import { Ride } from './types'
import { haversineKm, pointToPolylineDistanceKm } from './geo-utils'

const UNIQUENESS_THRESHOLD_KM = 0.5
const MIN_RIDES = 5
const MIN_UNIQUENESS_RATIO = 0.25
const ROUNDS_PER_GAME = 5

export interface GameRound {
  rideId: string
  lat: number
  lng: number
  correctRideId: string
}

export interface GameSession {
  sessionId: string
  rounds: GameRound[]
  rideIds: string[]
  rideTitles: Record<string, string>
}

/**
 * Calculate what percentage of a ride's points are unique (far from other rides)
 * @param ridePolyline Points from the ride to check
 * @param otherRides All other rides in set (excluding the one being checked)
 * @param thresholdKm Distance threshold for uniqueness
 * @returns Ratio from 0 to 1: unique points / total points
 */
export function calculatePointUniqueness(
  ridePolyline: [number, number][],
  otherRides: Ride[],
  thresholdKm = UNIQUENESS_THRESHOLD_KM
): number {
  if (ridePolyline.length === 0) return 0

  let uniqueCount = 0

  for (const point of ridePolyline) {
    // Check if this point is far from all other rides
    let isUnique = true

    for (const otherRide of otherRides) {
      if (otherRide.polyline.length === 0) continue

      const minDist = pointToPolylineDistanceKm(point, otherRide.polyline)
      if (minDist <= thresholdKm) {
        isUnique = false
        break
      }
    }

    if (isUnique) uniqueCount++
  }

  return uniqueCount / ridePolyline.length
}

/**
 * Filter rides to those with sufficient point uniqueness
 * @param rides All rides from user
 * @param minRides Minimum rides needed (error if fewer available)
 * @param minUniquenessRatio Minimum uniqueness (e.g., 0.25 = 25%)
 * @returns Filtered and shuffled rides
 */
export function selectRidesToPlay(
  rides: Ride[],
  minRides = MIN_RIDES,
  minUniquenessRatio = MIN_UNIQUENESS_RATIO
): Ride[] {
  // Filter to rides with sufficient unique points
  const validRides = rides.filter((ride) => {
    const otherRides = rides.filter((r) => r.id !== ride.id)
    const uniqueness = calculatePointUniqueness(ride.polyline, otherRides)
    return uniqueness >= minUniquenessRatio
  })

  if (validRides.length < minRides) {
    throw new Error(
      `Not enough unique rides for game. Need ${minRides}, found ${validRides.length} with sufficient uniqueness`
    )
  }

  // Select first N and shuffle
  const selected = validRides.slice(0, minRides).sort(() => Math.random() - 0.5)
  return selected
}

/**
 * Pick a unique point from a ride (if available), else fallback to random point
 * @param ridePolyline Points from ride
 * @param otherRides All other rides in game set
 * @param thresholdKm Distance threshold
 * @returns [lat, lng] of selected point
 */
export function selectPointPerRide(
  ridePolyline: [number, number][],
  otherRides: Ride[],
  thresholdKm = UNIQUENESS_THRESHOLD_KM
): [number, number] {
  if (ridePolyline.length === 0) {
    throw new Error('No polyline points available')
  }

  // Find unique points (far from all other rides)
  const uniquePoints = ridePolyline.filter((point) => {
    for (const otherRide of otherRides) {
      if (otherRide.polyline.length === 0) continue
      const minDist = pointToPolylineDistanceKm(point, otherRide.polyline)
      if (minDist <= thresholdKm) {
        return false
      }
    }
    return true
  })

  // Prefer unique points, but fallback to random point if none available
  const pointPool = uniquePoints.length > 0 ? uniquePoints : ridePolyline
  const randomIndex = Math.floor(Math.random() * pointPool.length)
  return pointPool[randomIndex]
}

/**
 * Create a game session: select rides, pick points, generate session object
 * @param rides All rides from user
 * @param roundsPerGame Number of rounds (default 5)
 * @returns Game session ready for client
 */
export function createGameSession(
  rides: Ride[],
  roundsPerGame = ROUNDS_PER_GAME
): GameSession {
  // Filter to valid rides
  const selectedRides = selectRidesToPlay(rides)

  // Take only the requested number of rounds
  const gameRides = selectedRides.slice(0, roundsPerGame)

  // Pick a point per ride
  const rounds: GameRound[] = []
  for (const ride of gameRides) {
    const otherGameRides = gameRides.filter((r) => r.id !== ride.id)
    const [lat, lng] = selectPointPerRide(ride.polyline, otherGameRides)

    rounds.push({
      rideId: ride.id,
      lat,
      lng,
      correctRideId: ride.id,
    })
  }

  // Shuffle rounds order
  rounds.sort(() => Math.random() - 0.5)

  // Build ride titles map (for display; add date if duplicate names)
  const ridesByName = new Map<string, Ride[]>()
  for (const ride of gameRides) {
    if (!ridesByName.has(ride.name)) {
      ridesByName.set(ride.name, [])
    }
    ridesByName.get(ride.name)!.push(ride)
  }

  const rideTitles: Record<string, string> = {}
  for (const ride of gameRides) {
    const ridesWithSameName = ridesByName.get(ride.name)!
    if (ridesWithSameName.length > 1 && ride.timestamp) {
      // Add date to distinguish duplicates
      const dateStr = new Date(ride.timestamp).toLocaleDateString()
      rideTitles[ride.id] = `${ride.name} (${dateStr})`
    } else {
      rideTitles[ride.id] = ride.name
    }
  }

  return {
    sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    rounds,
    rideIds: gameRides.map((r) => r.id),
    rideTitles,
  }
}
