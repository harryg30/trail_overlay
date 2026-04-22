import { NextRequest, NextResponse } from 'next/server'

const ORS_BASE = 'https://api.openrouteservice.org'
const ORS_API_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY

export async function POST(req: NextRequest) {
  if (!ORS_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const { lat, lng, radiusMeters = 50 } = await req.json()

    const response = await fetch(`${ORS_BASE}/v2/snap/cycling-regular`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': ORS_API_KEY,
      },
      body: JSON.stringify({
        locations: [[lng, lat]],
        radius: radiusMeters,
      }),
    })

    if (!response.ok) {
      if (response.status === 429) {
        return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
      }
      const errorText = await response.text()
      return NextResponse.json(
        { error: `Snap failed: ${response.status}`, details: errorText },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Transform ORS response to match client's expected format
    if (!data.locations?.[0]) {
      return NextResponse.json(null)
    }

    const snapped = data.locations[0]
    const transformed = {
      matched_point: {
        lat: snapped.location[1],
        lng: snapped.location[0],
      },
      edges: [{
        way_id: 0, // ORS doesn't provide way_id
        names: snapped.name ? [snapped.name] : [],
      }],
    }

    return NextResponse.json(transformed)
  } catch (error) {
    console.error('Snap proxy error:', error)
    return NextResponse.json({ error: 'Snap failed', details: String(error) }, { status: 500 })
  }
}
