'use client'

import { useState, useEffect } from 'react'
import type { Trail, TrimFormState, Network } from '@/lib/types'
import type { TrailEditTool } from '@/lib/modes/types'
import { TrailFormFields } from '@/components/shared/TrailFormFields'
import { ConfirmDeleteButton } from '@/components/shared/ConfirmDeleteButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { polylineDistanceKm } from '@/lib/geo-utils'
import { cn } from '@/lib/utils'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEraser, faPencil, faRotateLeft, faRotateRight, faScissors, faMagnet } from '@fortawesome/free-solid-svg-icons'

const toolBtnActive = 'border-2 border-foreground bg-foreground text-background'
const toolBtnIdle = 'border-2 border-border bg-card text-foreground hover:bg-mud/80'
const iconActionBtn =
  'shrink-0 rounded-md border-2 border-border bg-card p-2 text-foreground transition-colors hover:bg-mud/80 disabled:cursor-not-allowed disabled:opacity-40'

export function TrailEditDrawer({
  variant,
  trailEditTool,
  onSetTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  points,
  selectedTrail,
  refinedPolyline,
  onSaveDraw,
  onSaveEdit,
  onCancel,
  onDeleteTrail,
  networks,
  canPublish,
}: {
  variant: 'draw' | 'edit'
  trailEditTool: TrailEditTool
  onSetTool: (t: TrailEditTool) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  points: [number, number][]
  selectedTrail: Trail | null
  refinedPolyline: [number, number][] | null
  onSaveDraw: (form: TrimFormState, publishOnSave: boolean) => Promise<string | null>
  onSaveEdit: (form: TrimFormState) => Promise<string | null>
  onCancel: () => void
  onDeleteTrail?: () => Promise<string | null>
  networks: Network[]
  canPublish?: boolean
}) {
  const [form, setForm] = useState<TrimFormState>({
    name: '',
    difficulty: 'not_set',
    direction: 'not_set',
    notes: '',
  })
  const [networkQuery, setNetworkQuery] = useState('')
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false)
  const [publishOnSave, setPublishOnSave] = useState(!!canPublish)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (variant !== 'edit' || !selectedTrail) return
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate form from selected trail */
    setForm({
      name: selectedTrail.name,
      difficulty: selectedTrail.difficulty,
      direction: selectedTrail.direction,
      notes: selectedTrail.notes ?? '',
    })
    setSaveError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [variant, selectedTrail])

  useEffect(() => {
    if (variant !== 'draw') return
    /* eslint-disable react-hooks/set-state-in-effect -- reset draw flow fields */
    setForm({ name: '', difficulty: 'not_set', direction: 'not_set', notes: '' })
    setNetworkQuery('')
    setSaveError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [variant])

  const displayPoints = variant === 'edit' ? (refinedPolyline ?? points) : points
  const distanceKm = displayPoints.length >= 2 ? polylineDistanceKm(displayPoints) : 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving || !form.name.trim()) return
    if (variant === 'edit' && refinedPolyline === null) return
    if (variant === 'draw' && displayPoints.length < 2) {
      setSaveError('Draw at least 2 points on the map')
      return
    }
    if (variant === 'edit' && displayPoints.length < 2) {
      setSaveError('Trail line needs at least 2 points')
      return
    }
    setSaving(true)
    setSaveError(null)
    const err =
      variant === 'draw'
        ? await onSaveDraw(form, publishOnSave)
        : await onSaveEdit(form)
    if (err) setSaveError(err)
    setSaving(false)
  }

  const title = variant === 'draw' ? 'Draw trail' : 'Edit trail'
  const toolBase =
    'flex shrink-0 items-center justify-center rounded-md border-2 p-2 transition-colors'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-base font-normal uppercase tracking-wide text-foreground">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{displayPoints.length}</span> pts
          {distanceKm > 0 && (
            <span className="ml-2">{distanceKm.toFixed(2)} km</span>
          )}
        </p>
      </div>

      {variant === 'draw' && (
        <div className="flex flex-col gap-2">
          <p className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
            Tools
          </p>
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
            <button
              type="button"
              title="Pencil"
              aria-label="Pencil tool"
              aria-pressed={trailEditTool === 'pencil'}
              onClick={() => onSetTool('pencil')}
              className={`${toolBase} ${trailEditTool === 'pencil' ? toolBtnActive : toolBtnIdle}`}
            >
              <FontAwesomeIcon icon={faPencil} className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Eraser"
              aria-label="Eraser tool"
              aria-pressed={trailEditTool === 'eraser'}
              onClick={() => onSetTool('eraser')}
              className={`${toolBase} ${trailEditTool === 'eraser' ? toolBtnActive : toolBtnIdle}`}
            >
              <FontAwesomeIcon icon={faEraser} className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Section eraser"
              aria-label="Section eraser tool"
              aria-pressed={trailEditTool === 'section-eraser'}
              onClick={() => onSetTool('section-eraser')}
              className={`${toolBase} ${trailEditTool === 'section-eraser' ? toolBtnActive : toolBtnIdle}`}
            >
              <FontAwesomeIcon icon={faScissors} className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Snap to OSM"
              aria-label="Snap to OSM tool"
              aria-pressed={trailEditTool === 'snap'}
              onClick={() => onSetTool('snap')}
              className={`${toolBase} ${trailEditTool === 'snap' ? toolBtnActive : toolBtnIdle}`}
            >
              <FontAwesomeIcon icon={faMagnet} className="w-4 h-4" />
            </button>
            <button type="button" className={iconActionBtn} onClick={onUndo} disabled={!canUndo} title="Undo" aria-label="Undo">
              <FontAwesomeIcon icon={faRotateLeft} className="w-4 h-4" />
            </button>
            <button type="button" className={iconActionBtn} onClick={onRedo} disabled={!canRedo} title="Redo" aria-label="Redo">
              <FontAwesomeIcon icon={faRotateRight} className="w-4 h-4" />
            </button>
            <Button type="button" variant="outlineThick" size="sm" onClick={onClear}>
              Clear
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {trailEditTool === 'section-eraser'
              ? 'Section eraser: click two points to erase the section between them.'
              : trailEditTool === 'snap'
                ? 'Snap to OSM: click to snap to nearest trail/road. Click a second point to auto-route between them.'
                : 'Pencil: click line or drag points to edit; tap midpoints to insert. Eraser: remove a point.'}
          </p>
        </div>
      )}

      {variant === 'edit' && (
        <div className="flex flex-col gap-2">
          <p className="font-display text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
            Tools
          </p>
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
            <button
              type="button"
              title="Snap to OSM"
              aria-label="Snap to OSM tool"
              aria-pressed={trailEditTool === 'snap'}
              onClick={() => onSetTool('snap')}
              className={`${toolBase} ${trailEditTool === 'snap' ? toolBtnActive : toolBtnIdle}`}
            >
              <FontAwesomeIcon icon={faMagnet} className="w-4 h-4" />
            </button>
            <button type="button" className={iconActionBtn} onClick={onUndo} disabled={!canUndo} title="Undo" aria-label="Undo">
              <FontAwesomeIcon icon={faRotateLeft} className="w-4 h-4" />
            </button>
            <button type="button" className={iconActionBtn} onClick={onRedo} disabled={!canRedo} title="Redo" aria-label="Redo">
              <FontAwesomeIcon icon={faRotateRight} className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {trailEditTool === 'snap'
              ? 'Snap to OSM: drag endpoints to snap to nearest trail/road and auto-route along OSM ways.'
              : 'Snap to OSM to adjust endpoints along OSM trails and roads.'}
          </p>
        </div>
      )}

      <div>
        <p className="font-display mb-2 text-xs font-normal uppercase tracking-[0.15em] text-muted-foreground">
          Trail details
        </p>
        <TrailFormFields form={form} onChange={setForm} disabled={saving} />
      </div>

      {variant === 'draw' && (
        <div className="relative">
          <Label className="mb-1 text-[11px]">Network</Label>
          <div className="flex items-center gap-1">
            <Input
              type="text"
              placeholder="Search networks…"
              disabled={saving}
              value={networkQuery}
              onChange={(e) => {
                setNetworkQuery(e.target.value)
                setShowNetworkDropdown(true)
                if (!e.target.value) setForm((f) => ({ ...f, networkId: undefined }))
              }}
              onFocus={() => setShowNetworkDropdown(true)}
              onBlur={() => setTimeout(() => setShowNetworkDropdown(false), 150)}
              className="h-9 flex-1 text-sm"
            />
            {form.networkId && (
              <button
                type="button"
                onClick={() => {
                  setNetworkQuery('')
                  setForm((f) => ({ ...f, networkId: undefined }))
                }}
                className="px-1 text-muted-foreground hover:text-foreground"
                title="Clear network"
              >
                ×
              </button>
            )}
          </div>
          {showNetworkDropdown && networkQuery && (() => {
            const matches = networks.filter((n) => n.name.toLowerCase().includes(networkQuery.toLowerCase()))
            if (!matches.length) return null
            return (
              <ul className="absolute z-50 mt-0.5 max-h-36 w-full overflow-y-auto border-2 border-foreground bg-card text-sm shadow-[3px_3px_0_0_var(--foreground)]">
                {matches.map((n) => (
                  <li
                    key={n.id}
                    onMouseDown={() => {
                      setForm((f) => ({ ...f, networkId: n.id }))
                      setNetworkQuery(n.name)
                      setShowNetworkDropdown(false)
                    }}
                    className={cn(
                      'cursor-pointer px-3 py-2 hover:bg-mud/80',
                      form.networkId === n.id && 'bg-primary/20 font-bold text-primary'
                    )}
                  >
                    {n.name}
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>
      )}

      {variant === 'edit' && selectedTrail && (
        <div className="flex gap-3 font-mono text-xs text-muted-foreground">
          <span>Original ~{selectedTrail.distanceKm.toFixed(2)} km</span>
          <span>~{Math.round(selectedTrail.elevationGainFt)} ft gain</span>
        </div>
      )}

      {saveError && <p className="text-xs font-semibold text-destructive">{saveError}</p>}
      {variant === 'edit' && refinedPolyline === null && (
        <p className="text-xs text-muted-foreground">Loading line…</p>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          variant="catalog"
          className="flex-1"
          disabled={saving || !form.name.trim() || (variant === 'edit' && refinedPolyline === null)}
        >
          {saving ? 'Saving…' : variant === 'draw' ? 'Save trail' : 'Save changes'}
        </Button>
        <Button type="button" variant="outlineThick" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>

      {variant === 'draw' && canPublish && (
        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={publishOnSave}
            onChange={(e) => setPublishOnSave(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          Publish to public map
        </label>
      )}

      {variant === 'edit' && onDeleteTrail && selectedTrail && (
        <ConfirmDeleteButton onDelete={onDeleteTrail} disabled={saving} entityLabel="Trail" />
      )}
    </form>
  )
}
