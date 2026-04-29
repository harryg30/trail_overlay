'use client'

import type { RidePhoto, TrailPhoto, EditMode } from '@/lib/types'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCamera } from '@fortawesome/free-solid-svg-icons'

export function OfficialMapAlignBanner() {
  return (
    <div className="absolute left-1/2 top-3 z-[1001] flex max-w-[min(92vw,24rem)] -translate-x-1/2 items-center gap-2 border-2 border-electric/80 bg-primary/15 px-3 py-1.5 shadow-[3px_3px_0_0_var(--foreground)]">
      <p className="truncate text-xs font-semibold text-foreground">
        Map align: tap the same feature on the basemap
      </p>
    </div>
  )
}

interface PinPlacementBannerProps {
  placingPhoto: RidePhoto | null
  placingTrailPhoto: TrailPhoto | null
  onCancelPlace: () => void
}

export function PinPlacementBanner({ placingPhoto, placingTrailPhoto, onCancelPlace }: PinPlacementBannerProps) {
  const isTrailPin = placingTrailPhoto && !placingPhoto
  return (
    <div
      className={`absolute left-1/2 top-3 z-[1000] flex max-w-[min(90vw,22rem)] -translate-x-1/2 items-center gap-2 border-2 px-3 py-1.5 shadow-[3px_3px_0_0_var(--map-chrome-fg)] dark:border-[var(--map-chrome-fg)] dark:shadow-[3px_3px_0_0_var(--map-chrome-fg)] ${
        isTrailPin
          ? 'border-forest/80 bg-forest/15 dark:bg-[color-mix(in_oklch,var(--map-chrome-bg),var(--forest)_18%)]'
          : 'border-primary/80 bg-primary/15 dark:bg-[color-mix(in_oklch,var(--map-chrome-bg),var(--primary)_20%)]'
      }`}
    >
      <p
        className={`truncate text-xs font-semibold dark:text-[var(--map-chrome-fg)] ${
          isTrailPin ? 'text-forest' : 'text-foreground'
        }`}
      >
        Tap on or near a trail line to pin
      </p>
      <button
        type="button"
        onClick={onCancelPlace}
        className={`shrink-0 text-xs font-bold uppercase tracking-wide underline-offset-2 hover:underline dark:text-[var(--map-chrome-fg)] ${
          isTrailPin ? 'text-forest' : 'text-primary'
        }`}
      >
        Cancel
      </button>
    </div>
  )
}

interface MobileAddPhotoFabProps {
  editMode: EditMode
  onEditModeChange: (mode: EditMode) => void
}

export function MobileAddPhotoFab({ editMode, onEditModeChange }: MobileAddPhotoFabProps) {
  const active = editMode === 'add-trail-photo'
  return (
    <button
      type="button"
      onClick={() => onEditModeChange(active ? null : 'add-trail-photo')}
      aria-label={active ? 'Exit add photo mode' : 'Add photo'}
      title={active ? 'Cancel' : 'Add trail photo'}
      className={`absolute bottom-6 right-4 z-1000 flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-[3px_3px_0_0_var(--map-chrome-fg)] transition-colors sm:hidden ${
        active
          ? 'border-foreground bg-forest text-secondary-foreground dark:border-[var(--map-chrome-fg)] dark:bg-[color-mix(in_oklch,var(--map-chrome-bg),var(--forest)_28%)] dark:text-[var(--map-chrome-fg)] dark:shadow-[3px_3px_0_0_var(--map-chrome-fg)]'
          : 'border-foreground bg-card text-forest dark:border-[var(--map-chrome-fg)] dark:bg-[var(--map-chrome-bg)] dark:text-[var(--map-chrome-fg)] dark:shadow-[3px_3px_0_0_var(--map-chrome-fg)]'
      }`}
    >
      <FontAwesomeIcon icon={faCamera} className="w-6 h-6" />
    </button>
  )
}
