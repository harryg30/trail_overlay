/**
 * Valhalla API utilities for snapping to trails and routing between points.
 * Uses OpenRouteService's public Valhalla instance.
 */

const VALHALLA_BASE = 'https://api.openrouteservice.org/v2'
const ORS_API_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY

interface ValhallaNearestResponse {
  edges: Array<{
    id: number
    way_id: number
    names?: string[]
    length: number
  }>
  matched_point: {
    lat: number
    lng: number
  }
}

interface ValhallaRouteResponse {
  routes: Array<{
    geometry: {
      coordinates: [number, number][]
    }
    legs: Array<{
      steps: Array<{
        way_name?: string
        way_id?: number
      }>
    }>
  }>
}

export interface SnapResult {
  /** Snapped [lon, lat] */
  point: [number, number]
  /** OSM way ID */
  osmWayId?: number
  /** OSM way name if available */
  wayName?: string
}

export interface RouteResult {
  /** Route polyline as [lon, lat][] */
  polyline: [number, number][]
  /** OSM way IDs encountered along the route */
  osmWayIds: number[]
}

/**
 * Snap a point to the nearest trail/road using Valhalla.
 * Tries Valhalla first, falls back to error handling if unavailable.
 */
export async function snapToNearestWay(
  lat: number,
  lng: number,
  radiusMeters = 50,
): Promise<SnapResult | null> {
  if (!ORS_API_KEY) {
    console.warn('NEXT_PUBLIC_ORS_API_KEY not set; snapping disabled')
    return null
  }

  try {
    const response = await fetch(`${VALHALLA_BASE}/nearest?api_key=${ORS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: [lng, lat],
        preference: 'bicycle',
        radius_meters: radiusMeters,
      }),
    })

    if (!response.ok) {
      if (response.status === 429) throw new Error('Rate limited')
      throw new Error(`Snap failed: ${response.status}`)
    }

    const data = (await response.json()) as ValhallaNearestResponse
    if (!data.matched_point || !data.edges?.[0]) {
      return null
    }

    return {
      point: [data.matched_point.lng, data.matched_point.lat],
      osmWayId: data.edges[0].way_id,
      wayName: data.edges[0].names?.[0],
    }
  } catch (error) {
    console.error('Snap error:', error)
    return null
  }
}

/**
 * Route between two points using Valhalla, snapping to bicycle-friendly ways.
 * Returns the polyline and all OSM way IDs touched along the route.
 */
export async function routeBetweenPoints(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): Promise<RouteResult | null> {
  if (!ORS_API_KEY) {
    console.warn('NEXT_PUBLIC_ORS_API_KEY not set; routing disabled')
    return null
  }

  try {
    const response = await fetch(`${VALHALLA_BASE}/directions?api_key=${ORS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [
          [startLng, startLat],
          [endLng, endLat],
        ],
        profile: 'cycling-regular',
        geometry: true,
        instructions: false,
        preference: 'bicycle',
      }),
    })

    if (!response.ok) {
      if (response.status === 429) throw new Error('Rate limited')
      throw new Error(`Route failed: ${response.status}`)
    }

    const data = (await response.json()) as ValhallaRouteResponse
    const route = data.routes?.[0]
    if (!route?.geometry?.coordinates) {
      return null
    }

    // Collect unique OSM way IDs from all steps
    const osmWayIds = new Set<number>()
    route.legs?.forEach((leg) => {
      leg.steps?.forEach((step) => {
        if (step.way_id) osmWayIds.add(step.way_id)
      })
    })

    return {
      polyline: route.geometry.coordinates as [number, number][],
      osmWayIds: Array.from(osmWayIds),
    }
  } catch (error) {
    console.error('Route error:', error)
    return null
  }
}
