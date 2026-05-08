'use client'

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
import type { StagedTrailApi } from '@/hooks/useStagedTrail'
import { TrailsTabContent } from '@/components/drawer/TrailsTabContent'
import { NetworksTabContent } from '@/components/drawer/NetworksTabContent'

interface MapTabContentProps {
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
  visibleUnpinnedForPin: TrailPhoto[]
  placingTrailPhoto: TrailPhoto | null
  onSelectTrailPhotoForAction: (photo: TrailPhoto) => void

  onOpenViewTrail: (trail: Trail) => void
  onFlyToTrail: (trail: Trail) => void
}

export function MapTabContent(props: MapTabContentProps) {
  const {
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
    visibleUnpinnedForPin,
    placingTrailPhoto,
    onSelectTrailPhotoForAction,
    onOpenViewTrail,
    onFlyToTrail,
  } = props

  return (
    <>
      <TrailsTabContent
        user={user}
        trails={trails}
        networks={networks}
        editMode={editMode}
        onEditModeChange={onEditModeChange}
        selectedTrail={selectedTrail}
        onSelectTrail={onSelectTrail}
        onSaveEditedTrail={onSaveEditedTrail}
        onSaveAddedTrail={onSaveAddedTrail}
        onDeleteTrail={onDeleteTrail}
        refineError={refineError}
        staged={staged}
        draftSidebarPrefill={draftSidebarPrefill}
        onClearDraftSidebarPrefill={onClearDraftSidebarPrefill}
        onEnterAddTrailPhoto={onEnterAddTrailPhoto}
        onTrailPhotoCreated={onTrailPhotoCreated}
        visibleUnpinnedForPin={visibleUnpinnedForPin}
        placingTrailPhoto={placingTrailPhoto}
        onSelectTrailPhotoForAction={onSelectTrailPhotoForAction}
        showOnMapOnly={true}
        mapBounds={mapBounds}
        onOpenViewTrail={onOpenViewTrail}
        onFlyToTrail={onFlyToTrail}
        onFlyToNetwork={onFlyToNetwork}
        draftTrails={draftTrails}
        onPublishDraft={onPublishDraft}
        onDeleteDraft={onDeleteDraft}
        onEditDraft={onEditDraft}
      />
      <NetworksTabContent
        user={user}
        trails={trails}
        networks={networks}
        hiddenNetworkIds={hiddenNetworkIds}
        selectedNetwork={selectedNetwork}
        drawNetworkPoints={drawNetworkPoints}
        editMode={editMode}
        onEditModeChange={onEditModeChange}
        onToggleNetwork={onToggleNetwork}
        onSelectNetwork={onSelectNetwork}
        onSaveNetwork={onSaveNetwork}
        onUpdateNetwork={onUpdateNetwork}
        onDeleteNetwork={onDeleteNetwork}
        onStartRedrawNetwork={onStartRedrawNetwork}
        onFlyToNetwork={onFlyToNetwork}
        onOfficialMapLayerChange={onOfficialMapLayerChange}
        onAlignmentMapPickChange={onAlignmentMapPickChange}
        showOnMapOnly={true}
        mapBounds={mapBounds}
      />
    </>
  )
}
