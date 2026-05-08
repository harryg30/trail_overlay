'use client'

import { useState } from 'react'
import type { Trail, Network } from '@/lib/types'
import type { SessionUser } from '@/lib/auth'
import type { OfficialMapLayerPayload } from '@/lib/types'
import { ConfirmDeleteButton } from '@/components/shared/ConfirmDeleteButton'
import { SearchableDropdown } from '@/components/shared/SearchableDropdown'
import { OfficialMapAndTasksPanel } from '@/components/network/OfficialMapAndTasksPanel'

export function EditNetworkContent({
  trails,
  networks,
  selectedNetwork,
  onSelectNetwork,
  onUpdate,
  onDelete,
  onRedraw,
  onCancel,
  user,
  onOfficialMapLayerChange,
  onAlignmentMapPickChange,

}: {
  trails: Trail[]
  networks: Network[]
  selectedNetwork: Network | null
  onSelectNetwork: (network: Network | null) => void
  onUpdate: (name: string, polygon: [number, number][] | null, trailIds: string[]) => Promise<string | null>
  onDelete: () => Promise<string | null>
  onRedraw: () => void
  onCancel: () => void
  user: SessionUser | null
  onOfficialMapLayerChange: (layer: OfficialMapLayerPayload | null) => void
  onAlignmentMapPickChange: (handler: null | ((latlng: [number, number]) => void)) => void
}) {
  const [name, setName] = useState(selectedNetwork?.name ?? '')
  const [selectedTrailIds, setSelectedTrailIds] = useState<Set<string>>(
    new Set(selectedNetwork?.trailIds ?? [])
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const toggleTrail = (id: string) => {
    setSelectedTrailIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    if (!selectedNetwork || !name.trim()) return
    setSaving(true)
    setSaveError(null)
    const err = await onUpdate(name.trim(), null, Array.from(selectedTrailIds))
    if (err) setSaveError(err)
    setSaving(false)
  }

  const inputCls = 'w-full rounded border border-border bg-mud/45 px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-ring'
  const disabled = !selectedNetwork

  return (
    <div className="flex flex-col gap-3">
      <SearchableDropdown
        items={networks}
        selectedItem={selectedNetwork}
        onSelect={onSelectNetwork}
        onClear={() => onSelectNetwork(null)}
        getSearchText={(n) => n.name}
        renderItem={(network, isSelected) => (
          <span className={`px-3 py-2 text-sm hover:bg-primary/10 flex items-center justify-between gap-2 ${isSelected ? 'bg-primary/10 text-electric' : 'text-foreground'}`}>
            <span className="truncate">{network.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">{network.trailIds.length} trails</span>
          </span>
        )}
        placeholder="Search networks…"
        inputCls={inputCls}
      />

      {!selectedNetwork && (
        <p className="text-xs text-muted-foreground">Search above or click a network on the map.</p>
      )}

      <div className={`flex flex-col gap-3${disabled ? ' opacity-50 pointer-events-none' : ''}`}>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Trails</label>
          {trails.length === 0 ? (
            <p className="text-xs text-muted-foreground">No trails yet.</p>
          ) : (
            <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto">
              {trails.map((trail) => (
                <label key={trail.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-mud/45 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTrailIds.has(trail.id)}
                    onChange={() => toggleTrail(trail.id)}
                    className="accent-primary"
                  />
                  <span className="text-xs text-foreground truncate">{trail.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">{trail.distanceKm.toFixed(1)} km</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {selectedNetwork && (
          <OfficialMapAndTasksPanel
            networkId={selectedNetwork.id}
            user={user}
            onOfficialMapLayerChange={onOfficialMapLayerChange}
            onAlignmentMapPickChange={onAlignmentMapPickChange}
          />
        )}

        {saveError && <p className="text-xs text-destructive">{saveError}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={disabled || saving || !name.trim()}
            className="flex-1 py-2 rounded-md bg-primary/100 text-white text-sm font-medium hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-2 rounded-md border border-border text-sm text-muted-foreground hover:bg-mud/45 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>

        <button
          type="button"
          onClick={onRedraw}
          disabled={disabled || saving}
          className="w-full py-2 rounded-md border border-border text-sm text-muted-foreground hover:bg-mud/45 disabled:opacity-50 transition-colors"
        >
          Redraw Polygon
        </button>

        <ConfirmDeleteButton onDelete={onDelete} disabled={disabled || saving} entityLabel="Network" />
      </div>
    </div>
  )
}
