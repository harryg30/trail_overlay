'use client'

import { Fragment, useState } from 'react'
import type {
  DraftTrail,
  EditMode,
  Network,
  Trail,
  TrailPhoto,
  TrimFormState,
} from '@/lib/types'
import type { SessionUser } from '@/lib/auth'
import type { MapBounds } from '@/lib/geo-utils'
import { polylineInBounds } from '@/lib/geo-utils'
import { Badge } from '@/components/ui/badge'
import { DIFFICULTY_BADGE_VARIANT } from '@/lib/trail-constants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { TrailEditDrawer } from '@/components/trail/TrailEditDrawer'
import { AddTrailSidebar } from '@/components/trail/AddTrailSidebar'
import { AddTrailPhotoContent } from '@/components/photo/AddTrailPhotoContent'
import { DraftsList } from '@/components/trail/DraftsList'
import type { StagedTrailApi } from '@/hooks/useStagedTrail'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCamera,
  faCrosshairs,
  faFolder,
  faPenToSquare,
  faPlus,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'

interface TrailsTabContentProps {
  user: SessionUser | null
  trails: Trail[]
  networks: Network[]
  editMode: EditMode
  onEditModeChange: (mode: EditMode) => void
  selectedTrail: Trail | null
  onSelectTrail: (trail: Trail | null) => void
  onSaveEditedTrail: (form: TrimFormState) => Promise<string | null>
  onSaveAddedTrail: (form: TrimFormState, publishOnSave: boolean) => Promise<string | null>
  onDeleteTrail: () => Promise<string | null>
  refineError: string | null
  staged: StagedTrailApi
  draftSidebarPrefill: DraftTrail | null
  onClearDraftSidebarPrefill: () => void
  onEnterAddTrailPhoto: () => void
  onTrailPhotoCreated: (photo: TrailPhoto) => void
  visibleUnpinnedForPin: TrailPhoto[]
  placingTrailPhoto: TrailPhoto | null
  onSelectTrailPhotoForAction: (photo: TrailPhoto) => void
  showOnMapOnly: boolean
  mapBounds: MapBounds | null
  onOpenViewTrail: (trail: Trail) => void
  onFlyToTrail: (trail: Trail) => void
  onFlyToNetwork: (network: Network) => void
  draftTrails: DraftTrail[]
  onPublishDraft: (localId: string) => Promise<string | null>
  onDeleteDraft: (localId: string) => void
  onEditDraft: (localId: string) => void
}

export function TrailsTabContent({
  user,
  trails,
  networks,
  editMode,
  onEditModeChange,
  selectedTrail,
  onSelectTrail,
  onSaveEditedTrail,
  onSaveAddedTrail,
  onDeleteTrail,
  refineError,
  staged,
  draftSidebarPrefill,
  onClearDraftSidebarPrefill,
  onEnterAddTrailPhoto,
  onTrailPhotoCreated,
  visibleUnpinnedForPin,
  placingTrailPhoto,
  onSelectTrailPhotoForAction,
  showOnMapOnly,
  mapBounds,
  onOpenViewTrail,
  onFlyToTrail,
  onFlyToNetwork,
  draftTrails,
  onPublishDraft,
  onDeleteDraft,
  onEditDraft,
}: TrailsTabContentProps) {
  const [trailsQuery, setTrailsQuery] = useState('')
  const [trailsPageSize, setTrailsPageSize] = useState(() => {
    if (typeof window === 'undefined') return 10
    const saved = localStorage.getItem('trailsPageSize')
    return saved ? Number(saved) : 10
  })
  const [trailsPage, setTrailsPage] = useState(0)

  const handleModeClick = (mode: EditMode) => {
    onEditModeChange(editMode === mode ? null : mode)
  }

  const focusedTrailSession =
    editMode === 'add-trail' || (editMode === 'edit-trail' && !!selectedTrail)
  const showTrailFolderList =
    editMode !== 'add-trail' && !(editMode === 'edit-trail' && selectedTrail)

  return (
    <>
      <div className="flex flex-col gap-2 border-b-2 border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
            Trails ({trails.length})
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleModeClick('add-trail')}
              title={editMode === 'add-trail' ? 'Cancel' : 'Add trail'}
              className={cn(
                'flex size-6 items-center justify-center rounded-sm border-2 text-base font-light transition-colors',
                editMode === 'add-trail'
                  ? 'border-foreground bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-mud/80'
              )}
            >
              {editMode === 'add-trail' ? (
                <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5" />
              ) : (
                <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                if (editMode === 'add-trail-photo') onEditModeChange(null)
                else onEnterAddTrailPhoto()
              }}
              title={editMode === 'add-trail-photo' ? 'Cancel' : 'Add a trail photo'}
              className={cn(
                'flex size-6 items-center justify-center rounded-sm border-2 transition-colors',
                editMode === 'add-trail-photo'
                  ? 'border-foreground bg-forest text-secondary-foreground'
                  : 'border-border text-muted-foreground hover:bg-mud/80'
              )}
            >
              {editMode === 'add-trail-photo' ? (
                <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
              ) : (
                <FontAwesomeIcon icon={faCamera} className="w-4 h-4" />
              )}
            </button>
            {user && (
              <button
                type="button"
                onClick={() => handleModeClick('edit-trail')}
                title={editMode === 'edit-trail' ? 'Cancel edit' : 'Edit a trail'}
                className={cn(
                  'flex size-6 items-center justify-center rounded-sm border-2 transition-colors',
                  editMode === 'edit-trail'
                    ? 'border-foreground bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-mud/80'
                )}
              >
                {editMode === 'edit-trail' ? (
                  <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5" />
                ) : (
                  <FontAwesomeIcon icon={faPenToSquare} className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {editMode === 'edit-trail' && selectedTrail && (
          <div className="flex flex-col gap-2">
            {refineError && <p className="text-xs text-destructive">{refineError}</p>}
            <TrailEditDrawer
              variant="edit"
              trailEditTool={staged.drawTool}
              onSetTool={staged.setDrawTool}
              canUndo={staged.canUndo}
              canRedo={staged.canRedo}
              onUndo={staged.undo}
              onRedo={staged.redo}
              onClear={staged.clearAll}
              points={selectedTrail.polyline}
              selectedTrail={selectedTrail}
              refinedPolyline={staged.compositePolyline.length >= 2 ? staged.compositePolyline : null}
              onSaveDraw={onSaveAddedTrail}
              onSaveEdit={onSaveEditedTrail}
              onCancel={() => {
                onSelectTrail(null)
                onEditModeChange(null)
              }}
              onDeleteTrail={onDeleteTrail}
              networks={networks}
            />
          </div>
        )}

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

        {editMode === 'add-trail-photo' && (
          <AddTrailPhotoContent
            user={user}
            onCreated={(photo) => {
              onTrailPhotoCreated(photo)
              onEditModeChange(null)
            }}
            onCancel={() => onEditModeChange(null)}
          />
        )}

        {visibleUnpinnedForPin.length > 0 && (
          <div className="flex flex-col gap-2 px-4 py-3 border-t-2 border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {user ? 'My trail photos — pin on map' : 'Demo trail photos — pin on map'}
            </p>
            <p className="text-xs text-muted-foreground">
              Tap a thumbnail, then tap a trail on the map. Demo photos are not saved for others.
            </p>
            <div className="flex flex-wrap gap-2">
              {visibleUnpinnedForPin.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => onSelectTrailPhotoForAction(photo)}
                  title="View or pin to trail"
                  className={`relative w-14 h-14 rounded-md overflow-hidden border-2 shrink-0 transition-all ${
                    placingTrailPhoto?.id === photo.id
                      ? 'border-forest ring-2 ring-forest/35'
                      : 'border-border hover:border-foreground/40'
                  }`}
                >
                  <img
                    src={photo.thumbnailUrl || photo.blobUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-forest/95 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-secondary-foreground">
                    Pin
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {editMode === 'edit-trail' && !selectedTrail && (
          <p className="text-xs text-muted-foreground">Select a trail from the list to edit its line and details.</p>
        )}

        {showTrailFolderList && (() => {
          const activeBounds = showOnMapOnly && mapBounds ? mapBounds : null
          const visibleTrails = activeBounds
            ? trails.filter(t => polylineInBounds(t.polyline, activeBounds))
            : trails
          const searchFiltered = trailsQuery.trim()
            ? visibleTrails.filter(t => t.name.toLowerCase().includes(trailsQuery.toLowerCase()))
            : visibleTrails

          type TrailRow =
            | { kind: 'header'; networkId: string; name: string; count: number }
            | { kind: 'trail'; trail: Trail; networkId: string | null }

          const rows: TrailRow[] = []
          const sortedNetworks = [...networks].sort((a, b) => a.name.localeCompare(b.name))
          for (const network of sortedNetworks) {
            const networkTrails = searchFiltered.filter(t => network.trailIds.includes(t.id))
            if (networkTrails.length > 0) {
              rows.push({ kind: 'header', networkId: network.id, name: network.name, count: networkTrails.length })
              for (const t of networkTrails) rows.push({ kind: 'trail', trail: t, networkId: network.id })
            }
          }
          const networkTrailIds = new Set(networks.flatMap(n => n.trailIds))
          const unassigned = searchFiltered.filter(t => !networkTrailIds.has(t.id))
          if (unassigned.length > 0) {
            rows.push({ kind: 'header', networkId: '__unassigned__', name: 'Unassigned', count: unassigned.length })
            for (const t of unassigned) rows.push({ kind: 'trail', trail: t, networkId: null })
          }

          const trailFolderSearchBar = (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={trailsQuery}
                onChange={(e) => { setTrailsQuery(e.target.value); setTrailsPage(0) }}
                placeholder="Search trails…"
                className="h-9 flex-1 min-w-0"
              />
              <select
                value={trailsPageSize}
                onChange={(e) => { const v = Number(e.target.value); setTrailsPageSize(v); localStorage.setItem('trailsPageSize', String(v)); setTrailsPage(0) }}
                className="shrink-0 rounded-sm border-2 border-foreground bg-card px-1 py-0.5 text-xs font-semibold text-foreground shadow-[1px_1px_0_0_var(--foreground)]"
              >
                <option value={5}>5 / pg</option>
                <option value={10}>10 / pg</option>
                <option value={25}>25 / pg</option>
              </select>
            </div>
          )

          if (rows.length === 0) {
            return (
              <>
                {trailFolderSearchBar}
                <p className="text-xs text-muted-foreground">
                  {trails.length === 0 ? 'No trails saved yet.' : 'No trails match.'}
                </p>
              </>
            )
          }

          const totalPages = Math.max(1, Math.ceil(rows.length / trailsPageSize))
          const safePage = Math.min(trailsPage, totalPages - 1)
          const pagedRows = rows.slice(safePage * trailsPageSize, (safePage + 1) * trailsPageSize)

          return (
            <>
              {trailFolderSearchBar}
              <ul className="flex flex-col gap-0.5">
                {pagedRows.map((row, i) => {
                  if (row.kind === 'header') {
                    const folderNetwork =
                      row.networkId !== '__unassigned__'
                        ? networks.find((n) => n.id === row.networkId) ?? null
                        : null
                    return (
                      <li key={`h-${row.networkId}-${i}`} className="flex items-center gap-1.5 px-1 pt-2 pb-0.5">
                        <FontAwesomeIcon icon={faFolder} className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground truncate flex-1 min-w-0">
                          {row.name}
                        </span>
                        {folderNetwork && (
                          <button
                            type="button"
                            onClick={() => onFlyToNetwork(folderNetwork)}
                            title="Fly to on map"
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-0.5"
                          >
                            <FontAwesomeIcon icon={faCrosshairs} className="h-3 w-3" />
                          </button>
                        )}
                        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{row.count}</span>
                      </li>
                    )
                  }
                  const { trail } = row
                  return (
                    <Fragment key={`t-wrap-${trail.id}-${row.networkId ?? 'u'}-${i}`}>
                      <li
                        className={cn(
                          'ml-3 flex items-center gap-2 rounded-md border border-transparent bg-mud/45 px-2 py-2 text-sm',
                          selectedTrail?.id === trail.id && editMode === 'edit-trail'
                            ? 'ring-2 ring-primary'
                            : ''
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenViewTrail(trail)}
                          className="text-foreground truncate flex-1 min-w-0 text-left hover:underline underline-offset-2"
                        >
                          {trail.name}
                        </button>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-muted-foreground text-xs">{trail.distanceKm.toFixed(1)} km</span>
                          {trail.difficulty !== 'not_set' && (
                            <Badge
                              variant={DIFFICULTY_BADGE_VARIANT[trail.difficulty] as 'trail' | 'catalog' | 'ink' | 'default' ?? 'default'}
                              className="tabular-nums"
                            >
                              {trail.difficulty === 'easy' ? '● Green' :
                               trail.difficulty === 'intermediate' ? '■ Blue' :
                               trail.difficulty === 'hard' ? '◆ Black' :
                               '◆◆ Dbl'}
                            </Badge>
                          )}
                          <button
                            type="button"
                            onClick={() => onFlyToTrail(trail)}
                            title="Fly to on map"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <FontAwesomeIcon icon={faCrosshairs} className="w-3.5 h-3.5" />
                          </button>
                          {user && (
                            <button
                              type="button"
                              onClick={() => { onSelectTrail(trail); onEditModeChange('edit-trail') }}
                              title="Edit trail"
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <FontAwesomeIcon icon={faPenToSquare} className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </li>
                    </Fragment>
                  )
                })}
              </ul>
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-1">
                  <Button
                    type="button"
                    variant="outlineThick"
                    size="xs"
                    onClick={() => setTrailsPage(p => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                  >
                    Prev
                  </Button>
                  <span className="text-xs font-semibold text-muted-foreground">Page {safePage + 1} of {totalPages}</span>
                  <Button
                    type="button"
                    variant="outlineThick"
                    size="xs"
                    onClick={() => setTrailsPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage === totalPages - 1}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )
        })()}
      </div>

      {!focusedTrailSession && draftTrails.length > 0 && (
        <div className="px-4 py-4 border-t-2 border-border flex flex-col gap-2">
          <h2 className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
            Drafts ({draftTrails.length})
          </h2>
          <DraftsList
            drafts={draftTrails}
            canPublish={!!user}
            onPublish={onPublishDraft}
            onDelete={onDeleteDraft}
            onEdit={onEditDraft}
          />
        </div>
      )}
    </>
  )
}
