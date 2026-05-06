import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') || 'pending';

    // Fetch user's import drafts
    const rows = await query<any>(
      `SELECT
        id,
        import_session_id,
        bbox,
        filters,
        status,
        trails,
        stats,
        created_at,
        approved_at,
        published_at,
        claude_prompt_tokens,
        claude_output_tokens,
        claude_cache_hit
      FROM trail_import_drafts
      WHERE user_id = $1
        AND ($2 = 'all' OR status = $2)
      ORDER BY created_at DESC
      LIMIT 50`,
      [userId, status]
    );

    const drafts = rows.map((row) => ({
      id: row.id,
      importSessionId: row.import_session_id,
      bbox: row.bbox,
      filters: row.filters,
      status: row.status,
      trails: row.trails,
      stats: row.stats,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      publishedAt: row.published_at,
      claudeUsage: {
        promptTokens: row.claude_prompt_tokens,
        outputTokens: row.claude_output_tokens,
        cacheHit: row.claude_cache_hit,
      },
    }));

    return NextResponse.json({
      success: true,
      drafts,
      count: drafts.length,
    });
  } catch (error: any) {
    console.error('[Import Drafts] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch import drafts' },
      { status: 500 }
    );
  }
}
