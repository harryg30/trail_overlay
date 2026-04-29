'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { AddTrailTool, StagedSegment } from '@/lib/types'
import type { TrailEditTool } from '@/lib/modes/types'
import { polylineDistanceKm, haversineKm, polylinesEqual } from '@/lib/geo-utils'
import {
  insertPointAfter,
  removePointAt,
  removePointRange,
  truncatePolylineFromIndex,
  truncatePolylineThroughIndex,
} from '@/lib/geo-edit'

function genId() {
  return crypto.randomUUID()
}

function segmentsEqual(a: StagedSegment[], b: StagedSegment[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false
    if (!polylinesEqual(a[i].polyline, b[i].polyline)) return false
  }
  return true
}

export type ActiveEnd = 'start' | 'end'

export function useStagedTrail() {
  const [segments, setSegments] = useState<StagedSegment[]>([])
  const [activeTool, setActiveTool] = useState<AddTrailTool>('draw')
  const [drawTool, setDrawTool] = useState<TrailEditTool>('pencil')
  const [activeEnd, setActiveEnd] = useState<ActiveEnd>('end')

  const [historyPast, setHistoryPast] = useState<StagedSegment[][]>([])
  const [historyFuture, setHistoryFuture] = useState<StagedSegment[][]>([])

  const segmentsRef = useRef(segments)
  const historyPastRef = useRef(historyPast)
  const historyFutureRef = useRef(historyFuture)
  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])
  useEffect(() => {
    historyPastRef.current = historyPast
  }, [historyPast])
  useEffect(() => {
    historyFutureRef.current = historyFuture
  }, [historyFuture])

  const pushHistory = useCallback((prev: StagedSegment[]) => {
    setHistoryPast((past) => [...past, prev])
    setHistoryFuture([])
  }, [])

  const applyEdit = useCallback((updater: (prev: StagedSegment[]) => StagedSegment[]) => {
    const prev = segmentsRef.current
    const next = updater(prev)
    if (segmentsEqual(prev, next)) return
    pushHistory(prev)
    setSegments(next)
  }, [pushHistory])

  // --- Segment CRUD ---

  const addSegment = useCallback((seg: StagedSegment) => {
    applyEdit((prev) => [...prev, seg])
  }, [applyEdit])

  const removeSegment = useCallback((id: string) => {
    applyEdit((prev) => prev.filter((s) => s.id !== id))
  }, [applyEdit])

  const clearAll = useCallback(() => {
    applyEdit(() => [])
  }, [applyEdit])

  const resetAll = useCallback(() => {
    setSegments([])
    setHistoryPast([])
    setHistoryFuture([])
    setActiveTool('draw')
    setDrawTool('pencil')
    setActiveEnd('end')
  }, [])

  /** Replace staged geometry with a single draw segment (e.g. loading a draft for editing). Does not push undo history. */
  const loadDrawSegment = useCallback((polyline: [number, number][]) => {
    if (polyline.length < 2) return
    const copy: [number, number][] = polyline.map(([a, b]) => [a, b])
    setHistoryPast([])
    setHistoryFuture([])
    setSegments([{ id: genId(), source: 'draw', polyline: copy }])
    setActiveTool('draw')
    setDrawTool('pencil')
    setActiveEnd('end')
  }, [])

  /** Recalculate the active draw segment polyline with a new route. Used by snap tool drag recalculation. */
  const recalculateDrawSegment = useCallback((newPolyline: [number, number][]) => {
    const end = activeEndRef.current
    applyEdit((prev) => {
      const target = findDrawTarget(prev, end)
      if (!target || newPolyline.length < 1) return prev
      return replaceAt(prev, target.idx, { ...target.seg, polyline: newPolyline })
    })
  }, [applyEdit])

  // --- Undo / Redo ---

  const undo = useCallback(() => {
    const past = historyPastRef.current
    if (past.length === 0) return
    const current = segmentsRef.current
    const prev = past[past.length - 1]
    setHistoryPast(past.slice(0, -1))
    setHistoryFuture([current, ...historyFutureRef.current])
    setSegments(prev)
  }, [])

  const redo = useCallback(() => {
    const future = historyFutureRef.current
    if (future.length === 0) return
    const current = segmentsRef.current
    const next = future[0]
    setHistoryFuture(future.slice(1))
    setHistoryPast([...historyPastRef.current, current])
    setSegments(next)
  }, [])

  // --- Draw-specific operations ---
  // All draw ops respect activeEnd: 'end' targets the last segment, 'start' targets the first.

  const activeEndRef = useRef(activeEnd)
  useEffect(() => {
    activeEndRef.current = activeEnd
  }, [activeEnd])

  function findDrawTarget(prev: StagedSegment[], end: ActiveEnd): { seg: StagedSegment; idx: number } | null {
    if (end === 'end') {
      const idx = prev.length - 1
      const seg = prev[idx]
      return seg?.source === 'draw' ? { seg, idx } : null
    }
    const seg = prev[0]
    return seg?.source === 'draw' ? { seg, idx: 0 } : null
  }

  function replaceAt(prev: StagedSegment[], idx: number, seg: StagedSegment): StagedSegment[] {
    return [...prev.slice(0, idx), seg, ...prev.slice(idx + 1)]
  }

  function removeAt(prev: StagedSegment[], idx: number): StagedSegment[] {
    return [...prev.slice(0, idx), ...prev.slice(idx + 1)]
  }

  const getActiveDrawSegment = useCallback((): StagedSegment | null => {
    const segs = segmentsRef.current
    const end = activeEndRef.current
    if (end === 'end') {
      const last = segs[segs.length - 1]
      return last?.source === 'draw' ? last : null
    }
    const first = segs[0]
    return first?.source === 'draw' ? first : null
  }, [])

  const appendDrawPoint = useCallback((latlng: [number, number]) => {
    const end = activeEndRef.current
    applyEdit((prev) => {
      const target = findDrawTarget(prev, end)
      if (target) {
        const newPoly = end === 'end'
          ? [...target.seg.polyline, latlng]
          : [latlng, ...target.seg.polyline]
        return replaceAt(prev, target.idx, { ...target.seg, polyline: newPoly })
      }
      const newSeg = { id: genId(), source: 'draw' as const, polyline: [latlng] }
      return end === 'end' ? [...prev, newSeg] : [newSeg, ...prev]
    })
  }, [applyEdit])

  /** Append multiple points at once (more efficient than calling appendDrawPoint multiple times) */
  const appendDrawPoints = useCallback((points: [number, number][]) => {
    const end = activeEndRef.current
    applyEdit((prev) => {
      const target = findDrawTarget(prev, end)
      if (target) {
        const newPoly = end === 'end'
          ? [...target.seg.polyline, ...points]
          : [...points, ...target.seg.polyline]
        return replaceAt(prev, target.idx, { ...target.seg, polyline: newPoly })
      }
      if (points.length === 0) return prev
      const newSeg = { id: genId(), source: 'draw' as const, polyline: points }
      return end === 'end' ? [...prev, newSeg] : [newSeg, ...prev]
    })
  }, [applyEdit])

  const removeDrawPoint = useCallback((index: number) => {
    const end = activeEndRef.current
    applyEdit((prev) => {
      const target = findDrawTarget(prev, end)
      if (!target) return prev
      if (target.seg.polyline.length <= 1) return removeAt(prev, target.idx)
      return replaceAt(prev, target.idx, { ...target.seg, polyline: removePointAt(target.seg.polyline, index) })
    })
  }, [applyEdit])

  const moveDrawPoint = useCallback((index: number, latlng: [number, number]) => {
    const end = activeEndRef.current
    applyEdit((prev) => {
      const target = findDrawTarget(prev, end)
      if (!target || index < 0 || index >= target.seg.polyline.length) return prev
      const next = [...target.seg.polyline]
      next[index] = latlng
      return replaceAt(prev, target.idx, { ...target.seg, polyline: next })
    })
  }, [applyEdit])

  const insertDrawPointAfter = useCallback((indexBefore: number, latlng: [number, number]) => {
    const end = activeEndRef.current
    applyEdit((prev) => {
      const target = findDrawTarget(prev, end)
      if (!target) return prev
      return replaceAt(prev, target.idx, { ...target.seg, polyline: insertPointAfter(target.seg.polyline, indexBefore, latlng) })
    })
  }, [applyEdit])

  const eraseDrawSection = useCallback((fromIndex: number, toIndex: number) => {
    const end = activeEndRef.current
    applyEdit((prev) => {
      const target = findDrawTarget(prev, end)
      if (!target) return prev
      const result = removePointRange(target.seg.polyline, fromIndex, toIndex)
      if (result === target.seg.polyline) return prev
      return replaceAt(prev, target.idx, { ...target.seg, polyline: result })
    })
  }, [applyEdit])

  /** Remove the polyline chain toward the trail start from this vertex (vertex becomes the new start). */
  const trimDrawTowardStartAt = useCallback((vertexIndex: number) => {
    const end = activeEndRef.current
    applyEdit((prev) => {
      const target = findDrawTarget(prev, end)
      if (!target) return prev
      const next = truncatePolylineFromIndex(target.seg.polyline, vertexIndex)
      if (next === target.seg.polyline) return prev
      if (next.length === 0) return removeAt(prev, target.idx)
      return replaceAt(prev, target.idx, { ...target.seg, polyline: next })
    })
  }, [applyEdit])

  /** Remove the polyline chain toward the trail end from this vertex (vertex becomes the new end). */
  const trimDrawTowardEndAt = useCallback((vertexIndex: number) => {
    const end = activeEndRef.current
    applyEdit((prev) => {
      const target = findDrawTarget(prev, end)
      if (!target) return prev
      const next = truncatePolylineThroughIndex(target.seg.polyline, vertexIndex)
      if (next === target.seg.polyline) return prev
      if (next.length === 0) return removeAt(prev, target.idx)
      return replaceAt(prev, target.idx, { ...target.seg, polyline: next })
    })
  }, [applyEdit])

  // --- OSM toggle (multi-select) ---

  const toggleOsmWay = useCallback((osmWayId: number, name: string | undefined, polyline: [number, number][]) => {
    applyEdit((prev) => {
      const existing = prev.find((s) => s.source === 'osm' && s.osmWayId === osmWayId)
      if (existing) {
        return prev.filter((s) => s.id !== existing.id)
      }
      if (prev.length === 0 || polyline.length === 0) {
        return [...prev, { id: genId(), source: 'osm' as const, osmWayId, name, polyline, reversed: false }]
      }

      const firstSeg = prev[0]
      const lastSeg = prev[prev.length - 1]
      const trailStart = firstSeg.polyline[0]
      const trailEnd = lastSeg.polyline[lastSeg.polyline.length - 1]
      const wayStart = polyline[0]
      const wayEnd = polyline[polyline.length - 1]

      // Four possible connections
      const candidates = [
        { dist: haversineKm(trailEnd, wayStart), side: 'append' as const, rev: false },
        { dist: haversineKm(trailEnd, wayEnd),   side: 'append' as const, rev: true },
        { dist: haversineKm(trailStart, wayEnd),  side: 'prepend' as const, rev: false },
        { dist: haversineKm(trailStart, wayStart), side: 'prepend' as const, rev: true },
      ]
      const best = candidates.reduce((a, b) => (b.dist < a.dist ? b : a))

      const finalPolyline = best.rev ? [...polyline].reverse() : polyline
      const seg = { id: genId(), source: 'osm' as const, osmWayId, name, polyline: finalPolyline, reversed: best.rev }

      return best.side === 'prepend' ? [seg, ...prev] : [...prev, seg]
    })
  }, [applyEdit])

  const isOsmWaySelected = useCallback((osmWayId: number): boolean => {
    return segmentsRef.current.some((s) => s.source === 'osm' && s.osmWayId === osmWayId)
  }, [])

  // --- Strava segment toggle (multi-select, same pattern as OSM) ---

  const toggleStravaSegment = useCallback((stravaSegmentId: number, name: string | undefined, polyline: [number, number][]) => {
    applyEdit((prev) => {
      const existing = prev.find((s) => s.source === 'strava' && s.stravaSegmentId === stravaSegmentId)
      if (existing) {
        return prev.filter((s) => s.id !== existing.id)
      }
      if (prev.length === 0 || polyline.length === 0) {
        return [...prev, { id: genId(), source: 'strava' as const, stravaSegmentId, name, polyline, reversed: false }]
      }

      const firstSeg = prev[0]
      const lastSeg = prev[prev.length - 1]
      const trailStart = firstSeg.polyline[0]
      const trailEnd = lastSeg.polyline[lastSeg.polyline.length - 1]
      const wayStart = polyline[0]
      const wayEnd = polyline[polyline.length - 1]

      const candidates = [
        { dist: haversineKm(trailEnd, wayStart), side: 'append' as const, rev: false },
        { dist: haversineKm(trailEnd, wayEnd),   side: 'append' as const, rev: true },
        { dist: haversineKm(trailStart, wayEnd),  side: 'prepend' as const, rev: false },
        { dist: haversineKm(trailStart, wayStart), side: 'prepend' as const, rev: true },
      ]
      const best = candidates.reduce((a, b) => (b.dist < a.dist ? b : a))

      const finalPolyline = best.rev ? [...polyline].reverse() : polyline
      const seg = { id: genId(), source: 'strava' as const, stravaSegmentId, name, polyline: finalPolyline, reversed: best.rev }

      return best.side === 'prepend' ? [seg, ...prev] : [...prev, seg]
    })
  }, [applyEdit])

  const isStravaSegmentSelected = useCallback((stravaSegmentId: number): boolean => {
    return segmentsRef.current.some((s) => s.source === 'strava' && s.stravaSegmentId === stravaSegmentId)
  }, [])

  // --- Derived state ---

  const compositePolyline = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = []
    for (const seg of segments) {
      for (const pt of seg.polyline) {
        pts.push(pt)
      }
    }
    return pts
  }, [segments])

  const totalDistanceKm = useMemo(() => {
    return segments.reduce((sum, seg) => sum + polylineDistanceKm(seg.polyline), 0)
  }, [segments])

  const activeDrawSegment = useMemo(() => {
    if (activeEnd === 'end') {
      const last = segments[segments.length - 1]
      return last?.source === 'draw' ? last : null
    }
    const first = segments[0]
    return first?.source === 'draw' ? first : null
  }, [segments, activeEnd])

  return {
    segments,
    activeTool, setActiveTool,
    drawTool, setDrawTool,
    activeEnd, setActiveEnd,

    addSegment, removeSegment, clearAll, resetAll, loadDrawSegment, recalculateDrawSegment,

    undo, redo,
    canUndo: historyPast.length > 0,
    canRedo: historyFuture.length > 0,

    appendDrawPoint,
    appendDrawPoints,
    removeDrawPoint,
    moveDrawPoint,
    insertDrawPointAfter,
    eraseDrawSection,
    trimDrawTowardStartAt,
    trimDrawTowardEndAt,
    getActiveDrawSegment, activeDrawSegment,

    toggleOsmWay, isOsmWaySelected,
    toggleStravaSegment, isStravaSegmentSelected,

    compositePolyline, totalDistanceKm,
  }
}

export type StagedTrailApi = ReturnType<typeof useStagedTrail>
