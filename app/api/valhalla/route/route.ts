import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/auth'

const ORS_BASE = 'https://api.openrouteservice.org'
const ORS_API_KEY = process.env.ORS_API_KEY

/**
 * Decode a Google-encoded polyline to coordinates
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    result = 0
    shift = 0

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    points.push([lng / 1e5, lat / 1e5])
  }

  return points
}

export async function POST(req: NextRequest) {
  // Check authentication
  const userId = await getSessionUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!ORS_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const body = await req.json()
    const { startLat, startLng, endLat, endLng, coordinates } = body

    // Support both legacy two-point and new multi-point formats
    let coordArray: [number, number][]
    if (coordinates && Array.isArray(coordinates)) {
      // New format: coordinates = [[lon, lat], [lon, lat], ...]
      coordArray = coordinates
    } else if (startLat !== undefined && startLng !== undefined && endLat !== undefined && endLng !== undefined) {
      // Legacy format: individual lat/lng params
      coordArray = [
        [startLng, startLat],
        [endLng, endLat],
      ]
    } else {
      return NextResponse.json({ error: 'Missing coordinates or startLat/Lng/endLat/endLng parameters' }, { status: 400 })
    }

    const response = await fetch(`${ORS_BASE}/v2/directions/cycling-regular`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': ORS_API_KEY,
      },
      body: JSON.stringify({
        coordinates: coordArray,
        geometry: true,
        instructions: false,
      }),
    })

    if (!response.ok) {
      if (response.status === 429) {
        return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
      }
      const errorText = await response.text()
      console.error('[valhalla-route] ORS error response:', response.status, errorText)
      return NextResponse.json(
        { error: `Route failed: ${response.status}`, details: errorText },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Transform ORS response to match client's expected format
    if (!data.routes?.[0]) {
      return NextResponse.json(null)
    }

    const route = data.routes[0]
    const decodedPolyline = decodePolyline(route.geometry)

    const transformed = {
      routes: [{
        geometry: {
          coordinates: decodedPolyline,
        },
        legs: [{
          steps: [{
            way_name: 'Trail',
            way_id: 0,
          }],
        }],
      }],
    }

    return NextResponse.json(transformed)
  } catch (error) {
    console.error('Route proxy error:', error)
    return NextResponse.json({ error: 'Route failed', details: String(error) }, { status: 500 })
  }
}
