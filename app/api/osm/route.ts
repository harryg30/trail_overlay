import { NextRequest, NextResponse } from 'next/server'
import {
  OsmFetchError,
  classifyOverpassFailure,
  extractOverpassRemark,
  overpassErrorMessage,
} from '@/lib/overpass'

/**
 * Proxies Overpass API requests with in-memory caching and in-flight
 * deduplication. Multiple concurrent requests for the same (rounded) bbox
 * coalesce into a single Overpass call, staying under their 2-concurrent-
 * request limit.
 */

interface CacheEntry {
  data: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()
const CACHE_TTL_MS = 5 * 60 * 1000

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const DEFAULT_FILTERS = ['path', 'footway', 'bridleway', 'cycleway', 'steps', 'track']

function roundCoord(v: number, precision = 3): number {
  const factor = 10 ** precision
  return Math.round(v * factor) / factor
}

function buildCacheKey(south: number, west: number, north: number, east: number, filters: string[]): string {
  return `${roundCoord(south)},${roundCoord(west)},${roundCoord(north)},${roundCoord(east)}|${filters.sort().join(',')}`
}

function buildOverpassQuery(
  south: number, west: number, north: number, east: number,
  filters: string[]
): string {
  const bbox = `${south},${west},${north},${east}`
  const ways = filters.map((h) => `way["highway"="${h}"](${bbox});`).join('')
  return `[timeout:15][out:json];(${ways});out geom;`
}

async function fetchOverpass(key: string, query: string): Promise<unknown> {
  console.log('[Overpass] Query:', query.slice(0, 200))

  const res = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Trail-Overlay-App/1.0'
    },
  })

  console.log('[Overpass] Response status:', res.status)
  const text = await res.text()
  console.log('[Overpass] Response body:', text.slice(0, 200))

  if (!res.ok) {
    const code = classifyOverpassFailure(res.status, text)
    console.error('[Overpass] HTTP', res.status, ':', text.slice(0, 500))
    throw new OsmFetchError(overpassErrorMessage(code, res.status), code, res.status)
  }

  let data: unknown
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new OsmFetchError('Invalid JSON from Overpass', 'upstream_error', res.status)
  }

  const remark = extractOverpassRemark(data)
  if (remark && /too many|rate.?limit|quota|slot/i.test(remark)) {
    throw new OsmFetchError(remark.length > 220 ? `${remark.slice(0, 220)}…` : remark, 'rate_limited', 429)
  }
  if (remark && /timeout|busy|overload|capacity|runtime error/i.test(remark)) {
    throw new OsmFetchError(remark.length > 220 ? `${remark.slice(0, 220)}…` : remark, 'overloaded', 503)
  }

  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })

  if (cache.size > 200) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (v.expiresAt < now) cache.delete(k)
    }
  }

  return data
}

export async function GET(request: NextRequest) {
  try {
    console.log('[OSM GET] Handler start')

    const sp = request.nextUrl.searchParams
    const south = Number(sp.get('south'))
    const west = Number(sp.get('west'))
    const north = Number(sp.get('north'))
    const east = Number(sp.get('east'))

    console.log('[OSM GET] Received request with bbox:', { south, west, north, east })

    if ([south, west, north, east].some((v) => !Number.isFinite(v))) {
      console.log('[OSM GET] Invalid bbox')
      return NextResponse.json({ error: 'Invalid bbox' }, { status: 400 })
    }

    const filters = sp.get('filters')
      ? sp.get('filters')!.split(',').filter(Boolean)
      : DEFAULT_FILTERS

    console.log('[OSM GET] Filters:', filters)

    const key = buildCacheKey(south, west, north, east, filters)

    // 1. Serve from cache
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      console.log('[OSM GET] Serving from cache')
      return NextResponse.json(cached.data, {
        headers: { 'X-Cache': 'HIT' },
      })
    }

    // 2. Coalesce with an in-flight request for the same key
    try {
      let promise = inflight.get(key)
      let coalesced = false
      if (!promise) {
        console.log('[OSM GET] Building query')
        const query = buildOverpassQuery(south, west, north, east, filters)
        console.log('[OSM GET] Query built:', query.slice(0, 150))
        promise = fetchOverpass(key, query)
        inflight.set(key, promise)
      } else {
        console.log('[OSM GET] Coalescing with existing request')
        coalesced = true
      }

      console.log('[OSM GET] Awaiting Overpass response')
      const data = await promise
      console.log('[OSM GET] Got Overpass data')
      return NextResponse.json(data, {
        headers: { 'X-Cache': coalesced ? 'COALESCED' : 'MISS' },
      })
    } catch (err) {
      console.error('[OSM GET] Error in main flow:', err)
      throw err
    } finally {
      inflight.delete(key)
    }
  } catch (err) {
    console.error('[OSM GET] Outer catch:', err)
    if (err instanceof OsmFetchError) {
      const status =
        err.code === 'rate_limited'
          ? 429
          : err.code === 'overloaded'
            ? 503
            : 502
      return NextResponse.json(
        { error: err.message, code: err.code, httpStatus: err.httpStatus },
        { status }
      )
    }
    console.error('Overpass proxy error:', err)
    const msg = err instanceof Error ? err.message : 'Failed to fetch from Overpass'
    return NextResponse.json({ error: msg, code: 'upstream_error' as const }, { status: 502 })
  }
}
