'use client'

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { TrailPhoto } from '@/lib/types'
import type { SessionUser } from '@/lib/auth'
import type { MapBounds } from '@/lib/geo-utils'
import { trailPhotoMapPoint } from '@/lib/geo-utils'

export interface UseTrailPhotosResult {
  /** Server-pinned, accepted photos for the current map bounds. */
  communityTrailPhotos: TrailPhoto[]
  setCommunityTrailPhotos: Dispatch<SetStateAction<TrailPhoto[]>>
  /** Logged-in user's unpinned uploads (private). */
  myUnpinnedTrailPhotos: TrailPhoto[]
  setMyUnpinnedTrailPhotos: Dispatch<SetStateAction<TrailPhoto[]>>
  /** Demo-only photos (object URLs; never POST). */
  localTrailPhotos: TrailPhoto[]
  setLocalTrailPhotos: Dispatch<SetStateAction<TrailPhoto[]>>
  /** Merged + dedup'd + date-sorted view for the map layer. */
  mapTrailPhotos: TrailPhoto[]
}

/**
 * Owns the three trail-photo collections rendered on the map.
 * Fetches "my unpinned" on user change and "community" on bounds change.
 */
export function useTrailPhotos(
  user: SessionUser | null,
  mapBounds: MapBounds | null
): UseTrailPhotosResult {
  const [communityTrailPhotos, setCommunityTrailPhotos] = useState<TrailPhoto[]>([])
  const [myUnpinnedTrailPhotos, setMyUnpinnedTrailPhotos] = useState<TrailPhoto[]>([])
  const [localTrailPhotos, setLocalTrailPhotos] = useState<TrailPhoto[]>([])

  useEffect(() => {
    if (!user) return

    let cancelled = false
    const controller = new AbortController()

    fetch('/api/trail-photos/mine', { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || controller.signal.aborted || !data?.photos) return
        setMyUnpinnedTrailPhotos(data.photos as TrailPhoto[])
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [user])

  const visibleMyUnpinnedTrailPhotos = useMemo(
    () => (user ? myUnpinnedTrailPhotos : []),
    [myUnpinnedTrailPhotos, user]
  )

  // Community trail photo pins for the current map bounds (pinned-to-trail only on server)
  useEffect(() => {
    if (!mapBounds) return
    let cancelled = false
    const { north, south, east, west } = mapBounds
    fetch(`/api/trail-photos?north=${north}&south=${south}&east=${east}&west=${west}&limit=500`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.photos) return
        const photos = Array.isArray(data.photos) ? (data.photos as TrailPhoto[]) : []
        setCommunityTrailPhotos(
          [...photos].sort((a, b) => {
            const at = new Date(a.createdAt).getTime()
            const bt = new Date(b.createdAt).getTime()
            return bt - at
          })
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [mapBounds])

  const mapTrailPhotos = useMemo(() => {
    const byId = new Map<string, TrailPhoto>()
    for (const p of communityTrailPhotos) byId.set(p.id, p)
    for (const p of visibleMyUnpinnedTrailPhotos) {
      const pt = trailPhotoMapPoint(p)
      if (pt != null) byId.set(p.id, p)
    }
    for (const p of localTrailPhotos) {
      const pt = trailPhotoMapPoint(p)
      if (pt != null) byId.set(p.id, p)
    }
    return Array.from(byId.values()).sort((a, b) => {
      const at = new Date(a.createdAt).getTime()
      const bt = new Date(b.createdAt).getTime()
      return bt - at
    })
  }, [communityTrailPhotos, visibleMyUnpinnedTrailPhotos, localTrailPhotos])

  return {
    communityTrailPhotos,
    setCommunityTrailPhotos,
    myUnpinnedTrailPhotos: visibleMyUnpinnedTrailPhotos,
    setMyUnpinnedTrailPhotos,
    localTrailPhotos,
    setLocalTrailPhotos,
    mapTrailPhotos,
  }
}
