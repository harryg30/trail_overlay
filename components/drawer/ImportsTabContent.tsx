'use client'

import { useState, useEffect, useImperativeHandle, forwardRef } from 'react'
import { Button } from '@/components/ui/button'
import type { SessionUser } from '@/lib/auth'
import type { MapBounds } from '@/lib/geo-utils'

interface ImportDraft {
  id: string
  importSessionId: string
  bbox: { north: number; south: number; east: number; west: number }
  filters: any
  status: 'processing' | 'pending' | 'approved' | 'rejected' | 'published' | 'failed'
  trails: ImportedTrail[]
  stats: {
    totalFound: number
    filtered: number
    newTrails: number
    duplicates: number
    recommended: number
    error?: string
  }
  createdAt: string
  approvedAt?: string
  publishedAt?: string
  claudeUsage: {
    promptTokens: number
    outputTokens: number
    cacheHit: boolean
  }
}

interface ImportedTrail {
  osmWayId: string
  name: string
  difficulty: 'easy' | 'intermediate' | 'hard' | 'pro' | 'not_set'
  type: 'mtb' | 'hiking' | 'mixed'
  score: number
  reasoning: string
  polyline: [number, number][]
  distanceKm: number
}

interface ImportsTabContentProps {
  user: SessionUser | null
  mapBounds: MapBounds | null
  onApprovedImport?: () => Promise<void>
  onDraftTrailsChange?: (trails: ImportedTrail[], selectedIds: Set<string>) => void
  onHoverImportTrail?: (osmWayId: string | null) => void
  onStartDrawBbox?: () => void
  drawBboxCorners?: [number, number][]
  onClearDrawBbox?: () => void
}

export interface ImportsTabContentHandle {
  toggleTrailSelection: (osmWayId: string) => void
}

function getActivityLabel(type: ImportedTrail['type']): string {
  if (type === 'mtb') return 'Bike-focused'
  if (type === 'hiking') return 'Hike-focused'
  return 'Multi-use'
}

export const ImportsTabContent = forwardRef<ImportsTabContentHandle, ImportsTabContentProps>(
  function ImportsTabContent({ user, mapBounds, onApprovedImport, onDraftTrailsChange, onHoverImportTrail, onStartDrawBbox, drawBboxCorners, onClearDrawBbox }, ref) {
  const [drafts, setDrafts] = useState<ImportDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null)
  const [selectedTrailIds, setSelectedTrailIds] = useState<Set<string>>(new Set())
  const [approving, setApproving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingTrailId, setEditingTrailId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ name: string; difficulty: ImportedTrail['difficulty'] } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [dismissedByDraft, setDismissedByDraft] = useState<Record<string, Set<string>>>({})
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{
    step: number
    message: string
    detail?: string
  } | null>(null)
  const [showImportForm, setShowImportForm] = useState(false)
  const [regionName, setRegionName] = useState('')
  const [instructions, setInstructions] = useState('')

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }

    fetchDrafts()
  }, [user])

  // Auto-refresh when processing drafts exist
  useEffect(() => {
    const hasProcessing = drafts.some((d) => d.status === 'processing')
    if (!hasProcessing) return

    const interval = setInterval(() => {
      fetchDrafts()
    }, 2000) // Poll every 2 seconds

    return () => clearInterval(interval)
  }, [drafts])

  useEffect(() => {
    console.log('[Import] mapBounds updated:', mapBounds)
  }, [mapBounds])

  useEffect(() => {
    console.log('[Import] showImportForm changed:', showImportForm)
  }, [showImportForm])

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    toggleTrailSelection
  }))

  // Notify parent when draft trails change
  useEffect(() => {
    const expandedDraft = drafts.find((d) => d.id === expandedDraftId)
    if (expandedDraft && onDraftTrailsChange) {
      const dismissed = dismissedByDraft[expandedDraft.id] ?? new Set<string>()
      const visibleTrails = expandedDraft.trails.filter((trail) => !dismissed.has(trail.osmWayId))
      const visibleSelectedIds = new Set(
        [...selectedTrailIds].filter((id) => !dismissed.has(id))
      )
      onDraftTrailsChange(visibleTrails, visibleSelectedIds)
    } else if (!expandedDraft && onDraftTrailsChange) {
      onDraftTrailsChange([], new Set())
    }
  }, [expandedDraftId, selectedTrailIds, drafts, dismissedByDraft, onDraftTrailsChange])

  async function fetchDrafts() {
    try {
      console.log('[Drafts] Fetching drafts...')
      setLoading(true)
      setError(null)

      const response = await fetch('/api/trails/import-drafts?status=pending')
      console.log('[Drafts] Response status:', response.status)

      if (!response.ok) {
        throw new Error('Failed to fetch import drafts')
      }

      const data = await response.json()
      console.log('[Drafts] Received data:', data)

      setDrafts(data.drafts || [])
      console.log('[Drafts] Set', data.drafts?.length || 0, 'drafts')
    } catch (err: any) {
      console.error('[Drafts] Error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleApproveDraft(draftId: string) {
    if (selectedTrailIds.size === 0) {
      alert('Please select at least one trail to approve')
      return
    }

    try {
      setApproving(true)
      setError(null)

      const response = await fetch(`/api/trails/import-drafts/${draftId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedTrailIds: Array.from(selectedTrailIds),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorList = Array.isArray(errorData.errors) && errorData.errors.length
          ? `\n\n${errorData.errors.join('\n')}`
          : ''
        throw new Error(`${errorData.error || `Approve failed (${response.status})`}${errorList}`)
      }

      const result = await response.json()

      // Refresh drafts list
      await fetchDrafts()

      // Ensure map layers are rebuilt from latest server trails/networks.
      await onApprovedImport?.()

      // Clear selection
      setSelectedTrailIds(new Set())
      setExpandedDraftId(null)

      const partialNote = Array.isArray(result.errors) && result.errors.length
        ? `\n\nWarnings:\n${result.errors.join('\n')}`
        : ''
      alert(`Imported ${result.createdCount} trails.${partialNote}`)
    } catch (err: any) {
      setError(err.message)
      alert(`Approve failed:\n\n${err.message}`)
    } finally {
      setApproving(false)
    }
  }

  async function handleDeleteDraft(draftId: string) {
    if (!confirm('Delete this import draft? This cannot be undone.')) {
      return
    }

    try {
      setDeleting(draftId)
      setError(null)

      const response = await fetch(`/api/trails/import-drafts/${draftId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete draft')
      }

      // Refresh drafts list
      await fetchDrafts()

      // Clear selection if this draft was expanded
      if (expandedDraftId === draftId) {
        setExpandedDraftId(null)
        setSelectedTrailIds(new Set())
      }
    } catch (err: any) {
      setError(err.message)
      alert(`Delete failed: ${err.message}`)
    } finally {
      setDeleting(null)
    }
  }

  function toggleTrailSelection(osmWayId: string) {
    const newSet = new Set(selectedTrailIds)
    if (newSet.has(osmWayId)) {
      newSet.delete(osmWayId)
    } else {
      newSet.add(osmWayId)
    }
    setSelectedTrailIds(newSet)
  }

  function dismissTrail(draftId: string, osmWayId: string) {
    setDismissedByDraft((prev) => {
      const next: Record<string, Set<string>> = { ...prev }
      const existing = next[draftId] ?? new Set<string>()
      const updated = new Set(existing)
      updated.add(osmWayId)
      next[draftId] = updated
      return next
    })
    setSelectedTrailIds((prev) => {
      if (!prev.has(osmWayId)) return prev
      const next = new Set(prev)
      next.delete(osmWayId)
      return next
    })
  }

  function restoreDismissedTrails(draftId: string) {
    setDismissedByDraft((prev) => {
      if (!prev[draftId] || prev[draftId].size === 0) return prev
      const next: Record<string, Set<string>> = { ...prev }
      delete next[draftId]
      return next
    })
  }

  function selectAllTrails(draft: ImportDraft) {
    const dismissed = dismissedByDraft[draft.id] ?? new Set<string>()
    const allIds = draft.trails
      .filter((t) => !dismissed.has(t.osmWayId))
      .map((t) => t.osmWayId)
    setSelectedTrailIds(new Set(allIds))
  }

  function deselectAllTrails() {
    setSelectedTrailIds(new Set())
  }

  function startEditTrail(trail: ImportedTrail) {
    setEditingTrailId(trail.osmWayId)
    setEditForm({ name: trail.name, difficulty: trail.difficulty })
  }

  function cancelEditTrail() {
    setEditingTrailId(null)
    setEditForm(null)
  }

  async function saveEditTrail(draftId: string) {
    if (!editingTrailId || !editForm) return
    setSavingEdit(true)
    try {
      const response = await fetch(`/api/trails/import-drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          osmWayId: editingTrailId,
          updates: {
            name: editForm.name.trim(),
            difficulty: editForm.difficulty,
          },
        }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Save failed (${response.status})`)
      }
      // Optimistically apply locally so we don't need to refetch the whole draft
      setDrafts((prev) =>
        prev.map((d) =>
          d.id !== draftId
            ? d
            : {
                ...d,
                trails: d.trails.map((t) =>
                  t.osmWayId !== editingTrailId
                    ? t
                    : { ...t, name: editForm.name.trim(), difficulty: editForm.difficulty }
                ),
              }
        )
      )
      cancelEditTrail()
    } catch (err: any) {
      alert(`Edit failed: ${err.message}`)
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleImportFromMapView() {
    console.log('[Import] Button clicked!', { mapBounds, importing })

    if (!mapBounds) {
      console.log('[Import] No map bounds available')
      alert('Unable to get map bounds. Try zooming to the area you want to import.')
      return
    }

    console.log('[Import] Showing form...')
    setShowImportForm(true)
  }

  async function submitImport() {
    // Compute bbox from drawn corners or current map bounds
    let bbox: number[]

    if (drawBboxCorners && drawBboxCorners.length === 2) {
      // Use drawn bbox
      const [corner1, corner2] = drawBboxCorners
      const south = Math.min(corner1[0], corner2[0])
      const north = Math.max(corner1[0], corner2[0])
      const west = Math.min(corner1[1], corner2[1])
      const east = Math.max(corner1[1], corner2[1])
      bbox = [south, west, north, east]
    } else if (mapBounds) {
      // Use current map bounds
      bbox = [mapBounds.south, mapBounds.west, mapBounds.north, mapBounds.east]
    } else {
      console.log('[Import] Missing requirements:', { mapBounds, drawBboxCorners })
      alert('Please draw an area on the map or zoom to the area you want to import')
      return
    }

    if (!regionName.trim()) {
      console.log('[Import] Missing region name')
      return
    }

    console.log('[Import] Starting import...', { bbox, regionName })

    try {
      setImporting(true)
      setError(null)
      setShowImportForm(false)

      // Step 1: Fetching from OpenStreetMap
      setImportProgress({
        step: 1,
        message: 'Fetching trails from OpenStreetMap',
        detail: 'Querying Overpass API...',
      })

      console.log('[Import] Calling API with bbox:', bbox)

      // Simulate progress updates based on expected timing
      const progressTimer1 = setTimeout(() => {
        setImportProgress({
          step: 2,
          message: 'Filtering and deduplicating',
          detail: 'Checking for duplicate trails...',
        })
      }, 3000)

      const progressTimer2 = setTimeout(() => {
        setImportProgress({
          step: 3,
          message: 'Analyzing with Claude AI',
          detail: 'Ranking trails by quality and relevance...',
        })
      }, 6000)

      const response = await fetch('/api/trails/import-osm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox, regionName: regionName.trim(), instructions: instructions.trim() }),
      })

      clearTimeout(progressTimer1)
      clearTimeout(progressTimer2)

      console.log('[Import] API response status:', response.status)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('[Import] API error:', errorData)
        const claudePrefix = errorData.source === 'claude' ? 'Claude: ' : ''
        const msg =
          errorData.claudeMessage ||
          errorData.details ||
          errorData.error ||
          `Request failed (${response.status})`
        throw new Error(`${claudePrefix}${msg}`)
      }

      setImportProgress({
        step: 4,
        message: 'Finalizing import',
        detail: 'Creating draft for review...',
      })

      const result = await response.json()
      console.log('[Import] API success:', result)

      // Refresh drafts
      console.log('[Import] Refreshing drafts...')
      await fetchDrafts()
      console.log('[Import] Import complete!')

      // Reset form
      setRegionName('')
      setInstructions('')
      if (onClearDrawBbox) {
        onClearDrawBbox()
      }

      // Show success message briefly before clearing
      setImportProgress({
        step: 5,
        message: 'Import complete!',
        detail: `Draft created. Processing started.`,
      })

      setTimeout(() => {
        setImportProgress(null)
        setImporting(false)
      }, 2000)
    } catch (err: any) {
      console.error('[Import] Error:', err)
      setError(err.message)
      setImportProgress(null)
      setImporting(false) // Clear immediately on error
      alert(`Import failed: ${err.message}`)
    }
  }

  if (!user) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <p>Sign in to view import drafts</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <p>Loading drafts...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">Error loading drafts</p>
          <p className="mt-1">{error}</p>
        </div>
        <Button onClick={fetchDrafts} className="mt-3 w-full" variant="outline">
          Retry
        </Button>
      </div>
    )
  }

  if (drafts.length === 0) {
    return (
      <div className="p-4">
        {!showImportForm ? (
          <>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (onStartDrawBbox) {
                    onStartDrawBbox()
                  }
                }}
                disabled={importing}
                className="flex-1"
                variant="outline"
              >
                Draw Area
              </Button>
              <Button
                onClick={handleImportFromMapView}
                disabled={importing || !mapBounds}
                className="flex-1"
              >
                Current View
              </Button>
            </div>

            {drawBboxCorners && drawBboxCorners.length === 2 && (
              <div className="mt-3 rounded-md bg-muted p-2 text-xs">
                <div className="font-medium mb-1">Drawn Area</div>
                <div className="text-muted-foreground">
                  {Math.abs(drawBboxCorners[1][0] - drawBboxCorners[0][0]).toFixed(4)}° × {Math.abs(drawBboxCorners[1][1] - drawBboxCorners[0][1]).toFixed(4)}°
                </div>
                <Button
                  onClick={() => {
                    setShowImportForm(true)
                  }}
                  className="w-full mt-2"
                  size="sm"
                >
                  Import This Area
                </Button>
              </div>
            )}

            {!mapBounds && !drawBboxCorners && (
              <p className="mt-2 text-xs text-muted-foreground text-center">
                Draw an area or zoom the map to import trails
              </p>
            )}

            <div className="mt-6 text-center text-muted-foreground">
              <p className="text-sm">No pending imports</p>
              <p className="mt-2 text-xs">Use the button above to import trails from OpenStreetMap</p>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Import Trails from OSM</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Claude AI will analyze trails in the current map view
              </p>
            </div>

            <div>
              <label htmlFor="region-name" className="block text-sm font-medium">
                Region Name
              </label>
              <input
                id="region-name"
                type="text"
                value={regionName}
                onChange={(e) => setRegionName(e.target.value)}
                placeholder="e.g., Moab, Utah"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && regionName.trim()) {
                    submitImport()
                  }
                }}
                autoFocus
              />
            </div>

            {mapBounds && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <div className="font-medium mb-1">Map Area</div>
                <div className="text-muted-foreground space-y-0.5">
                  <div>N: {mapBounds.north.toFixed(4)}, S: {mapBounds.south.toFixed(4)}</div>
                  <div>E: {mapBounds.east.toFixed(4)}, W: {mapBounds.west.toFixed(4)}</div>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="instructions" className="block text-sm font-medium">
                Additional Instructions (optional)
              </label>
              <textarea
                id="instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g., Prefer shuttle/downhill trails, exclude hiking-only paths, prioritize loop trails..."
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={3}
              />
            </div>

            {mapBounds && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <div className="font-medium mb-1">Map Area</div>
                <div className="text-muted-foreground space-y-0.5">
                  <div>N: {mapBounds.north.toFixed(4)}, S: {mapBounds.south.toFixed(4)}</div>
                  <div>E: {mapBounds.east.toFixed(4)}, W: {mapBounds.west.toFixed(4)}</div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setShowImportForm(false)
                  setRegionName('')
                  setInstructions('')
                }}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={submitImport}
                disabled={!regionName.trim() || importing}
                className="flex-1"
              >
                {importing ? 'Importing...' : 'Import'}
              </Button>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {importing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-lg bg-card p-6 shadow-lg max-w-md w-full mx-4">
              <div className="space-y-4">
                {/* Progress steps */}
                <div className="space-y-3">
                  {[
                    { num: 1, label: 'Fetching from OpenStreetMap' },
                    { num: 2, label: 'Filtering and deduplicating' },
                    { num: 3, label: 'Analyzing with Claude AI' },
                    { num: 4, label: 'Finalizing import' },
                  ].map((step) => (
                    <div key={step.num} className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                          importProgress && importProgress.step === step.num
                            ? 'bg-primary text-primary-foreground'
                            : importProgress && importProgress.step > step.num
                            ? 'bg-primary/20 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {importProgress && importProgress.step > step.num ? (
                          <span>✓</span>
                        ) : importProgress && importProgress.step === step.num ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"></div>
                        ) : (
                          step.num
                        )}
                      </div>
                      <div className="flex-1">
                        <div
                          className={`text-sm font-medium ${
                            importProgress && importProgress.step >= step.num
                              ? 'text-foreground'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {step.label}
                        </div>
                        {importProgress &&
                          importProgress.step === step.num &&
                          importProgress.detail && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {importProgress.detail}
                            </div>
                          )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Overall message */}
                {importProgress && importProgress.step === 5 && (
                  <div className="rounded-md bg-primary/10 p-3 text-center">
                    <div className="font-semibold text-primary">
                      {importProgress.message}
                    </div>
                    {importProgress.detail && (
                      <div className="mt-1 text-sm text-muted-foreground">
                        {importProgress.detail}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const expandedDraft = expandedDraftId ? drafts.find((d) => d.id === expandedDraftId) : null

  return (
    <div className={`flex flex-col gap-3 p-4 ${expandedDraft ? 'h-full' : ''}`}>
      {!expandedDraft && (
      <div className="flex gap-2">
        <Button
          onClick={() => {
            if (onStartDrawBbox) {
              onStartDrawBbox()
            }
          }}
          disabled={importing}
          className="flex-1"
          variant="outline"
        >
          Draw Area
        </Button>
        <Button
          onClick={handleImportFromMapView}
          disabled={importing || !mapBounds}
          className="flex-1"
          variant="outline"
        >
          Current View
        </Button>
      </div>
      )}

      {!expandedDraft && drawBboxCorners && drawBboxCorners.length === 2 && (
        <div className="rounded-md bg-muted p-2 text-xs">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium mb-1">Drawn Area</div>
              <div className="text-muted-foreground">
                {Math.abs(drawBboxCorners[1][0] - drawBboxCorners[0][0]).toFixed(4)}° × {Math.abs(drawBboxCorners[1][1] - drawBboxCorners[0][1]).toFixed(4)}°
              </div>
            </div>
            {onClearDrawBbox && (
              <Button
                onClick={onClearDrawBbox}
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
              >
                Clear
              </Button>
            )}
          </div>
          <Button
            onClick={() => setShowImportForm(true)}
            className="w-full mt-2"
            size="sm"
          >
            Import This Area
          </Button>
        </div>
      )}

      {!expandedDraft && (
        <div className="text-sm text-muted-foreground">
          {drafts.length} pending {drafts.length === 1 ? 'import' : 'imports'}
        </div>
      )}

      {(expandedDraft ? [expandedDraft] : drafts).map((draft) => (
        <div
          key={draft.id}
          className={`rounded-lg border border-border bg-card p-3 text-sm ${expandedDraftId === draft.id ? 'flex-1 min-h-0 flex flex-col' : ''}`}
        >
          {/* Draft header */}
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => setExpandedDraftId(expandedDraftId === draft.id ? null : draft.id)}
              className="flex-1 text-left"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">
                    {draft.status === 'processing' && '⏳ Importing...'}
                    {draft.status === 'failed' && '❌ Import failed'}
                    {draft.status !== 'processing' && draft.status !== 'failed' && `${draft.stats.recommended} trails found`}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(draft.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {expandedDraftId === draft.id ? '▼' : '▶'}
                </div>
              </div>

              {/* Stats summary */}
              {draft.status !== 'processing' && draft.status !== 'failed' && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium">{draft.stats.newTrails}</span> new
                  </div>
                  <div>
                    <span className="font-medium">{draft.stats.duplicates}</span> duplicates
                  </div>
                </div>
              )}
            </button>

            <Button
              onClick={() => handleDeleteDraft(draft.id)}
              disabled={deleting === draft.id}
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            >
              {deleting === draft.id ? '...' : '×'}
            </Button>
          </div>

          {/* Expanded view */}
          {expandedDraftId === draft.id && (
            <div className="mt-4 border-t border-border pt-4 flex-1 min-h-0 flex flex-col">
              {/* Processing state */}
              {draft.status === 'processing' && (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mb-3"></div>
                  <p className="text-sm font-medium">Analyzing trails with Claude AI...</p>
                  <p className="mt-1 text-xs text-muted-foreground">This may take a minute</p>
                </div>
              )}

              {/* Failed state */}
              {draft.status === 'failed' && (
                <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
                  <div className="font-medium">Import Failed</div>
                  <div className="mt-2">{draft.stats.error || 'An unknown error occurred'}</div>
                </div>
              )}

              {/* Normal view - only show if not processing or failed */}
              {draft.status !== 'processing' && draft.status !== 'failed' && (
                <>
              {/* Selection controls */}
              <div className="mb-3 flex gap-2">
                <Button
                  onClick={() => selectAllTrails(draft)}
                  size="sm"
                  variant="outline"
                  className="flex-1"
                >
                  Select All
                </Button>
                <Button
                  onClick={deselectAllTrails}
                  size="sm"
                  variant="outline"
                  className="flex-1"
                >
                  Clear
                </Button>
              </div>

              {(dismissedByDraft[draft.id]?.size ?? 0) > 0 && (
                <div className="mb-3 rounded border border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {dismissedByDraft[draft.id]!.size} dismissed {dismissedByDraft[draft.id]!.size === 1 ? 'trail' : 'trails'}
                    </span>
                    <Button
                      onClick={() => restoreDismissedTrails(draft.id)}
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                    >
                      Restore
                    </Button>
                  </div>
                </div>
              )}

              {/* Trail list */}
              <div className="flex-1 min-h-0 space-y-2 overflow-y-auto">
                {[...draft.trails]
                  .filter((trail) => !(dismissedByDraft[draft.id] ?? new Set<string>()).has(trail.osmWayId))
                  .sort((a, b) => {
                    // Selected trails first
                    const aSelected = selectedTrailIds.has(a.osmWayId)
                    const bSelected = selectedTrailIds.has(b.osmWayId)
                    if (aSelected && !bSelected) return -1
                    if (!aSelected && bSelected) return 1
                    // Then by score descending
                    return (b.score || 0) - (a.score || 0)
                  })
                  .map((trail) => {
                    const isEditing = editingTrailId === trail.osmWayId
                    if (isEditing && editForm) {
                      return (
                        <div
                          key={trail.osmWayId}
                          className="rounded border border-border bg-muted/30 p-2"
                          onMouseEnter={() => onHoverImportTrail?.(trail.osmWayId)}
                          onMouseLeave={() => onHoverImportTrail?.(null)}
                        >
                          <div className="space-y-2">
                            <div>
                              <label className="block text-xs font-medium text-muted-foreground" htmlFor={`edit-name-${trail.osmWayId}`}>
                                Name
                              </label>
                              <input
                                id={`edit-name-${trail.osmWayId}`}
                                type="text"
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1 text-sm"
                                autoFocus
                              />
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="block text-xs font-medium text-muted-foreground" htmlFor={`edit-diff-${trail.osmWayId}`}>
                                  Difficulty
                                </label>
                                <select
                                  id={`edit-diff-${trail.osmWayId}`}
                                  value={editForm.difficulty}
                                  onChange={(e) => setEditForm({ ...editForm, difficulty: e.target.value as ImportedTrail['difficulty'] })}
                                  className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1 text-sm"
                                >
                                  <option value="not_set">not set</option>
                                  <option value="easy">easy</option>
                                  <option value="intermediate">intermediate</option>
                                  <option value="hard">hard</option>
                                  <option value="pro">pro</option>
                                </select>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                onClick={cancelEditTrail}
                                size="sm"
                                variant="outline"
                                className="flex-1"
                                disabled={savingEdit}
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={() => saveEditTrail(draft.id)}
                                size="sm"
                                className="flex-1"
                                disabled={savingEdit || !editForm.name.trim()}
                              >
                                {savingEdit ? 'Saving…' : 'Save'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div
                        key={trail.osmWayId}
                        className="flex items-start gap-2 rounded p-2 hover:bg-muted/50"
                        onMouseEnter={() => onHoverImportTrail?.(trail.osmWayId)}
                        onMouseLeave={() => onHoverImportTrail?.(null)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTrailIds.has(trail.osmWayId)}
                          onChange={() => toggleTrailSelection(trail.osmWayId)}
                          className="mt-1 cursor-pointer"
                        />
                        <button
                          type="button"
                          onClick={() => toggleTrailSelection(trail.osmWayId)}
                          className="flex-1 cursor-pointer text-left"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium">{trail.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {trail.score}/100
                            </span>
                          </div>
                          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                            <span className="capitalize">{trail.difficulty.replace('_', ' ')}</span>
                            <span>{getActivityLabel(trail.type)}</span>
                            {trail.distanceKm != null && (
                              <span>{trail.distanceKm.toFixed(1)} km</span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">AI analysis:</span>{' '}
                            {trail.reasoning?.trim() || 'No analysis provided.'}
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Activity profile: {trail.type === 'mixed' ? 'Both biking and hiking tags present' : trail.type === 'mtb' ? 'Tagged primarily for biking' : 'Tagged primarily for hiking'}
                          </div>
                        </button>
                        <div className="mt-0.5 flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              dismissTrail(draft.id, trail.osmWayId)
                            }}
                            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Dismiss trail from suggestions"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              startEditTrail(trail)
                            }}
                            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Edit trail"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    )
                  })}
              </div>

              {/* Approve button */}
              <Button
                onClick={() => handleApproveDraft(draft.id)}
                disabled={selectedTrailIds.size === 0 || approving}
                className="mt-4 w-full"
              >
                {approving ? (
                  'Importing...'
                ) : (
                  `Import ${selectedTrailIds.size} ${selectedTrailIds.size === 1 ? 'trail' : 'trails'}`
                )}
              </Button>

              {/* Claude usage info */}
              <div className="mt-3 rounded bg-muted/50 p-2 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>AI tokens:</span>
                  <span>
                    {draft.claudeUsage.promptTokens + draft.claudeUsage.outputTokens} total
                    {draft.claudeUsage.cacheHit && ' (cached)'}
                  </span>
                </div>
              </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Import Form */}
      {showImportForm && (
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div>
            <h3 className="text-base font-semibold">Import from OSM</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Claude AI will analyze trails in the current map view
            </p>
          </div>

          <div>
            <label htmlFor="region-name-2" className="block text-sm font-medium">
              Region Name
            </label>
            <input
              id="region-name-2"
              type="text"
              value={regionName}
              onChange={(e) => setRegionName(e.target.value)}
              placeholder="e.g., Moab, Utah"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && regionName.trim()) {
                  submitImport()
                }
              }}
              autoFocus
            />
          </div>

          {mapBounds && (
            <div className="rounded-md bg-muted p-2 text-xs">
              <div className="font-medium mb-1">Map Area</div>
              <div className="text-muted-foreground space-y-0.5">
                <div>N: {mapBounds.north.toFixed(4)}, S: {mapBounds.south.toFixed(4)}</div>
                <div>E: {mapBounds.east.toFixed(4)}, W: {mapBounds.west.toFixed(4)}</div>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="instructions-2" className="block text-sm font-medium">
              Additional Instructions (optional)
            </label>
            <textarea
              id="instructions-2"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g., Prefer shuttle/downhill trails, exclude hiking-only paths, prioritize loop trails..."
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => {
                setShowImportForm(false)
                setRegionName('')
                setInstructions('')
              }}
              variant="outline"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={submitImport}
              disabled={!regionName.trim() || importing}
              className="flex-1"
            >
              {importing ? 'Importing...' : 'Import'}
            </Button>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {importing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-card p-6 shadow-lg max-w-md w-full mx-4">
            <div className="space-y-4">
              {/* Progress steps */}
              <div className="space-y-3">
                {[
                  { num: 1, label: 'Fetching from OpenStreetMap' },
                  { num: 2, label: 'Filtering and deduplicating' },
                  { num: 3, label: 'Analyzing with Claude AI' },
                  { num: 4, label: 'Finalizing import' },
                ].map((step) => (
                  <div key={step.num} className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                        importProgress && importProgress.step === step.num
                          ? 'bg-primary text-primary-foreground'
                          : importProgress && importProgress.step > step.num
                          ? 'bg-primary/20 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {importProgress && importProgress.step > step.num ? (
                        <span>✓</span>
                      ) : importProgress && importProgress.step === step.num ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"></div>
                      ) : (
                        step.num
                      )}
                    </div>
                    <div className="flex-1">
                      <div
                        className={`text-sm font-medium ${
                          importProgress && importProgress.step >= step.num
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {step.label}
                      </div>
                      {importProgress &&
                        importProgress.step === step.num &&
                        importProgress.detail && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {importProgress.detail}
                          </div>
                        )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Overall message */}
              {importProgress && importProgress.step === 5 && (
                <div className="rounded-md bg-primary/10 p-3 text-center">
                  <div className="font-semibold text-primary">
                    {importProgress.message}
                  </div>
                  {importProgress.detail && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {importProgress.detail}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
