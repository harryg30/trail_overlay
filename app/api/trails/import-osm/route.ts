import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { query } from '@/lib/db';
import { checkImportQuota, incrementImportQuota } from '@/lib/rate-limit';
import { bulkFindDuplicates } from '@/lib/spatial-dedup';
import { rankOsmTrails } from '@/lib/claude-import';

export async function POST(request: NextRequest) {
  console.log('[Import OSM] Request received')

  try {
    // 1. Check authentication
    const userId = await getSessionUserId();
    console.log('[Import OSM] User ID:', userId)

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request
    const body = await request.json();
    console.log('[Import OSM] Request body:', body)

    const { bbox, filters = {}, regionName = 'Unknown Region', instructions = '' } = body;

    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
      return NextResponse.json(
        { error: 'Invalid bbox: expected [south, west, north, east]' },
        { status: 400 }
      );
    }

    const [south, west, north, east] = bbox;

    console.log('[Import OSM] Bbox:', { south, west, north, east })

    // 3. Check rate limit (10/day, 100/month)
    console.log('[Import OSM] Checking quota...')
    const quotaCheck = await checkImportQuota(userId);
    console.log('[Import OSM] Quota check:', quotaCheck)

    if (!quotaCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Import quota exceeded',
          remaining: quotaCheck.remaining,
          resetAt: quotaCheck.resetAt,
        },
        { status: 429 }
      );
    }

    // 4. Create initial draft with "processing" status
    const draftResult = await query<any>(
      `INSERT INTO trail_import_drafts
       (user_id, bbox, filters, status, trails, stats, claude_prompt_tokens, claude_output_tokens, claude_cache_hit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, import_session_id`,
      [
        userId,
        JSON.stringify({ north, south, east, west }),
        JSON.stringify(filters),
        'processing',
        JSON.stringify([]),
        JSON.stringify({
          totalFound: 0,
          filtered: 0,
          newTrails: 0,
          duplicates: 0,
          recommended: 0,
        }),
        0,
        0,
        false,
      ]
    );

    const draft = draftResult[0];

    // 5. Increment quota immediately
    await incrementImportQuota(userId);

    // 6. Start background processing (don't await)
    processImportInBackground(
      draft.id,
      userId,
      south,
      west,
      north,
      east,
      regionName,
      instructions,
      filters
    ).catch((err) => {
      console.error('[Import OSM] Background processing error:', err);
    });

    // Return immediately with processing draft
    return NextResponse.json({
      success: true,
      draftId: draft.id,
      importSessionId: draft.import_session_id,
      status: 'processing',
      quotaRemaining: quotaCheck.remaining - 1,
    });
  } catch (error: any) {
    console.error('[Import OSM] Error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to import trails',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

async function processImportInBackground(
  draftId: string,
  userId: string,
  south: number,
  west: number,
  north: number,
  east: number,
  regionName: string,
  instructions: string,
  filters: any
) {
  try {
    console.log('[Import OSM BG] Starting background import for draft:', draftId);

    // Fetch OSM data from Overpass (via internal API proxy)
    console.log('[Import OSM] Fetching from Overpass...')

    // Use relative URL for internal API calls to work in both dev and prod
    const baseUrl = process.env.NODE_ENV === 'production'
      ? process.env.NEXT_PUBLIC_APP_URL
      : 'http://localhost:3000'

    console.log('[Import OSM] Using base URL:', baseUrl)

    const osmResponse = await fetch(
      `${baseUrl}/api/osm?south=${south}&west=${west}&north=${north}&east=${east}&filters=path,track,cycleway`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    console.log('[Import OSM] Overpass response status:', osmResponse.status)

    if (!osmResponse.ok) {
      const errorData = await osmResponse.json().catch(() => ({}));
      await markDraftFailed(draftId, errorData.error || 'Failed to fetch trails from OpenStreetMap');
      return;
    }

    const osmData = await osmResponse.json();
    const osmElements = osmData.elements || [];

    console.log('[Import OSM] Sample element:', JSON.stringify(osmElements[0], null, 2));

    // Build node index for geometry construction
    const nodeIndex = new Map<number, { lat: number; lon: number }>();
    for (const el of osmElements) {
      if (el.type === 'node') {
        nodeIndex.set(el.id, { lat: el.lat, lon: el.lon });
      }
    }

    console.log('[Import OSM] Indexed', nodeIndex.size, 'nodes');

    // 5. Server-side filtering (surface, access)
    const filteredTrails = filterOsmTrails(osmElements, filters);

    console.log(
      `[Import] Fetched ${osmElements.length} OSM elements, filtered to ${filteredTrails.length} trails`
    );

    // 6. Convert OSM elements to polylines and prepare for deduplication
    const trailsWithPolylines = filteredTrails
      .map((el) => {
        const polyline = extractPolyline(el, nodeIndex);
        if (!polyline || polyline.length < 2) return null;

        return {
          osmWayId: `way/${el.id}`,
          name: el.tags?.name || 'Unnamed Trail',
          polyline,
          tags: el.tags || {},
          distanceKm: calculateDistance(polyline),
        };
      })
      .filter((t) => t !== null);

    console.log(
      `[Import OSM] Built ${trailsWithPolylines.length} trails with polylines from ${filteredTrails.length} filtered trails`
    );

    // 7. PostGIS spatial deduplication
    const duplicateMap = await bulkFindDuplicates(trailsWithPolylines, {
      north,
      south,
      east,
      west,
    });

    // Filter out trails that have duplicates within 50m
    const newTrails = trailsWithPolylines.filter(
      (t) => !duplicateMap.has(t.osmWayId)
    );

    console.log(
      `[Import] After dedup: ${newTrails.length} new trails (${duplicateMap.size} duplicates removed)`
    );

    // 8. Get existing trails summary for Claude context
    const existingTrails = await query<any>(
      `SELECT name, difficulty FROM trails
       WHERE ST_Intersects(
         geom,
         ST_MakeEnvelope($1, $2, $3, $4, 4326)
       )
       LIMIT 50`,
      [west, south, east, north]
    );

    const existingTrailsSummary =
      existingTrails.length > 0
        ? existingTrails
            .map((t) => `${t.name} (${t.difficulty})`)
            .join(', ')
        : 'No existing trails in this area';

    // 9. Call Claude API to rank trails
    console.log('[Import OSM] Calling Claude API with', newTrails.length, 'trails...')
    const { results: claudeResults, usage } = await rankOsmTrails(
      newTrails,
      existingTrailsSummary,
      regionName,
      instructions
    );

    console.log(
      `[Import OSM] Claude ranked ${claudeResults.rankedTrails.length} trails (${usage.inputTokens} input, ${usage.outputTokens} output, cache hit: ${usage.cacheHit})`
    );

    // 10. Merge Claude results with original trail data (to get polyline and distanceKm)
    const trailDataMap = new Map(
      newTrails.map((t) => [t.osmWayId, t])
    );

    const enrichedTrails = claudeResults.rankedTrails.map((claudeTrail) => {
      const originalTrail = trailDataMap.get(claudeTrail.osmWayId);
      if (!originalTrail) {
        console.warn(`[Import] Claude returned unknown trail: ${claudeTrail.osmWayId}`);
        return claudeTrail;
      }

      return {
        ...claudeTrail,
        polyline: originalTrail.polyline,
        distanceKm: originalTrail.distanceKm,
      };
    });

    // 11. Update draft with results
    await query(
      `UPDATE trail_import_drafts
       SET status = $1, trails = $2, stats = $3, claude_prompt_tokens = $4, claude_output_tokens = $5, claude_cache_hit = $6
       WHERE id = $7`,
      [
        'pending',
        JSON.stringify(enrichedTrails),
        JSON.stringify({
          totalFound: osmElements.length,
          filtered: filteredTrails.length,
          newTrails: newTrails.length,
          duplicates: duplicateMap.size,
          recommended: enrichedTrails.length,
        }),
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheHit,
        draftId,
      ]
    );

    console.log('[Import OSM BG] Import complete for draft:', draftId);
  } catch (error: any) {
    console.error('[Import OSM BG] Background error:', error);
    await markDraftFailed(draftId, error.message || 'Import failed');
  }
}

async function markDraftFailed(draftId: string, errorMessage: string) {
  try {
    await query(
      `UPDATE trail_import_drafts SET status = $1, stats = $2 WHERE id = $3`,
      [
        'failed',
        JSON.stringify({
          error: errorMessage,
          totalFound: 0,
          filtered: 0,
          newTrails: 0,
          duplicates: 0,
          recommended: 0,
        }),
        draftId,
      ]
    );
  } catch (err) {
    console.error('[Import OSM BG] Failed to mark draft as failed:', err);
  }
}

function filterOsmTrails(elements: any[], filters: any): any[] {
  return elements.filter((el) => {
    if (el.type !== 'way') return false;

    const tags = el.tags || {};

    // Filter by surface (exclude paved)
    if (
      tags.surface &&
      ['asphalt', 'paved', 'concrete'].includes(tags.surface)
    ) {
      return false;
    }

    // Filter by access (exclude private unless permissive)
    if (tags.access === 'private' && tags.access !== 'permissive') {
      return false;
    }

    // Filter by trail status (exclude abandoned)
    if (tags.trail_status === 'abandoned') {
      return false;
    }

    // Apply user filters (if provided)
    if (filters.minLength) {
      // We'll calculate this after polyline extraction
    }

    return true;
  });
}

function extractPolyline(
  element: any,
  nodeIndex: Map<number, { lat: number; lon: number }>
): [number, number][] | null {
  // If geometry is already included (some Overpass queries include it)
  if (element.geometry && Array.isArray(element.geometry)) {
    return element.geometry.map((node: any) => [node.lat, node.lon]);
  }

  // Otherwise, build from node references
  if (!element.nodes || !Array.isArray(element.nodes)) {
    return null;
  }

  const polyline: [number, number][] = [];
  for (const nodeId of element.nodes) {
    const node = nodeIndex.get(nodeId);
    if (!node) {
      console.warn(`[Import] Missing node ${nodeId} for way ${element.id}`);
      return null; // Missing node data, skip this way
    }
    polyline.push([node.lat, node.lon]);
  }

  return polyline.length >= 2 ? polyline : null;
}

function calculateDistance(polyline: [number, number][]): number {
  let distance = 0;
  for (let i = 1; i < polyline.length; i++) {
    distance += haversineDistance(
      polyline[i - 1][0],
      polyline[i - 1][1],
      polyline[i][0],
      polyline[i][1]
    );
  }
  return distance / 1000; // meters to km
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
