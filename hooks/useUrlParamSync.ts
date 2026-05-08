'use client'

import { useEffect, useRef } from 'react'
import type { Trail, TrailActivityItem } from '@/lib/types'

export interface UseUrlParamSyncOptions {
  drawerTab: 'map' | 'library' | 'activity' | 'edit'
  viewingTrail: Trail | null
  selectedActivityItem: TrailActivityItem | null
  /** Merge partial params into the URL without clobbering others. */
  updateParams: (updates: Record<string, string | null>) => void
  /** Cleared when viewingTrail goes null so the photo doesn't re-restore. */
  onClearPendingInitialPhotoId: () => void
}

/**
 * Mirrors `drawerTab`, `viewingTrail`, and `selectedActivityItem` into URL
 * query params. Skips the first fire to avoid clobbering server-rendered URLs.
 */
export function useUrlParamSync({
  drawerTab,
  viewingTrail,
  selectedActivityItem,
  updateParams,
  onClearPendingInitialPhotoId,
}: UseUrlParamSyncOptions) {
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!mountedRef.current) return
    updateParams({ tab: drawerTab === 'library' ? null : drawerTab })
    // 'edit' serialises as 'edit' in the URL
  }, [drawerTab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return // first fire — URL already correct from server render
    }
    updateParams({
      trail: viewingTrail ? String(viewingTrail.id) : null,
      photo: null, // cleared on trail change; restored via onPhotoOpen if needed
    })
    if (!viewingTrail) onClearPendingInitialPhotoId()
  }, [viewingTrail?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return
    updateParams({
      revision: selectedActivityItem?.revisionId ?? null,
      // Keep trail param pointing at the revision's trail while modal is open
      trail: selectedActivityItem
        ? selectedActivityItem.trailId
        : viewingTrail ? String(viewingTrail.id) : null,
    })
  }, [selectedActivityItem?.revisionId]) // eslint-disable-line react-hooks/exhaustive-deps
}
