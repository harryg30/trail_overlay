-- migrations/016_spatial_indexes.sql

-- Enable PostGIS (may already be enabled)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add spatial column for efficient deduplication
-- We'll populate this from the existing JSONB polyline
ALTER TABLE trails ADD COLUMN geom GEOMETRY(LineString, 4326);

-- Backfill geometry from existing polylines
-- polyline is stored as [[lat1, lon1], [lat2, lon2], ...]
-- PostGIS expects (lon, lat) so we need to swap
UPDATE trails
SET geom = ST_GeomFromText(
  'LINESTRING(' ||
  (
    SELECT string_agg(
      (point->1)::text || ' ' || (point->0)::text,
      ','
    )
    FROM jsonb_array_elements(polyline) AS point
  ) || ')',
  4326
)
WHERE polyline IS NOT NULL
  AND jsonb_array_length(polyline) >= 2
  AND geom IS NULL;

-- Spatial index for fast nearest-neighbor queries
CREATE INDEX idx_trails_geom ON trails USING GIST(geom);

-- Function to find duplicate trails within bbox
CREATE OR REPLACE FUNCTION find_duplicate_trails(
  candidate_geom GEOMETRY,
  search_bbox GEOMETRY,
  threshold_meters FLOAT DEFAULT 50
)
RETURNS TABLE(trail_id UUID, distance_meters FLOAT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    ST_HausdorffDistance(t.geom::geography, candidate_geom::geography) as dist
  FROM trails t
  WHERE
    t.geom && search_bbox -- bbox filter (uses spatial index)
    AND ST_HausdorffDistance(t.geom::geography, candidate_geom::geography) < threshold_meters
  ORDER BY dist ASC
  LIMIT 5; -- return top 5 closest matches
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION find_duplicate_trails IS 'Find trails similar to candidate using Hausdorff distance (directed, asymmetric)';
