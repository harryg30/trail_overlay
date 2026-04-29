'use client'

import type { TrailPhoto } from '@/lib/types'
import { Button } from '@/components/ui/button'

interface TrailPhotoActionModalProps {
  photo: TrailPhoto
  needsMapPin: boolean
  onView: () => void
  onPin: () => void
  onClose: () => void
}

export function TrailPhotoActionModal({ photo, needsMapPin, onView, onPin, onClose }: TrailPhotoActionModalProps) {
  return (
    <div
      className="fixed inset-0 z-[5002] flex items-center justify-center p-4 bg-black/40"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trail-photo-action-title"
        className="catalog-panel flex w-full max-w-sm flex-col gap-3 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          <img
            src={photo.thumbnailUrl || photo.blobUrl}
            alt=""
            className="h-20 w-20 shrink-0 rounded-md border-2 border-foreground object-cover"
          />
          <div className="min-w-0">
            <p id="trail-photo-action-title" className="font-display text-base font-normal uppercase tracking-wide text-foreground">
              Trail photo
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              View full size, or pin to a trail on the map.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="default" className="w-full" onClick={onView}>
            View
          </Button>
          {needsMapPin && (
            <Button
              type="button"
              variant="secondary"
              className="w-full bg-forest text-secondary-foreground hover:brightness-110"
              onClick={onPin}
            >
              Pin to map…
            </Button>
          )}
          <Button type="button" variant="outlineThick" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
