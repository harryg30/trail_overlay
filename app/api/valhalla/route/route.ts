import { NextRequest, NextResponse } from 'next/server'

const VALHALLA_BASE = 'https://api.openrouteservice.org/v2'
const ORS_API_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY

export async function POST(req: NextRequest) {
  if (!ORS_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const { startLat, startLng, endLat, endLng } = await req.json()

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
      if (response.status === 429) {
        return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
      }
      return NextResponse.json({ error: `Route failed: ${response.status}` }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Route proxy error:', error)
    return NextResponse.json({ error: 'Route failed' }, { status: 500 })
  }
}
