import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { createGameSession, GameSession } from '@/lib/ride-matcher-utils'
import { storeSession } from '../guess/route'
import { rowToRide } from '@/lib/api/mappers'
import type { RideRow } from '@/lib/api/mappers'

const cachedDevSessions = new Map<string, GameSession>()

export async function GET(_req: NextRequest) {
  try {
    // Check authentication
    const userId = await getSessionUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all rides for user
    const ridesData = await query<RideRow>(
      'SELECT id, name, distance, elevation, polyline, point_count, timestamp, strava_activity_id FROM rides WHERE user_id = $1 ORDER BY COALESCE(timestamp, created_at) DESC',
      [userId]
    )

    // Map to Ride interface using shared mapper
    const rides = ridesData.map(rowToRide)

    // Check minimum rides
    if (rides.length < 5) {
      return NextResponse.json(
        { error: `Need at least 5 rides to play. You have ${rides.length}.` },
        { status: 400 }
      )
    }

    // Check rate limit (unless dev mode)
    const isDev = process.env.RIDE_MATCHER_DEV_MODE === 'true'
    if (!isDev) {
      const user = await queryOne<any>(
        'SELECT last_game_started_at FROM users WHERE id = $1',
        [userId]
      )

      if (user?.last_game_started_at) {
        const lastGameTime = new Date(user.last_game_started_at).getTime()
        const now = Date.now()
        const fifteenMinMs = 15 * 60 * 1000

        if (now - lastGameTime < fifteenMinMs) {
          const retryAfter = Math.ceil((fifteenMinMs - (now - lastGameTime)) / 1000)
          return NextResponse.json(
            {
              error: 'Rate limited: one game per 15 minutes',
              retryAfter,
            },
            {
              status: 429,
              headers: {
                'Retry-After': retryAfter.toString(),
              },
            }
          )
        }
      }
    }

    // Create or return cached dev session (scoped per user)
    let session: GameSession
    if (isDev) {
      if (cachedDevSessions.has(userId)) {
        session = cachedDevSessions.get(userId)!
      } else {
        session = createGameSession(rides)
        cachedDevSessions.set(userId, session)
      }
    } else {
      session = createGameSession(rides)
    }

    // Update last_game_started_at in DB
    await query('UPDATE users SET last_game_started_at = NOW() WHERE id = $1', [userId])

    // Store session for later retrieval during guessing
    storeSession(session, userId)

    return NextResponse.json(session)
  } catch (err) {
    console.error('GET /api/ride-matcher/session error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: message },
      { status: 400 }
    )
  }
}
