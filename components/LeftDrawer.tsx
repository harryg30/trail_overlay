'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type {
  Ride,
  Trail,
  DraftTrail,
  TrimFormState,
  EditMode,
  Network,
  RidePhoto,
  TrailPhoto,
  OfficialMapLayerPayload,
  TrailActivityItem,
} from '@/lib/types'
import type { SessionUser } from '@/lib/auth'
import type { MapBounds } from '@/lib/geo-utils'
import { pointInBounds, trailPhotoMapPoint } from '@/lib/geo-utils'
import { Button } from '@/components/ui/button'
import { uploadRideFilesClient } from '@/lib/upload-rides-client'
import { cn } from '@/lib/utils'
import AuthButton from '@/components/AuthButton'
import GetExtensionButton from '@/components/GetExtensionButton'
import ThemeToggle from '@/components/ThemeToggle'
import { TrailDetailPanel } from '@/components/trail/TrailDetailPanel'
import { ActivityFeed } from '@/components/ActivityFeed'
import { LibraryTabContent } from '@/components/drawer/LibraryTabContent'
import { ImportsTabContent, type ImportsTabContentHandle } from '@/components/drawer/ImportsTabContent'
import { AddTrailSidebar } from '@/components/trail/AddTrailSidebar'
import { DrawNetworkContent } from '@/components/network/DrawNetworkContent'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons'
import { TrailPhotoActionModal } from '@/components/drawer/TrailPhotoActionModal'
import type { StagedTrailApi } from '@/hooks/useStagedTrail'

interface LeftDrawerProps {
  user: SessionUser | null
  rides: Ride[]
  trails: Trail[]
  hiddenRideIds: Set<string>
  onToggleRide: (id: string) => void
  onHideAllRides: () => void
  onRidesUploaded: (rides: Ride[]) => void
  onSyncComplete: () => Promise<void>
  onTrailsChanged: () => Promise<void>
  editMode: EditMode
  onEditModeChange: (mode: EditMode) => void
  selectedTrail: Trail | null
  onSelectTrail: (trail: Trail | null) => void
  onSaveEditedTrail: (form: TrimFormState) => Promise<string | null>
  onDeleteTrail: () => Promise<string | null>
  refineError: string | null
  networks: Network[]
  selectedNetwork: Network | null
  drawNetworkPoints: [number, number][]
  hiddenNetworkIds: Set<string>
  onToggleNetwork: (id: string) => void
  onSelectNetwork: (network: Network | null) => void
  onSaveNetwork: (name: string, polygon: [number, number][], trailIds: string[]) => Promise<string | null>
  onUpdateNetwork: (name: string, polygon: [number, number][] | null, trailIds: string[]) => Promise<string | null>
  onDeleteNetwork: () => Promise<string | null>
  onStartRedrawNetwork: () => void
  onOpenAnnouncement: () => void
  onOpenContact: () => void
  onOpenCookiePolicy: () => void
  highResRideIds: Set<string>
  onFetchHighRes: (id: string) => Promise<void>
  fetchingHighResId: string | null
  ridePhotos: Record<string, RidePhoto[]>
  photosVisibleRideIds: Set<string>
  fetchingPhotosId: string | null
  onFetchAndTogglePhotos: (rideId: string) => Promise<void>
  draftTrails: DraftTrail[]
  onPublishDraft: (localId: string) => Promise<string | null>
  onDeleteDraft: (localId: string) => void
  onEditDraft: (localId: string) => void
  draftSidebarPrefill: DraftTrail | null
  onClearDraftSidebarPrefill: () => void
  staged: StagedTrailApi
  onSaveAddedTrail: (form: TrimFormState, publishOnSave: boolean) => Promise<string | null>
  mapBounds: MapBounds | null
  onTrailPhotoCreated: (photo: TrailPhoto) => void
  onEnterAddTrailPhoto: () => void
  /** Public pinned photos (for trail rows + reference). */
  communityTrailPhotos: TrailPhoto[]
  /** Current user’s unpinned + local demo photos. */
  unpinnedTrailPhotos: TrailPhoto[]
  placingPhoto: RidePhoto | null
  placingTrailPhoto: TrailPhoto | null
  onPlaceRidePhoto: (photo: RidePhoto) => void
  onPlaceTrailPhoto: (photo: TrailPhoto) => void
  onCancelPinOnMap: () => void
  onOpenPhotoLightbox: (src: string) => void
  onFlyToTrail: (trail: Trail) => void
  onFlyToNetwork: (network: Network) => void
  onOfficialMapLayerChange: (layer: OfficialMapLayerPayload | null) => void
  onAlignmentMapPickChange: (handler: null | ((latlng: [number, number]) => void)) => void
  /** Trail currently being viewed in the detail panel (not editing). */
  viewingTrail: Trail | null
  onOpenViewTrail: (trail: Trail) => void
  onCloseViewTrail: () => void
  onEditViewTrail: (trail: Trail) => void
  onSelectActivityItem?: (item: TrailActivityItem) => void
  /** Controlled tab (lifted to parent for URL sync). */
  tab: 'map' | 'library' | 'activity' | 'edit'
  onTabChange: (tab: 'map' | 'library' | 'activity' | 'edit') => void
  /** Photo lightbox state for URL sync. */
  initialPhotoId?: string
  onPhotoOpen?: (photoId: string) => void
  onPhotoClose?: () => void
  /** Draft trails from imports tab. */
  onDraftTrailsChange?: (trails: any[], selectedIds: Set<string>) => void
  onHoverImportTrail?: (osmWayId: string | null) => void
  importsTabRef?: React.RefObject<ImportsTabContentHandle | null>
  /** Bbox draw flow for OSM imports. */
  onStartDrawBbox?: () => void
  drawBboxCorners?: [number, number][]
  onClearDrawBbox?: () => void
}

export default function LeftDrawer({
  user,
  rides,
  trails,
  hiddenRideIds,
  onToggleRide,
  onHideAllRides,
  onRidesUploaded,
  onSyncComplete,
  onTrailsChanged,
  editMode,
  onEditModeChange,
  selectedTrail,
  onSelectTrail,
  onSaveEditedTrail,
  onDeleteTrail,
  refineError,
  networks,
  selectedNetwork,
  drawNetworkPoints,
  hiddenNetworkIds,
  onToggleNetwork,
  onSelectNetwork,
  onSaveNetwork,
  onUpdateNetwork,
  onDeleteNetwork,
  onStartRedrawNetwork,
  onOpenAnnouncement,
  onOpenContact,
  onOpenCookiePolicy,
  highResRideIds,
  onFetchHighRes,
  fetchingHighResId,
  ridePhotos,
  photosVisibleRideIds,
  fetchingPhotosId,
  onFetchAndTogglePhotos,
  draftTrails,
  onPublishDraft,
  onDeleteDraft,
  onEditDraft,
  draftSidebarPrefill,
  onClearDraftSidebarPrefill,
  staged,
  onSaveAddedTrail,
  mapBounds,
  onTrailPhotoCreated,
  onEnterAddTrailPhoto,
  communityTrailPhotos,
  unpinnedTrailPhotos,
  placingPhoto,
  placingTrailPhoto,
  onPlaceRidePhoto,
  onPlaceTrailPhoto,
  onCancelPinOnMap,
  onOpenPhotoLightbox,
  onFlyToTrail,
  onFlyToNetwork,
  onOfficialMapLayerChange,
  onAlignmentMapPickChange,
  viewingTrail,
  onOpenViewTrail,
  onCloseViewTrail,
  onEditViewTrail,
  onSelectActivityItem,
  tab,
  onTabChange,
  initialPhotoId,
  onPhotoOpen,
  onPhotoClose,
  onDraftTrailsChange,
  onHoverImportTrail,
  importsTabRef,
  onStartDrawBbox,
  drawBboxCorners,
  onClearDrawBbox,
}: LeftDrawerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [pendingHighResRideId, setPendingHighResRideId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [generateSuggestionsOpen, setGenerateSuggestionsOpen] = useState(false)
  const trailPhotoNeedsMapPin = (p: TrailPhoto) => !p.accepted

  const [trailPhotoForAction, setTrailPhotoForAction] = useState<TrailPhoto | null>(null)
  const drawerTab = tab
  const viewportFilterActive = drawerTab === 'map'

  const visibleUnpinnedForPin = useMemo(() => {
    const pending = unpinnedTrailPhotos.filter((p) => trailPhotoNeedsMapPin(p))
    const activeBounds = viewportFilterActive && mapBounds ? mapBounds : null
    if (!activeBounds) return pending
    return pending.filter((p) => {
      const pt = trailPhotoMapPoint(p)
      return pt != null && pointInBounds(pt, activeBounds)
    })
  }, [unpinnedTrailPhotos, viewportFilterActive, mapBounds])


  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setUploading(true)
    setUploadError(null)
    setUploadProgress({ done: 0, total: files.length })

    const { rides: allRides, errors } = await uploadRideFilesClient(files, (done, total) =>
      setUploadProgress({ done, total })
    )

    if (allRides.length > 0) onRidesUploaded(allRides)
    if (errors.length > 0) setUploadError(errors.join(', '))
    setUploading(false)
    setUploadProgress(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const res = await fetch('/api/strava/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setSyncMessage(data.error ?? 'Sync failed')
      } else {
        await onSyncComplete()
        setSyncMessage(`Synced ${data.synced} ride${data.synced !== 1 ? 's' : ''}`)
      }
    } catch {
      setSyncMessage('Network error — sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex h-screen w-full max-w-[392px] shrink-0 flex-col border-r-2 border-foreground bg-card shadow-[4px_0_0_0_var(--foreground)] sm:w-[392px]">
      {/* Header */}
      <div className="catalog-title-strip border-b-2 border-foreground px-4 py-4">
        <h1 className="mb-3 leading-none">
          <span className="font-display inline-block border-2 border-foreground bg-primary px-3 py-2 text-2xl font-normal uppercase tracking-[0.22em] text-primary-foreground shadow-[5px_5px_0_0_var(--foreground)] dark:bg-muted dark:text-primary sm:px-4 sm:py-2.5 sm:text-3xl sm:tracking-[0.26em}">
            Trail Overlay
          </span>
        </h1>
        <AuthButton user={user} />
        <div className="mt-3 w-full">
          <ThemeToggle className="w-full" size="sm" />
        </div>
        <div className="mt-3 w-full">
          <GetExtensionButton />
        </div>
      </div>

      {/* Upload section */}
      <div className="flex flex-col gap-2 border-b-2 border-border px-4 py-4">
        <input
          ref={inputRef}
          type="file"
          accept=".gpx,.zip"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        {user ? (
          <>
            <Button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              variant="default"
              className="w-full"
            >
              {uploadProgress
                ? `Uploading ${uploadProgress.done} / ${uploadProgress.total}…`
                : 'Upload GPX / ZIP'}
            </Button>
            <Button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              variant="secondary"
              className="w-full"
            >
              {syncing ? 'Syncing...' : 'Sync Strava Rides'}
            </Button>
            {syncMessage && <p className="text-xs text-muted-foreground">{syncMessage}</p>}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Connect with Strava to upload rides.</p>
        )}
        {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
      </div>

      {/* Tab navigation */}
      <div className="flex border-b-2 border-border">
        {(['map', 'library', 'activity', 'edit'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => { onTabChange(tab); if (viewingTrail) onCloseViewTrail() }}
            disabled={tab === 'map' && !mapBounds}
            suppressHydrationWarning
            className={cn(
              'flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              !viewingTrail && drawerTab === tab
                ? 'border-b-2 border-foreground text-foreground -mb-0.5'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab === 'map' ? 'Map' :
             tab === 'library' ? 'Library' :
             tab === 'activity' ? 'Activity' : 'Edit'}
          </button>
        ))}
      </div>

      {/* Scrollable content area — everything below the tab bar */}
      <div className="drawer-scroll flex-1 min-h-0 overflow-y-auto">

      {/* Trail detail panel */}
      {viewingTrail && (
        <TrailDetailPanel
          trail={viewingTrail}
          networks={networks}
          user={user}
          onClose={onCloseViewTrail}
          onEdit={onEditViewTrail}
          initialPhotoId={initialPhotoId}
          onPhotoOpen={onPhotoOpen}
          onPhotoClose={onPhotoClose}
        />
      )}

      {/* Activity tab */}
      {!viewingTrail && drawerTab === 'activity' && (
        <ActivityFeed
          trails={trails}
          onOpenViewTrail={onOpenViewTrail}
          onSelectActivityItem={onSelectActivityItem}
        />
      )}

      {/* Map / Library tab — same content; Map filters to viewport */}
      {!viewingTrail && (drawerTab === 'map' || drawerTab === 'library') && (
        <LibraryTabContent
          viewportFilter={drawerTab === 'map'}
          mapBounds={mapBounds}
          user={user}
          trails={trails}
          networks={networks}
          draftTrails={draftTrails}
          hiddenNetworkIds={hiddenNetworkIds}
          editMode={editMode}
          onEditModeChange={onEditModeChange}
          selectedTrail={selectedTrail}
          onSelectTrail={onSelectTrail}
          selectedNetwork={selectedNetwork}
          onSelectNetwork={onSelectNetwork}
          drawNetworkPoints={drawNetworkPoints}
          onSaveEditedTrail={onSaveEditedTrail}
          onSaveAddedTrail={onSaveAddedTrail}
          onDeleteTrail={onDeleteTrail}
          refineError={refineError}
          staged={staged}
          draftSidebarPrefill={draftSidebarPrefill}
          onClearDraftSidebarPrefill={onClearDraftSidebarPrefill}
          onPublishDraft={onPublishDraft}
          onDeleteDraft={onDeleteDraft}
          onEditDraft={onEditDraft}
          onSaveNetwork={onSaveNetwork}
          onUpdateNetwork={onUpdateNetwork}
          onDeleteNetwork={onDeleteNetwork}
          onStartRedrawNetwork={onStartRedrawNetwork}
          onToggleNetwork={onToggleNetwork}
          onFlyToNetwork={onFlyToNetwork}
          onOfficialMapLayerChange={onOfficialMapLayerChange}
          onAlignmentMapPickChange={onAlignmentMapPickChange}
          onEnterAddTrailPhoto={onEnterAddTrailPhoto}
          onTrailPhotoCreated={onTrailPhotoCreated}
          onOpenViewTrail={onOpenViewTrail}
          onFlyToTrail={onFlyToTrail}
        />
      )}

      {/* Edit tab — add trail, add network, import suggestions */}
      {!viewingTrail && drawerTab === 'edit' && (
        <div className="flex flex-col">
          {/* Add trail */}
          <div className="flex flex-col gap-2 border-b-2 border-border px-4 py-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Add trail
              </h2>
              {user && (
                <button
                  type="button"
                  onClick={() => onEditModeChange(editMode === 'add-trail' ? null : 'add-trail')}
                  title={editMode === 'add-trail' ? 'Cancel' : 'Add trail'}
                  className={`flex size-6 items-center justify-center rounded-sm border-2 transition-colors ${
                    editMode === 'add-trail'
                      ? 'border-foreground bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-mud/80'
                  }`}
                >
                  <FontAwesomeIcon icon={editMode === 'add-trail' ? faXmark : faPlus} className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {editMode === 'add-trail' && (
              <AddTrailSidebar
                staged={staged}
                onSave={onSaveAddedTrail}
                onCancel={() => onEditModeChange(null)}
                networks={networks}
                canPublish={!!user}
                draftPrefill={draftSidebarPrefill}
                onClearDraftPrefill={onClearDraftSidebarPrefill}
              />
            )}
          </div>

          {/* Add network */}
          <div className="flex flex-col gap-2 border-b-2 border-border px-4 py-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Add network
              </h2>
              {user && (
                <button
                  type="button"
                  onClick={() => onEditModeChange(editMode === 'add-network' ? null : 'add-network')}
                  title={editMode === 'add-network' ? 'Cancel' : 'Add network'}
                  className={`flex size-6 items-center justify-center rounded-sm border-2 transition-colors ${
                    editMode === 'add-network'
                      ? 'border-foreground bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-mud/80'
                  }`}
                >
                  <FontAwesomeIcon icon={editMode === 'add-network' ? faXmark : faPlus} className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {editMode === 'add-network' && (
              <DrawNetworkContent
                trails={trails}
                drawNetworkPoints={drawNetworkPoints}
                selectedNetwork={selectedNetwork}
                onSave={onSaveNetwork}
                onUpdate={onUpdateNetwork}
                onCancel={() => onEditModeChange(null)}
              />
            )}
          </div>

          {/* Generate suggestions */}
          <div className="flex flex-col gap-2 border-b-2 border-border px-4 py-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Generate suggestions
              </h2>
              <button
                type="button"
                onClick={() => setGenerateSuggestionsOpen((prev) => !prev)}
                title={generateSuggestionsOpen ? 'Close suggestions' : 'Generate suggestions'}
                className={`flex size-6 items-center justify-center rounded-sm border-2 transition-colors ${
                  generateSuggestionsOpen
                    ? 'border-foreground bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-mud/80'
                }`}
              >
                <FontAwesomeIcon icon={generateSuggestionsOpen ? faXmark : faPlus} className="w-3.5 h-3.5" />
              </button>
            </div>
            {generateSuggestionsOpen && (
              <ImportsTabContent
                ref={importsTabRef}
                user={user}
                onApprovedImport={onTrailsChanged}
                onDraftTrailsChange={onDraftTrailsChange}
                onHoverImportTrail={onHoverImportTrail}
                onStartDrawBbox={onStartDrawBbox}
                drawBboxCorners={drawBboxCorners}
                onClearDrawBbox={onClearDrawBbox}
              />
            )}
          </div>
        </div>
      )}

      </div>{/* end scrollable content area */}

      {trailPhotoForAction && (
        <TrailPhotoActionModal
          photo={trailPhotoForAction}
          needsMapPin={trailPhotoNeedsMapPin(trailPhotoForAction)}
          onView={() => {
            onOpenPhotoLightbox(trailPhotoForAction.blobUrl)
            setTrailPhotoForAction(null)
          }}
          onPin={() => {
            onPlaceTrailPhoto(trailPhotoForAction)
            setTrailPhotoForAction(null)
          }}
          onClose={() => setTrailPhotoForAction(null)}
        />
      )}

      {/* About / Contact footer */}
      <div className="mt-auto px-4 py-2 border-t-2 border-border flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onOpenAnnouncement}
          className="text-[10px] font-bold uppercase tracking-wide text-electric underline-offset-1 hover:underline whitespace-nowrap"
        >
          About
        </button>
        <button
          type="button"
          onClick={onOpenContact}
          className="text-[10px] font-bold uppercase tracking-wide text-electric underline-offset-1 hover:underline whitespace-nowrap"
        >
          Contact
        </button>
        <button
          type="button"
          onClick={onOpenCookiePolicy}
          className="text-[10px] font-bold uppercase tracking-wide text-electric underline-offset-1 hover:underline whitespace-nowrap"
        >
          Cookies
        </button>
        <Link
          href="/privacy"
          className="text-[10px] font-bold uppercase tracking-wide text-electric underline-offset-1 hover:underline whitespace-nowrap"
        >
          Privacy
        </Link>
      </div>
    </div>
  )
}
