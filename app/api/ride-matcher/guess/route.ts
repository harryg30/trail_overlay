import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/auth'
import { GameSession } from '@/lib/ride-matcher-utils'

// In-memory session storage (simple for friend group scale)
const sessions = new Map<string, { session: GameSession; expiresAt: number }>()
const SESSION_TTL = 30 * 60 * 1000 // 30 minutes

// Export for the session endpoint to use
export function storeSession(session: GameSession) {
  sessions.set(session.sessionId, {
    session,
    expiresAt: Date.now() + SESSION_TTL,
  })
}

function getSession(sessionId: string): GameSession | undefined {
  const stored = sessions.get(sessionId)
  if (!stored) return undefined
  if (Date.now() > stored.expiresAt) {
    sessions.delete(sessionId)
    return undefined
  }
  return stored.session
}

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now()
  for (const [id, data] of sessions.entries()) {
    if (now > data.expiresAt) {
      sessions.delete(id)
    }
  }
}, 5 * 60 * 1000) // Every 5 minutes

interface GuessRequest {
  sessionId: string
  guessRideId: string
  round: number
  guessCount: number
}

interface GuessResponse {
  correct: boolean
  score: number
  nextRound?: {
    rideId: string
    lat: number
    lng: number
  } | null
  finalScore?: number
  shareLink?: string
}

export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const userId = await getSessionUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: GuessRequest = await req.json()
    const { sessionId, guessRideId, round, guessCount } = body

    if (
      !sessionId ||
      !guessRideId ||
      typeof round !== 'number' ||
      typeof guessCount !== 'number'
    ) {
      return NextResponse.json(
        { error: 'Missing or invalid required fields' },
        { status: 400 }
      )
    }

    // Get session
    const session = getSession(sessionId)
    if (!session) {
      return NextResponse.json({ error: 'Session not found or expired' }, { status: 400 })
    }

    // Validate round exists
    if (round < 0 || round >= session.rounds.length) {
      return NextResponse.json({ error: 'Invalid round' }, { status: 400 })
    }

    const currentRound = session.rounds[round]
    const correct = currentRound.correctRideIds.includes(guessRideId)

    // Calculate score based on guess attempt (0, 1, or 2)
    const scoreMap = { 0: 100, 1: 50, 2: 10 }
    const score = correct ? (scoreMap[guessCount as 0 | 1 | 2] || 0) : 0

    // Check if game continues or ends
    const isLastRound = round === session.rounds.length - 1
    const isLastGuess = guessCount === 2
    const shouldMoveToNext = correct || isLastGuess

    let response: GuessResponse = {
      correct,
      score,
      nextRound: null,
    }

    if (shouldMoveToNext && !isLastRound) {
      // Move to next round
      const nextRoundIndex = round + 1
      const nextRoundData = session.rounds[nextRoundIndex]
      response.nextRound = {
        rideId: nextRoundData.rideId,
        lat: nextRoundData.lat,
        lng: nextRoundData.lng,
      }
    } else if (shouldMoveToNext && isLastRound) {
      // Game over
      response.finalScore = score
      response.shareLink = `/ride-matcher?score=${score}`
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('POST /api/ride-matcher/guess error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
