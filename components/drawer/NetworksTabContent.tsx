'use client'

import type { EditMode, Network, OfficialMapLayerPayload, Trail } from '@/lib/types'
import type { SessionUser } from '@/lib/auth'
import type { MapBounds } from '@/lib/geo-utils'
import { polylineInBounds } from '@/lib/geo-utils'
import { cn } from '@/lib/utils'
import { NetworkRow } from '@/components/network/NetworkRow'
import { DrawNetworkContent } from '@/components/network/DrawNetworkContent'
import { EditNetworkContent } from '@/components/network/EditNetworkContent'

interface NetworksTabContentProps {
  user: SessionUser | null
  trails: Trail[]
  networks: Network[]
  hiddenNetworkIds: Set<string>
  selectedNetwork: Network | null
  drawNetworkPoints: [number, number][]
  editMode: EditMode
  onEditModeChange: (mode: EditMode) => void
  onToggleNetwork: (id: string) => void
  onSelectNetwork: (network: Network | null) => void
  onSaveNetwork: (name: string, polygon: [number, number][], trailIds: string[]) => Promise<string | null>
  onUpdateNetwork: (name: string, polygon: [number, number][] | null, trailIds: string[]) => Promise<string | null>
  onDeleteNetwork: () => Promise<string | null>
  onStartRedrawNetwork: () => void
  onFlyToNetwork: (network: Network) => void
  onOfficialMapLayerChange: (layer: OfficialMapLayerPayload | null) => void
  onAlignmentMapPickChange: (handler: null | ((latlng: [number, number]) => void)) => void
  pendingDigitizationTask: { id: string; label: string } | null
  onPendingDigitizationTaskChange: (task: { id: string; label: string } | null) => void
  showOnMapOnly: boolean
  mapBounds: MapBounds | null
}

export function NetworksTabContent({
  user,
  trails,
  networks,
  hiddenNetworkIds,
  selectedNetwork,
  drawNetworkPoints,
  editMode,
  onEditModeChange,
  onToggleNetwork,
  onSelectNetwork,
  onSaveNetwork,
  onUpdateNetwork,
  onDeleteNetwork,
  onStartRedrawNetwork,
  onFlyToNetwork,
  onOfficialMapLayerChange,
  onAlignmentMapPickChange,
  pendingDigitizationTask,
  onPendingDigitizationTaskChange,
  showOnMapOnly,
  mapBounds,
}: NetworksTabContentProps) {
  const activeBounds = showOnMapOnly && mapBounds ? mapBounds : null
  const visibleNetworks = activeBounds
    ? networks.filter(n =>
        polylineInBounds(n.polygon, activeBounds) ||
        trails.some(t => n.trailIds.includes(t.id) && polylineInBounds(t.polyline, activeBounds))
      )
    : networks

  return (
    <div className="px-4 py-4 border-t-2 border-border flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
          Networks ({networks.length})
        </h2>
        {user && (
          <button
            type="button"
            onClick={() => onEditModeChange(editMode === 'add-network' ? null : 'add-network')}
            title={editMode === 'add-network' ? 'Cancel' : 'Add new network'}
            className={cn(
              'flex size-6 items-center justify-center rounded-sm border-2 text-base font-light transition-colors',
              editMode === 'add-network'
                ? 'border-foreground bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-mud/80'
            )}
          >
            {editMode === 'add-network' ? '×' : '+'}
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

      {editMode === 'edit-network' && (
        <EditNetworkContent
          key={selectedNetwork?.id ?? 'none'}
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
          pendingDigitizationTask={pendingDigitizationTask}
          onPendingDigitizationTaskChange={onPendingDigitizationTaskChange}
        />
      )}

      {visibleNetworks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {networks.length === 0 ? 'No networks yet.' : 'No networks in view.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visibleNetworks.map((network) => (
            <NetworkRow
              key={network.id}
              network={network}
              trails={trails}
              isSelected={selectedNetwork?.id === network.id && editMode === 'edit-network'}
              isHidden={hiddenNetworkIds.has(network.id)}
              onToggleVisibility={() => onToggleNetwork(network.id)}
              onFlyTo={() => onFlyToNetwork(network)}
              onEdit={() => {
                onSelectNetwork(network)
                onEditModeChange('edit-network')
              }}
              user={user}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
