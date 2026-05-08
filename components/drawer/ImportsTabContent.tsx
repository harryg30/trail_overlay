'use client'

import { useState, useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import type { SessionUser } from '@/lib/auth'

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
  suggestionSetName?: string
  aiAnalyzed: boolean
  aiAnalyzedAt?: string
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
  function ImportsTabContent({ user, onApprovedImport, onDraftTrailsChange, onHoverImportTrail, onStartDrawBbox, drawBboxCorners, onClearDrawBbox }, ref) {
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
  const [suggestionSetName, setSuggestionSetName] = useState('')
  const [analyzingDraftId, setAnalyzingDraftId] = useState<string | null>(null)
  const [expandGenerateForm, setExpandGenerateForm] = useState(true)
  const [analyzeFormDraftId, setAnalyzeFormDraftId] = useState<string | null>(null)
  const [analyzeInstructions, setAnalyzeInstructions] = useState('')
  const previousExpandedDraftIdRef = useRef<string | null>(null)

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
      fetchDrafts(true) // Pass true to skip loading toggle
    }, 2000) // Poll every 2 seconds

    return () => clearInterval(interval)
  }, [drafts])

  useEffect(() => {
    // Reset selection only when switching directly between two expanded drafts.
    // Skip collapse/expand transitions so re-expanding can keep any still-valid
    // selections via the prune effect below. Intentionally not depending on
    // `drafts` — optimistic in-place edits (e.g. saveEditTrail) update `drafts`
    // and would otherwise wipe the current selection mid-review.
    const previousExpandedDraftId = previousExpandedDraftIdRef.current
    if (
      previousExpandedDraftId !== null &&
      expandedDraftId !== null &&
      previousExpandedDraftId !== expandedDraftId
    ) {
      setSelectedTrailIds(new Set())
    }
    previousExpandedDraftIdRef.current = expandedDraftId
  }, [expandedDraftId])

  useEffect(() => {
    // When the expanded draft's trails change (e.g. analyzeWithClaude refetch),
    // drop any selected ids that no longer exist so the "Import N trails"
    // count stays accurate and the approve API never receives stale ids.
    if (!expandedDraftId) return
    const expandedDraft = drafts.find((d) => d.id === expandedDraftId)
    if (!expandedDraft) return
    const validIds = new Set(expandedDraft.trails.map((t) => t.osmWayId))
    setSelectedTrailIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (validIds.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [drafts, expandedDraftId])

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

  async function fetchDrafts(skipLoading = false) {
    if (!skipLoading) {
      setLoading(true)
    }
    setError(null)

    try {
      const response = await fetch('/api/trails/import-drafts?status=all')

      if (!response.ok) {
        throw new Error('Failed to fetch import drafts')
      }

      const data = await response.json()
      setDrafts(data.drafts || [])
    } catch (err: any) {
      console.error('[Drafts] Error:', err)
      setError(err.message)
    } finally {
      if (!skipLoading) {
        setLoading(false)
      }
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

  async function analyzeWithClaude(draftId: string) {
    try {
      setAnalyzingDraftId(draftId)
      const response = await fetch(`/api/trails/import-drafts/${draftId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: analyzeInstructions.trim(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Analysis failed (${response.status})`)
      }

      // Refresh drafts to show updated trails
      await fetchDrafts()
      setAnalyzeFormDraftId(null)
      setAnalyzeInstructions('')
    } catch (err: any) {
      alert(`Analysis failed: ${err.message}`)
    } finally {
      setAnalyzingDraftId(null)
    }
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

  async function submitImport() {
    if (!drawBboxCorners || drawBboxCorners.length !== 2) {
      alert('Please draw an area on the map before generating suggestions')
      return
    }

    const [corner1, corner2] = drawBboxCorners
    const south = Math.min(corner1[0], corner2[0])
    const north = Math.max(corner1[0], corner2[0])
    const west = Math.min(corner1[1], corner2[1])
    const east = Math.max(corner1[1], corner2[1])
    const bbox = [south, west, north, east]

    if (!suggestionSetName.trim()) {
      return
    }

    try {
      setImporting(true)
      setError(null)

      // Step 1: Fetching from OpenStreetMap
      setImportProgress({
        step: 1,
        message: 'Fetching trails from OpenStreetMap',
        detail: 'Querying Overpass API...',
      })

      // Simulate progress updates based on expected timing
      const progressTimer1 = setTimeout(() => {
        setImportProgress({
          step: 2,
          message: 'Filtering and deduplicating',
          detail: 'Checking for duplicate trails...',
        })
      }, 3000)

      const response = await fetch('/api/trails/import-osm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox, suggestionSetName: suggestionSetName.trim() }),
      })

      clearTimeout(progressTimer1)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const claudePrefix = errorData.source === 'claude' ? 'Claude: ' : ''
        const msg =
          errorData.claudeMessage ||
          errorData.details ||
          errorData.error ||
          `Request failed (${response.status})`
        throw new Error(`${claudePrefix}${msg}`)
      }

      setImportProgress({
        step: 3,
        message: 'Finalizing import',
        detail: 'Creating draft for review...',
      })

      await response.json()

      // Refresh drafts
      await fetchDrafts()

      // Reset form
      setSuggestionSetName('')
      if (onClearDrawBbox) {
        onClearDrawBbox()
      }

      // Show success message briefly before clearing
      setImportProgress({
        step: 4,
        message: 'Import complete!',
        detail: `Draft created. Ready for analysis.`,
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

  const loadingModal = importing && (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50" style={{ zIndex: 99999 }}>
      <div className="rounded-lg bg-card p-6 shadow-lg max-w-md w-full mx-4">
        <div className="space-y-4">
          {/* Progress steps */}
          <div className="space-y-3">
            {[
              { num: 1, label: 'Fetching from OpenStreetMap' },
              { num: 2, label: 'Filtering and deduplicating' },
              { num: 3, label: 'Finalizing import' },
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
  )

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
        <Button onClick={() => { void fetchDrafts() }} className="mt-3 w-full" variant="outline">
          Retry
        </Button>
      </div>
    )
  }

  if (drafts.length === 0) {
    return (
      <>
        <div className="p-4 space-y-4 flex flex-col">
          {/* Generate Suggestions Form - Always Visible */}
          <div className="space-y-4 rounded-lg border border-border bg-card">
          {/* Collapsible Header */}
          <button
            onClick={() => setExpandGenerateForm(!expandGenerateForm)}
            className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1 text-left">
              <div className="text-base font-semibold">Generate Suggestions from OSM</div>
              <div className="text-xs text-muted-foreground">
                {expandGenerateForm ? '▼' : '▶'}
              </div>
            </div>
          </button>

          {/* Collapsible Content */}
          {expandGenerateForm && (
            <div className="space-y-4 px-4 pb-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Create a new suggestion set from OpenStreetMap data in your current map view
              </p>

              <div>
                <label htmlFor="osm-name" className="block text-sm font-medium">
                  Suggestion Set Name
                </label>
                <input
                  id="osm-name"
                  type="text"
                  value={suggestionSetName}
                  onChange={(e) => setSuggestionSetName(e.target.value)}
                  placeholder="e.g., Moab, Utah"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && suggestionSetName.trim() && drawBboxCorners?.length === 2) {
                      submitImport()
                    }
                  }}
                  autoFocus
                />
              </div>

              {!drawBboxCorners || drawBboxCorners.length !== 2 ? (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Draw an area on the map to generate suggestions
                  </p>
                  <Button
                    onClick={() => {
                      if (onStartDrawBbox) {
                        onStartDrawBbox()
                      }
                    }}
                    size="sm"
                    className="w-full"
                  >
                    Draw Area
                  </Button>
                </div>
              ) : (
                <div className="rounded-md bg-muted p-3 text-xs">
                  <div className="font-medium mb-1">Map Area Ready</div>
                  <div className="text-muted-foreground">
                    {Math.abs(drawBboxCorners[1][0] - drawBboxCorners[0][0]).toFixed(4)}° × {Math.abs(drawBboxCorners[1][1] - drawBboxCorners[0][1]).toFixed(4)}°
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setSuggestionSetName('')
                  }}
                  variant="outline"
                  className="flex-1"
                >
                  Clear
                </Button>
                <Button
                  onClick={submitImport}
                  disabled={!suggestionSetName.trim() || importing || !drawBboxCorners || drawBboxCorners.length !== 2}
                  className="flex-1"
                >
                  {importing ? 'Importing...' : 'Import'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="text-center text-muted-foreground">
          <p className="text-sm">No pending imports</p>
        </div>
      </div>

      {/* Loading Modal via Portal */}
      {typeof document !== 'undefined' && loadingModal && createPortal(loadingModal, document.body)}
    </>
  )
  }

  const expandedDraft = expandedDraftId ? drafts.find((d) => d.id === expandedDraftId) : null

  return (
    <div className={`flex flex-col gap-2 p-4 ${expandedDraft ? 'h-full' : ''}`}>
      {!expandedDraft && (
        <div className="space-y-4 rounded-lg border border-border bg-card">
          {/* Collapsible Header */}
          <button
            onClick={() => setExpandGenerateForm(!expandGenerateForm)}
            className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1 text-left">
              <div className="text-base font-semibold">Generate Suggestions from OSM</div>
              <div className="text-xs text-muted-foreground">
                {expandGenerateForm ? '▼' : '▶'}
              </div>
            </div>
          </button>

          {/* Collapsible Content */}
          {expandGenerateForm && (
            <div className="space-y-4 px-4 pb-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Create a new suggestion set from OpenStreetMap data in your current map view
              </p>

              <div>
                <label htmlFor="drafts-name" className="block text-sm font-medium">
                  Suggestion Set Name
                </label>
                <input
                  id="drafts-name"
                  type="text"
                  value={suggestionSetName}
                  onChange={(e) => setSuggestionSetName(e.target.value)}
                  placeholder="e.g., Moab, Utah"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && suggestionSetName.trim() && drawBboxCorners?.length === 2) {
                      submitImport()
                    }
                  }}
                />
              </div>

              {!drawBboxCorners || drawBboxCorners.length !== 2 ? (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Draw an area on the map to generate suggestions
                  </p>
                  <Button
                    onClick={() => {
                      if (onStartDrawBbox) {
                        onStartDrawBbox()
                      }
                    }}
                    size="sm"
                    className="w-full"
                  >
                    Draw Area
                  </Button>
                </div>
              ) : (
                <div className="rounded-md bg-muted p-3 text-xs">
                  <div className="font-medium mb-1">Map Area Ready</div>
                  <div className="text-muted-foreground">
                    {Math.abs(drawBboxCorners[1][0] - drawBboxCorners[0][0]).toFixed(4)}° × {Math.abs(drawBboxCorners[1][1] - drawBboxCorners[0][1]).toFixed(4)}°
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setSuggestionSetName('')
                  }}
                  variant="outline"
                  className="flex-1"
                >
                  Clear
                </Button>
                <Button
                  onClick={submitImport}
                  disabled={!suggestionSetName.trim() || importing || !drawBboxCorners || drawBboxCorners.length !== 2}
                  className="flex-1"
                >
                  {importing ? 'Importing...' : 'Import'}
                </Button>
              </div>
            </div>
          )}
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
          className={`rounded-lg border border-border bg-card p-2 text-sm ${expandedDraftId === draft.id ? 'flex-1 min-h-0 flex flex-col' : ''}`}
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
                    {draft.suggestionSetName && <span className="font-medium">{draft.suggestionSetName}</span>}
                    {draft.suggestionSetName && <span> · </span>}
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

              {/* Analyze button for unanalyzed drafts */}
              {!draft.aiAnalyzed && (
                <div className="mb-3">
                  {analyzeFormDraftId === draft.id ? (
                    <div className="space-y-2 rounded border border-border bg-muted/30 p-3">
                      <textarea
                        value={analyzeInstructions}
                        onChange={(e) => setAnalyzeInstructions(e.target.value)}
                        placeholder="Optional instructions for Claude AI analysis..."
                        className="w-full rounded border border-input bg-background px-2 py-2 text-xs"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            setAnalyzeFormDraftId(null)
                            setAnalyzeInstructions('')
                          }}
                          disabled={analyzingDraftId === draft.id}
                          size="sm"
                          variant="outline"
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => analyzeWithClaude(draft.id)}
                          disabled={analyzingDraftId === draft.id}
                          size="sm"
                          className="flex-1"
                        >
                          {analyzingDraftId === draft.id ? 'Analyzing...' : 'Analyze'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={() => setAnalyzeFormDraftId(draft.id)}
                      disabled={analyzingDraftId === draft.id}
                      size="sm"
                      className="w-full"
                    >
                      {analyzingDraftId === draft.id ? 'Analyzing...' : 'Analyze with Claude AI'}
                    </Button>
                  )}
                </div>
              )}

              {/* Claude AI summary for analyzed drafts */}
              {draft.aiAnalyzed && (
                <div className="mb-3 rounded bg-muted/50 p-2 text-xs text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">✓ Claude Analysis Complete</div>
                  <div>Claude ranked {draft.trails?.length || 0} trails by quality, removed duplicates, and tagged difficulty/type.</div>
                  <div className="flex gap-2 mt-2">
                    <Button
                      onClick={() => setAnalyzeFormDraftId(draft.id)}
                      disabled={analyzingDraftId === draft.id}
                      size="sm"
                      variant="outline"
                      className="flex-1"
                    >
                      {analyzingDraftId === draft.id ? 'Recomputing...' : 'Recompute'}
                    </Button>
                  </div>
                  {analyzeFormDraftId === draft.id && (
                    <div className="space-y-2 rounded border border-border bg-background p-2 mt-2">
                      <textarea
                        value={analyzeInstructions}
                        onChange={(e) => setAnalyzeInstructions(e.target.value)}
                        placeholder="Optional instructions to refine analysis..."
                        className="w-full rounded border border-input bg-background px-2 py-2 text-xs"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            setAnalyzeFormDraftId(null)
                            setAnalyzeInstructions('')
                          }}
                          disabled={analyzingDraftId === draft.id}
                          size="sm"
                          variant="outline"
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => analyzeWithClaude(draft.id)}
                          disabled={analyzingDraftId === draft.id}
                          size="sm"
                          className="flex-1"
                        >
                          {analyzingDraftId === draft.id ? 'Recomputing...' : 'Recompute'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Approve button */}
              <Button
                onClick={() => handleApproveDraft(draft.id)}
                disabled={selectedTrailIds.size === 0 || approving}
                className="mb-3 w-full"
              >
                {approving ? (
                  'Importing...'
                ) : (
                  `Import ${selectedTrailIds.size} ${selectedTrailIds.size === 1 ? 'trail' : 'trails'}`
                )}
              </Button>

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

              {/* Claude usage info */}
              {draft.aiAnalyzed && (
                <div className="mt-3 rounded bg-muted/50 p-2 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>AI tokens:</span>
                    <span>
                      {draft.claudeUsage.promptTokens + draft.claudeUsage.outputTokens} total
                      {draft.claudeUsage.cacheHit && ' (cached)'}
                    </span>
                  </div>
                </div>
              )}

              {/* Delete button */}
              <Button
                onClick={() => handleDeleteDraft(draft.id)}
                disabled={deleting === draft.id}
                variant="outline"
                className="mt-3 w-full text-destructive hover:bg-destructive/10"
              >
                {deleting === draft.id ? 'Deleting...' : 'Delete Suggestion Set'}
              </Button>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Loading Modal via Portal */}
      {typeof document !== 'undefined' && loadingModal && createPortal(loadingModal, document.body)}
    </div>
  )
})
