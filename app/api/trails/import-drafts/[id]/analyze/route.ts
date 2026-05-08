import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { query } from '@/lib/db';
import { checkImportQuota, incrementImportQuota } from '@/lib/rate-limit';
import { rankOsmTrails } from '@/lib/claude-import';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Check rate limit (10/day for Claude analysis) - skip in dev mode
    if (process.env.NODE_ENV !== 'development') {
      const quotaCheck = await checkImportQuota(userId);
      if (!quotaCheck.allowed) {
        return NextResponse.json(
          {
            success: false,
            error: 'Claude analysis quota exceeded',
            resetAt: quotaCheck.resetAt,
          },
          { status: 429 }
        );
      }
    } else {
      console.log('[Analyze] Dev mode: skipping quota check');
    }

    // Extract instructions from request body
    let instructions = '';
    try {
      const body = await request.json();
      instructions = body.instructions || '';
    } catch {
      // Request body may be empty or not JSON
    }

    // Fetch the draft
    const draftResult = await query<any>(
      `SELECT
        id, trails, stats, suggestion_set_name, ai_analyzed, bbox
      FROM trail_import_drafts
      WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (draftResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Draft not found' },
        { status: 404 }
      );
    }

    const draft = draftResult[0];

    // Skip if already analyzed
    if (draft.ai_analyzed) {
      return NextResponse.json({
        success: true,
        message: 'Draft already analyzed',
        draft,
      });
    }

    const trails = draft.trails || [];
    if (trails.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No trails to analyze',
        draft,
      });
    }

    // Prepare trail data for Claude
    const trailsForClaude = (trails as any[]).map((t: any) => ({
      osmWayId: t.osmWayId,
      name: t.name,
      polyline: t.polyline,
      tags: t.tags || {},
      distanceKm: t.distanceKm,
    }));

    // Get existing trails summary for Claude context
    const bbox = draft.bbox;
    const existingTrails = await query<any>(
      `SELECT name, difficulty FROM trails
       WHERE ST_Intersects(
         geom,
         ST_MakeEnvelope($1, $2, $3, $4, 4326)
       )
       LIMIT 50`,
      [bbox.west, bbox.south, bbox.east, bbox.north]
    );

    const existingTrailsSummary =
      existingTrails.length > 0
        ? existingTrails
            .map((t) => `${t.name} (${t.difficulty})`)
            .join(', ')
        : 'No existing trails in this area';

    // Call Claude API to rank trails
    const { results: claudeResults, usage } = await rankOsmTrails(
      trailsForClaude,
      existingTrailsSummary,
      draft.suggestion_set_name || 'Unknown',
      instructions
    );

    // Merge Claude results with original trail data
    const trailDataMap = new Map(
      trailsForClaude.map((t: any) => [t.osmWayId, t])
    );

    const enrichedTrails = claudeResults.rankedTrails.map((claudeTrail: any) => {
      const originalTrail = trailDataMap.get(claudeTrail.osmWayId);
      if (!originalTrail) {
        return claudeTrail;
      }

      return {
        ...claudeTrail,
        polyline: originalTrail.polyline,
        distanceKm: originalTrail.distanceKm,
      };
    });

    // Update draft with analyzed results
    await query(
      `UPDATE trail_import_drafts
       SET trails = $1::jsonb, ai_analyzed = $2, ai_analyzed_at = $3,
           instructions = $4, claude_prompt_tokens = $5, claude_output_tokens = $6, claude_cache_hit = $7
       WHERE id = $8`,
      [
        JSON.stringify(enrichedTrails),
        true,
        new Date().toISOString(),
        instructions,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheHit,
        id,
      ]
    );

    // Increment quota after successful analysis (skip in dev mode)
    if (process.env.NODE_ENV !== 'development') {
      await incrementImportQuota(userId);
    }

    return NextResponse.json({
      success: true,
      message: 'Analysis complete',
      trails: enrichedTrails,
      usage: {
        promptTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheHit: usage.cacheHit,
      },
    });
  } catch (error: any) {
    console.error('[Import Analyze] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to analyze trails',
      },
      { status: 500 }
    );
  }
}
