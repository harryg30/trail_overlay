/**
 * OpenRouteService API utilities for snapping to trails and routing between points
 * Proxied through /api/valhalla/* endpoints for auth and rate limiting
 */

interface OrsSnapResponse {
  matched_point: {
    lat: number
    lng: number
  }
  edges: Array<{
    way_id?: number // May not be present from ORS
    names?: string[]
  }>
}

interface OrsRouteResponse {
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
 * Snap a point to the nearest trail/road using OpenRouteService proxy.
 */
export async function snapToNearestWay(
  lat: number,
  lng: number,
  radiusMeters = 50,
): Promise<SnapResult | null> {
  try {
    const response = await fetch('/api/valhalla/snap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat,
        lng,
        radiusMeters,
      }),
    })

    if (!response.ok) {
      if (response.status === 429) throw new Error('Rate limited')
      throw new Error(`Snap failed: ${response.status}`)
    }

    const data = (await response.json()) as OrsSnapResponse
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
 * Route between two points using OpenRouteService proxy, snapping to bicycle-friendly ways.
 */
export async function routeBetweenPoints(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): Promise<RouteResult | null> {
  try {
    const response = await fetch('/api/valhalla/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startLat,
        startLng,
        endLat,
        endLng,
      }),
    })

    if (!response.ok) {
      if (response.status === 429) throw new Error('Rate limited')
      throw new Error(`Route failed: ${response.status}`)
    }

    const data = (await response.json()) as OrsRouteResponse
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

/**
 * Route through multiple waypoints using OpenRouteService proxy.
 * Points are in [lat, lng] format and will be converted to [lon, lat] for the API.
 */
export async function routeThroughPoints(
  points: [number, number][],
): Promise<RouteResult | null> {
  if (points.length < 2) {
    console.error('routeThroughPoints requires at least 2 points')
    return null
  }

  try {
    // Convert [lat, lng] to [lon, lat] for API
    const coordinates = points.map(([lat, lng]) => [lng, lat] as [number, number])

    const response = await fetch('/api/valhalla/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates,
      }),
    })

    if (!response.ok) {
      if (response.status === 429) throw new Error('Rate limited')
      throw new Error(`Route failed: ${response.status}`)
    }

    const data = (await response.json()) as OrsRouteResponse
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
    console.error('Route through points error:', error)
    return null
  }
}
