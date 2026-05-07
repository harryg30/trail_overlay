/**
 * Overpass API client for fetching OSM ways as GeoJSON-like features.
 *
 * Queries the public Overpass API for highway ways within a bounding box,
 * filtered by configurable highway tag values.
 */

export type OsmFetchErrorCode = 'rate_limited' | 'overloaded' | 'upstream_error'

export class OsmFetchError extends Error {
  readonly code: OsmFetchErrorCode
  readonly httpStatus: number

  constructor(message: string, code: OsmFetchErrorCode, httpStatus: number) {
    super(message)
    this.name = 'OsmFetchError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface OsmWayFeature {
  osmId: number
  name: string | undefined
  highway: string | undefined
  polyline: [number, number][]
  tags: Record<string, string>
  distanceKm: number
}

export const DEFAULT_HIGHWAY_FILTERS = [
  'path',
  'footway',
  'bridleway',
  'cycleway',
  'steps',
  'track',
] as const

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const USE_PROXY = typeof window !== 'undefined'

function buildOverpassQuery(
  bounds: { south: number; west: number; north: number; east: number },
  highwayFilters: readonly string[]
): string {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
  const filters = highwayFilters.map((h) => `way["highway"="${h}"](${bbox});`).join('')
  return `[timeout:15][out:json];(${filters});out geom;`
}

function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function polylineDistanceKm(pts: [number, number][]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) {
    d += haversineKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
  }
  return d
}

/** Classify Overpass HTTP failures — 429 = rate limit; 502/503/504 = overloaded / busy. */
export function classifyOverpassFailure(httpStatus: number, bodyText: string): OsmFetchErrorCode {
  const t = bodyText.toLowerCase()
  if (httpStatus === 429) return 'rate_limited'
  if (httpStatus === 503 || httpStatus === 504 || httpStatus === 502) return 'overloaded'
  if (
    /too many requests|rate.?limit|slots?\s*full|quota|please wait|try again later/i.test(t) ||
    (httpStatus === 400 && /rate|too many|slot/i.test(t))
  ) {
    return 'rate_limited'
  }
  if (/busy|overload|capacity|gateway|temporarily unavailable|bad gateway/i.test(t)) {
    return 'overloaded'
  }
  return 'upstream_error'
}

export function overpassErrorMessage(code: OsmFetchErrorCode, httpStatus: number): string {
  if (code === 'rate_limited') {
    return `Overpass rate limit (HTTP ${httpStatus}) — wait a minute or zoom in.`
  }
  if (code === 'overloaded') {
    return `Overpass is busy (HTTP ${httpStatus}) — try again shortly or zoom in.`
  }
  return `Overpass error (HTTP ${httpStatus})`
}

export function extractOverpassRemark(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const r = (data as { remark?: unknown }).remark
  return typeof r === 'string' ? r : null
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  tags?: Record<string, string>
}

export async function fetchOsmWays(
  bounds: { south: number; west: number; north: number; east: number },
  highwayFilters: readonly string[] = DEFAULT_HIGHWAY_FILTERS,
  signal?: AbortSignal
): Promise<OsmWayFeature[]> {
  let data: { elements: OverpassElement[] }

  if (USE_PROXY) {
    const sp = new URLSearchParams({
      south: String(bounds.south),
      west: String(bounds.west),
      north: String(bounds.north),
      east: String(bounds.east),
      filters: highwayFilters.join(','),
    })
    const res = await fetch(`/api/osm?${sp}`, { signal })
    let body: { elements: OverpassElement[] } | { error?: string; code?: OsmFetchErrorCode }
    try {
      body = (await res.json()) as typeof body
    } catch {
      throw new OsmFetchError(`OSM proxy returned non-JSON (HTTP ${res.status})`, 'upstream_error', res.status)
    }
    if (!res.ok) {
      const b = body as { error?: string; code?: OsmFetchErrorCode }
      const code: OsmFetchErrorCode =
        b.code === 'rate_limited' || b.code === 'overloaded' ? b.code : 'upstream_error'
      throw new OsmFetchError(
        b.error ?? `OSM proxy error: ${res.status}`,
        code,
        res.status
      )
    }
    data = body as { elements: OverpassElement[] }
  } else {
    const query = buildOverpassQuery(bounds, highwayFilters)
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
    })
    const rawText = await res.text()
    if (!res.ok) {
      const code = classifyOverpassFailure(res.status, rawText)
      throw new OsmFetchError(
        overpassErrorMessage(code, res.status),
        code,
        res.status
      )
    }
    try {
      data = JSON.parse(rawText) as { elements: OverpassElement[] }
    } catch {
      throw new OsmFetchError(
        'Invalid response from Overpass',
        'upstream_error',
        res.status
      )
    }
    const remark = extractOverpassRemark(data)
    if (remark && /too many|rate limit|quota|slot/i.test(remark)) {
      throw new OsmFetchError(remark, 'rate_limited', 429)
    }
    if (remark && /timeout|busy|overload|capacity/i.test(remark)) {
      throw new OsmFetchError(remark, 'overloaded', 503)
    }
    if (!data.elements) {
      data = { elements: [] }
    }
  }

  const nodeMap = new Map<number, [number, number]>()
  for (const el of data.elements) {
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      nodeMap.set(el.id, [el.lat, el.lon])
    }
  }

  const features: OsmWayFeature[] = []
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.nodes) continue
    const polyline: [number, number][] = []
    for (const nid of el.nodes) {
      const coord = nodeMap.get(nid)
      if (coord) polyline.push(coord)
    }
    if (polyline.length < 2) continue

    const tags = el.tags ?? {}
    features.push({
      osmId: el.id,
      name: tags.name,
      highway: tags.highway,
      polyline,
      tags,
      distanceKm: polylineDistanceKm(polyline),
    })
  }

  return features
}
