'use client'

import { useEffect, useRef, useState } from 'react'
import type { DraftTrail, Network, StagedSegment, TrimFormState } from '@/lib/types'
import { inferNetworkIdForPolyline } from '@/lib/geo-utils'
import { Button } from '@/components/ui/button'
import { TrailFormFields } from '@/components/shared/TrailFormFields'
import type { StagedTrailApi } from '@/hooks/useStagedTrail'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'

interface AddTrailSidebarProps {
  staged: StagedTrailApi
  onSave: (form: TrimFormState, publishOnSave: boolean) => Promise<string | null>
  onCancel: () => void
  networks: Network[]
  canPublish: boolean
  draftPrefill: DraftTrail | null
  onClearDraftPrefill: () => void
}

export function AddTrailSidebar({
  staged,
  onSave,
  onCancel,
  networks,
  canPublish,
  draftPrefill,
  onClearDraftPrefill,
}: AddTrailSidebarProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form, setForm] = useState<TrimFormState>({
    name: '',
    difficulty: 'not_set',
    direction: 'not_set',
    notes: '',
    networkId: undefined,
  })
  const networkUserChosenRef = useRef(false)

  // One-shot: opening a draft for edit (map tools + sidebar form)
  useEffect(() => {
    if (!draftPrefill) return
    queueMicrotask(() => {
      setForm({
        name: draftPrefill.name,
        difficulty: draftPrefill.difficulty,
        direction: draftPrefill.direction,
        notes: draftPrefill.notes ?? '',
        networkId: draftPrefill.networkId,
      })
    })
    networkUserChosenRef.current = !!draftPrefill.networkId
    onClearDraftPrefill()
  }, [draftPrefill, onClearDraftPrefill])

  // Pre-fill trail name from OSM way names when the user hasn't typed a name yet
  useEffect(() => {
    const osmNamed = staged.segments.filter(
      (s): s is Extract<StagedSegment, { source: 'osm' }> =>
        s.source === 'osm' && typeof s.name === 'string' && s.name.trim().length > 0
    )
    if (osmNamed.length === 0) return
    const suggested =
      osmNamed.length === 1
        ? (osmNamed[0]?.name ?? '').trim()
        : osmNamed.map((s) => (s.name ?? '').trim()).filter(Boolean).join(' · ')
    if (!suggested) return
    queueMicrotask(() => {
      setForm((prev) => {
        if (prev.name.trim() !== '') return prev
        return { ...prev, name: suggested }
      })
    })
  }, [staged.segments])

  // Pre-fill network from polygon containment when the user hasn't changed the Network select
  useEffect(() => {
    if (networkUserChosenRef.current || networks.length === 0) return
    if (staged.compositePolyline.length < 2) return
    const id = inferNetworkIdForPolyline(staged.compositePolyline, networks)
    queueMicrotask(() => {
      setForm((prev) => ({ ...prev, networkId: id }))
    })
  }, [staged.compositePolyline, networks])

  const handleSubmit = async (publishOnSave: boolean) => {
    setSaving(true)
    setSaveError(null)
    const err = await onSave(form, publishOnSave)
    setSaving(false)
    if (err) setSaveError(err)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        Use the panel on the map to draw, select GPX segments, or pick OSM ways.
      </p>
      {staged.segments.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Staged — {staged.segments.length} segment{staged.segments.length !== 1 ? 's' : ''} · {staged.totalDistanceKm.toFixed(2)} km
          </p>
          {staged.segments.map((seg, i) => (
            <div key={seg.id} className="flex items-center justify-between text-[11px]">
              <span className="truncate">
                {i + 1}. {seg.source === 'draw' ? `Draw (${seg.polyline.length} pts)` : seg.source === 'gpx' ? 'GPX' : seg.source === 'osm' ? ((seg as Extract<typeof seg, { source: 'osm' }>).name ?? `OSM`) : seg.source === 'strava' ? ((seg as Extract<typeof seg, { source: 'strava' }>).name ?? `Strava`) : '?'}
              </span>
              <button type="button" onClick={() => staged.removeSegment(seg.id)} className="text-muted-foreground hover:text-destructive" title="Remove">
                <FontAwesomeIcon icon={faXmark} className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      <TrailFormFields form={form} onChange={setForm} disabled={saving} />
      {networks.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium">Network</label>
          <select
            value={form.networkId ?? ''}
            onChange={(e) => {
              networkUserChosenRef.current = true
              setForm({ ...form, networkId: e.target.value || undefined })
            }}
            disabled={saving}
            className="h-9 w-full rounded-md border-2 border-foreground bg-card px-2 py-1 text-sm font-medium text-foreground shadow-[inset_2px_2px_0_0_var(--mud)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">None</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => handleSubmit(false)}
          disabled={saving || staged.compositePolyline.length < 2}
        >
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
        {canPublish && (
          <Button
            type="button"
            variant="outlineThick"
            size="sm"
            onClick={() => handleSubmit(true)}
            disabled={saving || staged.compositePolyline.length < 2 || !form.name.trim()}
          >
            Publish
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
