import { NextRequest, NextResponse } from 'next/server'

const ORS_BASE = 'https://api.openrouteservice.org'
const ORS_API_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY

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
  if (!ORS_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const { startLat, startLng, endLat, endLng } = await req.json()

    const response = await fetch(`${ORS_BASE}/v2/directions/cycling-electric`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': ORS_API_KEY,
      },
      body: JSON.stringify({
        coordinates: [
          [startLng, startLat],
          [endLng, endLat],
        ],
        geometry: true,
        instructions: false,
      }),
    })

    if (!response.ok) {
      if (response.status === 429) {
        return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
      }
      const errorText = await response.text()
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
    const coordinates = decodePolyline(route.geometry)

    const transformed = {
      routes: [{
        geometry: {
          coordinates,
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
