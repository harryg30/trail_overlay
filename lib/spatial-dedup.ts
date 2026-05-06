import { query } from '@/lib/db';

export interface DuplicateMatch {
  trailId: string;
  trailName: string;
  distanceMeters: number;
}

export async function findDuplicateTrails(
  polyline: [number, number][],
  bbox: { north: number; south: number; east: number; west: number },
  thresholdMeters = 50
): Promise<DuplicateMatch[]> {
  // Convert polyline to PostGIS LineString
  // polyline format: [[lat, lon], ...] -> need (lon lat, lon lat, ...)
  const lineString = polyline
    .map(([lat, lon]) => `${lon} ${lat}`)
    .join(',');

  const geomWKT = `LINESTRING(${lineString})`;

  // Build bbox polygon for spatial filter
  const bboxWKT = `POLYGON((
    ${bbox.west} ${bbox.south},
    ${bbox.east} ${bbox.south},
    ${bbox.east} ${bbox.north},
    ${bbox.west} ${bbox.north},
    ${bbox.west} ${bbox.south}
  ))`;

  const sql = `
    SELECT
      t.id::text as trail_id,
      t.name as trail_name,
      dist as distance_meters
    FROM (
      SELECT
        t.id,
        t.name,
        ST_HausdorffDistance(
          ST_Transform(t.geom, 3857),
          ST_Transform(ST_GeomFromText($1, 4326), 3857)
        ) as dist
      FROM trails t
      WHERE
        t.geom && ST_GeomFromText($2, 4326)
        AND ST_HausdorffDistance(
          ST_Transform(t.geom, 3857),
          ST_Transform(ST_GeomFromText($1, 4326), 3857)
        ) < $3
    ) sub
    ORDER BY dist ASC
    LIMIT 5
  `;

  const results = await query(sql, [geomWKT, bboxWKT, thresholdMeters]);

  return results.map((row) => ({
    trailId: row.trail_id,
    trailName: row.trail_name,
    distanceMeters: parseFloat(row.distance_meters),
  }));
}

// Bulk deduplication for import (checks many trails at once)
export async function bulkFindDuplicates(
  trails: Array<{ osmWayId: string; polyline: [number, number][] }>,
  bbox: { north: number; south: number; east: number; west: number }
): Promise<Map<string, DuplicateMatch[]>> {
  const duplicates = new Map<string, DuplicateMatch[]>();

  // Process in parallel (but limit concurrency to avoid overwhelming DB)
  const concurrency = 5;
  for (let i = 0; i < trails.length; i += concurrency) {
    const batch = trails.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((trail) => findDuplicateTrails(trail.polyline, bbox))
    );

    batch.forEach((trail, idx) => {
      if (results[idx].length > 0) {
        duplicates.set(trail.osmWayId, results[idx]);
      }
    });
  }

  return duplicates;
}
