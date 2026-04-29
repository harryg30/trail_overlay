import type { Network, Ride, Trail, TrailPhoto } from "@/lib/types";

export type MapBounds = { north: number; south: number; east: number; west: number }

export function polylinesEqual(a: [number, number][], b: [number, number][]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false
  }
  return true
}

export function pointInBounds([lat, lng]: [number, number], bounds: MapBounds): boolean {
  return (
    lat <= bounds.north &&
    lat >= bounds.south &&
    lng <= bounds.east &&
    lng >= bounds.west
  )
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function onSegment(a: [number, number], b: [number, number], p: [number, number]): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  )
}

function segmentsIntersect(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number]
): boolean {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)
  const eps = 1e-12

  if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) {
    return true
  }
  if (Math.abs(o1) <= eps && onSegment(a1, a2, b1)) return true
  if (Math.abs(o2) <= eps && onSegment(a1, a2, b2)) return true
  if (Math.abs(o3) <= eps && onSegment(b1, b2, a1)) return true
  if (Math.abs(o4) <= eps && onSegment(b1, b2, a2)) return true
  return false
}

function segmentIntersectsBounds(
  start: [number, number],
  end: [number, number],
  bounds: MapBounds
): boolean {
  if (pointInBounds(start, bounds) || pointInBounds(end, bounds)) return true

  const nw: [number, number] = [bounds.north, bounds.west]
  const ne: [number, number] = [bounds.north, bounds.east]
  const sw: [number, number] = [bounds.south, bounds.west]
  const se: [number, number] = [bounds.south, bounds.east]

  return (
    segmentsIntersect(start, end, nw, ne) ||
    segmentsIntersect(start, end, ne, se) ||
    segmentsIntersect(start, end, se, sw) ||
    segmentsIntersect(start, end, sw, nw)
  )
}

/** True if any vertex lies in bounds or any segment crosses the map rectangle. */
export function polylineInBounds(polyline: [number, number][], bounds: MapBounds): boolean {
  if (polyline.length === 0) return false
  if (polyline.some((point) => pointInBounds(point, bounds))) return true

  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const [lat, lng] of polyline) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }

  const bboxOverlaps =
    maxLat >= bounds.south &&
    minLat <= bounds.north &&
    maxLng >= bounds.west &&
    minLng <= bounds.east
  if (!bboxOverlaps) return false
  if (polyline.length === 1) return false

  for (let i = 0; i < polyline.length - 1; i++) {
    if (segmentIntersectsBounds(polyline[i], polyline[i + 1], bounds)) return true
  }
  return false
}

/** Ray casting in [lat, lng] space — ring is closed or open; at least 3 vertices. */
export function pointInPolygonLatLng(point: [number, number], ring: [number, number][]): boolean {
  if (ring.length < 3) return false
  const px = point[1]
  const py = point[0]
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0]
    const xi = ring[i][1]
    const yj = ring[j][0]
    const xj = ring[j][1]
    if ((yi > py) !== (yj > py)) {
      if (yj === yi) continue
      const xAt = xi + ((py - yi) / (yj - yi)) * (xj - xi)
      if (px < xAt) inside = !inside
    }
  }
  return inside
}

function polygonBBoxArea(ring: [number, number][]): number {
  const lats = ring.map((p) => p[0])
  const lngs = ring.map((p) => p[1])
  return (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs))
}

/**
 * Picks the network polygon that best contains the staged trail polyline.
 * Prefers centroid inside; tie-break by smaller bbox (more specific region).
 */
export function inferNetworkIdForPolyline(
  polyline: [number, number][],
  networks: Network[]
): string | undefined {
  if (polyline.length < 2 || networks.length === 0) return undefined

  const centroid: [number, number] = [
    polyline.reduce((s, p) => s + p[0], 0) / polyline.length,
    polyline.reduce((s, p) => s + p[1], 0) / polyline.length,
  ]

  const withPoly = networks.filter((n) => n.polygon.length >= 3)
  if (withPoly.length === 0) return undefined

  const centroidInside = withPoly.filter((n) => pointInPolygonLatLng(centroid, n.polygon))
  if (centroidInside.length === 1) return centroidInside[0].id
  if (centroidInside.length > 1) {
    return centroidInside.reduce((a, b) =>
      polygonBBoxArea(a.polygon) <= polygonBBoxArea(b.polygon) ? a : b
    ).id
  }

  const samples =
    polyline.length > 120 ? polyline.filter((_, i) => i % Math.ceil(polyline.length / 120) === 0) : polyline

  let bestId: string | undefined
  let bestRatio = -1
  let bestArea = Infinity
  for (const net of withPoly) {
    let inside = 0
    for (const p of samples) {
      if (pointInPolygonLatLng(p, net.polygon)) inside++
    }
    const ratio = samples.length > 0 ? inside / samples.length : 0
    const area = polygonBBoxArea(net.polygon)
    if (ratio > bestRatio || (ratio === bestRatio && area < bestArea)) {
      bestRatio = ratio
      bestArea = area
      bestId = net.id
    }
  }
  if (bestRatio < 0.12) return undefined
  return bestId
}

// Minimum distance in km from a point to any segment of a polyline
export function pointToPolylineDistanceKm(
  point: [number, number],
  polyline: [number, number][]
): number {
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    // Project point onto segment a->b (in lat/lon space, close enough for small distances)
    const abLat = b[0] - a[0];
    const abLon = b[1] - a[1];
    const abLen2 = abLat * abLat + abLon * abLon;
    let t = 0;
    if (abLen2 > 0) {
      t = ((point[0] - a[0]) * abLat + (point[1] - a[1]) * abLon) / abLen2;
      t = Math.max(0, Math.min(1, t));
    }
    const nearest: [number, number] = [a[0] + t * abLat, a[1] + t * abLon];
    const d = haversineKm(point, nearest);
    if (d < min) min = d;
  }
  // Fallback for single-point polylines
  if (polyline.length === 1) return haversineKm(point, polyline[0]);
  return min;
}

// Returns the longest contiguous run of points within radiusKm of the reference polyline
export function clipPolylineToCorridor(
  polyline: [number, number][],
  reference: [number, number][],
  radiusKm: number,
  minRunLength = 5
): [number, number][] {
  const inside = polyline.map(
    (pt) => pointToPolylineDistanceKm(pt, reference) <= radiusKm
  );

  // Find all contiguous runs of true values
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;

  for (let i = 0; i <= inside.length; i++) {
    if (i < inside.length && inside[i]) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        const len = i - runStart;
        if (len > bestLen) {
          bestLen = len;
          bestStart = runStart;
        }
        runStart = -1;
      }
    }
  }

  if (bestLen < minRunLength) return [];
  return polyline.slice(bestStart, bestStart + bestLen);
}

// Shifts each reference point toward the local mean of nearby ride points.
// Returns null if fewer than minRides have data in the corridor.
export function generateAveragedTrail(
  trimPolyline: [number, number][],
  rides: Ride[],
  corridorRadiusKm = 0.025,
  minRides = 2,
  outputSpacingKm = 0.010,
  maxRides = 25
): { polyline: [number, number][]; rideCount: number } | null {
  // Clip each ride to the corridor and tag points with rideId
  const clipped: { rideId: string; points: [number, number][] }[] = [];
  for (const ride of rides) {
    if (clipped.length >= maxRides) break;
    const clip = clipPolylineToCorridor(
      ride.polyline,
      trimPolyline,
      corridorRadiusKm
    );
    const dense = resamplePolyline(clip, 0.010)
    if (dense.length >= 5) clipped.push({ rideId: ride.id, points: dense });
  }

  if (clipped.length < minRides) return null;
  const rideCount = clipped.length;

  // Pool all clipped points tagged by rideId
  const pool: { point: [number, number]; rideId: string }[] = clipped.flatMap(
    (c) => c.points.map((p) => ({ point: p, rideId: c.rideId }))
  );

  // For each reference point, find nearby pool points and compute mean-of-means
  const refPolyline = resamplePolyline(trimPolyline, outputSpacingKm)
  const result: [number, number][] = refPolyline.map((refPt) => {
    const nearby = pool.filter(
      (p) => haversineKm(p.point, refPt) < corridorRadiusKm
    );

    const rideIds = new Set(nearby.map((p) => p.rideId));
    if (rideIds.size < 2) return refPt;

    // Mean-of-means: average per-ride centroids so each ride has equal weight
    const rideCentroids: [number, number][] = Array.from(rideIds).map((id) => {
      const pts = nearby.filter((p) => p.rideId === id).map((p) => p.point);
      const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const lon = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      return [lat, lon];
    });

    const lat =
      rideCentroids.reduce((s, p) => s + p[0], 0) / rideCentroids.length;
    const lon =
      rideCentroids.reduce((s, p) => s + p[1], 0) / rideCentroids.length;
    return [lat, lon];
  });

  return { polyline: result, rideCount };
}

// Linearly interpolate a polyline so consecutive points are at most `spacingKm` apart.
export function resamplePolyline(
  polyline: [number, number][],
  spacingKm: number
): [number, number][] {
  if (polyline.length < 2) return polyline
  const out: [number, number][] = [polyline[0]]
  for (let i = 1; i < polyline.length; i++) {
    const a = out[out.length - 1]
    const b = polyline[i]
    const d = haversineKm(a, b)
    const steps = Math.floor(d / spacingKm)
    for (let s = 1; s <= steps; s++) {
      const t = (s * spacingKm) / d
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    }
    out.push(b)
  }
  return out
}

export function haversineKm(
  a: [number, number],
  b: [number, number]
): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function polylineDistanceKm(points: [number, number][]): number {
  return points
    .slice(1)
    .reduce((sum, p, i) => sum + haversineKm(points[i], p), 0);
}

export function snapToNearestTrailPoint(
  lat: number,
  lon: number,
  trails: Trail[],
  maxDistanceKm = 0.1
): { trail: Trail; lat: number; lon: number; index: number } | null {
  let best: { trail: Trail; lat: number; lon: number; index: number; dist: number } | null = null

  for (const trail of trails) {
    for (let i = 0; i < trail.polyline.length; i++) {
      const pt = trail.polyline[i]
      const d = haversineKm([lat, lon], pt)
      if (d < maxDistanceKm && (best === null || d < best.dist)) {
        best = { trail, lat: pt[0], lon: pt[1], index: i, dist: d }
      }
    }
  }

  if (!best) return null
  return { trail: best.trail, lat: best.lat, lon: best.lon, index: best.index }
}

export function estimatedElevationGainFt(
  ride: Ride,
  startIdx: number,
  endIdx: number
): number {
  if (ride.pointCount <= 1) return 0;
  const fraction = (endIdx - startIdx) / ride.pointCount;
  return fraction * ride.elevation;
}

/** Map marker / list position — matches Leaflet trail photo layer. */
export function trailPhotoMapPoint(photo: TrailPhoto): [number, number] | null {
  const lat =
    photo.accepted && photo.trailLat != null ? photo.trailLat : photo.lat
  const lng =
    photo.accepted && photo.trailLon != null ? photo.trailLon : photo.lon
  if (lat == null || lng == null) return null
  return [lat, lng]
}
