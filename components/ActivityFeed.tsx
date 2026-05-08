'use client'

import { useEffect, useState, useCallback } from 'react'
import type { Trail, TrailActivityItem, TrailRevisionAction } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner } from '@fortawesome/free-solid-svg-icons'

interface ActivityFeedProps {
  trails: Trail[]
  onOpenViewTrail: (trail: Trail) => void
  onSelectActivityItem?: (item: TrailActivityItem) => void
}

const PAGE_SIZE = 50

const ACTION_META: Record<TrailRevisionAction, { label: string; cls: string }> = {
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

export function ActivityFeed({ trails, onOpenViewTrail, onSelectActivityItem }: ActivityFeedProps) {
  const [items, setItems] = useState<TrailActivityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(async (pageOffset: number, replace: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/trails/activity?limit=${PAGE_SIZE}&offset=${pageOffset}`)
      const data = await res.json()
      if (!data.success) {
        setError(data.error ?? 'Failed to load activity')
        return
      }
      const fetched: TrailActivityItem[] = (data.activity ?? []).map((item: TrailActivityItem) => ({
        ...item,
        createdAt: new Date(item.createdAt),
      }))
      if (replace) {
        setItems(fetched)
      } else {
        setItems(prev => [...prev, ...fetched])
      }
      setHasMore(fetched.length === PAGE_SIZE)
      setOffset(pageOffset + fetched.length)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    setItems([])
    setOffset(0)
    setHasMore(true)
    loadPage(0, true)
  }, [loadPage])

  return (
    <div className="flex flex-col gap-2 px-4 py-4">
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {items.length === 0 && !loading ? (
        <p className="text-xs text-muted-foreground">No recent activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-0">
          {items.map(item => {
            const meta = ACTION_META[item.action] ?? { label: item.action, cls: 'bg-border text-foreground border-border' }
            const matchedTrail = trails.find(t => t.id === item.trailId)
            const isDeleted = item.action === 'delete'

            return (
              <li key={item.revisionId} className="border-b border-border last:border-0">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 py-2.5 text-left hover:bg-muted/40 transition-colors rounded-sm px-1 -mx-1"
                  onClick={() => onSelectActivityItem ? onSelectActivityItem(item) : matchedTrail && onOpenViewTrail(matchedTrail)}
                >
                  <span
                    className={cn(
                      'mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      meta.cls
                    )}
                  >
                    {meta.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className={cn('text-sm font-semibold', isDeleted ? 'text-muted-foreground line-through' : 'text-foreground')}>
                      {item.trailName}
                    </span>
                    <div className="flex items-baseline gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {item.createdByName ?? 'Unknown'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </div>
                    {(item.summary || item.changeSetComment) && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                        {item.summary ?? item.changeSetComment}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <FontAwesomeIcon icon={faSpinner} spin className="w-3.5 h-3.5" />
          Loading…
        </div>
      )}

      {!loading && hasMore && (
        <Button
          type="button"
          variant="outlineThick"
          size="sm"
          className="self-start"
          onClick={() => loadPage(offset, false)}
        >
          Load more
        </Button>
      )}
    </div>
  )
}
