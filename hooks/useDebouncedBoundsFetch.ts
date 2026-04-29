'use client'

import { useEffect, useRef, useState } from 'react'
import type { MapBounds } from '@/lib/geo-utils'

export interface UseDebouncedBoundsFetchOptions<T> {
  enabled: boolean
  bounds: MapBounds | null
  fetcher: (bounds: MapBounds, signal: AbortSignal) => Promise<T[]>
  /** Skip fetching when the latitude span exceeds this value (too zoomed out). */
  maxLatSpan?: number
  debounceMs?: number
  /** Convert a thrown error into a user-facing string. */
  formatError?: (err: unknown) => string
}

export interface UseDebouncedBoundsFetchResult<T> {
  data: T[]
  loading: boolean
  error: string | null
}

/**
 * Fetches map data on bounds change with a debounce + abort. Resets when disabled.
 * Used for OSM ways and Strava segments — both follow the exact same pattern.
 */
export function useDebouncedBoundsFetch<T>({
  enabled,
  bounds,
  fetcher,
  maxLatSpan = 0.15,
  debounceMs = 800,
  formatError = (err) => err instanceof Error ? err.message : 'Failed to load data.',
}: UseDebouncedBoundsFetchOptions<T>): UseDebouncedBoundsFetchResult<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!enabled) {
      setData([])
      setLoading(false)
      setError(null)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (abortRef.current) abortRef.current.abort()
      return
    }
    if (!bounds) return

    if (bounds.north - bounds.south > maxLatSpan) {
      setData([])
      setLoading(false)
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()

    setLoading(true)
    setError(null)
    timerRef.current = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller
      fetcher(bounds, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setData(result)
            setError(null)
          }
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            console.error('useDebouncedBoundsFetch error:', err)
            setError(formatError(err))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  // fetcher and formatError are intentionally omitted: callers may pass new closures
  // every render; including them would cause infinite refetches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bounds, maxLatSpan, debounceMs])

  return { data, loading, error }
}
