'use client'

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Ride } from '@/lib/types'
import type { SessionUser } from '@/lib/auth'

const VISIBLE_RIDE_IDS_KEY = 'visible_ride_ids'

export interface UseRidesResult {
  rides: Ride[]
  setRides: Dispatch<SetStateAction<Ride[]>>
  hiddenRideIds: Set<string>
  setHiddenRideIds: Dispatch<SetStateAction<Set<string>>>
  /** Fetches /api/rides; resolves with the new ride list. Re-callable (e.g. after Strava sync). */
  loadRides: () => Promise<void>
}

/**
 * Loads the user's rides on mount, and persists per-user visibility to localStorage.
 */
export function useRides(user: SessionUser | null): UseRidesResult {
  const [rides, setRides] = useState<Ride[]>([])
  const [hiddenRideIds, setHiddenRideIds] = useState<Set<string>>(new Set())
  const ridesLoadedRef = useRef(false)
  const ridesRequestSeqRef = useRef(0)
  const ridesRequestAbortRef = useRef<AbortController | null>(null)

  const loadRides = useCallback(async () => {
    if (!user) return

    const requestSeq = ++ridesRequestSeqRef.current
    ridesRequestAbortRef.current?.abort()

    const controller = new AbortController()
    ridesRequestAbortRef.current = controller

    try {
      const r = await fetch('/api/rides', { signal: controller.signal })
      const data = await r.json()
      if (controller.signal.aborted || requestSeq !== ridesRequestSeqRef.current || !data.success) return

      setRides(data.rides)
      const saved = localStorage.getItem(VISIBLE_RIDE_IDS_KEY)
      const visibleIds = saved ? new Set(JSON.parse(saved) as string[]) : new Set<string>()
      setHiddenRideIds(
        new Set(data.rides.map((ride: Ride) => ride.id).filter((id: string) => !visibleIds.has(id)))
      )
      ridesLoadedRef.current = true
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }, [user])

  useEffect(() => {
    if (!user) {
      ridesRequestSeqRef.current += 1
      ridesRequestAbortRef.current?.abort()
      ridesLoadedRef.current = false
      return
    }

    const timer = setTimeout(() => {
      void loadRides()
    }, 0)

    return () => {
      clearTimeout(timer)
    }
  }, [loadRides, user])

  useEffect(() => {
    return () => {
      ridesRequestAbortRef.current?.abort()
    }
  }, [])

  // Persist visibility once rides have loaded for the first time
  useEffect(() => {
    if (!user || !ridesLoadedRef.current) return
    const visibleIds = rides.filter((r) => !hiddenRideIds.has(r.id)).map((r) => r.id)
    localStorage.setItem(VISIBLE_RIDE_IDS_KEY, JSON.stringify(visibleIds))
  }, [hiddenRideIds, rides, user])

  const visibleRides = user ? rides : []
  const visibleHiddenRideIds = user ? hiddenRideIds : new Set<string>()

  return {
    rides: visibleRides,
    setRides,
    hiddenRideIds: visibleHiddenRideIds,
    setHiddenRideIds,
    loadRides,
  }
}
