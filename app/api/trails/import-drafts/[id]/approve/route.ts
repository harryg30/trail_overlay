import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

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
    const { selectedTrailIds } = await request.json();

    if (!Array.isArray(selectedTrailIds) || selectedTrailIds.length === 0) {
      return NextResponse.json(
        { error: 'No trails selected' },
        { status: 400 }
      );
    }

    // Fetch draft
    const drafts = await query<any>(
      `SELECT * FROM trail_import_drafts WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (drafts.length === 0) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    const draft = drafts[0];

    if (draft.status !== 'pending') {
      return NextResponse.json(
        { error: 'Draft already processed' },
        { status: 400 }
      );
    }

    const allTrails = draft.trails as any[];
    const selectedTrails = allTrails.filter((t) =>
      selectedTrailIds.includes(t.osmWayId)
    );

    if (selectedTrails.length === 0) {
      return NextResponse.json(
        { error: 'No matching trails found' },
        { status: 400 }
      );
    }

    // Create changeset
    const changeSetResult = await query<any>(
      `INSERT INTO trail_change_sets (created_by_user_id, comment)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, `OpenStreetMap import (${selectedTrails.length} trails)`]
    );

    const changeSetId = changeSetResult[0].id;

    // Batch create trails in chunks of 50
    const CHUNK_SIZE = 50;
    const createdTrailIds: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < selectedTrails.length; i += CHUNK_SIZE) {
      const chunk = selectedTrails.slice(i, i + CHUNK_SIZE);

      try {
        const chunkIds = await createTrailChunk(
          chunk,
          userId,
          draft.import_session_id,
          changeSetId
        );
        createdTrailIds.push(...chunkIds);

        console.log(
          `[Import] Created chunk ${i / CHUNK_SIZE + 1}: ${chunkIds.length} trails`
        );
      } catch (error: any) {
        console.error(`[Import] Chunk ${i / CHUNK_SIZE + 1} failed:`, error);
        errors.push(
          `Chunk ${i / CHUNK_SIZE + 1} (trails ${i}-${i + chunk.length}): ${error.message}`
        );
      }
    }

    // Don't mark the draft as published if every chunk failed — keeping it
    // pending lets the user retry once the underlying issue is fixed instead
    // of silently losing the import session.
    if (createdTrailIds.length === 0) {
      return NextResponse.json(
        {
          error: errors[0] ?? 'No trails were created',
          createdCount: 0,
          errors,
        },
        { status: 500 }
      );
    }

    // Mark draft as published (some trails created — partial success is OK).
    await query(
      `UPDATE trail_import_drafts
       SET status = 'published',
           published_at = NOW(),
           selected_trail_ids = $1,
           created_trail_db_ids = $2,
           created_change_set_id = $3
       WHERE id = $4`,
      [selectedTrailIds, createdTrailIds, changeSetId, id]
    );

    return NextResponse.json({
      success: true,
      createdCount: createdTrailIds.length,
      createdTrailIds,
      changeSetId,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('[Import Approve] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to approve import', details: error.message },
      { status: 500 }
    );
  }
}

async function createTrailChunk(
  trails: any[],
  userId: string,
  importSessionId: string,
  changeSetId: string
): Promise<string[]> {
  return withTransaction(async (tx) => {
    const createdIds: string[] = [];

    for (const trail of trails) {
      const wktLineString = `LINESTRING(${trail.polyline.map(([lat, lon]: [number, number]) => `${lon} ${lat}`).join(',')})`;

      const osmWayIdNumeric = trail.osmWayId?.startsWith('way/')
        ? parseInt(trail.osmWayId.slice(4), 10) || null
        : null;

      const trailRow = await tx.queryOne<{ id: string }>(
        `INSERT INTO trails
         (name, difficulty, direction, polyline, distance_km, elevation_gain_ft,
          notes, source, osm_way_id, uploaded_by_user_id, geom)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, ST_GeomFromText($11, 4326))
         RETURNING id`,
        [
          trail.name,
          trail.difficulty || 'not_set',
          trail.direction || 'not_set',
          JSON.stringify(trail.polyline),
          trail.distanceKm || 0,
          trail.elevationGainFt || 0,
          `OSM Way ID: ${trail.osmWayId}${trail.reasoning ? `\n\nAI Analysis: ${trail.reasoning}` : ''}`,
          'osm',
          osmWayIdNumeric,
          userId,
          wktLineString,
        ]
      );

      if (!trailRow) {
        throw new Error(`Trail insert returned no row for ${trail.osmWayId}`);
      }
      const trailId = trailRow.id;
      createdIds.push(trailId);

      await tx.query(
        `INSERT INTO trail_revisions
         (trail_id, created_by_user_id, change_set_id, import_session_id,
          ai_categorized, action, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          trailId,
          userId,
          changeSetId,
          importSessionId,
          true,
          'create',
          JSON.stringify({
            name: trail.name,
            difficulty: trail.difficulty || 'not_set',
            direction: trail.direction || 'not_set',
            polyline: trail.polyline,
            distanceKm: trail.distanceKm || 0,
            elevationGainFt: trail.elevationGainFt || 0,
            source: 'osm',
            osmWayId: trail.osmWayId,
          }),
        ]
      );
    }

    return createdIds;
  });
}
