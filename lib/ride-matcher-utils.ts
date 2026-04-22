import { Ride } from './types'
import { resamplePolyline } from './geo-utils'

const ROUNDS_PER_GAME = 5

export interface GameRound {
  rideId: string
  lat: number
  lng: number
  correctRideIds: string[] // Multiple rides can have same location
}

export interface GameSession {
  sessionId: string
  rounds: GameRound[]
  rideIds: string[]
  rideTitles: Record<string, string>
}

/**
 * Create a game session: randomly select 5+ rides and pick a random point from each
 * No uniqueness requirement - multiple rides can share the same location
 * @param rides All rides from user (min 5 required)
 * @param roundsPerGame Number of rounds (default 5)
 * @returns Game session ready for client
 */
export function createGameSession(
  rides: Ride[],
  roundsPerGame = ROUNDS_PER_GAME
): GameSession {
  if (rides.length < 5) {
    throw new Error(`Need at least 5 rides. You have ${rides.length}.`)
  }

  // Shuffle and take N rides
  const shuffled = [...rides].sort(() => Math.random() - 0.5)
  const selectedRides = shuffled.slice(0, roundsPerGame)

  // Pick a random point from each ride
  const rounds: GameRound[] = selectedRides.map((ride) => {
    const polyline = ride.polyline
    if (polyline.length === 0) {
      throw new Error(`Ride ${ride.id} has no polyline`)
    }

    // Randomly pick a point from the ride
    const randomIdx = Math.floor(Math.random() * polyline.length)
    const [lat, lng] = polyline[randomIdx]

    return {
      rideId: ride.id,
      lat,
      lng,
      correctRideIds: [ride.id], // Only this ride is correct for now
    }
  })

  // Shuffle question order for variety
  rounds.sort(() => Math.random() - 0.5)

  // Build ride titles (add date if duplicates)
  const ridesByName = new Map<string, Ride[]>()
  for (const ride of selectedRides) {
    if (!ridesByName.has(ride.name)) {
      ridesByName.set(ride.name, [])
    }
    ridesByName.get(ride.name)!.push(ride)
  }

  const rideTitles: Record<string, string> = {}
  for (const ride of selectedRides) {
    const ridesWithSameName = ridesByName.get(ride.name)!
    if (ridesWithSameName.length > 1 && ride.timestamp) {
      const dateStr = new Date(ride.timestamp).toLocaleDateString()
      rideTitles[ride.id] = `${ride.name} (${dateStr})`
    } else {
      rideTitles[ride.id] = ride.name
    }
  }

  return {
    sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    rounds,
    rideIds: selectedRides.map((r) => r.id),
    rideTitles,
  }
}
