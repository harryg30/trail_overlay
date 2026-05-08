import { NextResponse } from 'next/server'

export async function GET() {
  console.log('[TEST-OSM] Handler called')
  return NextResponse.json({
    message: 'Test endpoint working',
    timestamp: new Date().toISOString(),
  })
}
