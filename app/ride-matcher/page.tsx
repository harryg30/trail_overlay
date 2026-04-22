'use client'

import { useEffect, useState, useRef } from 'react'
import { GameSession } from '@/lib/ride-matcher-utils'
import { Ride } from '@/lib/types'
import 'leaflet/dist/leaflet.css'

interface GameState {
  sessionId: string
  round: number
  guessCount: number
  scores: number[] // Score per round
  totalScore: number
  gameOver: boolean
}

const STREET_VIEW_API_KEY = process.env.NEXT_PUBLIC_MAPS_API_KEY || ''

export default function RideMatcherPage() {
  const [loading, setLoading] = useState(true)
  const [loadingStep, setLoadingStep] = useState<string>('Checking authentication...')
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<GameSession | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [rides, setRides] = useState<Ride[]>([])
  const [guessing, setGuessing] = useState(false)
  const mapRef = useRef<any>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)

  // Initialize map only after game loads + rides are ready
  useEffect(() => {
    if (!mapContainerRef.current || rides.length === 0 || !session) return

    // Dynamic import of Leaflet (only runs client-side)
    import('leaflet').then((L) => {
      if (mapRef.current) return // Already initialized

      mapRef.current = L.map(mapContainerRef.current!).setView([40, -105], 10)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapRef.current)

      // Add game rides
      const gameRideIds = session.rideIds
      const gameRides = rides.filter((r) => gameRideIds.includes(r.id))

      gameRides.forEach((ride, idx) => {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8']
        const color = colors[idx % colors.length]

        if (ride.polyline && ride.polyline.length > 0) {
          L.polyline(ride.polyline, {
            color,
            weight: 2,
            opacity: 0.6,
          }).addTo(mapRef.current!)
        }
      })
    })
  }, [rides, session])

  // Fetch session on mount
  useEffect(() => {
    const fetchSession = async () => {
      try {
        setLoadingStep('Creating game session...')
        const res = await fetch('/api/ride-matcher/session')
        const data = await res.json()

        if (!res.ok) {
          setError(data.error || 'Failed to start game')
          setLoading(false)
          return
        }

        setSession(data)
        setLoadingStep('Initializing game state...')
        setGameState({
          sessionId: data.sessionId,
          round: 0,
          guessCount: 0,
          scores: Array(data.rounds.length).fill(0),
          totalScore: 0,
          gameOver: false,
        })

        // Fetch rides for map display
        setLoadingStep('Loading your rides for the map...')
        const ridesRes = await fetch('/api/rides')
        const ridesData = await ridesRes.json()
        if (ridesRes.ok && ridesData.rides) {
          setRides(ridesData.rides)
          setLoadingStep('Nearly there...')
        }

        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      }
    }

    fetchSession()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="text-center max-w-md">
          <div className="mb-6">
            <svg
              className="w-16 h-16 mx-auto animate-spin text-blue-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Getting Ready</h2>
          <p className="text-gray-600 text-lg mb-6">{loadingStep}</p>
          <div className="space-y-2 text-sm text-gray-500">
            <p>✓ Checking your rides</p>
            <p>✓ Selecting unique segments</p>
            <p>✓ Preparing the challenge</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="bg-red-50 border border-red-200 rounded p-4 max-w-md">
          <p className="text-red-800">{error}</p>
          <a href="/" className="text-red-600 hover:underline mt-4 inline-block">
            Back to home
          </a>
        </div>
      </div>
    )
  }

  if (!session || !gameState) {
    return null
  }

  const currentRound = session.rounds[gameState.round]
  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${currentRound.lat},${currentRound.lng}&heading=auto&pitch=0&key=${STREET_VIEW_API_KEY}`

  const handleGuess = async (guessRideId: string) => {
    setGuessing(true)
    try {
      const res = await fetch('/api/ride-matcher/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: gameState.sessionId,
          guessRideId,
          round: gameState.round,
          guessCount: gameState.guessCount,
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        setError(result.error || 'Guess failed')
        setGuessing(false)
        return
      }

      const isCorrect = result.correct
      const roundScore = result.score
      const newScores = [...gameState.scores]
      newScores[gameState.round] += roundScore
      const newTotal = gameState.totalScore + roundScore

      // Handle response cases
      if (result.nextRound) {
        // Move to next round
        setGameState({
          ...gameState,
          round: gameState.round + 1,
          guessCount: 0,
          scores: newScores,
          totalScore: newTotal,
        })
      } else if (result.finalScore !== undefined) {
        // Game over
        setGameState({
          ...gameState,
          scores: newScores,
          totalScore: newTotal,
          gameOver: true,
        })
      } else {
        // More guesses in this round
        setGameState({
          ...gameState,
          guessCount: gameState.guessCount + 1,
          scores: newScores,
          totalScore: newTotal,
        })
      }

      setGuessing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setGuessing(false)
    }
  }

  const isGameOver = gameState.round >= session.rounds.length
  const remainingGuesses = 3 - gameState.guessCount

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 p-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-2">🚴 Ride Matcher</h1>
        <p className="text-center text-gray-600 mb-6">
          Can you guess which ride went through this location?
        </p>

        {!isGameOver ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Map */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-lg p-4 mb-6">
                <h2 className="text-lg font-semibold mb-2">Your Rides</h2>
                <div ref={mapContainerRef} className="h-96 rounded overflow-hidden bg-gray-100" />
              </div>

              {/* Street View */}
              <div className="bg-white rounded-lg shadow-lg p-4">
                <h2 className="text-lg font-semibold mb-2">Where are you?</h2>
                <img
                  src={streetViewUrl}
                  alt="Street View"
                  className="w-full rounded"
                />
              </div>
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1">
              {/* Score */}
              <div className="bg-white rounded-lg shadow-lg p-4 mb-6">
                <h2 className="text-lg font-semibold mb-3">Score</h2>
                <div className="text-3xl font-bold text-blue-600 mb-2">
                  {gameState.totalScore}
                </div>
                <div className="text-sm text-gray-600 mb-4">
                  Round {gameState.round + 1} of {session.rounds.length}
                </div>

                {/* Round scores */}
                <div className="space-y-1">
                  {gameState.scores.map((score, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span>Round {i + 1}:</span>
                      <span className="font-semibold">{score} pts</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Guess Box */}
              <div className="bg-white rounded-lg shadow-lg p-4">
                <h2 className="text-lg font-semibold mb-3">Make a Guess</h2>

                <div className="space-y-2 mb-4">
                  {session.rideIds.map((rideId) => (
                    <button
                      key={rideId}
                      onClick={() => handleGuess(rideId)}
                      disabled={guessing}
                      className="w-full px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded text-sm font-medium transition"
                    >
                      {session.rideTitles[rideId]}
                    </button>
                  ))}
                </div>

                <div className="text-sm text-gray-600">
                  {remainingGuesses > 0 ? (
                    <p>
                      Guesses remaining: <span className="font-semibold">{remainingGuesses}</span>
                    </p>
                  ) : (
                    <p className="text-orange-600 font-semibold">No guesses left this round!</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Game Over Screen */
          <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">🎉 Game Over!</h2>
            <p className="text-5xl font-bold text-blue-600 mb-6">{gameState.totalScore}</p>
            <p className="text-gray-600 mb-6">
              You scored {gameState.totalScore} points across 5 rounds!
            </p>

            <div className="mb-6">
              <a
                href={`/ride-matcher?score=${gameState.totalScore}`}
                className="inline-block px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded font-medium transition"
              >
                📤 Share Your Score
              </a>
            </div>

            <div className="text-sm">
              <a href="/contact" className="text-gray-600 hover:underline">
                Questions or feedback?
              </a>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded font-medium transition"
            >
              Play Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
