import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/auth'
import { GameSession } from '@/lib/ride-matcher-utils'

// In-memory session storage (simple for friend group scale)
const sessions = new Map<
  string,
  {
    session: GameSession
    userId: string
    expiresAt: number
    roundScores: Map<number, number> // Track score for each round
    roundAttempts: Map<number, number> // Track attempts per round
  }
>()
const SESSION_TTL = 30 * 60 * 1000 // 30 minutes

// Export for the session endpoint to use
export function storeSession(session: GameSession, userId: string) {
  sessions.set(session.sessionId, {
    session,
    userId,
    expiresAt: Date.now() + SESSION_TTL,
    roundScores: new Map(), // Track score for each round
    roundAttempts: new Map(), // Track attempts per round
  })
}

function getSession(
  sessionId: string,
  userId: string
): { session: GameSession; roundScores: Map<number, number>; roundAttempts: Map<number, number> } | undefined {
  const stored = sessions.get(sessionId)
  if (!stored) return undefined
  if (Date.now() > stored.expiresAt) {
    sessions.delete(sessionId)
    return undefined
  }
  // Verify session belongs to this user
  if (stored.userId !== userId) {
    return undefined
  }
  return { session: stored.session, roundScores: stored.roundScores, roundAttempts: stored.roundAttempts }
}

// Opportunistic cleanup on every read
function cleanupExpiredSessions() {
  const now = Date.now()
  for (const [id, data] of sessions.entries()) {
    if (now > data.expiresAt) {
      sessions.delete(id)
    }
  }
}

interface GuessRequest {
  sessionId: string
  guessRideId: string
  round: number
  guessCount?: number // Optional - not used, validated server-side instead
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Check authentication
    const userId = await getSessionUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    cleanupExpiredSessions()

    const body: GuessRequest = await req.json()
    const { sessionId, guessRideId, round } = body

    if (!sessionId || !guessRideId || typeof round !== 'number') {
      return NextResponse.json(
        { error: 'Missing or invalid required fields' },
        { status: 400 }
      )
    }

    // Get session with user validation
    const sessionData = getSession(sessionId, userId)
    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found or expired' }, { status: 400 })
    }

    const { session, roundScores, roundAttempts } = sessionData

    // Validate round exists
    if (round < 0 || round >= session.rounds.length) {
      return NextResponse.json({ error: 'Invalid round' }, { status: 400 })
    }

    // Check if round is already complete
    if (roundScores.has(round)) {
      return NextResponse.json(
        { error: 'This round is already complete' },
        { status: 400 }
      )
    }

    // Track attempts server-side per round
    const roundAttempt = (roundAttempts.get(round) || 0) + 1
    if (roundAttempt > 3) {
      return NextResponse.json(
        { error: 'Exceeded maximum guesses for this round' },
        { status: 400 }
      )
    }
    roundAttempts.set(round, roundAttempt)

    const currentRound = session.rounds[round]
    const correct = currentRound.correctRideIds.includes(guessRideId)

    // Calculate score based on attempt number (1-indexed)
    const scoreMap = { 1: 100, 2: 50, 3: 10 }
    const roundScore = correct ? (scoreMap[roundAttempt as 1 | 2 | 3] || 0) : 0

    // Check if game continues or ends
    const isLastRound = round === session.rounds.length - 1
    const isLastGuess = roundAttempt === 3
    const shouldMoveToNext = correct || isLastGuess

    // If round ends, store the score
    if (shouldMoveToNext) {
      roundScores.set(round, roundScore)
    }

    let response: GuessResponse = {
      correct,
      score: roundScore,
      nextRound: null,
    }

    // Calculate cumulative score across all completed rounds
    let totalScore = 0
    for (let i = 0; i <= round; i++) {
      totalScore += roundScores.get(i) || 0
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
      // Game over - compute cumulative score
      response.finalScore = totalScore
      response.shareLink = `/ride-matcher?score=${totalScore}`
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('POST /api/ride-matcher/guess error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
