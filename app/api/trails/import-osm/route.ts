import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { query } from '@/lib/db';
import { bulkFindDuplicates } from '@/lib/spatial-dedup';

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Parse request
    const body = await request.json();
    const { bbox, filters = {}, regionName, suggestionSetName, instructions = '' } = body;

    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
      return NextResponse.json(
        { success: false, error: 'Invalid bbox: expected [south, west, north, east]' },
        { status: 400 }
      );
    }

    const [south, west, north, east] = bbox;

    // Create initial draft with "processing" status
    const draftResult = await query<any>(
      `INSERT INTO trail_import_drafts
       (user_id, bbox, filters, status, trails, stats, suggestion_set_name, ai_analyzed, claude_prompt_tokens, claude_output_tokens, claude_cache_hit)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11)
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
        (body.suggestionSetName || body.regionName || 'Unnamed').trim(),
        false,
        0,
        0,
        false,
      ]
    );

    const draft = draftResult[0];

    // Start background processing using Vercel waitUntil
    const waitUntilPromise = processImportInBackground(
      draft.id,
      userId,
      south,
      west,
      north,
      east,
      regionName,
      filters
    ).catch((err) => {
      console.error('[Import OSM] Background processing error:', err);
    });

    // Use waitUntil if available (Vercel Functions), otherwise just let it run
    if ('waitUntil' in request) {
      (request as any).waitUntil(waitUntilPromise);
    }

    // Return immediately with processing draft
    return NextResponse.json({
      success: true,
      draftId: draft.id,
      importSessionId: draft.import_session_id,
      status: 'processing',
    });
  } catch (error: any) {
    console.error('[Import OSM] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to import trails',
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
  filters: any
) {
  console.log('[Import OSM BG] Starting background processing for draft:', draftId)
  console.log('[Import OSM BG] Bbox:', { south, west, north, east })

  try {
    // Derive baseUrl from environment, with validation
    // In development, always use localhost even if NEXT_PUBLIC_APP_URL is set
    let baseUrl = process.env.NODE_ENV === 'development'
      ? 'http://localhost:3000'
      : (process.env.NEXT_PUBLIC_APP_URL?.trim() ||
         (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'));

    baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash

    const osmUrl = `${baseUrl}/api/osm?south=${south}&west=${west}&north=${north}&east=${east}&filters=path,track,cycleway`;
    console.log('[Import OSM BG] Calling OSM endpoint:', osmUrl)

    let osmResponse;
    try {
      osmResponse = await fetch(osmUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (fetchErr) {
      console.error('[Import OSM BG] Fetch error:', fetchErr)
      await markDraftFailed(draftId, `Failed to fetch from OSM endpoint: ${fetchErr instanceof Error ? fetchErr.message : 'unknown error'}`);
      return;
    }

    console.log('[Import OSM BG] OSM API response status:', osmResponse.status)

    if (!osmResponse.ok) {
      const errorData = await osmResponse.json().catch(() => ({}));
      console.error('[Import OSM BG] OSM API error:', errorData)
      await markDraftFailed(draftId, errorData.error || 'Failed to fetch trails from OpenStreetMap');
      return;
    }

    const osmData = await osmResponse.json();
    const osmElements = osmData.elements || [];

    // Build node index for geometry construction
    const nodeIndex = new Map<number, { lat: number; lon: number }>();
    for (const el of osmElements) {
      if (el.type === 'node') {
        nodeIndex.set(el.id, { lat: el.lat, lon: el.lon });
      }
    }

    // Server-side filtering (surface, access)
    const filteredTrails = filterOsmTrails(osmElements, filters);

    // Convert OSM elements to polylines and prepare for deduplication
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
          difficulty: 'not_set' as const,
          type: 'mixed' as const,
          score: 0,
          reasoning: 'Not yet analyzed by Claude AI',
        };
      })
      .filter((t) => t !== null);

    // PostGIS spatial deduplication
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

    // Update draft with raw trails (no Claude analysis yet)
    await query(
      `UPDATE trail_import_drafts
       SET status = $1, trails = $2::jsonb, stats = $3::jsonb
       WHERE id = $4`,
      [
        'pending',
        JSON.stringify(newTrails),
        JSON.stringify({
          totalFound: osmElements.length,
          filtered: filteredTrails.length,
          newTrails: newTrails.length,
          duplicates: duplicateMap.size,
          recommended: newTrails.length,
        }),
        draftId,
      ]
    );
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

    // Filter by access: allow yes/permissive/designated, exclude private and other restricted values
    if (tags.access && tags.access !== 'yes' && tags.access !== 'permissive' && tags.access !== 'designated') {
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
