'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type {
  TrailActivityItem,
  TrailRevision,
  TrailRevisionPayload,
  TrailRevisionAction,
  TrailRevisionComment,
  Trail,
} from '@/lib/types'
import type { SessionUser } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark, faSpinner, faExternalLink } from '@fortawesome/free-solid-svg-icons'
import type { DiffView } from './RevisionMapDiff'

const RevisionMapDiff = dynamic(
  () => import('./RevisionMapDiff').then(m => ({ default: m.RevisionMapDiff })),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading map…</div> }
)

const ACTION_META: Record<string, { label: string; cls: string }> = {
  create:   { label: 'Created',     cls: 'bg-forest/20 text-forest border-forest/30' },
  update:   { label: 'Updated',     cls: 'bg-electric/15 text-electric border-electric/30' },
  delete:   { label: 'Deleted',     cls: 'bg-destructive/15 text-destructive border-destructive/30' },
  rollback: { label: 'Rolled back', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-400/30' },
}

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
}

function formatDifficulty(d: string): string {
  return { easy: 'green', intermediate: 'blue', hard: 'black', pro: 'double-black', not_set: 'not set' }[d] ?? d
}

function formatDirection(d: string): string {
  return { 'one-way': 'one-way', 'out-and-back': 'out & back', loop: 'loop', not_set: 'not set' }[d] ?? d
}

// ── Diff building ────────────────────────────────────────────────────────────

type DiffLine = {
  kind: 'context' | 'removed' | 'added' | 'spacer'
  field: string
  value: string
}

function buildDiffLines(
  before: TrailRevisionPayload | null,
  after: TrailRevisionPayload | null,
  action: TrailRevisionAction,
): DiffLine[] {
  type FieldDef = { label: string; get: (p: TrailRevisionPayload) => string }

  const fields: FieldDef[] = [
    { label: 'name',       get: p => p.name || '' },
    { label: 'difficulty', get: p => formatDifficulty(p.difficulty) },
    { label: 'direction',  get: p => formatDirection(p.direction) },
    { label: 'distance',   get: p => p.distanceKm != null ? `${p.distanceKm.toFixed(2)} km` : '' },
    { label: 'elevation',  get: p => p.elevationGainFt != null ? `${Math.round(p.elevationGainFt)} ft` : '' },
    { label: 'notes',      get: p => p.notes?.trim() || '' },
  ]

  const lines: DiffLine[] = []

  // Geometry field — compare by point count + distance
  const geoChanged =
    before && after &&
    before.polyline && after.polyline &&
    (before.polyline.length !== after.polyline.length ||
      before.distanceKm !== after.distanceKm)

  for (const { label, get } of fields) {
    const bVal = before ? get(before) : null
    const aVal = after  ? get(after)  : null

    // Skip empty notes entirely
    if (label === 'notes' && !bVal && !aVal) continue

    if (action === 'create') {
      if (aVal) lines.push({ kind: 'added',   field: label, value: aVal })
    } else if (action === 'delete') {
      if (bVal) lines.push({ kind: 'removed', field: label, value: bVal })
    } else {
      // update / rollback
      if (bVal !== aVal) {
        if (bVal != null) lines.push({ kind: 'removed', field: label, value: bVal })
        if (aVal != null) lines.push({ kind: 'added',   field: label, value: aVal })
      } else {
        if (aVal != null) lines.push({ kind: 'context', field: label, value: aVal })
      }
    }
  }

  // Geometry row
  if (geoChanged && before && after) {
    lines.push({ kind: 'spacer',   field: '', value: '' })
    lines.push({ kind: 'removed', field: 'shape', value: `${before.polyline.length} pts · ${before.distanceKm.toFixed(2)} km` })
    lines.push({ kind: 'added',   field: 'shape', value: `${after.polyline.length} pts · ${after.distanceKm.toFixed(2)} km` })
  } else if (action === 'create' && after) {
    lines.push({ kind: 'added',   field: 'shape', value: `${after.polyline.length} pts · ${after.distanceKm.toFixed(2)} km` })
  } else if (action === 'delete' && before) {
    lines.push({ kind: 'removed', field: 'shape', value: `${before.polyline.length} pts · ${before.distanceKm.toFixed(2)} km` })
  } else if ((action === 'update' || action === 'rollback') && after) {
    lines.push({ kind: 'context', field: 'shape', value: `${after.polyline.length} pts · ${after.distanceKm.toFixed(2)} km` })
  }

  return lines
}

// ── Component ────────────────────────────────────────────────────────────────

interface ChangeDetailModalProps {
  item: TrailActivityItem
  trails: Trail[]
  sessionUser: SessionUser | null
  onClose: () => void
  onOpenTrail: (trail: Trail) => void
}

export function ChangeDetailModal({ item, trails, sessionUser, onClose, onOpenTrail }: ChangeDetailModalProps) {
  const [revisions, setRevisions] = useState<TrailRevision[] | null>(null)
  const [revisionsError, setRevisionsError] = useState<string | null>(null)
  const [comments, setComments] = useState<TrailRevisionComment[] | null>(null)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [view, setView] = useState<DiffView>('both')
  const commentsEndRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Fetch revisions
  useEffect(() => {
    setRevisions(null)
    setRevisionsError(null)
    fetch(`/api/trails/${item.trailId}/revisions?limit=200`)
      .then(r => r.json())
      .then(data => {
        if (!data.success) { setRevisionsError(data.error ?? 'Failed to load revisions'); return }
        setRevisions((data.revisions ?? []).map((r: TrailRevision) => ({
          ...r,
          createdAt: new Date(r.createdAt),
        })))
      })
      .catch(() => setRevisionsError('Network error'))
  }, [item.trailId])

  // Fetch comments
  const loadComments = useCallback(() => {
    fetch(`/api/trails/${item.trailId}/comments`)
      .then(r => r.json())
      .then(data => {
        if (!data.success) { setCommentsError(data.error ?? 'Failed to load comments'); return }
        setComments((data.comments ?? []).map((c: TrailRevisionComment) => ({
          ...c,
          createdAt: new Date(c.createdAt),
        })))
      })
      .catch(() => setCommentsError('Network error'))
  }, [item.trailId])

  useEffect(() => { loadComments() }, [loadComments])

  // Derive before/after
  const selectedRevision = revisions?.find(r => r.id === item.revisionId) ?? null
  const selectedIndex    = revisions ? revisions.findIndex(r => r.id === item.revisionId) : -1
  // revisions are newest-first, so prior = index + 1
  const priorRevision    = revisions && selectedIndex >= 0 ? revisions[selectedIndex + 1] ?? null : null

  const afterPolyline: [number, number][] | null =
    item.action === 'delete' ? null : (selectedRevision?.payload.polyline ?? null)
  const beforePolyline: [number, number][] | null =
    item.action === 'create' ? null :
    item.action === 'delete' ? (selectedRevision?.payload.polyline ?? null) :
    (priorRevision?.payload.polyline ?? null)

  // Reset map view when revisions load
  useEffect(() => {
    if (!revisions) return
    if (!beforePolyline && afterPolyline) setView('after')
    else if (beforePolyline && !afterPolyline) setView('before')
    else setView('both')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisions])

  const afterPayload: TrailRevisionPayload | null =
    item.action === 'delete' ? (selectedRevision?.payload ?? null) : (selectedRevision?.payload ?? null)
  const beforePayload: TrailRevisionPayload | null =
    (item.action === 'update' || item.action === 'rollback') ? (priorRevision?.payload ?? null) : null

  const diffLines = buildDiffLines(beforePayload, afterPayload, item.action)
  const hasBoth   = !!(beforePolyline && afterPolyline)

  const matchedTrail = trails.find(t => t.id === item.trailId) ?? null
  const meta = ACTION_META[item.action] ?? { label: item.action, cls: 'bg-border text-foreground border-border' }

  async function handlePostComment() {
    if (!commentBody.trim()) return
    setPosting(true)
    setPostError(null)
    try {
      const res = await fetch(`/api/trails/${item.trailId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody.trim() }),
      })
      const data = await res.json()
      if (!data.success) { setPostError(data.error ?? 'Failed to post'); return }
      setCommentBody('')
      loadComments()
      setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch {
      setPostError('Network error')
    } finally {
      setPosting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[5010] bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Change detail: ${item.trailName}`}
        className="fixed inset-2 z-[5015] flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', meta.cls)}>
            {meta.label}
          </span>
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
            {item.trailName}
          </h2>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
            {item.createdByName ?? 'Unknown'} · {formatRelativeTime(item.createdAt)}
            {(item.summary || item.changeSetComment) && (
              <span className="ml-1.5 italic">— {item.summary ?? item.changeSetComment}</span>
            )}
          </span>
          {matchedTrail && item.action !== 'delete' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden shrink-0 gap-1.5 text-xs sm:flex"
              onClick={() => { onClose(); onOpenTrail(matchedTrail) }}
            >
              <FontAwesomeIcon icon={faExternalLink} className="w-3 h-3" />
              View trail
            </Button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile attribution row */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-1.5 text-xs text-muted-foreground sm:hidden">
          <span>{item.createdByName ?? 'Unknown'} · {formatRelativeTime(item.createdAt)}</span>
          {matchedTrail && item.action !== 'delete' && (
            <button
              type="button"
              className="text-xs text-foreground underline underline-offset-2"
              onClick={() => { onClose(); onOpenTrail(matchedTrail) }}
            >
              View trail
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">

          {/* ── Left: Map diff ── */}
          <div className="flex flex-col border-b border-border sm:border-b-0 sm:border-r" style={{ flex: '0 0 55%' }}>
            {/* A/B toggle */}
            {hasBoth && (
              <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-3">
                {(['before', 'both', 'after'] as DiffView[]).map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                      view === v
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {v === 'before' ? 'A — Before' : v === 'both' ? 'A + B' : 'B — After'}
                  </button>
                ))}
                {revisionsError && (
                  <span className="ml-auto text-[11px] text-destructive">{revisionsError}</span>
                )}
              </div>
            )}
            {!hasBoth && revisionsError && (
              <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
                <span className="text-[11px] text-destructive">{revisionsError}</span>
              </div>
            )}

            {/* Map */}
            <div className="min-h-[220px] flex-1 sm:min-h-0">
              {revisions === null && !revisionsError ? (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                  <FontAwesomeIcon icon={faSpinner} spin className="w-3.5 h-3.5" />
                  Loading…
                </div>
              ) : (
                <RevisionMapDiff
                  beforePolyline={beforePolyline}
                  afterPolyline={afterPolyline}
                  view={view}
                />
              )}
            </div>
          </div>

          {/* ── Right: Diff + Comments ── */}
          <div className="flex min-h-0 flex-1 flex-col">

            {/* Git-style diff block */}
            <div className="shrink-0 border-b border-border">
              {revisions === null && !revisionsError ? (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                  <FontAwesomeIcon icon={faSpinner} spin className="w-3 h-3" />
                  Loading diff…
                </div>
              ) : diffLines.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">No field changes recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  {/* Diff file header */}
                  <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
                    <span className="font-mono text-[10px] text-muted-foreground">trail.json</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {diffLines.filter(l => l.kind === 'removed').length > 0 && (
                        <span className="text-red-500 dark:text-red-400">
                          −{diffLines.filter(l => l.kind === 'removed').length}
                        </span>
                      )}
                      {diffLines.filter(l => l.kind === 'removed').length > 0 && diffLines.filter(l => l.kind === 'added').length > 0 && ' '}
                      {diffLines.filter(l => l.kind === 'added').length > 0 && (
                        <span className="text-green-600 dark:text-green-400">
                          +{diffLines.filter(l => l.kind === 'added').length}
                        </span>
                      )}
                    </span>
                  </div>
                  <table className="w-full border-collapse font-mono text-xs">
                    <tbody>
                      {diffLines.map((line, i) => {
                        if (line.kind === 'spacer') {
                          return (
                            <tr key={i}>
                              <td colSpan={3} className="h-2 bg-muted/20" />
                            </tr>
                          )
                        }
                        const isRemoved = line.kind === 'removed'
                        const isAdded   = line.kind === 'added'
                        return (
                          <tr
                            key={i}
                            className={cn(
                              isRemoved && 'bg-red-500/10 dark:bg-red-500/15',
                              isAdded   && 'bg-green-500/10 dark:bg-green-500/15',
                            )}
                          >
                            {/* Sign gutter */}
                            <td className={cn(
                              'select-none w-5 pl-2 pr-1 text-center font-bold',
                              isRemoved && 'text-red-500 dark:text-red-400',
                              isAdded   && 'text-green-600 dark:text-green-400',
                              !isRemoved && !isAdded && 'text-muted-foreground',
                            )}>
                              {isRemoved ? '−' : isAdded ? '+' : ' '}
                            </td>
                            {/* Field name */}
                            <td className={cn(
                              'py-0.5 pr-3 text-right text-[11px] whitespace-nowrap',
                              isRemoved && 'text-red-400 dark:text-red-500',
                              isAdded   && 'text-green-500 dark:text-green-600',
                              !isRemoved && !isAdded && 'text-muted-foreground',
                            )}>
                              {line.field}
                            </td>
                            {/* Value */}
                            <td className={cn(
                              'w-full py-0.5 pr-4 break-all',
                              isRemoved && 'text-red-700 dark:text-red-300',
                              isAdded   && 'text-green-700 dark:text-green-300',
                              !isRemoved && !isAdded && 'text-foreground',
                            )}>
                              {line.value || <span className="italic text-muted-foreground">empty</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Comments list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {commentsError && (
                <p className="text-xs text-destructive">{commentsError}</p>
              )}
              {comments === null && !commentsError ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FontAwesomeIcon icon={faSpinner} spin className="w-3.5 h-3.5" />
                  Loading comments…
                </div>
              ) : comments && comments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No comments yet. Be the first!</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {(comments ?? []).map(c => (
                    <li key={c.id} className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-foreground">
                          {c.authorName ?? 'Unknown'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(c.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground whitespace-pre-wrap break-words">{c.body}</p>
                    </li>
                  ))}
                  <div ref={commentsEndRef} />
                </ul>
              )}
            </div>

            {/* Post comment form */}
            <div className="shrink-0 border-t border-border px-4 py-3">
              {sessionUser ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={commentBody}
                    onChange={e => setCommentBody(e.target.value)}
                    placeholder="Add a comment…"
                    rows={2}
                    className="w-full resize-none rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePostComment()
                    }}
                  />
                  {postError && <p className="text-[11px] text-destructive">{postError}</p>}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">⌘↵ to submit</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      disabled={posting || !commentBody.trim()}
                      onClick={handlePostComment}
                    >
                      {posting ? <FontAwesomeIcon icon={faSpinner} spin className="w-3.5 h-3.5" /> : 'Post'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Sign in to leave a comment.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
