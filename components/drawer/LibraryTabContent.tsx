'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  DraftTrail,
  EditMode,
  Network,
  OfficialMapLayerPayload,
  Trail,
  TrailPhoto,
  TrimFormState,
} from '@/lib/types'
import type { SessionUser } from '@/lib/auth'
import type { MapBounds } from '@/lib/geo-utils'
import { polylineInBounds } from '@/lib/geo-utils'
import type { StagedTrailApi } from '@/hooks/useStagedTrail'
import { Badge } from '@/components/ui/badge'
import { DIFFICULTY_BADGE_VARIANT } from '@/lib/trail-constants'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { TrailEditDrawer } from '@/components/trail/TrailEditDrawer'
import { AddTrailPhotoContent } from '@/components/photo/AddTrailPhotoContent'
import { DraftsList } from '@/components/trail/DraftsList'
import { EditNetworkContent } from '@/components/network/EditNetworkContent'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCamera,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faCrosshairs,
  faEye,
  faEyeSlash,
  faPenToSquare,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'

interface LibraryTabContentProps {
  /** When true, trails and networks outside mapBounds are hidden. */
  viewportFilter?: boolean
  mapBounds: MapBounds | null
  user: SessionUser | null
  trails: Trail[]
  networks: Network[]
  draftTrails: DraftTrail[]
  hiddenNetworkIds: Set<string>

  editMode: EditMode
  onEditModeChange: (mode: EditMode) => void
  selectedTrail: Trail | null
  onSelectTrail: (trail: Trail | null) => void
  selectedNetwork: Network | null
  onSelectNetwork: (network: Network | null) => void
  drawNetworkPoints: [number, number][]

  onSaveEditedTrail: (form: TrimFormState) => Promise<string | null>
  onSaveAddedTrail: (form: TrimFormState, publishOnSave: boolean) => Promise<string | null>
  onDeleteTrail: () => Promise<string | null>
  refineError: string | null
  staged: StagedTrailApi
  draftSidebarPrefill: DraftTrail | null
  onClearDraftSidebarPrefill: () => void

  onPublishDraft: (localId: string) => Promise<string | null>
  onDeleteDraft: (localId: string) => void
  onEditDraft: (localId: string) => void

  onSaveNetwork: (name: string, polygon: [number, number][], trailIds: string[]) => Promise<string | null>
  onUpdateNetwork: (name: string, polygon: [number, number][] | null, trailIds: string[]) => Promise<string | null>
  onDeleteNetwork: () => Promise<string | null>
  onStartRedrawNetwork: () => void
  onToggleNetwork: (id: string) => void
  onFlyToNetwork: (network: Network) => void
  onOfficialMapLayerChange: (layer: OfficialMapLayerPayload | null) => void
  onAlignmentMapPickChange: (handler: null | ((latlng: [number, number]) => void)) => void

  onEnterAddTrailPhoto: () => void
  onTrailPhotoCreated: (photo: TrailPhoto) => void

  onOpenViewTrail: (trail: Trail) => void
  onFlyToTrail: (trail: Trail) => void
}

/**
 * Network-first accordion Library / Map tab.
 * Networks are collapsible groups; trails appear inline when expanded.
 * Drafts are pinned at top and never viewport-filtered.
 * When viewportFilter is true (Map tab), networks/trails outside mapBounds are hidden.
 */
export function LibraryTabContent({
  viewportFilter = false,
  mapBounds,
  user,
  trails,
  networks,
  draftTrails,
  hiddenNetworkIds,
  editMode,
  onEditModeChange,
  selectedTrail,
  onSelectTrail,
  selectedNetwork,
  onSelectNetwork,
  drawNetworkPoints,
  onSaveEditedTrail,
  onSaveAddedTrail,
  onDeleteTrail,
  refineError,
  staged,
  draftSidebarPrefill,
  onClearDraftSidebarPrefill,
  onPublishDraft,
  onDeleteDraft,
  onEditDraft,
  onSaveNetwork,
  onUpdateNetwork,
  onDeleteNetwork,
  onStartRedrawNetwork,
  onToggleNetwork,
  onFlyToNetwork,
  onOfficialMapLayerChange,
  onAlignmentMapPickChange,
  onEnterAddTrailPhoto,
  onTrailPhotoCreated,
  onOpenViewTrail,
  onFlyToTrail,
}: LibraryTabContentProps) {
  const [expandedNetworkIds, setExpandedNetworkIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const toggleNetwork = (id: string) =>
    setExpandedNetworkIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Auto-expand network being edited so trails are visible during edit-network.
  useEffect(() => {
    if (editMode === 'edit-network' && selectedNetwork) {
      setExpandedNetworkIds((prev) => new Set([...prev, selectedNetwork.id]))
    }
  }, [editMode, selectedNetwork?.id])

  const handleModeClick = (mode: EditMode) => {
    onEditModeChange(editMode === mode ? null : mode)
  }

  const focusedTrailSession = editMode === 'edit-trail' && !!selectedTrail

  const activeBounds = viewportFilter && mapBounds ? mapBounds : null

  const sortedNetworks = useMemo(
    () => [...networks].sort((a, b) => a.name.localeCompare(b.name)),
    [networks]
  )

  const networkTrailIdSet = useMemo(
    () => new Set(networks.flatMap((n) => n.trailIds)),
    [networks]
  )

  const q = query.trim().toLowerCase()

  const matchTrailName = (t: Trail) => !q || t.name.toLowerCase().includes(q)
  const matchNetworkName = (n: Network) => !q || n.name.toLowerCase().includes(q)

  // For each network: apply viewport filter then search filter.
  const visibleNetworks = useMemo(() => {
    return sortedNetworks
      .map((n) => {
        // Viewport filter: keep network if its polygon or any member trail is in bounds.
        if (activeBounds) {
          const polygonVisible = n.polygon.length > 0 && polylineInBounds(n.polygon, activeBounds)
          const memberTrailVisible = trails.some(
            (t) => n.trailIds.includes(t.id) && polylineInBounds(t.polyline, activeBounds)
          )
          if (!polygonVisible && !memberTrailVisible) return null
        }
        // Search: keep network if name matches OR any member trail name matches.
        if (q) {
          const nameMatch = matchNetworkName(n)
          const trailNameMatch = trails.some(
            (t) => n.trailIds.includes(t.id) && matchTrailName(t)
          )
          if (!nameMatch && !trailNameMatch) return null
        }
        return n
      })
      .filter(Boolean) as Network[]
  }, [sortedNetworks, trails, activeBounds, q])

  // Trails for a given network, filtered by viewport + search.
  const getNetworkTrails = (network: Network) =>
    trails.filter((t) => {
      if (!network.trailIds.includes(t.id)) return false
      if (activeBounds && !polylineInBounds(t.polyline, activeBounds)) return false
      if (!matchTrailName(t)) return false
      return true
    })

  const standaloneTrails = useMemo(() => {
    return trails.filter((t) => {
      if (networkTrailIdSet.has(t.id)) return false
      if (activeBounds && !polylineInBounds(t.polyline, activeBounds)) return false
      if (!matchTrailName(t)) return false
      return true
    })
  }, [trails, networkTrailIdSet, activeBounds, q])

  const renderTrailRow = (trail: Trail, indent = true) => (
    <li
      key={trail.id}
      className={cn(
        'flex items-center gap-2 rounded-md border border-transparent bg-mud/45 px-2 py-2 text-sm',
        indent ? 'ml-3' : '',
        selectedTrail?.id === trail.id && editMode === 'edit-trail' ? 'ring-2 ring-primary' : ''
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
  )

  // Flat list of all trails in viewport (used by Map tab).
  const trailsInView = useMemo(() => {
    if (!activeBounds) return []
    return [...trails]
      .filter((t) => polylineInBounds(t.polyline, activeBounds))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [trails, activeBounds])

  // ── Map tab: simple flat list ─────────────────────────────────────────────
  if (viewportFilter) {
    return (
      <div className="px-4 py-4 flex flex-col gap-2">
        <h2 className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
          Trails in view ({trailsInView.length})
        </h2>
        {trailsInView.length === 0 ? (
          <p className="text-xs text-muted-foreground">No trails in the current viewport.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {trailsInView.map((trail) => (
              <li
                key={trail.id}
                className={cn(
                  'flex items-center gap-2 rounded-md bg-mud/45 px-2 py-2 text-sm',
                  selectedTrail?.id === trail.id && editMode === 'edit-trail' ? 'ring-2 ring-primary' : ''
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
            ))}
          </ul>
        )}
      </div>
    )
  }

  // ── Library tab: network-first accordion ──────────────────────────────────
  return (
    <>

        {/* Trail edit drawer */}
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

        {editMode === 'edit-trail' && !selectedTrail && (
          <p className="text-xs text-muted-foreground">Select a trail from the list to edit its line and details.</p>
        )}
  

      {/* Drafts — pinned, never viewport-filtered */}
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

      {editMode === 'edit-network' && selectedNetwork && (
        <div className="px-4 py-4 border-t-2 border-border flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              onEditModeChange(null)
              onSelectNetwork(null)
            }}
            className="self-start flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            <FontAwesomeIcon icon={faChevronLeft} className="w-3 h-3" />
            {selectedNetwork.name}
          </button>
          <EditNetworkContent
            key={selectedNetwork.id}
            trails={trails}
            networks={networks}
            selectedNetwork={selectedNetwork}
            onSelectNetwork={onSelectNetwork}
            onUpdate={onUpdateNetwork}
            onDelete={onDeleteNetwork}
            onRedraw={onStartRedrawNetwork}
            onCancel={() => { onSelectNetwork(null); onEditModeChange(null) }}
            user={user}
            onOfficialMapLayerChange={onOfficialMapLayerChange}
            onAlignmentMapPickChange={onAlignmentMapPickChange}
          />
        </div>
      )}

      {/* Accordion body — hidden during trail or network edit */}
      {!focusedTrailSession && editMode !== 'edit-network' && (
        <div className="px-4 py-4 border-t-2 border-border flex flex-col gap-3">
          {/* Search */}
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search networks and trails…"
            className="h-9"
          />

          {/* Networks */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Networks ({visibleNetworks.length})
              </h3>

            </div>

            {visibleNetworks.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {networks.length === 0
                  ? 'No networks yet.'
                  : viewportFilter
                  ? 'No networks in view.'
                  : 'No networks match.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {visibleNetworks.map((network) => {
                  const isHidden = hiddenNetworkIds.has(network.id)
                  const isExpanded = expandedNetworkIds.has(network.id)
                  const networkTrails = getNetworkTrails(network)
                  return (
                    <li key={network.id}>
                      {/* Network header row */}
                      <div
                        className={cn(
                          'flex items-center gap-2 rounded-md bg-mud/45 px-3 py-2 text-sm',
                          isHidden ? 'opacity-50' : ''
                        )}
                      >
                        {/* Expand/collapse chevron + name */}
                        <button
                          type="button"
                          onClick={() => toggleNetwork(network.id)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        >
                          <FontAwesomeIcon
                            icon={isExpanded ? faChevronDown : faChevronRight}
                            className="w-3 h-3 shrink-0 text-muted-foreground transition-transform"
                          />
                          <span className="truncate text-foreground font-medium">{network.name}</span>
                          <span className="text-muted-foreground text-xs shrink-0">{networkTrails.length}</span>
                        </button>
                        {/* Actions */}
                        <button
                          type="button"
                          onClick={() => onToggleNetwork(network.id)}
                          title={isHidden ? 'Show on map' : 'Hide from map'}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          <FontAwesomeIcon icon={isHidden ? faEyeSlash : faEye} className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onFlyToNetwork(network)}
                          title="Fly to on map"
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          <FontAwesomeIcon icon={faCrosshairs} className="w-3.5 h-3.5" />
                        </button>
                        {user && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectNetwork(network)
                              onEditModeChange('edit-network')
                            }}
                            title="Edit network"
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          >
                            <FontAwesomeIcon icon={faPenToSquare} className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Expanded trail list */}
                      {isExpanded && (
                        <ul className="flex flex-col gap-0.5 mt-0.5">
                          {networkTrails.length === 0 ? (
                            <li className="ml-3 px-2 py-2 text-xs text-muted-foreground">
                              {network.trailIds.length === 0
                                ? 'No trails in this network yet.'
                                : 'No trails in view.'}
                            </li>
                          ) : (
                            networkTrails.map((t) => renderTrailRow(t))
                          )}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Standalone trails */}
          {standaloneTrails.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Standalone trails ({standaloneTrails.length})
              </h3>
              <ul className="flex flex-col gap-0.5">
                {standaloneTrails.map((t) => renderTrailRow(t, false))}
              </ul>
            </div>
          )}

          {networks.length === 0 && standaloneTrails.length === 0 && trails.length === 0 && (
            <p className="text-xs text-muted-foreground">No trails or networks saved yet.</p>
          )}
        </div>
      )}
    </>
  )
}
