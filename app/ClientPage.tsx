'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import LeftDrawer from '@/components/LeftDrawer'
import { type ImportsTabContentHandle } from '@/components/drawer/ImportsTabContent'
import AnnouncementModal from '@/components/AnnouncementModal'
import { ChangeDetailModal } from '@/components/trail/ChangeDetailModal'
import { ANNOUNCEMENT_VERSION, ANNOUNCEMENT } from '@/lib/announcement'
import type {
  Ride,
  Trail,
  Network,
  TrimSegment,
  TrimFormState,
  SaveTrailResponse,
  RidePhoto,
  DraftTrail,
  TrailPhoto,
  OfficialMapLayerPayload,
  StagedSegment,
  TrailActivityItem,
} from '@/lib/types'
import type { SessionUser } from '@/lib/auth'
import {
  polylineDistanceKm,
  polylinesEqual,
  estimatedElevationGainFt,
  generateAveragedTrail,
  clipPolylineToCorridor,
} from '@/lib/geo-utils'
import type { MapBounds } from '@/lib/geo-utils'
import { insertPointAfter, removePointAt, removePointRange } from '@/lib/geo-edit'
import { useEditMode } from '@/hooks/useEditMode'
import { useStagedTrail } from '@/hooks/useStagedTrail'
import { useDebouncedBoundsFetch } from '@/hooks/useDebouncedBoundsFetch'
import { useTrailPhotos } from '@/hooks/useTrailPhotos'
import { useUrlParamSync } from '@/hooks/useUrlParamSync'
import { useRides } from '@/hooks/useRides'
import { fetchOsmWays, OsmFetchError, type OsmWayFeature } from '@/lib/overpass'
import { fetchStravaSegments, type StravaSegmentFeature } from '@/lib/strava-segments'
import { loadDemoRides } from '@/lib/demo-rides'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBars, faCamera } from '@fortawesome/free-solid-svg-icons'
import ThemeToggle from '@/components/ThemeToggle'
import ContactModal from '@/components/ContactModal'
import CookieModal from '@/components/CookieModal'

const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full flex-1 items-center justify-center bg-mud/50">
      <p className="font-display text-sm uppercase tracking-wide text-muted-foreground">Loading map…</p>
    </div>
  ),
})

const DRAFTS_STORAGE_KEY = 'draft_trails'

function persistDrafts(drafts: DraftTrail[]) {
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts))
}

interface InitialParams {
  tab: string | null
  trailId: string | null
  photoId: string | null
  revision: string | null
  lat: number | null
  lng: number | null
  zoom: number | null
}

export default function ClientPage({
  user,
  initialTrail = null,
  initialParams,
  initialContact = false,
  initialAbout = false,
}: {
  user: SessionUser | null
  initialTrail?: Trail | null
  initialParams?: InitialParams
  initialContact?: boolean
  initialAbout?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Lifted from LeftDrawer so we can sync to the URL
  const [drawerTab, setDrawerTab] = useState<'trails' | 'activity' | 'networks' | 'imports'>(
    (initialParams?.tab as 'trails' | 'activity' | 'networks' | 'imports' | undefined) ?? 'trails'
  )

  // Photo open from TrailDetailPanel lightbox; cleared after first use so it doesn't re-restore
  const [pendingInitialPhotoId, setPendingInitialPhotoId] = useState<string | null>(
    initialParams?.photoId ?? null
  )

  // Debounce timer for map view URL sync
  const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Merge partial params into URL without clobbering other params
  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) p.delete(k); else p.set(k, v)
    }
    router.replace(`?${p.toString()}`, { scroll: false })
  }, [router, searchParams])

  const { rides, setRides, hiddenRideIds, setHiddenRideIds, loadRides } = useRides(user)
  const [trails, setTrails] = useState<Trail[]>([])
  const [networks, setNetworks] = useState<Network[]>([])
  const [draftTrails, setDraftTrails] = useState<DraftTrail[]>([])
  const [draftImportTrails, setDraftImportTrails] = useState<any[]>([])
  const [draftImportSelectedIds, setDraftImportSelectedIds] = useState<Set<string>>(new Set())
  const [hoveredImportTrailId, setHoveredImportTrailId] = useState<string | null>(null)
  const [drawBboxMode, setDrawBboxMode] = useState(false)
  const [drawBboxCorners, setDrawBboxCorners] = useState<[number, number][]>([])
  const importsTabRef = useRef<ImportsTabContentHandle>(null)

  const handleStartDrawBbox = useCallback(() => {
    setDrawBboxCorners([])
    setDrawBboxMode(true)
  }, [])

  const handleClearDrawBbox = useCallback(() => {
    setDrawBboxCorners([])
    setDrawBboxMode(false)
  }, [])

  const handleDraftImportTrailsChange = useCallback((trails: any[], selectedIds: Set<string>) => {
    setDraftImportTrails(trails)
    setDraftImportSelectedIds(selectedIds)
  }, [])

  const handleBboxDrawn = useCallback((corners: [[number, number], [number, number]]) => {
    const [a, b] = corners
    const south = Math.min(a[0], b[0])
    const north = Math.max(a[0], b[0])
    const west = Math.min(a[1], b[1])
    const east = Math.max(a[1], b[1])
    setDrawBboxCorners([[south, west], [north, east]])
    setDrawBboxMode(false)
  }, [])
  const [hiddenNetworkIds, setHiddenNetworkIds] = useState<Set<string>>(new Set())
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showAnnouncement, setShowAnnouncement] = useState(false)
  const [showContact, setShowContact] = useState(initialContact)
  const [showAbout, setShowAbout] = useState(initialAbout)
  const [showCookiePolicy, setShowCookiePolicy] = useState(false)
  const [photoLightboxSrc, setPhotoLightboxSrc] = useState<string | null>(null)

  useEffect(() => {
    setShowAnnouncement(localStorage.getItem(`announcement_dismissed_v${ANNOUNCEMENT_VERSION}`) !== 'true')
  }, [])

  // Load demo rides for unauthenticated users
  useEffect(() => {
    if (user) return
    loadDemoRides().then((demos) => {
      if (demos.length > 0) setRides(demos)
    }).catch(console.error)
  }, [user])

  // Hydrate draft trails from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DRAFTS_STORAGE_KEY)
      if (stored) setDraftTrails(JSON.parse(stored) as DraftTrail[])
    } catch { /* ignore malformed storage */ }
  }, [])

  // Edit state — mode transitions and mode-scoped state managed by useEditMode
  const {
    editMode,
    setMode,
    trimStart, setTrimStart,
    trimEnd, setTrimEnd,
    trimEndRef,
    selectedTrail, setSelectedTrail,
    refinedPolyline, setRefinedPolyline,
    refineError, setRefineError,
    selectedNetwork, setSelectedNetwork,
    drawNetworkPoints, setDrawNetworkPoints,
    refineTrailHistoryPast, setRefineTrailHistoryPast,
    refineTrailHistoryFuture, setRefineTrailHistoryFuture,
    trailEditTool, setTrailEditTool,
  } = useEditMode()

  const staged = useStagedTrail()

  const addTrailMode = editMode === 'add-trail' || (editMode === 'edit-trail' && !!selectedTrail)
  const trimMode = addTrailMode && staged.activeTool === 'gpx'
  const mapTrailPickMode = editMode === 'edit-trail' && !selectedTrail
  const drawNetworkMode = editMode === 'add-network'
  const editNetworkMode = editMode === 'edit-network'
  const drawToolActive = addTrailMode && staged.activeTool === 'draw'
  const osmToolActive = addTrailMode && staged.activeTool === 'osm'

  const [gpxActiveRideId, setGpxActiveRideId] = useState<string | null>(null)
  /** When set, save-draft updates this row instead of creating a new draft (edit from drafts list). */
  const [editingDraftLocalId, setEditingDraftLocalId] = useState<string | null>(null)
  /** One-shot form prefill for AddTrailSidebar when opening a draft for edit. */
  const [draftSidebarPrefill, setDraftSidebarPrefill] = useState<DraftTrail | null>(null)

  const refinedPolylineRef = useRef(refinedPolyline)
  refinedPolylineRef.current = refinedPolyline
  const refineTrailHistoryPastRef = useRef(refineTrailHistoryPast)
  refineTrailHistoryPastRef.current = refineTrailHistoryPast
  const refineTrailHistoryFutureRef = useRef(refineTrailHistoryFuture)
  refineTrailHistoryFutureRef.current = refineTrailHistoryFuture

  const lastEditTrailIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (editMode !== 'edit-trail' || !selectedTrail) {
      // Leaving edit-trail: clear any staged geometry we loaded (handles edit→add-trail transition)
      if (lastEditTrailIdRef.current !== null) {
        staged.resetAll()
        lastEditTrailIdRef.current = null
      }
      return
    }
    if (lastEditTrailIdRef.current !== selectedTrail.id) {
      lastEditTrailIdRef.current = selectedTrail.id
      staged.loadDrawSegment(selectedTrail.polyline) // replaces all segments + clears history
      staged.setActiveTool('draw')
      setRefineError(null)
    }
  }, [editMode, selectedTrail]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyRefineTrailEdit = useCallback((updater: (prev: [number, number][]) => [number, number][]) => {
    const prev =
      refinedPolylineRef.current ??
      (selectedTrail ? [...selectedTrail.polyline] : [])
    const next = updater(prev)
    if (polylinesEqual(prev, next)) return
    setRefineTrailHistoryPast([...refineTrailHistoryPastRef.current, prev])
    setRefineTrailHistoryFuture([])
    setRefinedPolyline(next)
  }, [
    selectedTrail,
    setRefineTrailHistoryFuture,
    setRefineTrailHistoryPast,
    setRefinedPolyline,
  ])

  const [averagedTrimPolyline, setAveragedTrimPolyline] = useState<[number, number][] | null>(null)
  const [averagedRideCount, setAveragedRideCount] = useState(0)
  const [corridorRadiusKm, setCorridorRadiusKm] = useState(0.025)
  const [outputSpacingKm, setOutputSpacingKm] = useState(0.010)
  const [highResRideIds, setHighResRideIds] = useState<Set<string>>(new Set())
  const [fetchingHighResId, setFetchingHighResId] = useState<string | null>(null)
  const [fetchingHighResForCorridor, setFetchingHighResForCorridor] = useState(false)
  const [ridePhotos, setRidePhotos] = useState<Record<string, RidePhoto[]>>({})
  const [photosVisibleRideIds, setPhotosVisibleRideIds] = useState<Set<string>>(new Set())
  const [fetchingPhotosId, setFetchingPhotosId] = useState<string | null>(null)
  const [placingPhoto, setPlacingPhoto] = useState<RidePhoto | null>(null)
  const [placingTrailPhoto, setPlacingTrailPhoto] = useState<TrailPhoto | null>(null)
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null)
  const {
    communityTrailPhotos,
    setCommunityTrailPhotos,
    myUnpinnedTrailPhotos,
    setMyUnpinnedTrailPhotos,
    localTrailPhotos,
    setLocalTrailPhotos,
    mapTrailPhotos,
  } = useTrailPhotos(user, mapBounds)
  const osmTooZoomedOut = addTrailMode && !!mapBounds && (mapBounds.north - mapBounds.south) > 0.15
  const [showOnMapOnly, setShowOnMapOnly] = useState(false)
  const [viewingTrail, setViewingTrail] = useState<Trail | null>(initialTrail)
  const [selectedActivityItem, setSelectedActivityItem] = useState<TrailActivityItem | null>(null)

  useUrlParamSync({
    drawerTab,
    viewingTrail,
    selectedActivityItem,
    updateParams,
    onClearPendingInitialPhotoId: () => setPendingInitialPhotoId(null),
  })

  const [mapFlyToRequest, setMapFlyToRequest] = useState<{
    seq: number
    kind: 'trail' | 'network'
    id: string
  } | null>(null)

  const [officialMapLayer, setOfficialMapLayer] = useState<OfficialMapLayerPayload | null>(null)
  const [alignMapHandler, setAlignMapHandler] = useState<null | ((ll: [number, number]) => void)>(null)

  useEffect(() => {
    if (editMode !== 'edit-network' && editMode !== 'add-trail') {
      setOfficialMapLayer(null)
      setAlignMapHandler(null)
    }
  }, [editMode])

  // Fetch OSM ways only when the OSM tool is active
  const osmActive = addTrailMode && staged.activeTool === 'osm'
  const {
    data: osmWays,
    loading: osmLoading,
    error: osmError,
  } = useDebouncedBoundsFetch<OsmWayFeature>({
    enabled: osmActive,
    bounds: mapBounds,
    fetcher: (bounds, signal) => fetchOsmWays(bounds, undefined, signal),
    formatError: (err) =>
      err instanceof OsmFetchError ? err.message : 'Failed to load OSM data. Pan the map to retry.',
  })

  // Reset staged trail + GPX ride when leaving add-trail mode
  useEffect(() => {
    if (!addTrailMode) {
      staged.resetAll()
      setGpxActiveRideId(null)
      setEditingDraftLocalId(null)
      setDraftSidebarPrefill(null)
    }
  }, [addTrailMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOsmWaySelected = useCallback((feature: OsmWayFeature) => {
    staged.toggleOsmWay(feature.osmId, feature.name, feature.polyline)
  }, [staged.toggleOsmWay]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch Strava segments only when the Strava tool is active
  const stravaActive = addTrailMode && staged.activeTool === 'strava' && !!user
  const {
    data: stravaSegments,
    loading: stravaLoading,
    error: stravaError,
  } = useDebouncedBoundsFetch<StravaSegmentFeature>({
    enabled: stravaActive,
    bounds: mapBounds,
    fetcher: (bounds, signal) => fetchStravaSegments(bounds, 'riding', signal),
    formatError: (err) =>
      err instanceof Error ? err.message : 'Failed to load Strava segments.',
  })

  const handleStravaSegmentSelected = useCallback((feature: StravaSegmentFeature) => {
    staged.toggleStravaSegment(feature.segmentId, feature.name, feature.polyline)
  }, [staged.toggleStravaSegment]) // eslint-disable-line react-hooks/exhaustive-deps

  const requestFlyToTrail = useCallback((trail: Trail) => {
    setMapFlyToRequest((prev) => ({
      seq: (prev?.seq ?? 0) + 1,
      kind: 'trail',
      id: trail.id,
    }))
  }, [])

  const requestFlyToNetwork = useCallback((network: Network) => {
    setMapFlyToRequest((prev) => ({
      seq: (prev?.seq ?? 0) + 1,
      kind: 'network',
      id: network.id,
    }))
  }, [])

  useEffect(() => {
    fetch('/api/trails')
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) return
        const loadedTrails: Trail[] = data.trails
        setTrails(loadedTrails)

        // Restore initial trail from URL: prefer the full freshly-fetched version,
        // fall back to the server-pre-fetched initialTrail (which may lack some fields)
        if (initialTrail && !viewingTrail) {
          const match = loadedTrails.find(t => t.id === initialTrail.id)
          if (match) setViewingTrail(match)
        }

        // Restore revision modal from URL
        if (initialParams?.revision && initialParams?.trailId) {
          const trailForRevision = loadedTrails.find(t => t.id === initialParams.trailId)
          if (trailForRevision) {
            fetch(`/api/trails/${initialParams.trailId}/revisions?limit=200`)
              .then(r => r.json())
              .then(d => {
                const rev = (d.revisions ?? []).find((r: { id: string }) => r.id === initialParams.revision)
                if (rev) {
                  setSelectedActivityItem({
                    revisionId: rev.id,
                    trailId: initialParams.trailId!,
                    trailName: trailForRevision.name,
                    action: rev.action,
                    summary: rev.summary,
                    createdAt: new Date(rev.createdAt),
                  })
                }
              })
              .catch(console.error)
          }
        }
      })
      .catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/networks')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setNetworks(data.networks)
      })
      .catch(console.error)
  }, [])

  const reloadTrailMapObjects = useCallback(async () => {
    try {
      const [trailsRes, networksRes] = await Promise.all([
        fetch('/api/trails'),
        fetch('/api/networks'),
      ])
      const [trailsData, networksData] = await Promise.all([
        trailsRes.json(),
        networksRes.json(),
      ])

      if (trailsData.success && Array.isArray(trailsData.trails)) {
        setTrails(trailsData.trails)
      }
      if (networksData.success && Array.isArray(networksData.networks)) {
        setNetworks(networksData.networks)
      }
    } catch (err) {
      console.error('Failed to reload trail map objects:', err)
    }
  }, [])

  const trimSegment = useMemo<TrimSegment | null>(() => {
    if (!trimStart || !trimEnd) return null
    const ride = rides.find((r) => r.id === trimStart.rideId)
    if (!ride) return null
    const polyline = ride.polyline.slice(trimStart.index, trimEnd.index + 1)
    if (polyline.length < 2) return null
    return {
      ride,
      startIndex: trimStart.index,
      endIndex: trimEnd.index,
      polyline,
      distanceKm: polylineDistanceKm(polyline),
      elevationGainFt: estimatedElevationGainFt(ride, trimStart.index, trimEnd.index),
    }
  }, [rides, trimStart, trimEnd])

  // Clear averaged result when endpoints change
  useEffect(() => {
    setAveragedTrimPolyline(null)
    setAveragedRideCount(0)
  }, [trimSegment])

  const handleClearAveragedTrim = useCallback(() => {
    setAveragedTrimPolyline(null)
    setAveragedRideCount(0)
  }, [])

  const handleSaveDraft = useCallback((
    polyline: [number, number][],
    form: TrimFormState,
    source: string,
    sourceRideId?: string,
    osmWayId?: number,
    /** When set, update this draft instead of creating a new one (edit flow). */
    replaceLocalId?: string,
  ) => {
    if (replaceLocalId) {
      setDraftTrails((prev) => {
        const next = prev.map((d) =>
          d.localId === replaceLocalId
            ? {
                ...d,
                name: form.name,
                difficulty: form.difficulty,
                direction: form.direction,
                notes: form.notes || undefined,
                polyline,
                distanceKm: polylineDistanceKm(polyline),
                source,
                sourceRideId,
                osmWayId,
                networkId: form.networkId,
                createdAt: new Date().toISOString(),
              }
            : d
        )
        persistDrafts(next)
        return next
      })
      return
    }
    const draft: DraftTrail = {
      localId: 'draft_' + crypto.randomUUID(),
      isDraft: true,
      name: form.name,
      difficulty: form.difficulty,
      direction: form.direction,
      notes: form.notes || undefined,
      polyline,
      distanceKm: polylineDistanceKm(polyline),
      elevationGainFt: 0,
      source,
      sourceRideId,
      osmWayId,
      networkId: form.networkId,
      createdAt: new Date().toISOString(),
    }
    setDraftTrails((prev) => {
      const next = [draft, ...prev]
      persistDrafts(next)
      return next
    })
  }, [])

  const handleEditDraft = useCallback(
    (localId: string) => {
      const draft = draftTrails.find((d) => d.localId === localId)
      if (!draft || draft.polyline.length < 2) return
      staged.loadDrawSegment(draft.polyline)
      setEditingDraftLocalId(localId)
      setDraftSidebarPrefill(draft)
      setMode('add-trail')
    },
    [draftTrails, staged.loadDrawSegment, setMode]
  )

  const clearDraftSidebarPrefill = useCallback(() => setDraftSidebarPrefill(null), [])

  const handleSaveAddedTrail = useCallback(
    async (form: TrimFormState, publishOnSave: boolean): Promise<string | null> => {
      const polyline = staged.compositePolyline
      if (polyline.length < 2) return 'Add at least 2 points'

      const osmSeg = staged.segments.find((s): s is Extract<StagedSegment, { source: 'osm' }> => s.source === 'osm')
      const gpxSeg = staged.segments.find((s): s is Extract<StagedSegment, { source: 'gpx' }> => s.source === 'gpx')
      const sources = new Set(staged.segments.map((s) => s.source))
      const source = sources.size === 1 ? staged.segments[0].source : 'mixed'

      if (!publishOnSave || !user) {
        handleSaveDraft(
          polyline,
          form,
          source,
          gpxSeg?.rideId,
          osmSeg?.osmWayId,
          editingDraftLocalId ?? undefined
        )
        setEditingDraftLocalId(null)
        setDraftSidebarPrefill(null)
        setMode(null)
        return null
      }

      const res = await fetch('/api/trails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trails: [{
            name: form.name,
            difficulty: form.difficulty,
            direction: form.direction,
            notes: form.notes || undefined,
            polyline,
            distanceKm: staged.totalDistanceKm,
            elevationGainFt: 0,
            source,
            sourceRideId: gpxSeg?.rideId,
            osmWayId: osmSeg?.osmWayId,
          }],
        }),
      })
      const data: SaveTrailResponse = await res.json()
      if (data.success && data.savedTrails) {
        setTrails((prev) => [...(data.savedTrails ?? []), ...prev])

        if (form.networkId && data.savedTrails.length > 0) {
          const network = networks.find((n) => n.id === form.networkId)
          if (network) {
            const updatedTrailIds = [...network.trailIds, data.savedTrails[0].id]
            const res2 = await fetch(`/api/networks/${network.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: network.name, trailIds: updatedTrailIds }),
            })
            const data2 = await res2.json()
            if (data2.success && data2.network) {
              setNetworks((prev) => prev.map((n) => (n.id === data2.network.id ? data2.network : n)))
            }
          }
        }

        if (editingDraftLocalId) {
          setDraftTrails((prev) => {
            const next = prev.filter((d) => d.localId !== editingDraftLocalId)
            persistDrafts(next)
            return next
          })
          setEditingDraftLocalId(null)
          setDraftSidebarPrefill(null)
        }

        await reloadTrailMapObjects()

        setMode(null)
        return null
      }
      return data.error ?? 'Save failed'
    },
    [
      staged.compositePolyline,
      staged.segments,
      staged.totalDistanceKm,
      user,
      handleSaveDraft,
      networks,
      editingDraftLocalId,
      setMode,
    ]
  )

  const handlePublishDraft = useCallback(async (localId: string): Promise<string | null> => {
    const draft = draftTrails.find((d) => d.localId === localId)
    if (!draft) return 'Draft not found'
    try {
      const res = await fetch('/api/trails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trails: [{
            name: draft.name,
            difficulty: draft.difficulty,
            direction: draft.direction,
            notes: draft.notes,
            polyline: draft.polyline,
            distanceKm: draft.distanceKm,
            elevationGainFt: draft.elevationGainFt,
            source: draft.source,
            sourceRideId: draft.sourceRideId,
            osmWayId: draft.osmWayId,
          }],
        }),
      })
      const data: SaveTrailResponse = await res.json()
      if (data.success && data.savedTrails) {
        setTrails((prev) => [...(data.savedTrails ?? []), ...prev])
        setDraftTrails((prev) => {
          const next = prev.filter((d) => d.localId !== localId)
          persistDrafts(next)
          return next
        })
        await reloadTrailMapObjects()
        return null
      }
      return data.error ?? 'Publish failed'
    } catch {
      return 'Network error'
    }
  }, [draftTrails, reloadTrailMapObjects])

  const handleDeleteDraft = useCallback((localId: string) => {
    setDraftTrails((prev) => {
      const next = prev.filter((d) => d.localId !== localId)
      persistDrafts(next)
      return next
    })
  }, [])

  const handleAverageLine = useCallback(() => {
    if (!trimSegment) return
    const otherRides = rides.filter((r) => r.id !== trimSegment.ride.id)
    const result = generateAveragedTrail(trimSegment.polyline, otherRides, corridorRadiusKm, 2, outputSpacingKm)
    setAveragedTrimPolyline(result?.polyline ?? null)
    setAveragedRideCount(result?.rideCount ?? 0)
  }, [trimSegment, rides, corridorRadiusKm, outputSpacingKm])

  // Cheap check — no clip math, just gates the "Improve from Strava" button
  const hasUnfetchedStravaRides = useMemo(() =>
    trimSegment
      ? rides.some((r) => r.stravaActivityId && !highResRideIds.has(r.id) && r.id !== trimSegment.ride.id)
      : false
  , [rides, trimSegment, highResRideIds])

  const handleFetchHighRes = useCallback(async (rideId: string) => {
    setFetchingHighResId(rideId)
    try {
      const res = await fetch(`/api/rides/${rideId}/highres`)
      const data = await res.json()
      if (data.polyline) {
        setRides((prev) => prev.map((r) =>
          r.id === rideId ? { ...r, polyline: data.polyline, pointCount: data.polyline.length } : r
        ))
        setHighResRideIds((prev) => new Set([...prev, rideId]))
      }
    } finally {
      setFetchingHighResId(null)
    }
  }, [])

  const handleFetchHighResForCorridor = useCallback(async () => {
    if (!trimSegment) return
    setFetchingHighResForCorridor(true)
    const eligible = rides.filter((r) =>
      r.stravaActivityId &&
      !highResRideIds.has(r.id) &&
      r.id !== trimSegment.ride.id &&
      clipPolylineToCorridor(r.polyline, trimSegment.polyline, corridorRadiusKm).length >= 5
    )
    for (const ride of eligible) {
      const res = await fetch(`/api/rides/${ride.id}/highres`)
      const data = await res.json()
      if (data.polyline) {
        setRides((prev) => prev.map((r) =>
          r.id === ride.id ? { ...r, polyline: data.polyline, pointCount: data.polyline.length } : r
        ))
        setHighResRideIds((prev) => new Set([...prev, ride.id]))
      }
    }
    setFetchingHighResForCorridor(false)
  }, [rides, trimSegment, highResRideIds, corridorRadiusKm])

  const handleRidesUploaded = (newRides: Ride[]) => {
    setRides((prev) => [...prev, ...newRides])
    setHiddenRideIds((prev) => {
      const next = new Set(prev)
      newRides.forEach((r) => next.add(r.id))
      return next
    })
  }

  const handleToggleRide = useCallback((id: string) => {
    setHiddenRideIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleHideAllRides = useCallback(() => {
    setHiddenRideIds(new Set(rides.map((r) => r.id)))
    localStorage.setItem('visible_ride_ids', JSON.stringify([]))
  }, [rides])

  const handleToggleNetwork = useCallback((id: string) => {
    setHiddenNetworkIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])


  // Mode transitions now handled by useEditMode — setMode does cleanup automatically
  const handleEditModeChange = setMode

  const handleEnterAddTrailPhoto = useCallback(() => {
    setMode('add-trail-photo')
  }, [setMode])

  const handleToggleAddTrailPhoto = useCallback(() => {
    if (editMode === 'add-trail-photo') {
      setMode(null)
      return
    }
    handleEnterAddTrailPhoto()
  }, [editMode, handleEnterAddTrailPhoto, setMode])

  const handleTrailSelected = useCallback((trail: Trail) => {
    setSelectedTrail(trail)
  }, [])

  const handleSelectActivityItem = useCallback((item: TrailActivityItem) => {
    setSelectedActivityItem(item)
  }, [])

  const handlePhotoOpen = useCallback((photoId: string) => {
    setPendingInitialPhotoId(null)  // consumed; prevent re-restore on subsequent opens
    updateParams({ photo: photoId })
  }, [updateParams])

  const handlePhotoClose = useCallback(() => {
    updateParams({ photo: null })
  }, [updateParams])

  const handleViewChange = useCallback((lat: number, lng: number, zoom: number) => {
    if (viewTimerRef.current) clearTimeout(viewTimerRef.current)
    viewTimerRef.current = setTimeout(() => {
      updateParams({ lat: String(lat), lng: String(lng), zoom: String(zoom) })
    }, 500)
  }, [updateParams])

  const handleOpenViewTrail = useCallback((trail: Trail) => {
    setViewingTrail(trail)
    // Exit any edit mode so the detail panel has full focus
    setMode(null)
    setSelectedTrail(null)
  }, [setMode, setSelectedTrail])

  const handleCloseViewTrail = useCallback(() => {
    setViewingTrail(null)
  }, [])

  const handleEditFromViewTrail = useCallback((trail: Trail) => {
    setViewingTrail(null)
    setSelectedTrail(trail)
    setMode('edit-trail')
  }, [setMode, setSelectedTrail])

  const handlePolylineRefined = useCallback((polyline: [number, number][]) => {
    applyRefineTrailEdit(() => [...polyline])
  }, [applyRefineTrailEdit])

  const handleSaveEditedTrail = useCallback(
    async (form: TrimFormState): Promise<string | null> => {
      if (!selectedTrail) return 'Nothing to save'
      const polyline = staged.compositePolyline
      if (polyline.length < 2) return 'Trail needs at least 2 points'
      setRefineError(null)
      try {
        const distanceKm = staged.totalDistanceKm > 0 ? staged.totalDistanceKm : selectedTrail.distanceKm
        const res = await fetch(`/api/trails/${selectedTrail.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            difficulty: form.difficulty,
            direction: form.direction,
            notes: form.notes || undefined,
            polyline,
            distanceKm,
          }),
        })
        const data = await res.json()
        if (data.success && data.trail) {
          setTrails((prev) => prev.map((t) => (t.id === data.trail.id ? data.trail : t)))
          setSelectedTrail(null)
          setMode(null)
          return null
        }
        setRefineError(data.error ?? 'Save failed')
        return data.error ?? 'Save failed'
      } catch {
        setRefineError('Network error')
        return 'Network error'
      }
    },
    [selectedTrail, staged.compositePolyline, staged.totalDistanceKm, setMode, setRefineError, setSelectedTrail] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const handleDeleteTrail = useCallback(async (): Promise<string | null> => {
    if (!selectedTrail) return 'No trail selected'
    try {
      const res = await fetch(`/api/trails/${selectedTrail.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setTrails((prev) => prev.filter((t) => t.id !== selectedTrail.id))
        setSelectedTrail(null)
        return null
      }
      return data.error ?? 'Delete failed'
    } catch {
      return 'Network error'
    }
  }, [selectedTrail])

  const handleTrimPointSelected = useCallback((rideId: string, index: number) => {
    setTrimStart((prevStart) => {
      const prevEnd = trimEndRef.current

      // No start yet → set start
      if (!prevStart) {
        setTrimEnd(null)
        return { rideId, index }
      }

      // Both set (third click) → reset to new start
      if (prevEnd !== null) {
        setTrimEnd(null)
        return { rideId, index }
      }

      // Different ride → reset to new start
      if (prevStart.rideId !== rideId) {
        setTrimEnd(null)
        return { rideId, index }
      }

      // Same ride, second click → set end with lo/hi ordering
      const lo = Math.min(prevStart.index, index)
      const hi = Math.max(prevStart.index, index)
      setTrimEnd({ rideId, index: hi })
      return { rideId, index: lo }
    })
  }, [])

  const handleStepTrimPoint = useCallback(
    (which: 'start' | 'end', delta: number) => {
      if (!trimSegment) return
      const maxIdx = trimSegment.ride.polyline.length - 1
      if (which === 'start') {
        setTrimStart((prev) => {
          if (!prev) return prev
          const newIdx = Math.max(0, Math.min(prev.index + delta, trimSegment.endIndex - 1))
          return { ...prev, index: newIdx }
        })
      } else {
        setTrimEnd((prev) => {
          if (!prev) return prev
          const newIdx = Math.max(trimSegment.startIndex + 1, Math.min(prev.index + delta, maxIdx))
          return { ...prev, index: newIdx }
        })
      }
    },
    [trimSegment]
  )

  const handleClearTrimPoint = useCallback((which: 'start' | 'end') => {
    if (which === 'start') setTrimStart(null)
    else setTrimEnd(null)
  }, [])

  // When trim segment is complete, add it as a GPX staged segment
  const handleAddTrimSegment = useCallback(() => {
    if (!trimSegment) return
    const polyline = averagedTrimPolyline ?? trimSegment.polyline
    staged.addSegment({
      id: crypto.randomUUID(),
      source: 'gpx',
      rideId: trimSegment.ride.id,
      startIndex: trimSegment.startIndex,
      endIndex: trimSegment.endIndex,
      polyline,
    })
    setTrimStart(null)
    setTrimEnd(null)
    setAveragedTrimPolyline(null)
    setAveragedRideCount(0)
  }, [trimSegment, averagedTrimPolyline, staged.addSegment]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefineUndo = useCallback(() => {
    const past = refineTrailHistoryPastRef.current
    if (past.length === 0) return
    const prev = past[past.length - 1]
    const current =
      refinedPolylineRef.current ?? (selectedTrail ? [...selectedTrail.polyline] : prev)
    setRefineTrailHistoryPast(past.slice(0, -1))
    setRefineTrailHistoryFuture([current, ...refineTrailHistoryFutureRef.current])
    setRefinedPolyline(prev)
  }, [
    refinedPolyline,
    refineTrailHistoryFuture.length,
    refineTrailHistoryPast.length,
    selectedTrail,
    setRefineTrailHistoryFuture,
    setRefineTrailHistoryPast,
    setRefinedPolyline,
  ])

  const handleRefineRedo = useCallback(() => {
    const future = refineTrailHistoryFutureRef.current
    if (future.length === 0) return
    const next = future[0]
    const current =
      refinedPolylineRef.current ?? (selectedTrail ? [...selectedTrail.polyline] : next)
    setRefineTrailHistoryFuture(future.slice(1))
    setRefineTrailHistoryPast([...refineTrailHistoryPastRef.current, current])
    setRefinedPolyline(next)
  }, [
    refinedPolyline,
    refineTrailHistoryFuture.length,
    refineTrailHistoryPast.length,
    selectedTrail,
    setRefineTrailHistoryFuture,
    setRefineTrailHistoryPast,
    setRefinedPolyline,
  ])

  const handleRefineClear = useCallback(() => {
    if (!selectedTrail) return
    applyRefineTrailEdit(() => [...selectedTrail.polyline])
  }, [applyRefineTrailEdit, selectedTrail])

  const handleRefinePointRemoved = useCallback((index: number) => {
    applyRefineTrailEdit((prev) => {
      if (prev.length <= 2) return prev
      return removePointAt(prev, index)
    })
  }, [applyRefineTrailEdit])

  const handleRefineInsertAfter = useCallback((indexBefore: number, latlng: [number, number]) => {
    applyRefineTrailEdit((prev) => insertPointAfter(prev, indexBefore, latlng))
  }, [applyRefineTrailEdit])

  const handleRefineSectionErase = useCallback((fromIndex: number, toIndex: number) => {
    applyRefineTrailEdit((prev) => {
      const result = removePointRange(prev, fromIndex, toIndex)
      if (result.length < 2) return prev
      return result
    })
  }, [applyRefineTrailEdit])

  const handleNetworkPointAdded = useCallback((latlng: [number, number]) => {
    setDrawNetworkPoints((prev) => [...prev, latlng])
  }, [])

  const handleSaveNetwork = useCallback(
    async (name: string, polygon: [number, number][], trailIds: string[]): Promise<string | null> => {
      try {
        const res = await fetch('/api/networks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, polygon, trailIds }),
        })
        const data = await res.json()
        if (data.success && data.network) {
          setNetworks((prev) => [data.network, ...prev])
          setMode(null)
          setDrawNetworkPoints([])
          return null
        }
        return data.error ?? 'Save failed'
      } catch {
        return 'Network error'
      }
    },
    []
  )

  const handleUpdateNetwork = useCallback(
    async (name: string, polygon: [number, number][] | null, trailIds: string[]): Promise<string | null> => {
      if (!selectedNetwork) return 'No network selected'
      try {
        const body: { name: string; trailIds: string[]; polygon?: [number, number][] } = { name, trailIds }
        if (polygon) body.polygon = polygon
        const res = await fetch(`/api/networks/${selectedNetwork.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (data.success && data.network) {
          setNetworks((prev) => prev.map((n) => (n.id === data.network.id ? data.network : n)))
          setSelectedNetwork(null)
          setMode(null)
          setDrawNetworkPoints([])
          return null
        }
        return data.error ?? 'Update failed'
      } catch {
        return 'Network error'
      }
    },
    [selectedNetwork]
  )

  const handleDeleteNetwork = useCallback(async (): Promise<string | null> => {
    if (!selectedNetwork) return 'No network selected'
    try {
      const res = await fetch(`/api/networks/${selectedNetwork.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setNetworks((prev) => prev.filter((n) => n.id !== selectedNetwork.id))
        setSelectedNetwork(null)
        setMode(null)
        return null
      }
      return data.error ?? 'Delete failed'
    } catch {
      return 'Network error'
    }
  }, [selectedNetwork])

  const handleStartRedrawNetwork = useCallback(() => {
    setDrawNetworkPoints([])
    setMode('add-network')
  }, [])

  const handleFetchAndTogglePhotos = useCallback(async (rideId: string) => {
    const isVisible = photosVisibleRideIds.has(rideId)
    // If already loaded, just toggle visibility
    if (ridePhotos[rideId]) {
      setPhotosVisibleRideIds((prev) => {
        const next = new Set(prev)
        if (next.has(rideId)) next.delete(rideId)
        else next.add(rideId)
        return next
      })
      return
    }
    // Fetch from Strava, then show
    setFetchingPhotosId(rideId)
    try {
      const res = await fetch(`/api/rides/${rideId}/photos`)
      const data = await res.json()
      if (data.photos) {
        setRidePhotos((prev) => ({ ...prev, [rideId]: data.photos }))
        if (!isVisible) {
          setPhotosVisibleRideIds((prev) => new Set([...prev, rideId]))
        }
      }
    } finally {
      setFetchingPhotosId(null)
    }
  }, [ridePhotos, photosVisibleRideIds])

  const handleAcceptPhoto = useCallback(async (
    photoId: string,
    trailId: string,
    trailLat: number,
    trailLon: number
  ) => {
    const res = await fetch(`/api/photos/${photoId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trailId, trailLat, trailLon }),
    })
    const data = await res.json()
    if (data.photo) {
      setRidePhotos((prev) => {
        const rideId = data.photo.rideId
        const updated = (prev[rideId] ?? []).map((p: RidePhoto) =>
          p.id === data.photo.id ? data.photo : p
        )
        return { ...prev, [rideId]: updated }
      })
      setPlacingPhoto(null)
    }
  }, [])

  const handlePlacePhoto = useCallback((photo: RidePhoto) => {
    setPlacingTrailPhoto(null)
    setPlacingPhoto(photo)
    // Mobile: collapse drawer so the map is visible for trail tap-to-pin.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches) {
      setMobileMenuOpen(false)
    }
  }, [])

  const handlePlaceTrailPhoto = useCallback((photo: TrailPhoto) => {
    setPlacingPhoto(null)
    setPlacingTrailPhoto(photo)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches) {
      setMobileMenuOpen(false)
    }
  }, [])

  const handleCancelPlace = useCallback(() => {
    setPlacingPhoto(null)
    setPlacingTrailPhoto(null)
  }, [])

  const handleTrailPhotoCreated = useCallback((photo: TrailPhoto) => {
    if (photo.isLocal) {
      setLocalTrailPhotos((prev) => [photo, ...prev.filter((p) => p.id !== photo.id)])
      return
    }
    setMyUnpinnedTrailPhotos((prev) => [photo, ...prev.filter((p) => p.id !== photo.id)])
  }, [])

  const handleAcceptTrailPhoto = useCallback(async (
    photoId: string,
    trailId: string,
    trailLat: number,
    trailLon: number
  ) => {
    if (photoId.startsWith('local-')) {
      setLocalTrailPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? {
                ...p,
                trailId,
                trailLat,
                trailLon,
                accepted: true,
                lat: trailLat,
                lon: trailLon,
              }
            : p
        )
      )
      setPlacingTrailPhoto(null)
      return
    }

    const res = await fetch(`/api/trail-photos/${photoId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trailId, trailLat, trailLon }),
    })
    const data = await res.json()
    if (data.photo) {
      const updated = data.photo as TrailPhoto
      setMyUnpinnedTrailPhotos((prev) => prev.filter((p) => p.id !== updated.id))
      setCommunityTrailPhotos((prev) => {
        const byId = new Map<string, TrailPhoto>()
        for (const p of prev) byId.set(p.id, p)
        byId.set(updated.id, updated)
        return Array.from(byId.values()).sort((a, b) => {
          const at = new Date(a.createdAt).getTime()
          const bt = new Date(b.createdAt).getTime()
          return bt - at
        })
      })
      setPlacingTrailPhoto(null)
    }
  }, [])

  const handleCloseAnnouncement = useCallback(() => {
    localStorage.setItem(`announcement_dismissed_v${ANNOUNCEMENT_VERSION}`, 'true')
    setShowAnnouncement(false)
  }, [])

  const handleOpenAnnouncement = useCallback(() => {
    setShowAnnouncement(true)
  }, [])

  const handleOpenContact = useCallback(() => {
    setShowContact(true)
  }, [])

  const handleCloseContact = useCallback(() => {
    setShowContact(false)
    // If we arrived via /contact, navigate back to /
    if (typeof window !== 'undefined' && window.location.pathname === '/contact') {
      router.replace('/')
    }
  }, [router])

  const handleOpenCookiePolicy = useCallback(() => {
    setShowCookiePolicy(true)
  }, [])

  const handleCloseCookiePolicy = useCallback(() => {
    setShowCookiePolicy(false)
  }, [])

  const handleCloseAbout = useCallback(() => {
    setShowAbout(false)
    if (typeof window !== 'undefined' && window.location.pathname === '/about') {
      router.replace('/')
    }
  }, [router])

  const handleOpenPhotoLightbox = useCallback((src: string) => {
    setPhotoLightboxSrc(src)
  }, [])

  const handleClosePhotoLightbox = useCallback(() => {
    setPhotoLightboxSrc(null)
  }, [])

  return (
    <div className="flex h-screen relative overflow-hidden">
      {/* Mobile backdrop */}
      {mobileMenuOpen && (
        <div
          className="sm:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Drawer — always visible on desktop, slide-in sheet on mobile */}
      <div className={`${mobileMenuOpen ? 'flex' : 'hidden'} sm:flex fixed top-0 left-0 sm:relative sm:top-auto sm:left-auto z-2000 sm:z-auto h-full`}>
        <LeftDrawer
          user={user}
          rides={rides}
          trails={trails}
          hiddenRideIds={hiddenRideIds}
          onToggleRide={handleToggleRide}
          onHideAllRides={handleHideAllRides}
          onRidesUploaded={handleRidesUploaded}
          onSyncComplete={loadRides}
          editMode={editMode}
          onEditModeChange={handleEditModeChange}
          selectedTrail={selectedTrail}
          onSelectTrail={setSelectedTrail}
          onSaveEditedTrail={handleSaveEditedTrail}
          onDeleteTrail={handleDeleteTrail}
          refineError={refineError}
          networks={networks}
          hiddenNetworkIds={hiddenNetworkIds}
          onToggleNetwork={handleToggleNetwork}
          selectedNetwork={selectedNetwork}
          drawNetworkPoints={drawNetworkPoints}
          onSelectNetwork={setSelectedNetwork}
          onSaveNetwork={handleSaveNetwork}
          onUpdateNetwork={handleUpdateNetwork}
          onDeleteNetwork={handleDeleteNetwork}
          onStartRedrawNetwork={handleStartRedrawNetwork}
          onOpenAnnouncement={handleOpenAnnouncement}
          onOpenContact={handleOpenContact}
          onOpenCookiePolicy={handleOpenCookiePolicy}
          highResRideIds={highResRideIds}
          onFetchHighRes={handleFetchHighRes}
          fetchingHighResId={fetchingHighResId}
          ridePhotos={ridePhotos}
          photosVisibleRideIds={photosVisibleRideIds}
          fetchingPhotosId={fetchingPhotosId}
          onFetchAndTogglePhotos={handleFetchAndTogglePhotos}
          draftTrails={draftTrails}
          onPublishDraft={handlePublishDraft}
          onDeleteDraft={handleDeleteDraft}
          onEditDraft={handleEditDraft}
          draftSidebarPrefill={draftSidebarPrefill}
          onClearDraftSidebarPrefill={clearDraftSidebarPrefill}
          staged={staged}
          onSaveAddedTrail={handleSaveAddedTrail}
          mapBounds={mapBounds}
          showOnMapOnly={showOnMapOnly}
          onToggleShowOnMapOnly={() => setShowOnMapOnly(v => !v)}
          onTrailPhotoCreated={handleTrailPhotoCreated}
          onEnterAddTrailPhoto={handleEnterAddTrailPhoto}
          communityTrailPhotos={communityTrailPhotos}
          unpinnedTrailPhotos={[...myUnpinnedTrailPhotos, ...localTrailPhotos]}
          placingPhoto={placingPhoto}
          placingTrailPhoto={placingTrailPhoto}
          onPlaceRidePhoto={handlePlacePhoto}
          onPlaceTrailPhoto={handlePlaceTrailPhoto}
          onCancelPinOnMap={handleCancelPlace}
          onOpenPhotoLightbox={handleOpenPhotoLightbox}
          onFlyToTrail={requestFlyToTrail}
          onFlyToNetwork={requestFlyToNetwork}
          onOfficialMapLayerChange={setOfficialMapLayer}
          onAlignmentMapPickChange={setAlignMapHandler}
          viewingTrail={viewingTrail}
          onOpenViewTrail={handleOpenViewTrail}
          onCloseViewTrail={handleCloseViewTrail}
          onEditViewTrail={handleEditFromViewTrail}
          onSelectActivityItem={handleSelectActivityItem}
          tab={drawerTab}
          onTabChange={setDrawerTab}
          initialPhotoId={pendingInitialPhotoId ?? undefined}
          onPhotoOpen={handlePhotoOpen}
          onPhotoClose={handlePhotoClose}
          onDraftTrailsChange={handleDraftImportTrailsChange}
          onHoverImportTrail={setHoveredImportTrailId}
          importsTabRef={importsTabRef}
          onStartDrawBbox={handleStartDrawBbox}
          drawBboxCorners={drawBboxCorners}
          onClearDrawBbox={handleClearDrawBbox}
          onTrailsChanged={reloadTrailMapObjects}
        />
      </div>

      {/* Mobile quick actions — shown when drawer is closed */}
      {!mobileMenuOpen && (
        <div className="sm:hidden fixed top-4 right-4 z-1001 flex items-center gap-2">
          <ThemeToggle className="w-52 shrink-0" size="sm" />
          <button
            type="button"
            className={`rounded-lg border-2 p-2.5 shadow-[2px_2px_0_0_var(--foreground)] transition-colors ${
              editMode === 'add-trail-photo'
                ? 'border-forest bg-forest/15 text-forest'
                : 'border-transparent bg-card text-foreground'
            }`}
            onClick={handleToggleAddTrailPhoto}
            aria-label={editMode === 'add-trail-photo' ? 'Exit add photo mode' : 'Add photo'}
            title={editMode === 'add-trail-photo' ? 'Cancel' : 'Add photo'}
          >
            <FontAwesomeIcon icon={faCamera} className="w-5 h-5" />
          </button>

          <button
            type="button"
            className="rounded-lg border-2 border-foreground bg-card p-2.5 shadow-[2px_2px_0_0_var(--foreground)]"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
          >
            <FontAwesomeIcon icon={faBars} className="h-5 w-5 text-foreground" />
          </button>
        </div>
      )}

      <LeafletMap
        rides={rides}
        hiddenRideIds={hiddenRideIds}
        trails={trails}
        draftTrails={draftTrails}
        editMode={editMode}
        onEditModeChange={handleEditModeChange}
        trimMode={trimMode}
        trimStart={trimStart}
        trimSegment={trimSegment}
        averagedTrimPolyline={averagedTrimPolyline}
        onTrimPointSelected={handleTrimPointSelected}
        editTrailMode={mapTrailPickMode}
        selectedTrailId={selectedTrail?.id ?? null}
        onTrailSelected={handleTrailSelected}
        refineMode={false}
        refinePolyline={null}
        onPolylineRefined={handlePolylineRefined}
        networks={networks}
        hiddenNetworkIds={hiddenNetworkIds}
        drawNetworkMode={drawNetworkMode}
        drawNetworkPoints={drawNetworkPoints}
        onNetworkPointAdded={handleNetworkPointAdded}
        editNetworkMode={editNetworkMode}
        selectedNetworkId={selectedNetwork?.id ?? null}
        onNetworkSelected={setSelectedNetwork}
        ridePhotos={ridePhotos}
        photosVisibleRideIds={photosVisibleRideIds}
        placingPhoto={placingPhoto}
        placingTrailPhoto={placingTrailPhoto}
        onAcceptPhoto={handleAcceptPhoto}
        onCancelPlace={handleCancelPlace}
        trailPhotos={mapTrailPhotos}
        onAcceptTrailPhoto={handleAcceptTrailPhoto}
        onBoundsChange={setMapBounds}
        trailEditTool={trailEditTool}
        onRefinePointRemoved={handleRefinePointRemoved}
        onRefineInsertAfter={handleRefineInsertAfter}
        onRefineSectionErase={handleRefineSectionErase}
        onOpenPhotoLightbox={handleOpenPhotoLightbox}
        flyToRequest={mapFlyToRequest}
        officialMapLayer={officialMapLayer}
        officialMapAlignHandler={alignMapHandler}
        addTrailMode={addTrailMode}
        staged={staged}
        osmWays={osmWays}
        onOsmWaySelected={handleOsmWaySelected}
        osmLoading={osmLoading}
        osmError={osmError}
        stravaSegments={stravaSegments}
        onStravaSegmentSelected={handleStravaSegmentSelected}
        stravaLoading={stravaLoading}
        stravaError={stravaError}
        showStravaTab={!!user}
        gpxActiveRideId={gpxActiveRideId}
        onSetGpxActiveRide={setGpxActiveRideId}
        onAddTrimSegment={handleAddTrimSegment}
        onStepTrimPoint={handleStepTrimPoint}
        onClearTrimPoint={handleClearTrimPoint}
        canUploadGpx={!!user}
        onRidesUploaded={handleRidesUploaded}
        onOpenViewTrail={handleOpenViewTrail}
        onViewChange={handleViewChange}
        initialCenter={
          initialParams?.lat != null && initialParams?.lng != null
            ? [initialParams.lat, initialParams.lng]
            : undefined
        }
        initialZoom={initialParams?.zoom ?? undefined}
        skipInitialFit={initialParams?.lat != null && initialParams?.lng != null}
        draftImportTrails={draftImportTrails}
        draftImportSelectedIds={draftImportSelectedIds}
        hoveredImportTrailId={hoveredImportTrailId}
        onDraftImportTrailClick={(osmWayId) => {
          importsTabRef.current?.toggleTrailSelection(osmWayId)
        }}
        drawBboxMode={drawBboxMode}
        drawBboxCorners={drawBboxCorners}
        onBboxDrawn={handleBboxDrawn}
      />

      {photoLightboxSrc && (
        <div
          className="fixed inset-0 z-[5005] flex items-center justify-center bg-black/45 p-6 md:p-10"
          role="presentation"
          onClick={handleClosePhotoLightbox}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Full-size photo"
            className="flex max-h-full w-full max-w-[min(96rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl border-2 border-border bg-card shadow-[3px_3px_0_0_var(--foreground)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 justify-end border-b-2 border-border px-3 py-2">
              <button
                type="button"
                onClick={handleClosePhotoLightbox}
                className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                aria-label="Close full image"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
              <div className="flex min-h-[12rem] items-center justify-center">
                <img
                  src={photoLightboxSrc}
                  alt=""
                  className="max-h-[min(85vh,calc(100dvh-8rem))] max-w-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedActivityItem && (
        <ChangeDetailModal
          item={selectedActivityItem}
          trails={trails}
          sessionUser={user}
          onClose={() => setSelectedActivityItem(null)}
          onOpenTrail={(trail) => {
            setSelectedActivityItem(null)
            handleOpenViewTrail(trail)
          }}
        />
      )}

      <AnnouncementModal isOpen={showAnnouncement || showAbout} onClose={showAbout ? handleCloseAbout : handleCloseAnnouncement} content={ANNOUNCEMENT} />
      <ContactModal isOpen={showContact} onClose={handleCloseContact} />
      <CookieModal forceOpen={showCookiePolicy} onClose={handleCloseCookiePolicy} />
    </div>
  )
}
