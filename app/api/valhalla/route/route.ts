import { NextRequest, NextResponse } from 'next/server'

const ORS_BASE = 'https://api.openrouteservice.org'
const ORS_API_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY

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
    const transformed = {
      routes: [{
        geometry: {
          coordinates: route.geometry.coordinates,
        },
        legs: [{
          steps: route.segments?.map((seg: any) => ({
            way_name: seg.name,
            way_id: 0, // ORS doesn't provide way_id
          })) || [],
        }],
      }],
    }

    return NextResponse.json(transformed)
  } catch (error) {
    console.error('Route proxy error:', error)
    return NextResponse.json({ error: 'Route failed', details: String(error) }, { status: 500 })
  }
}
