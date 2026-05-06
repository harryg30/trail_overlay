'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type {
  Ride,
  Trail,
  DraftTrail,
  TrimPoint,
  TrimSegment,
  Network,
  EditMode,
  RidePhoto,
  TrailPhoto,
  OfficialMapLayerPayload,
} from '@/lib/types'
import { imagePixelToLatLng } from '@/lib/map-overlay-transform'
import { DIFFICULTY_LABELS } from '@/lib/trail-constants'
import type { TrailEditTool } from '@/lib/modes/types'
import type { OsmWayFeature } from '@/lib/overpass'
import type { StravaSegmentFeature } from '@/lib/strava-segments'
import type { StagedTrailApi } from '@/hooks/useStagedTrail'
import { FloatingDraggableToolsPanel } from '@/components/map/FloatingDraggableToolsPanel'
import { AddTrailPanel } from '@/components/trail/AddTrailPanel'
import {
  OfficialMapAlignBanner,
  PinPlacementBanner,
  MobileAddPhotoFab,
} from '@/components/map/MapOverlayBanners'
import { resolveMapCursor } from '@/lib/modes/map-cursor'
import { snapToNearestTrailPoint } from '@/lib/geo-utils'
import { nearestPolylineSegment } from '@/lib/geo-edit'
import { snapToNearestWay, routeBetweenPoints, routeThroughPoints } from '@/lib/valhalla-utils'
import { attachVertexInsertHoverCursor } from '@/lib/map-vertex-insert-cursor'
import { createTopLeftToolControl } from '@/lib/map-top-left-tools'
import {
  MAP,
  catalogLineHints,
  drawNetworkNodeDivHtml,
  drawTrailNodeDivHtml,
  drawInsertMidpointDivHtml,
  mapPopupStyles,
  networkCentroidLabelHtml,
  networkPolygonLeafletStyle,
  refineNodeDivHtml,
  rideLineColor,
  snapAnchorPointDivHtml,
  snapMidpointDivHtml,
  trailLineColor,
  trailMidpointLabelHtml,
} from '@/lib/map-theme'
import {
  getBasemapLayerOptions,
  getMapBaseStyle,
  readStoredBasemapStyle,
  writeStoredBasemapStyle,
  type MapBaseStyle,
} from '@/lib/map-basemap'

export interface LeafletMapProps {
  rides: Ride[]
  hiddenRideIds: Set<string>
  trails: Trail[]
  editMode: EditMode
  trimMode: boolean
  trimStart: TrimPoint | null
  trimSegment: TrimSegment | null
  averagedTrimPolyline: [number, number][] | null
  onTrimPointSelected: (rideId: string, index: number) => void
  editTrailMode: boolean
  selectedTrailId: string | null
  onTrailSelected: (trail: Trail) => void
  refineMode: boolean
  refinePolyline: [number, number][] | null
  onPolylineRefined: (polyline: [number, number][]) => void
  networks: Network[]
  hiddenNetworkIds: Set<string>
  drawNetworkMode: boolean
  drawNetworkPoints: [number, number][]
  onNetworkPointAdded: (latlng: [number, number]) => void
  editNetworkMode: boolean
  selectedNetworkId: string | null
  onNetworkSelected: (network: Network) => void
  ridePhotos: Record<string, RidePhoto[]>
  photosVisibleRideIds: Set<string>
  placingPhoto: RidePhoto | null
  placingTrailPhoto: TrailPhoto | null
  onAcceptPhoto: (photoId: string, trailId: string, trailLat: number, trailLon: number) => Promise<void>
  onCancelPlace: () => void
  trailPhotos: TrailPhoto[]
  onAcceptTrailPhoto: (photoId: string, trailId: string, trailLat: number, trailLon: number) => Promise<void>
  onEditModeChange?: (mode: EditMode) => void
  draftTrails: DraftTrail[]
  trailEditTool: TrailEditTool
  onRefinePointRemoved: (index: number) => void
  onRefineInsertAfter: (indexBefore: number, latlng: [number, number]) => void
  onRefineSectionErase?: (fromIndex: number, toIndex: number) => void
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void
  onOpenPhotoLightbox?: (src: string) => void
  flyToRequest?: { seq: number; kind: 'trail' | 'network'; id: string } | null
  officialMapLayer?: OfficialMapLayerPayload | null
  officialMapAlignHandler?: null | ((latlng: [number, number]) => void)
  addTrailMode?: boolean
  staged?: StagedTrailApi
  osmWays?: OsmWayFeature[]
  onOsmWaySelected?: (feature: OsmWayFeature) => void
  osmLoading?: boolean
  osmError?: string | null
  stravaSegments?: StravaSegmentFeature[]
  onStravaSegmentSelected?: (feature: StravaSegmentFeature) => void
  stravaLoading?: boolean
  stravaError?: string | null
  showStravaTab?: boolean
  gpxActiveRideId?: string | null
  onSetGpxActiveRide?: (id: string | null) => void
  onAddTrimSegment?: () => void
  onStepTrimPoint?: (which: 'start' | 'end', delta: number) => void
  onClearTrimPoint?: (which: 'start' | 'end') => void
  /** GPX tab: upload matches drawer /api/upload (session required). */
  canUploadGpx?: boolean
  onRidesUploaded?: (rides: Ride[]) => void
  /** Open trail detail panel in sidebar (non-edit click). */
  onOpenViewTrail?: (trail: Trail) => void
  /** Called on move/zoom with current center + zoom for URL sync. */
  onViewChange?: (lat: number, lng: number, zoom: number) => void
  /** Initial map center for restoring from URL. */
  initialCenter?: [number, number]
  /** Initial zoom level for restoring from URL. */
  initialZoom?: number
  /** When true, skip the one-shot fit-to-trails-bounds on first load (URL already has position). */
  skipInitialFit?: boolean
  /** Draft import trails to show on map when imports tab expanded. */
  draftImportTrails?: any[]
  draftImportSelectedIds?: Set<string>
  hoveredImportTrailId?: string | null
  onDraftImportTrailClick?: (osmWayId: string) => void
  /** OSM import bbox draw mode: drag (or click-click) to define a rectangle. */
  drawBboxMode?: boolean
  drawBboxCorners?: [number, number][]
  onBboxDrawn?: (corners: [[number, number], [number, number]]) => void
}

export default function LeafletMap({
  rides,
  hiddenRideIds,
  trails,
  editMode,
  trimMode,
  trimStart,
  trimSegment,
  averagedTrimPolyline,
  onTrimPointSelected,
  editTrailMode,
  selectedTrailId,
  onTrailSelected,
  refineMode,
  refinePolyline,
  onPolylineRefined,
  networks,
  hiddenNetworkIds,
  drawNetworkMode,
  drawNetworkPoints,
  onNetworkPointAdded,
  editNetworkMode,
  selectedNetworkId,
  onNetworkSelected,
  ridePhotos,
  photosVisibleRideIds,
  placingPhoto,
  placingTrailPhoto,
  onAcceptPhoto,
  onCancelPlace,
  trailPhotos,
  onAcceptTrailPhoto,
  onEditModeChange,
  draftTrails,
  trailEditTool,
  onRefinePointRemoved,
  onRefineInsertAfter,
  onRefineSectionErase,
  onBoundsChange,
  onOpenPhotoLightbox,
  flyToRequest,
  officialMapLayer = null,
  officialMapAlignHandler = null,
  addTrailMode = false,
  staged,
  osmWays = [],
  onOsmWaySelected,
  osmLoading = false,
  osmError = null,
  stravaSegments = [],
  onStravaSegmentSelected,
  stravaLoading = false,
  stravaError = null,
  showStravaTab = false,
  gpxActiveRideId = null,
  onSetGpxActiveRide,
  onAddTrimSegment,
  onStepTrimPoint,
  onClearTrimPoint,
  canUploadGpx = false,
  onRidesUploaded,
  onOpenViewTrail,
  onViewChange,
  initialCenter,
  initialZoom,
  skipInitialFit = false,
  draftImportTrails = [],
  draftImportSelectedIds = new Set(),
  hoveredImportTrailId = null,
  onDraftImportTrailClick,
  drawBboxMode = false,
  drawBboxCorners = [],
  onBboxDrawn,
}: LeafletMapProps) {
  const drawToolActive = addTrailMode && staged?.activeTool === 'draw'
  const osmToolActive = addTrailMode && staged?.activeTool === 'osm'
  const stravaToolActive = addTrailMode && staged?.activeTool === 'strava'
  const mapDrawingSurface = drawToolActive || refineMode || drawNetworkMode

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const basemapLayerRef = useRef<L.TileLayer | null>(null)
  const locateControlRef = useRef<L.Control | null>(null)
  const userLocationLayerRef = useRef<L.LayerGroup | null>(null)
  const ridesLayerRef = useRef<L.LayerGroup | null>(null)
  const trailsLayerRef = useRef<L.LayerGroup | null>(null)
  const draftImportTrailsLayerRef = useRef<L.LayerGroup | null>(null)
  const drawBboxLayerRef = useRef<L.LayerGroup | null>(null)
  const drawBboxPreviewLayerRef = useRef<L.LayerGroup | null>(null)
  const trimLayerRef = useRef<L.LayerGroup | null>(null)
  const selectedTrailLayerRef = useRef<L.LayerGroup | null>(null)
  const refineLayerRef = useRef<L.LayerGroup | null>(null)
  const networksLayerRef = useRef<L.LayerGroup | null>(null)
  const drawNetworkLayerRef = useRef<L.LayerGroup | null>(null)
  const averagedTrimLayerRef = useRef<L.LayerGroup | null>(null)
  const hoverLayerRef = useRef<L.LayerGroup | null>(null)
  const photoMarkersLayerRef = useRef<L.LayerGroup | null>(null)
  const trailPhotoMarkersLayerRef = useRef<L.LayerGroup | null>(null)
  const draftTrailsLayerRef = useRef<L.LayerGroup | null>(null)
  const drawTrailLayerRef = useRef<L.LayerGroup | null>(null)
  const osmLayerRef = useRef<L.LayerGroup | null>(null)
  const stravaLayerRef = useRef<L.LayerGroup | null>(null)

  const [zoom, setZoom] = useState(5)
  const [basemapStyle, setBasemapStyle] = useState<MapBaseStyle>(getMapBaseStyle)
  const basemapStyleRef = useRef(basemapStyle)
  basemapStyleRef.current = basemapStyle
  const LABEL_ZOOM_THRESHOLD = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 14 : 15
  const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number; accuracyM?: number } | null>(null)
  const [snapFirstPoint, setSnapFirstPoint] = useState<[number, number] | null>(null)
  const [snapLoading, setSnapLoading] = useState(false)
  const [snapAnchorPoints, setSnapAnchorPoints] = useState<[number, number][]>([])
  const [snapAnchorIndices, setSnapAnchorIndices] = useState<number[]>([])

  // Mutable refs — updated in component body so click handlers always read current values
  const trimModeRef = useRef(trimMode)
  const editTrailModeRef = useRef(editTrailMode)
  const onTrimPointSelectedRef = useRef(onTrimPointSelected)
  const onTrailSelectedRef = useRef(onTrailSelected)
  const onOpenViewTrailRef = useRef(onOpenViewTrail)
  const onPolylineRefinedRef = useRef(onPolylineRefined)
  const ridesRef = useRef(rides)
  const drawNetworkModeRef = useRef(drawNetworkMode)
  const editNetworkModeRef = useRef(editNetworkMode)
  const onNetworkPointAddedRef = useRef(onNetworkPointAdded)
  const onNetworkSelectedRef = useRef(onNetworkSelected)
  const networksRef = useRef(networks)
  const drawToolActiveRef = useRef(drawToolActive)
  const drawToolTypeRef = useRef(staged?.drawTool ?? 'pencil')
  const stagedRef = useRef(staged)
  const snapLoadingRef = useRef(snapLoading)
  const snapAnchorPointsRef = useRef(snapAnchorPoints)
  const isRecalculatingRef = useRef(false)
  const trailEditToolRef = useRef<TrailEditTool>(trailEditTool)
  const refineModeRef = useRef(refineMode)
  const onRefinePointRemovedRef = useRef(onRefinePointRemoved)
  const onRefineInsertAfterRef = useRef(onRefineInsertAfter)
  const sectionEraseStartRef = useRef<number | null>(null)
  const hasFitBoundsRef = useRef(false)
  const onBoundsChangeRef = useRef(onBoundsChange)
  onBoundsChangeRef.current = onBoundsChange
  const placingPhotoRef = useRef(placingPhoto)
  const placingTrailPhotoRef = useRef(placingTrailPhoto)
  const onAcceptPhotoRef = useRef(onAcceptPhoto)
  const onCancelPlaceRef = useRef(onCancelPlace)
  const trailsRef = useRef(trails)
  placingPhotoRef.current = placingPhoto
  placingTrailPhotoRef.current = placingTrailPhoto
  onAcceptPhotoRef.current = onAcceptPhoto
  onCancelPlaceRef.current = onCancelPlace
  trailsRef.current = trails
  const onAcceptTrailPhotoRef = useRef(onAcceptTrailPhoto)
  onAcceptTrailPhotoRef.current = onAcceptTrailPhoto
  const onOpenPhotoLightboxRef = useRef(onOpenPhotoLightbox)
  onOpenPhotoLightboxRef.current = onOpenPhotoLightbox
  const officialMapLayerRef = useRef(officialMapLayer)
  officialMapLayerRef.current = officialMapLayer
  const officialMapAlignHandlerRef = useRef(officialMapAlignHandler)
  officialMapAlignHandlerRef.current = officialMapAlignHandler
  const onOsmWaySelectedRef = useRef(onOsmWaySelected)
  onOsmWaySelectedRef.current = onOsmWaySelected
  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  const onStravaSegmentSelectedRef = useRef(onStravaSegmentSelected)
  onStravaSegmentSelectedRef.current = onStravaSegmentSelected
  const onBboxDrawnRef = useRef(onBboxDrawn)
  onBboxDrawnRef.current = onBboxDrawn
  trimModeRef.current = trimMode
  editTrailModeRef.current = editTrailMode
  onTrimPointSelectedRef.current = onTrimPointSelected
  onTrailSelectedRef.current = onTrailSelected
  onOpenViewTrailRef.current = onOpenViewTrail
  onPolylineRefinedRef.current = onPolylineRefined
  ridesRef.current = rides
  drawNetworkModeRef.current = drawNetworkMode
  editNetworkModeRef.current = editNetworkMode
  onNetworkPointAddedRef.current = onNetworkPointAdded
  onNetworkSelectedRef.current = onNetworkSelected
  networksRef.current = networks
  drawToolActiveRef.current = drawToolActive
  drawToolTypeRef.current = staged?.drawTool ?? 'pencil'
  stagedRef.current = staged
  snapLoadingRef.current = snapLoading
  trailEditToolRef.current = trailEditTool
  refineModeRef.current = refineMode
  onRefinePointRemovedRef.current = onRefinePointRemoved
  const onRefineSectionEraseRef = useRef(onRefineSectionErase)
  onRefineSectionEraseRef.current = onRefineSectionErase
  onRefineInsertAfterRef.current = onRefineInsertAfter
  snapAnchorPointsRef.current = snapAnchorPoints

  const getResolvedMapCursor = useCallback(
    () =>
      resolveMapCursor({
        editMode,
        editTrailMode,
        refineMode,
        addTrailTool: staged?.activeTool ?? null,
        drawTool: staged?.drawTool ?? 'pencil',
        trailEditTool,
      }),
    [editMode, editTrailMode, refineMode, staged?.activeTool, staged?.drawTool, trailEditTool]
  )
  const getResolvedMapCursorRef = useRef(getResolvedMapCursor)
  getResolvedMapCursorRef.current = getResolvedMapCursor

  /** Classic vs Catalog only changes tile CSS (`data-basemap`); both use the same OSM layer. */
  const applyBasemapStyle = useCallback((next: MapBaseStyle) => {
    const el = containerRef.current
    if (!el) return
    el.dataset.basemap = next
    setBasemapStyle(next)
    writeStoredBasemapStyle(next)
  }, [])

  const applyBasemapStyleRef = useRef(applyBasemapStyle)
  applyBasemapStyleRef.current = applyBasemapStyle

  const installTopLeftToolControls = useCallback((map: L.Map) => {
    return createTopLeftToolControl(map, {
      getCurrentBasemapStyle: () => basemapStyleRef.current,
      applyBasemapStyle: (style) => applyBasemapStyleRef.current(style),
      onLocate: (lat, lon, accuracyM) => {
        setUserLocation({ lat, lon, accuracyM })
        mapRef.current?.flyTo([lat, lon], Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 })
      },
    })
  }, [])

  // Effect 1: map init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const baseStyle = readStoredBasemapStyle() ?? getMapBaseStyle()
    containerRef.current.dataset.basemap = baseStyle
    setBasemapStyle(baseStyle)
    basemapStyleRef.current = baseStyle

    const map = L.map(containerRef.current).setView(
      initialCenter ?? [39.8283, -98.5795],
      initialZoom ?? 5
    )

    // Panes to ensure stable layer ordering (networks always below everything else).
    const networksPane = map.createPane('networksPane')
    networksPane.style.zIndex = '200'

    const basemap = getBasemapLayerOptions(baseStyle)
    basemapLayerRef.current = L.tileLayer(basemap.url, {
      attribution: basemap.attribution,
      maxZoom: basemap.maxZoom,
      ...(basemap.subdomains != null ? { subdomains: basemap.subdomains } : {}),
    }).addTo(map)

    networksLayerRef.current = L.layerGroup().addTo(map)
    ridesLayerRef.current = L.layerGroup().addTo(map)
    trailsLayerRef.current = L.layerGroup().addTo(map)
    draftImportTrailsLayerRef.current = L.layerGroup().addTo(map)
    drawBboxLayerRef.current = L.layerGroup().addTo(map)
    drawBboxPreviewLayerRef.current = L.layerGroup().addTo(map)
    trimLayerRef.current = L.layerGroup().addTo(map)
    averagedTrimLayerRef.current = L.layerGroup().addTo(map)
    hoverLayerRef.current = L.layerGroup().addTo(map)
    photoMarkersLayerRef.current = L.layerGroup().addTo(map)
    trailPhotoMarkersLayerRef.current = L.layerGroup().addTo(map)
    userLocationLayerRef.current = L.layerGroup().addTo(map)
    selectedTrailLayerRef.current = L.layerGroup().addTo(map)
    refineLayerRef.current = L.layerGroup().addTo(map)
    drawNetworkLayerRef.current = L.layerGroup().addTo(map)
    draftTrailsLayerRef.current = L.layerGroup().addTo(map)
    drawTrailLayerRef.current = L.layerGroup().addTo(map)
    osmLayerRef.current = L.layerGroup().addTo(map)
    stravaLayerRef.current = L.layerGroup().addTo(map)

    const fireBoundsChange = () => {
      const b = map.getBounds()
      onBoundsChangeRef.current?.({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      })
    }

    const fireViewChange = () => {
      const c = map.getCenter()
      onViewChangeRef.current?.(
        parseFloat(c.lat.toFixed(5)),
        parseFloat(c.lng.toFixed(5)),
        map.getZoom()
      )
    }

    map.on('zoomend', () => { setZoom(map.getZoom()); fireBoundsChange(); fireViewChange() })
    map.on('moveend', () => { fireBoundsChange(); fireViewChange() })
    fireBoundsChange()

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (officialMapAlignHandlerRef.current) {
        officialMapAlignHandlerRef.current([e.latlng.lat, e.latlng.lng])
        return
      }
      if (placingPhotoRef.current) {
        const { lat, lng } = e.latlng
        const snap = snapToNearestTrailPoint(lat, lng, trailsRef.current)
        const photo = placingPhotoRef.current

        if (!snap) {
          const msg =
            trailsRef.current.length === 0
              ? 'Load trails on the map first, then tap on or near a trail line.'
              : 'No trail close to this tap. Zoom in and tap on or near a trail line.'
          const popupContent = document.createElement('div')
          popupContent.style.cssText = mapPopupStyles.columnWide
          const label = document.createElement('p')
          label.style.cssText = mapPopupStyles.label
          label.textContent = msg
          popupContent.appendChild(label)
          const okBtn = document.createElement('button')
          okBtn.textContent = 'OK'
          okBtn.style.cssText = mapPopupStyles.btnPrimaryRideFullWidth
          popupContent.appendChild(okBtn)
          const popup = L.popup({ closeButton: false })
            .setLatLng([lat, lng])
            .setContent(popupContent)
            .openOn(map)
          okBtn.onclick = () => popup.close()
          return
        }

        const pinLat = snap.lat
        const pinLon = snap.lon
        const trailName = snap.trail.name

        const popupContent = document.createElement('div')
        popupContent.style.cssText = mapPopupStyles.column
        if (photo.thumbnailUrl || photo.blobUrl) {
          const img = document.createElement('img')
          img.src = photo.thumbnailUrl || photo.blobUrl
          img.style.cssText = mapPopupStyles.imgThumb
          popupContent.appendChild(img)
        }
        const label = document.createElement('p')
        label.style.cssText = mapPopupStyles.label
        label.textContent = `Pin to trail: ${trailName}`
        popupContent.appendChild(label)
        const btnRow = document.createElement('div')
        btnRow.style.cssText = mapPopupStyles.btnRow
        const acceptBtn = document.createElement('button')
        acceptBtn.textContent = 'Accept'
        acceptBtn.style.cssText = mapPopupStyles.btnPrimaryRide
        const cancelBtn = document.createElement('button')
        cancelBtn.textContent = 'Cancel'
        cancelBtn.style.cssText = mapPopupStyles.btnOutline
        btnRow.appendChild(acceptBtn)
        btnRow.appendChild(cancelBtn)
        popupContent.appendChild(btnRow)

        const popup = L.popup({ closeButton: false })
          .setLatLng([pinLat, pinLon])
          .setContent(popupContent)
          .openOn(map)

        acceptBtn.onclick = () => {
          popup.close()
          onAcceptPhotoRef.current(photo.id, snap.trail.id, pinLat, pinLon)
        }
        cancelBtn.onclick = () => {
          popup.close()
          onCancelPlaceRef.current()
        }
        return
      }
      if (placingTrailPhotoRef.current) {
        const { lat, lng } = e.latlng
        const snap = snapToNearestTrailPoint(lat, lng, trailsRef.current)
        const photo = placingTrailPhotoRef.current

        if (!snap) {
          const msg =
            trailsRef.current.length === 0
              ? 'Load trails on the map first, then tap on or near a trail line.'
              : 'No trail close to this tap. Zoom in and tap on or near a trail line.'
          const popupContent = document.createElement('div')
          popupContent.style.cssText = mapPopupStyles.columnWide
          const label = document.createElement('p')
          label.style.cssText = mapPopupStyles.label
          label.textContent = msg
          popupContent.appendChild(label)
          const okBtn = document.createElement('button')
          okBtn.textContent = 'OK'
          okBtn.style.cssText = mapPopupStyles.btnPrimaryTrailFullWidth
          popupContent.appendChild(okBtn)
          const popup = L.popup({ closeButton: false })
            .setLatLng([lat, lng])
            .setContent(popupContent)
            .openOn(map)
          okBtn.onclick = () => popup.close()
          return
        }

        const pinLat = snap.lat
        const pinLon = snap.lon
        const trailName = snap.trail.name

        const popupContent = document.createElement('div')
        popupContent.style.cssText = mapPopupStyles.column
        if (photo.thumbnailUrl || photo.blobUrl) {
          const img = document.createElement('img')
          img.src = photo.thumbnailUrl || photo.blobUrl
          img.style.cssText = mapPopupStyles.imgThumb
          popupContent.appendChild(img)
        }
        const label = document.createElement('p')
        label.style.cssText = mapPopupStyles.label
        label.textContent = `Pin to trail: ${trailName}`
        popupContent.appendChild(label)
        const btnRow = document.createElement('div')
        btnRow.style.cssText = mapPopupStyles.btnRow
        const acceptBtn = document.createElement('button')
        acceptBtn.textContent = 'Accept'
        acceptBtn.style.cssText = mapPopupStyles.btnPrimaryTrail
        const cancelBtn = document.createElement('button')
        cancelBtn.textContent = 'Cancel'
        cancelBtn.style.cssText = mapPopupStyles.btnOutline
        btnRow.appendChild(acceptBtn)
        btnRow.appendChild(cancelBtn)
        popupContent.appendChild(btnRow)

        const popup = L.popup({ closeButton: false })
          .setLatLng([pinLat, pinLon])
          .setContent(popupContent)
          .openOn(map)

        acceptBtn.onclick = () => {
          popup.close()
          void onAcceptTrailPhotoRef.current(photo.id, snap.trail.id, pinLat, pinLon)
        }
        cancelBtn.onclick = () => {
          popup.close()
          onCancelPlaceRef.current()
        }
        return
      }
      if (drawToolActiveRef.current) {
        if (drawToolTypeRef.current === 'pencil') {
          stagedRef.current?.appendDrawPoint([e.latlng.lat, e.latlng.lng])
        } else if (drawToolTypeRef.current === 'snap') {
          // Snap tool: accumulate snapped points and recalculate route through all waypoints
          const clickLat = e.latlng.lat
          const clickLng = e.latlng.lng

          if (snapLoadingRef.current || isRecalculatingRef.current) return

          setSnapLoading(true)

          snapToNearestWay(clickLat, clickLng, 50)
            .then((result) => {
              if (!result) {
                setSnapLoading(false)
                return
              }

              // Convert [lon, lat] to [lat, lon]
              const snappedPoint: [number, number] = [result.point[1], result.point[0]]

              // Add to anchor points (update state and calculate with updated list)
              const updatedAnchors = [...snapAnchorPointsRef.current, snappedPoint]
              setSnapAnchorPoints(updatedAnchors)

              // Always append the snapped point to draw
              stagedRef.current?.appendDrawPoint(snappedPoint)

              // If we have 2+ points, recalculate full route through all of them
              if (updatedAnchors.length >= 2) {
                isRecalculatingRef.current = true
                routeThroughPoints(updatedAnchors)
                  .then((routeResult) => {
                    if (routeResult && routeResult.polyline && routeResult.polyline.length >= 1) {
                      // Convert polyline from [lon, lat] to [lat, lng]
                      const latLngPolyline = routeResult.polyline.map((point) => [point[1], point[0]] as [number, number])
                      stagedRef.current?.recalculateDrawSegment(latLngPolyline)
                      setSnapLoading(false)
                      isRecalculatingRef.current = false
                    } else {
                      console.error('[snap] Route failed: polyline too short or invalid')
                      setSnapLoading(false)
                      isRecalculatingRef.current = false
                    }
                  })
                  .catch((err) => {
                    console.error('[snap] Route error:', err)
                    setSnapLoading(false)
                    isRecalculatingRef.current = false
                  })
              } else {
                setSnapLoading(false)
              }
            })
            .catch((err) => {
              console.error('[snap] Snap error:', err)
              setSnapLoading(false)
            })
        }
        return
      }
      if (drawNetworkModeRef.current) {
        onNetworkPointAddedRef.current([e.latlng.lat, e.latlng.lng])
      }
    })

    mapRef.current = map

    locateControlRef.current = installTopLeftToolControls(map)

    return () => {
      map.remove()
      mapRef.current = null
      basemapLayerRef.current = null
      locateControlRef.current = null
      ridesLayerRef.current = null
      trailsLayerRef.current = null
      trimLayerRef.current = null
      averagedTrimLayerRef.current = null
      selectedTrailLayerRef.current = null
      refineLayerRef.current = null
      networksLayerRef.current = null
      drawNetworkLayerRef.current = null
      hoverLayerRef.current = null
      photoMarkersLayerRef.current = null
      trailPhotoMarkersLayerRef.current = null
      userLocationLayerRef.current = null
      draftTrailsLayerRef.current = null
      drawTrailLayerRef.current = null
      osmLayerRef.current = null
      draftImportTrailsLayerRef.current = null
      drawBboxLayerRef.current = null
      drawBboxPreviewLayerRef.current = null
    }
  }, [])

  // Render "you are here" marker if location is known
  useEffect(() => {
    if (!userLocationLayerRef.current) return
    userLocationLayerRef.current.clearLayers()
    if (!userLocation) return

    const pt: [number, number] = [userLocation.lat, userLocation.lon]

    if (typeof userLocation.accuracyM === 'number' && Number.isFinite(userLocation.accuracyM)) {
      L.circle(pt, {
        radius: userLocation.accuracyM,
        color: MAP.locationAccuracyStroke,
        weight: 1,
        opacity: 0.5,
        fillColor: MAP.locationAccuracyFill,
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(userLocationLayerRef.current)
    }

    L.circleMarker(pt, {
      radius: 7,
      color: MAP.locationDotBorder,
      weight: 2,
      fillColor: MAP.locationDotFill,
      fillOpacity: 1,
      interactive: false,
    }).addTo(userLocationLayerRef.current)

    L.circleMarker(pt, {
      radius: 2,
      color: MAP.white,
      weight: 0,
      fillColor: MAP.white,
      fillOpacity: 1,
      interactive: false,
    }).addTo(userLocationLayerRef.current)
  }, [userLocation])

  // Effect 2: initial fit-to-bounds — fires once when trails first load (skipped when URL provides position)
  useEffect(() => {
    if (!mapRef.current || hasFitBoundsRef.current || trails.length === 0) return
    hasFitBoundsRef.current = true
    if (skipInitialFit) return
    const allPoints = trails.flatMap((t) => t.polyline)
    if (allPoints.length === 0) return
    const bounds = L.latLngBounds(allPoints)
    mapRef.current.flyToBounds(bounds, { padding: [40, 40], maxZoom: 15, duration: 1.2 })
  }, [trails]) // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 3: rides layer
  useEffect(() => {
    if (!mapRef.current || !ridesLayerRef.current) return

    ridesLayerRef.current.clearLayers()

    if (rides.length === 0) return

    rides.filter((r) => !hiddenRideIds.has(r.id)).forEach((ride) => {
      const ridePopupContent = `<strong>${ride.name}</strong><br/>${(ride.distance / 1000).toFixed(1)} km`

      const rideHitInteractive =
        trimMode || (!mapDrawingSurface && !placingPhoto && !placingTrailPhoto)
      const rc = rideLineColor(MAP)

      // Visible line — not interactive so the wide hit area beneath handles all events
      L.polyline(ride.polyline, {
        color: rc,
        weight: 3,
        dashArray: '8, 6',
        opacity: 0.85,
        interactive: false,
        ...catalogLineHints,
      }).addTo(ridesLayerRef.current!)

      // Wide invisible hit area — much easier to click than the 3px line
      const hitArea = L.polyline(ride.polyline, {
        color: rc,
        weight: 20,
        opacity: 0,
        interactive: rideHitInteractive,
        ...catalogLineHints,
      })

      const findClosestIdx = (latlng: L.LatLng) => {
        let minDist = Infinity
        let closestIdx = 0
        ride.polyline.forEach(([lat, lng], i) => {
          const d = latlng.distanceTo(L.latLng(lat, lng))
          if (d < minDist) { minDist = d; closestIdx = i }
        })
        return closestIdx
      }

      hitArea.on('mousemove', (e: L.LeafletMouseEvent) => {
        if (!trimModeRef.current) return
        const snapPt = ride.polyline[findClosestIdx(e.latlng)]
        hoverLayerRef.current?.clearLayers()
        L.circleMarker(snapPt, {
          radius: 7,
          color: MAP.foreground,
          fillColor: MAP.card,
          fillOpacity: 1,
          weight: 2,
          interactive: false,
        }).addTo(hoverLayerRef.current!)
      })

      hitArea.on('mouseout', () => {
        if (trimModeRef.current) hoverLayerRef.current?.clearLayers()
      })

      hitArea.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        if (trimModeRef.current) {
          hoverLayerRef.current?.clearLayers()
          onTrimPointSelectedRef.current(ride.id, findClosestIdx(e.latlng))
          return
        }
        if (drawToolActiveRef.current || refineModeRef.current) return
        if (editTrailModeRef.current) return
        L.popup().setLatLng(e.latlng).setContent(ridePopupContent).openOn(mapRef.current!)
      })

      hitArea.addTo(ridesLayerRef.current!)
    })

    const allPoints = rides.filter((r) => !hiddenRideIds.has(r.id)).flatMap((r) => r.polyline)
    if (allPoints.length > 0 && !trimModeRef.current && !editTrailModeRef.current) {
      mapRef.current.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] })
    }
  }, [rides, hiddenRideIds, trimMode, mapDrawingSurface, placingPhoto, placingTrailPhoto])

  // Effect 4: trails layer
  useEffect(() => {
    if (!mapRef.current || !trailsLayerRef.current) return

    trailsLayerRef.current.clearLayers()

    trails.forEach((trail) => {
      const difficultyLabel = DIFFICULTY_LABELS[trail.difficulty] ?? ''
      const trailPopupContent = `<strong>${trail.name}</strong><br/>${difficultyLabel ? difficultyLabel + ' · ' : ''}${trail.distanceKm.toFixed(1)} km`

      const clickHandler = (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        if (editTrailModeRef.current) {
          onTrailSelectedRef.current(trail)
          return
        }
        if (trimModeRef.current) return
        if (onOpenViewTrailRef.current) {
          onOpenViewTrailRef.current(trail)
        } else {
          L.popup().setLatLng(e.latlng).setContent(trailPopupContent).openOn(mapRef.current!)
        }
      }

      const trailColor = trailLineColor(trail.difficulty, MAP)

      const normalWeight = trail.difficulty === 'pro' ? 4 : 3
      const hoverWeight = trail.difficulty === 'pro' ? 7 : 6

      const showHoverMarkers = () => {
        const start = trail.polyline[0]
        const end = trail.polyline[trail.polyline.length - 1]
        hoverLayerRef.current?.clearLayers()
        L.circleMarker(start, { radius: 6, color: MAP.foreground, weight: 2, fillColor: trailColor, fillOpacity: 1, interactive: false })
          .addTo(hoverLayerRef.current!)
        L.circleMarker(end, { radius: 6, color: MAP.foreground, weight: 2, fillColor: trailColor, fillOpacity: 1, interactive: false })
          .addTo(hoverLayerRef.current!)
      }

      const pl = L.polyline(trail.polyline, {
        color: trailColor,
        weight: normalWeight,
        opacity: 0.9,
        interactive: false,
        ...catalogLineHints,
      })
      pl.addTo(trailsLayerRef.current!)

      const trailHitInteractive =
        !trimMode &&
        (editTrailMode || !mapDrawingSurface) &&
        !placingPhoto &&
        !placingTrailPhoto

      // Wide invisible hit area handles all mouse events for this trail
      // Non-interactive in trim mode so clicks fall through to ride lines beneath
      const hitArea = L.polyline(trail.polyline, {
        color: trailColor,
        weight: 20,
        opacity: 0,
        interactive: trailHitInteractive,
        ...catalogLineHints,
      })
      hitArea.on('click', clickHandler)
      hitArea.on('mouseover', () => { pl.setStyle({ weight: hoverWeight, opacity: 1 }); showHoverMarkers() })
      hitArea.on('mouseout', () => { pl.setStyle({ weight: normalWeight, opacity: 0.9 }); hoverLayerRef.current?.clearLayers() })
      hitArea.addTo(trailsLayerRef.current!)

      // Permanent label at midpoint, rotated to follow the trail (only when zoomed in)
      if (zoom >= LABEL_ZOOM_THRESHOLD) {
        const midIdx = Math.floor(trail.polyline.length / 2)
        const midPoint = trail.polyline[midIdx]
        const p1 = trail.polyline[Math.max(0, midIdx - 5)]
        const p2 = trail.polyline[Math.min(trail.polyline.length - 1, midIdx + 5)]
        const dy = -(p2[0] - p1[0])
        const dx = p2[1] - p1[1]
        let labelAngle = Math.atan2(dy, dx) * 180 / Math.PI
        if (labelAngle > 90) labelAngle -= 180
        if (labelAngle < -90) labelAngle += 180
        const diffIcon =
          trail.difficulty === 'easy' ? '●' :
          trail.difficulty === 'intermediate' ? '■' :
          trail.difficulty === 'hard' ? '◆' :
          trail.difficulty === 'pro' ? '◆◆' : ''
        const labelHtml = trailMidpointLabelHtml(
          {
            trailColor,
            diffIcon,
            name: trail.name,
            labelAngle,
          },
          MAP
        )
        L.marker(midPoint, {
          icon: L.divIcon({ html: labelHtml, className: '', iconSize: [0, 0], iconAnchor: [0, 0] }),
          interactive: false,
          keyboard: false,
        }).addTo(trailsLayerRef.current!)
      }
    })
  }, [trails, editTrailMode, trimMode, zoom, mapDrawingSurface, placingPhoto, placingTrailPhoto])

  // Effect: Draft import trails layer (shown when imports tab is open)
  useEffect(() => {
    if (!mapRef.current || !draftImportTrailsLayerRef.current) return

    draftImportTrailsLayerRef.current.clearLayers()

    if (draftImportTrails.length === 0) return

    // Render hovered trail last so it stacks on top of all others.
    const sortedTrails = [...draftImportTrails].sort((a, b) => {
      if (a.osmWayId === hoveredImportTrailId) return 1
      if (b.osmWayId === hoveredImportTrailId) return -1
      return 0
    })

    sortedTrails.forEach((trail) => {
      if (!trail.polyline || trail.polyline.length < 2) return

      const isSelected = draftImportSelectedIds.has(trail.osmWayId)
      const isHovered = trail.osmWayId === hoveredImportTrailId
      // Hovered trails get a vivid amber so they stand out from selected (green) and idle (gray).
      const trailColor = isHovered ? '#f59e0b' : isSelected ? '#10b981' : '#6b7280'
      const weight = isHovered ? 6 : isSelected ? 4 : 2
      const opacity = isHovered ? 1 : isSelected ? 1 : 0.6

      // Build tooltip content
      const difficultyLabel = trail.difficulty ? trail.difficulty.replace('_', ' ') : 'not set'
      const distanceStr = trail.distanceKm != null ? `${trail.distanceKm.toFixed(1)} km` : '? km'
      const scoreStr = trail.score != null ? `${trail.score}/100` : '?'
      const tooltipContent = `
        <div style="min-width: 200px;">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${trail.name}</div>
          <div style="font-size: 12px; color: #666; margin-bottom: 2px;">
            <span style="text-transform: capitalize;">${difficultyLabel}</span> ·
            <span style="text-transform: capitalize;">${trail.type || 'mixed'}</span> ·
            ${distanceStr}
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 6px;">
            Quality score: ${scoreStr}
          </div>
          ${trail.reasoning ? `<div style="font-size: 11px; font-style: italic; color: #888; margin-top: 4px; border-top: 1px solid #eee; padding-top: 4px;">${trail.reasoning}</div>` : ''}
          <div style="font-size: 11px; color: #999; margin-top: 6px; padding-top: 4px; border-top: 1px solid #eee;">
            ${isSelected ? '✓ Selected' : 'Click to select'}
          </div>
        </div>
      `

      const pl = L.polyline(trail.polyline, {
        color: trailColor,
        weight,
        opacity,
        interactive: false,
        ...catalogLineHints,
      })
      pl.addTo(draftImportTrailsLayerRef.current!)

      // Wide invisible hit area for clicks
      const hitArea = L.polyline(trail.polyline, {
        color: trailColor,
        weight: 20,
        opacity: 0,
        interactive: true,
        ...catalogLineHints,
      })

      hitArea.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        if (onDraftImportTrailClick) {
          onDraftImportTrailClick(trail.osmWayId)
        }
      })

      hitArea.on('mouseover', (e: L.LeafletMouseEvent) => {
        pl.setStyle({ weight: weight + 3, opacity: 1 })
      })

      hitArea.on('mouseout', () => {
        pl.setStyle({ weight, opacity })
      })

      // Bind tooltip that shows on hover
      hitArea.bindTooltip(tooltipContent, {
        sticky: true,
        opacity: 0.95,
        className: 'draft-trail-tooltip',
      })

      hitArea.addTo(draftImportTrailsLayerRef.current!)
    })
  }, [draftImportTrails, draftImportSelectedIds, hoveredImportTrailId, onDraftImportTrailClick])

  // Effect: committed bbox rectangle + draggable corner handles for fine-tuning
  useEffect(() => {
    const layer = drawBboxLayerRef.current
    if (!layer) return
    layer.clearLayers()
    if (drawBboxCorners.length !== 2 || drawBboxMode) return

    const [[south0, west0], [north0, east0]] = drawBboxCorners as [[number, number], [number, number]]
    let curS = south0
    let curN = north0
    let curW = west0
    let curE = east0

    const rect = L.rectangle(L.latLngBounds([curS, curW], [curN, curE]), {
      color: '#10b981',
      weight: 2,
      fillColor: '#10b981',
      fillOpacity: 0.15,
      interactive: false,
    }).addTo(layer)

    const handleIcon = L.divIcon({
      className: 'bbox-resize-handle',
      html: '<div style="width:14px;height:14px;border:2px solid #10b981;background:white;border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,0.3);box-sizing:border-box"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })

    type Kind = 'sw' | 'nw' | 'ne' | 'se'
    const positionFor = (k: Kind): L.LatLngTuple =>
      k === 'sw' ? [curS, curW]
      : k === 'nw' ? [curN, curW]
      : k === 'ne' ? [curN, curE]
      : [curS, curE]

    const handles: { kind: Kind; marker: L.Marker }[] = (['sw', 'nw', 'ne', 'se'] as Kind[]).map((kind) => {
      const marker = L.marker(positionFor(kind), { draggable: true, icon: handleIcon, autoPan: true })
      marker.addTo(layer)
      return { kind, marker }
    })

    const applyDrag = (kind: Kind, ll: L.LatLng) => {
      if (kind === 'sw') { curS = ll.lat; curW = ll.lng }
      else if (kind === 'nw') { curN = ll.lat; curW = ll.lng }
      else if (kind === 'ne') { curN = ll.lat; curE = ll.lng }
      else { curS = ll.lat; curE = ll.lng }
      // Normalize so dragging past the opposite edge still produces a valid rect
      const south = Math.min(curS, curN)
      const north = Math.max(curS, curN)
      const west = Math.min(curW, curE)
      const east = Math.max(curW, curE)
      rect.setBounds(L.latLngBounds([south, west], [north, east]))
      handles.forEach((h) => {
        if (h.kind === kind) return
        const pos =
          h.kind === 'sw' ? [south, west]
          : h.kind === 'nw' ? [north, west]
          : h.kind === 'ne' ? [north, east]
          : [south, east]
        h.marker.setLatLng(pos as L.LatLngTuple)
      })
    }

    handles.forEach(({ kind, marker }) => {
      marker.on('drag', () => applyDrag(kind, marker.getLatLng()))
      marker.on('dragend', () => {
        const south = Math.min(curS, curN)
        const north = Math.max(curS, curN)
        const west = Math.min(curW, curE)
        const east = Math.max(curW, curE)
        curS = south; curN = north; curW = west; curE = east
        onBboxDrawnRef.current?.([
          [south, west],
          [north, east],
        ])
      })
    })
  }, [drawBboxCorners, drawBboxMode])

  // Effect: drag-to-resize bbox with live preview (also supports click-click)
  useEffect(() => {
    const map = mapRef.current
    const previewLayer = drawBboxPreviewLayerRef.current
    if (!map || !previewLayer) return
    if (!drawBboxMode) {
      previewLayer.clearLayers()
      return
    }

    map.dragging.disable()
    map.boxZoom?.disable()

    let firstCorner: L.LatLng | null = null
    let dragStart: L.LatLng | null = null
    let dragMoved = false
    let previewRect: L.Rectangle | null = null

    const renderPreview = (a: L.LatLng, b: L.LatLng) => {
      const bounds = L.latLngBounds(a, b)
      if (previewRect) {
        previewRect.setBounds(bounds)
      } else {
        previewRect = L.rectangle(bounds, {
          color: '#10b981',
          weight: 2,
          dashArray: '6,4',
          fillColor: '#10b981',
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(previewLayer)
      }
    }

    const onDown = (e: L.LeafletMouseEvent) => {
      dragStart = e.latlng
      dragMoved = false
    }

    const onMove = (e: L.LeafletMouseEvent) => {
      const anchor = dragStart ?? firstCorner
      if (!anchor) return
      if (dragStart) {
        const px1 = map.latLngToContainerPoint(dragStart)
        const px2 = map.latLngToContainerPoint(e.latlng)
        if (px1.distanceTo(px2) > 4) dragMoved = true
      }
      renderPreview(anchor, e.latlng)
    }

    const onUp = (e: L.LeafletMouseEvent) => {
      if (!dragStart) return
      const start = dragStart
      dragStart = null

      if (dragMoved) {
        // Finalize via drag
        firstCorner = null
        previewLayer.clearLayers()
        previewRect = null
        onBboxDrawnRef.current?.([
          [start.lat, start.lng],
          [e.latlng.lat, e.latlng.lng],
        ])
        return
      }

      // Click (no meaningful drag)
      if (!firstCorner) {
        firstCorner = start
        // Keep a small marker to anchor the preview while waiting for second click
        previewLayer.clearLayers()
        previewRect = null
        L.circleMarker(start, {
          radius: 5,
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: 1,
          weight: 2,
          interactive: false,
        }).addTo(previewLayer)
      } else {
        const a = firstCorner
        firstCorner = null
        previewLayer.clearLayers()
        previewRect = null
        onBboxDrawnRef.current?.([
          [a.lat, a.lng],
          [e.latlng.lat, e.latlng.lng],
        ])
      }
    }

    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)

    return () => {
      map.off('mousedown', onDown)
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
      map.dragging.enable()
      map.boxZoom?.enable()
      previewLayer.clearLayers()
    }
  }, [drawBboxMode])

  // Map container cursor: mode + trail picker vs geometry + pencil vs eraser
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.getContainer().style.cursor = drawBboxMode ? 'crosshair' : getResolvedMapCursor()
  }, [getResolvedMapCursor, drawBboxMode])

  // Effect 5: start marker (before second point is selected)
  useEffect(() => {
    if (!trimLayerRef.current) return
    if (trimSegment) return // segment preview handles this case

    trimLayerRef.current.clearLayers()

    if (!trimStart) return

    const ride = ridesRef.current.find((r) => r.id === trimStart.rideId)
    if (!ride) return

    L.circleMarker(ride.polyline[trimStart.index], {
      radius: 8,
      color: MAP.foreground,
      fillColor: MAP.primary,
      fillOpacity: 0.95,
      weight: 2,
    })
      .bindTooltip('Start — click to set end point', { permanent: false })
      .addTo(trimLayerRef.current)
  }, [trimStart, trimSegment])

  // Effect 6: segment preview (both points selected)
  useEffect(() => {
    if (!trimLayerRef.current) return
    if (!trimSegment) return

    trimLayerRef.current.clearLayers()

    L.polyline(trimSegment.polyline, {
      color: MAP.primary,
      weight: 6,
      opacity: 0.9,
      ...catalogLineHints,
    }).addTo(trimLayerRef.current)

    L.circleMarker(trimSegment.polyline[0], {
      radius: 8,
      color: MAP.foreground,
      fillColor: MAP.forest,
      fillOpacity: 1,
      weight: 2,
    })
      .bindTooltip('Start')
      .addTo(trimLayerRef.current)

    L.circleMarker(trimSegment.polyline[trimSegment.polyline.length - 1], {
      radius: 8,
      color: MAP.foreground,
      fillColor: MAP.destructive,
      fillOpacity: 1,
      weight: 2,
    })
      .bindTooltip('End')
      .addTo(trimLayerRef.current)
  }, [trimSegment])

  // Effect 6b: averaged trim candidate
  useEffect(() => {
    if (!averagedTrimLayerRef.current) return
    averagedTrimLayerRef.current.clearLayers()
    if (!averagedTrimPolyline || averagedTrimPolyline.length < 2) return

    L.polyline(averagedTrimPolyline, {
      color: MAP.trimAverage,
      weight: 4,
      dashArray: '10, 6',
      opacity: 0.9,
      ...catalogLineHints,
    }).addTo(averagedTrimLayerRef.current)

    for (const pt of averagedTrimPolyline) {
      L.circleMarker(pt, {
        radius: 2,
        color: MAP.trimAverage,
        fillColor: MAP.trimAverage,
        fillOpacity: 1,
        weight: 0,
      }).addTo(averagedTrimLayerRef.current)
    }
  }, [averagedTrimPolyline])

  // Effect 7: refine mode — draggable nodes
  useEffect(() => {
    let cleanupInsertHover: (() => void) | undefined
    if (!refineLayerRef.current || !mapRef.current) return
    refineLayerRef.current.clearLayers()
    if (!refineMode || !refinePolyline || refinePolyline.length < 2) return

    const tool = trailEditTool
    sectionEraseStartRef.current = null

    const insertHitPx = isCoarsePointer ? 48 : 40

    // Working copy mutated during drag
    const pts: [number, number][] = refinePolyline.map(([lat, lng]) => [lat, lng])

    const pl = L.polyline(pts as L.LatLngExpression[], {
      color: MAP.primary,
      weight: 4,
      opacity: 1,
      ...catalogLineHints,
    }).addTo(refineLayerRef.current)

    let refineInsertHitPoly: L.Polyline | null = null

    // Click-on-line to insert a point (pencil mode)
    if (tool === 'pencil' && pts.length >= 2) {
      const hitArea = L.polyline(pts as L.LatLngExpression[], {
        color: MAP.primary,
        weight: insertHitPx,
        opacity: 0,
        interactive: true,
      }).addTo(refineLayerRef.current!)
      refineInsertHitPoly = hitArea
      hitArea.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        const click: [number, number] = [e.latlng.lat, e.latlng.lng]
        const result = nearestPolylineSegment(pts, click)
        if (result) {
          onRefineInsertAfterRef.current(result.indexBefore, result.projectedLatLng)
        }
      })
    }

    const nodeIcon = L.divIcon({
      className: '',
      html: refineNodeDivHtml(10, MAP.primary, MAP),
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    })

    const sectionEraseActiveIcon = L.divIcon({
      className: '',
      html: refineNodeDivHtml(10, MAP.destructive, MAP),
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    })

    pts.forEach((pt, i) => {
      const marker = L.marker(pt as L.LatLngExpression, {
        draggable: tool === 'pencil',
        icon: nodeIcon,
        zIndexOffset: 1000,
      }).addTo(refineLayerRef.current!)

      if (tool === 'pencil') {
        marker.on('drag', () => {
          const { lat, lng } = marker.getLatLng()
          pts[i] = [lat, lng]
          pl.setLatLngs(pts as L.LatLngExpression[])
        })

        marker.on('dragend', () => {
          onPolylineRefinedRef.current([...pts])
        })
      } else if (tool === 'eraser') {
        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onRefinePointRemovedRef.current(i)
        })
      } else if (tool === 'section-eraser') {
        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          const start = sectionEraseStartRef.current
          if (start === null || start === i) {
            sectionEraseStartRef.current = i
            marker.setIcon(sectionEraseActiveIcon)
          } else {
            sectionEraseStartRef.current = null
            onRefineSectionEraseRef.current?.(start, i)
          }
        })
      }
    })

    const insertMidMarkers: L.Marker[] = []
    if (tool === 'pencil' && pts.length >= 2) {
      const midIcon = L.divIcon({
        className: '',
        html: drawInsertMidpointDivHtml(MAP.primary, MAP),
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const marker = L.marker(mid as L.LatLngExpression, {
          icon: midIcon,
          interactive: true,
          zIndexOffset: 1500,
        })
        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onRefineInsertAfterRef.current(i, mid)
        })
        marker.addTo(refineLayerRef.current!)
        insertMidMarkers.push(marker)
      }
      const mapForInsert = mapRef.current
      if (mapForInsert && refineInsertHitPoly) {
        cleanupInsertHover = attachVertexInsertHoverCursor(mapForInsert, [refineInsertHitPoly, ...insertMidMarkers], () =>
          getResolvedMapCursorRef.current()
        )
      }
    }
    return () => {
      cleanupInsertHover?.()
    }
  }, [refineMode, refinePolyline, trailEditTool, isCoarsePointer])

  // Effect 8: networks layer
  useEffect(() => {
    if (!networksLayerRef.current) return
    networksLayerRef.current.clearLayers()

    networks.forEach((network) => {
      if (hiddenNetworkIds.has(network.id)) return
      if (network.polygon.length < 3) return
      const isSelected = network.id === selectedNetworkId
      const interactive =
        !trimMode && !editTrailMode && !placingPhoto && !placingTrailPhoto && !mapDrawingSurface
      const polygon = L.polygon(network.polygon as L.LatLngExpression[], {
        ...networkPolygonLeafletStyle(isSelected, MAP),
        interactive,
        pane: 'networksPane',
      })

      polygon.on('click', (e: L.LeafletMouseEvent) => {
        if (editNetworkModeRef.current) {
          L.DomEvent.stopPropagation(e)
          onNetworkSelectedRef.current(network)
        }
      })

      polygon.addTo(networksLayerRef.current!)

      // Network name label at polygon centroid when zoomed out — click to zoom in
      if (zoom < LABEL_ZOOM_THRESHOLD) {
        const centroidLat = network.polygon.reduce((s, p) => s + p[0], 0) / network.polygon.length
        const centroidLon = network.polygon.reduce((s, p) => s + p[1], 0) / network.polygon.length
        const networkLabelHtml = networkCentroidLabelHtml(network.name, MAP)
        const labelMarker = L.marker([centroidLat, centroidLon], {
          icon: L.divIcon({ html: networkLabelHtml, className: '', iconSize: [0, 0], iconAnchor: [0, 0] }),
          interactive,
          keyboard: false,
          pane: 'networksPane',
        })
        labelMarker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          mapRef.current!.flyToBounds(L.latLngBounds(network.polygon as L.LatLngExpression[]), { padding: [40, 40], duration: 0.8 })
        })
        labelMarker.addTo(networksLayerRef.current!)
      }
    })
  }, [
    networks,
    hiddenNetworkIds,
    selectedNetworkId,
    trimMode,
    editTrailMode,
    placingPhoto,
    placingTrailPhoto,
    zoom,
    mapDrawingSurface,
  ])

  // Effect: draw network polygon preview
  useEffect(() => {
    if (!drawNetworkLayerRef.current) return
    drawNetworkLayerRef.current.clearLayers()
    if (!drawNetworkMode || drawNetworkPoints.length === 0) return

    const nodeIcon = L.divIcon({
      className: '',
      html: drawNetworkNodeDivHtml(10, MAP.primary, MAP),
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    })

    drawNetworkPoints.forEach((pt) => {
      L.marker(pt as L.LatLngExpression, { icon: nodeIcon }).addTo(drawNetworkLayerRef.current!)
    })

    if (drawNetworkPoints.length >= 2) {
      // Preview polyline connecting placed points
      L.polyline(drawNetworkPoints as L.LatLngExpression[], {
        color: MAP.primary,
        weight: 2,
        dashArray: '6, 4',
        opacity: 0.8,
        ...catalogLineHints,
      }).addTo(drawNetworkLayerRef.current!)
    }

    if (drawNetworkPoints.length >= 3) {
      // Closing dash back to first point
      L.polyline([drawNetworkPoints[drawNetworkPoints.length - 1], drawNetworkPoints[0]] as L.LatLngExpression[], {
        color: MAP.primary,
        weight: 1,
        dashArray: '4, 6',
        opacity: 0.5,
        ...catalogLineHints,
      }).addTo(drawNetworkLayerRef.current!)
    }
  }, [drawNetworkMode, drawNetworkPoints])

  // Effect: draft trails — dashed lines, same difficulty colors, not interactive in edit modes
  useEffect(() => {
    if (!draftTrailsLayerRef.current) return
    draftTrailsLayerRef.current.clearLayers()

    draftTrails.forEach((draft) => {
      const trailColor = trailLineColor(draft.difficulty, MAP)

      L.polyline(draft.polyline, {
        color: trailColor,
        weight: 3,
        opacity: 0.65,
        dashArray: '6, 4',
        interactive: false,
        ...catalogLineHints,
      })
        .bindTooltip(`Draft: ${draft.name}`, { sticky: true })
        .addTo(draftTrailsLayerRef.current!)
    })
  }, [draftTrails])

  // Effect: draw trail preview — live polyline + node markers as user plots
  // Unified staged-trail rendering: composite polyline + start/end markers + draw vertex editing
  useEffect(() => {
    let cleanupInsertHover: (() => void) | undefined
    if (!drawTrailLayerRef.current) return
    drawTrailLayerRef.current.clearLayers()
    if (!addTrailMode || !staged) return

    const composite = staged.compositePolyline
    if (composite.length === 0) return

    // Render composite polyline
    if (composite.length >= 2) {
      L.polyline(composite as L.LatLngExpression[], {
        color: MAP.primary,
        weight: 3,
        opacity: 0.85,
        interactive: false,
        ...catalogLineHints,
      }).addTo(drawTrailLayerRef.current!)
    }

    // Gap dashes between non-adjacent segment endpoints
    const segs = staged.segments.filter((s) => s.polyline.length > 0)
    for (let i = 0; i < segs.length - 1; i++) {
      const endA = segs[i].polyline[segs[i].polyline.length - 1]
      const startB = segs[i + 1].polyline[0]
      if (endA[0] !== startB[0] || endA[1] !== startB[1]) {
        L.polyline([endA, startB] as L.LatLngExpression[], {
          color: '#888',
          weight: 2,
          dashArray: '6 4',
          opacity: 0.5,
          interactive: false,
        }).addTo(drawTrailLayerRef.current!)
      }
    }

    // Start marker (green)
    const startPt = composite[0]
    L.circleMarker(startPt as L.LatLngExpression, {
      radius: 6,
      color: '#16a34a',
      fillColor: '#22c55e',
      fillOpacity: 1,
      weight: 2,
      interactive: false,
    }).addTo(drawTrailLayerRef.current!)

    // End marker (red)
    if (composite.length >= 2) {
      const endPt = composite[composite.length - 1]
      L.circleMarker(endPt as L.LatLngExpression, {
        radius: 6,
        color: '#dc2626',
        fillColor: '#ef4444',
        fillOpacity: 1,
        weight: 2,
        interactive: false,
      }).addTo(drawTrailLayerRef.current!)
    }

    // Draw vertex editing (only when draw tool is active)
    const activeDrawSeg = staged.activeDrawSegment
    if (drawToolActive && activeDrawSeg && activeDrawSeg.polyline.length > 0) {
      const tool = staged.drawTool
      const drawPts: [number, number][] = activeDrawSeg.polyline.map(([lat, lng]) => [lat, lng])
      sectionEraseStartRef.current = null

      const insertHitPx = isCoarsePointer ? 48 : 40
      let drawInsertHitPoly: L.Polyline | null = null

      // Click-on-line to insert a point (pencil mode)
      if (tool === 'pencil' && drawPts.length >= 2) {
        const hitArea = L.polyline(drawPts as L.LatLngExpression[], {
          color: MAP.primary,
          weight: insertHitPx,
          opacity: 0,
          interactive: true,
        }).addTo(drawTrailLayerRef.current!)
        drawInsertHitPoly = hitArea
        hitArea.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          const click: [number, number] = [e.latlng.lat, e.latlng.lng]
          const result = nearestPolylineSegment(drawPts, click)
          if (result) {
            staged.insertDrawPointAfter(result.indexBefore, result.projectedLatLng)
          }
        })
      }

      const nodeIcon = L.divIcon({
        className: '',
        html: drawTrailNodeDivHtml(8, MAP.primary, MAP),
        iconSize: [8, 8],
        iconAnchor: [4, 4],
      })

      const anchorPointIcon = L.divIcon({
        className: '',
        html: snapAnchorPointDivHtml(14, MAP),
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      const sectionEraseActiveIcon = L.divIcon({
        className: '',
        html: drawTrailNodeDivHtml(8, MAP.destructive, MAP),
        iconSize: [8, 8],
        iconAnchor: [4, 4],
      })

      // Precompute anchor point lookup set for fast O(1) checking
      const anchorPointsSet = new Set<string>()
      if (tool === 'snap') {
        snapAnchorPointsRef.current.forEach((anchor) => {
          // Use rounded coordinates as key (to 5 decimal places ~ 1m precision)
          const key = `${Math.round(anchor[0] * 1e5)},${Math.round(anchor[1] * 1e5)}`
          anchorPointsSet.add(key)
        })
      }

      drawPts.forEach((pt, i) => {
        // In snap mode, only render markers for anchor points
        const isAnchorPoint =
          tool === 'snap' &&
          anchorPointsSet.has(`${Math.round(pt[0] * 1e5)},${Math.round(pt[1] * 1e5)}`)

        if (tool === 'snap' && !isAnchorPoint) {
          // Skip rendering markers for non-anchor points in snap mode
          return
        }

        const marker = L.marker(pt as L.LatLngExpression, {
          icon: isAnchorPoint ? anchorPointIcon : nodeIcon,
          interactive: true,
          draggable: tool === 'pencil' || tool === 'snap',
          zIndexOffset: 1000,
        })
        if (tool === 'eraser') {
          marker.on('click', (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e)
            staged.removeDrawPoint(i)
          })
        }
        if (tool === 'pencil') {
          marker.on('dragend', () => {
            const { lat, lng } = marker.getLatLng()
            staged.moveDrawPoint(i, [lat, lng])
          })
          marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e)
            e.originalEvent?.preventDefault()
            const canTowardStart = i > 0
            const canTowardEnd = i < drawPts.length - 1
            if (!canTowardStart && !canTowardEnd) return
            const mapInstance = mapRef.current
            if (!mapInstance) return

            const popupContent = document.createElement('div')
            popupContent.style.cssText = mapPopupStyles.column
            const label = document.createElement('p')
            label.style.cssText = mapPopupStyles.label
            label.textContent = 'Remove line on one side of this point'
            popupContent.appendChild(label)

            const btnRow = document.createElement('div')
            btnRow.style.cssText = `${mapPopupStyles.btnRow};flex-direction:column;gap:6px`

            const popup = L.popup({ closeButton: true })

            if (canTowardStart) {
              const btn = document.createElement('button')
              btn.type = 'button'
              btn.textContent = 'Toward trail start'
              btn.style.cssText = `${mapPopupStyles.btnOutline};width:100%;box-sizing:border-box`
              btn.onclick = () => {
                mapInstance.closePopup(popup)
                stagedRef.current?.trimDrawTowardStartAt(i)
              }
              btnRow.appendChild(btn)
            }
            if (canTowardEnd) {
              const btn = document.createElement('button')
              btn.type = 'button'
              btn.textContent = 'Toward trail end'
              btn.style.cssText = `${mapPopupStyles.btnOutline};width:100%;box-sizing:border-box`
              btn.onclick = () => {
                mapInstance.closePopup(popup)
                stagedRef.current?.trimDrawTowardEndAt(i)
              }
              btnRow.appendChild(btn)
            }
            popupContent.appendChild(btnRow)
            popup.setLatLng(marker.getLatLng()).setContent(popupContent).openOn(mapInstance)
          })
        }
        if (tool === 'snap') {
          marker.on('dragend', async () => {
            if (isRecalculatingRef.current) {
              return
            }

            const { lat, lng } = marker.getLatLng()
            const snapped = await snapToNearestWay(lat, lng, 50)
            if (!snapped) return

            const snappedLatLng: [number, number] = [snapped.point[1], snapped.point[0]]

            // Find the closest anchor point to the dragged position
            const anchors = snapAnchorPointsRef.current
            let matchingAnchorIndex = -1
            let closestDistance = Infinity

            if (anchors.length > 0) {
              for (let j = 0; j < anchors.length; j++) {
                const [aLat, aLng] = anchors[j]
                const latDiff = Math.abs(aLat - lat)
                const lngDiff = Math.abs(aLng - lng)
                const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff)

                // Find closest anchor (within ~300m, which is 0.003 degrees at equator)
                if (distance < closestDistance && distance < 0.003) {
                  closestDistance = distance
                  matchingAnchorIndex = j
                }
              }
            }

            if (matchingAnchorIndex >= 0) {
              // This is an anchor point - recalculate only affected segments
              // Update the anchor point
              const updatedAnchors = [...anchors]
              updatedAnchors[matchingAnchorIndex] = snappedLatLng

              isRecalculatingRef.current = true
              setSnapAnchorPoints(updatedAnchors)

              // Build new polyline by recalculating only affected segments
              // Segment before: (anchor[i-1] → updated anchor[i])
              // Segment after: (updated anchor[i] → anchor[i+1])
              const newPolyline: [number, number][] = []

              for (let segIdx = 0; segIdx < updatedAnchors.length - 1; segIdx++) {
                const fromAnchor = updatedAnchors[segIdx]
                const toAnchor = updatedAnchors[segIdx + 1]

                // Route this segment
                const routeResult = await routeBetweenPoints(
                  fromAnchor[0],
                  fromAnchor[1],
                  toAnchor[0],
                  toAnchor[1]
                )

                if (routeResult && routeResult.polyline && routeResult.polyline.length >= 1) {
                  // Convert from [lon, lat] to [lat, lng]
                  const latLngSegment = routeResult.polyline.map((point) => [point[1], point[0]] as [number, number])

                  if (segIdx === 0) {
                    // First segment - include all points
                    newPolyline.push(...latLngSegment)
                  } else {
                    // Subsequent segments - skip first point to avoid duplication at anchor
                    // But keep the last point which is the endpoint
                    newPolyline.push(...latLngSegment.slice(1))
                  }
                } else {
                  console.error('[snap-drag] Route segment', segIdx, 'failed')
                  isRecalculatingRef.current = false
                  return
                }
              }

              // Ensure the final anchor point is included (may differ slightly from route endpoint due to snapping)
              const finalAnchor = updatedAnchors[updatedAnchors.length - 1]
              if (newPolyline.length > 0) {
                const lastPoint = newPolyline[newPolyline.length - 1]
                const latDiff = Math.abs(lastPoint[0] - finalAnchor[0])
                const lngDiff = Math.abs(lastPoint[1] - finalAnchor[1])
                if (latDiff > 0.00001 || lngDiff > 0.00001) {
                  // Last point differs from final anchor - replace it to ensure accuracy
                  newPolyline[newPolyline.length - 1] = finalAnchor
                }
              }

              stagedRef.current?.recalculateDrawSegment(newPolyline)
              isRecalculatingRef.current = false
            } else {
              // Not an anchor point - just move it in place
              staged.moveDrawPoint(i, snappedLatLng)
            }
          })
        }
        if (tool === 'section-eraser') {
          marker.on('click', (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e)
            const start = sectionEraseStartRef.current
            if (start === null || start === i) {
              sectionEraseStartRef.current = i
              marker.setIcon(sectionEraseActiveIcon)
            } else {
              sectionEraseStartRef.current = null
              staged.eraseDrawSection(start, i)
            }
          })
        }
        marker.addTo(drawTrailLayerRef.current!)
      })

      // Render draggable midpoints between anchor points in snap mode
      if (tool === 'snap' && snapAnchorPointsRef.current.length >= 2) {
        const midpointIcon = L.divIcon({
          className: '',
          html: snapMidpointDivHtml(10, MAP),
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        })

        const anchors = snapAnchorPointsRef.current
        // Find indices of each anchor point in the polyline
        const anchorIndicesInPolyline: number[] = []
        for (const anchor of anchors) {
          for (let j = 0; j < drawPts.length; j++) {
            const [lat, lng] = drawPts[j]
            const [aLat, aLng] = anchor
            if (Math.abs(lat - aLat) < 0.00001 && Math.abs(lng - aLng) < 0.00001) {
              anchorIndicesInPolyline.push(j)
              break
            }
          }
        }

        // Create midpoint markers on the polyline between consecutive anchors
        for (let i = 0; i < anchorIndicesInPolyline.length - 1; i++) {
          const startIdx = anchorIndicesInPolyline[i]
          const endIdx = anchorIndicesInPolyline[i + 1]

          if (startIdx >= 0 && endIdx > startIdx) {
            const segmentLength = endIdx - startIdx
            const midIdx = Math.floor(startIdx + segmentLength / 2)
            const mid = drawPts[midIdx]

            const marker = L.marker(mid as L.LatLngExpression, {
              icon: midpointIcon,
              interactive: true,
              draggable: true,
              zIndexOffset: 1200,
            })

            marker.on('dragend', async () => {
              if (isRecalculatingRef.current) {
                console.log('[snap-midpoint-drag] Already recalculating, skipping')
                return
              }

              const { lat, lng } = marker.getLatLng()
              const snapped = await snapToNearestWay(lat, lng, 50)
              if (!snapped) {
                console.log('[snap-midpoint-drag] Snap failed, reverting')
                return
              }

              const snappedLatLng: [number, number] = [snapped.point[1], snapped.point[0]]
              console.log('[snap-midpoint-drag] Snapped midpoint between anchor', i, 'and', i + 1, 'to', snappedLatLng)

              // Insert the new anchor point between anchors[i] and anchors[i+1]
              const updatedAnchors = [...anchors]
              updatedAnchors.splice(i + 1, 0, snappedLatLng)

              isRecalculatingRef.current = true
              setSnapAnchorPoints(updatedAnchors)

              // Recalculate route through all anchors
              const routeResult = await routeThroughPoints(updatedAnchors)
              if (routeResult && routeResult.polyline && routeResult.polyline.length >= 1) {
                console.log('[snap-midpoint-drag] Route recalculated with', updatedAnchors.length, 'anchors')
                const latLngPolyline = routeResult.polyline.map((point) => [point[1], point[0]] as [number, number])
                stagedRef.current?.recalculateDrawSegment(latLngPolyline)
              } else {
                console.error('[snap-midpoint-drag] Route recalculation failed')
                // Revert the anchor update
                setSnapAnchorPoints(anchors)
              }
              isRecalculatingRef.current = false
            })

            marker.addTo(drawTrailLayerRef.current!)
          }
        }
      }

      const insertMidMarkers: L.Marker[] = []
      if (tool === 'pencil' && drawPts.length >= 2) {
        const midIcon = L.divIcon({
          className: '',
          html: drawInsertMidpointDivHtml(MAP.primary, MAP),
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        })
        for (let i = 0; i < drawPts.length - 1; i++) {
          const a = drawPts[i]
          const b = drawPts[i + 1]
          const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          const marker = L.marker(mid as L.LatLngExpression, { icon: midIcon, interactive: true, zIndexOffset: 1500 })
          marker.on('click', (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e)
            staged.insertDrawPointAfter(i, mid)
          })
          marker.addTo(drawTrailLayerRef.current!)
          insertMidMarkers.push(marker)
        }
        const mapForInsert = mapRef.current
        if (mapForInsert && drawInsertHitPoly) {
          cleanupInsertHover = attachVertexInsertHoverCursor(mapForInsert, [drawInsertHitPoly, ...insertMidMarkers], () =>
            getResolvedMapCursorRef.current()
          )
        }
      }
    }
    return () => {
      cleanupInsertHover?.()
    }
  }, [addTrailMode, staged?.compositePolyline, staged?.segments, staged?.activeDrawSegment, staged?.drawTool, drawToolActive, isCoarsePointer]) // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 9: selected trail highlight
  useEffect(() => {
    if (!selectedTrailLayerRef.current) return

    selectedTrailLayerRef.current.clearLayers()

    if (!selectedTrailId) return

    const trail = trails.find((t) => t.id === selectedTrailId)
    if (!trail) return

    L.polyline(trail.polyline, {
      color: MAP.primary,
      weight: 6,
      opacity: 0.85,
      ...catalogLineHints,
    }).addTo(selectedTrailLayerRef.current)

    mapRef.current?.flyToBounds(L.latLngBounds(trail.polyline), { padding: [60, 60], duration: 0.6 })
  }, [selectedTrailId, trails])

  // Imperative fly from drawer / list (independent of selection)
  useEffect(() => {
    if (!mapRef.current || !flyToRequest) return
    const { kind, id } = flyToRequest
    if (kind === 'trail') {
      const trail = trails.find((t) => t.id === id)
      if (!trail?.polyline?.length) return
      mapRef.current.flyToBounds(L.latLngBounds(trail.polyline), {
        padding: [60, 60],
        maxZoom: 15,
        duration: 0.8,
      })
      return
    }
    const network = networks.find((n) => n.id === id)
    if (!network) return
    if (network.polygon.length >= 3) {
      mapRef.current.flyToBounds(L.latLngBounds(network.polygon as L.LatLngExpression[]), {
        padding: [40, 40],
        maxZoom: 15,
        duration: 0.8,
      })
      return
    }
    const trailPts = trails.filter((t) => network.trailIds.includes(t.id)).flatMap((t) => t.polyline)
    if (trailPts.length === 0) return
    mapRef.current.flyToBounds(L.latLngBounds(trailPts), { padding: [40, 40], maxZoom: 15, duration: 0.8 })
  }, [flyToRequest, trails, networks])

  // Effect 10: photo markers
  useEffect(() => {
    if (!photoMarkersLayerRef.current) return

    photoMarkersLayerRef.current.clearLayers()
    for (const [rideId, photos] of Object.entries(ridePhotos)) {
      if (!photosVisibleRideIds.has(rideId)) continue

      for (const photo of photos) {
        // Accepted photos render at their snapped trail position
        const displayLat = photo.accepted && photo.trailLat != null ? photo.trailLat : photo.lat
        const displayLon = photo.accepted && photo.trailLon != null ? photo.trailLon : photo.lon

        if (displayLat == null || displayLon == null) continue

        const thumbSrc = photo.thumbnailUrl || photo.blobUrl
        const ridePhotoBorder = photo.accepted ? MAP.primary : MAP.foreground
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:36px;height:36px;border-radius:4px;border:2px solid ${ridePhotoBorder};box-shadow:0 1px 4px rgba(0,0,0,.4);overflow:hidden;background:${MAP.mud}">
            <img src="${thumbSrc}" style="width:100%;height:100%;object-fit:cover" />
          </div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        })

        const marker = L.marker([displayLat, displayLon], { icon })

        if (!photo.accepted) {
          const popupContent = document.createElement('div')
          popupContent.style.cssText = mapPopupStyles.column
          const img = document.createElement('img')
          img.src = thumbSrc
          img.style.cssText = mapPopupStyles.imgThumb
          popupContent.appendChild(img)
          const viewBtnUnaccepted = document.createElement('button')
          viewBtnUnaccepted.type = 'button'
          viewBtnUnaccepted.textContent = 'View full size'
          viewBtnUnaccepted.style.cssText = `${mapPopupStyles.btnOutline};width:100%;box-sizing:border-box`
          viewBtnUnaccepted.onclick = () => {
            onOpenPhotoLightboxRef.current?.(photo.blobUrl)
            marker.closePopup()
          }
          popupContent.appendChild(viewBtnUnaccepted)
          const btnRow = document.createElement('div')
          btnRow.style.cssText = mapPopupStyles.btnRow
          const acceptBtn = document.createElement('button')
          acceptBtn.textContent = 'Accept — pin to trail'
          acceptBtn.style.cssText = mapPopupStyles.btnPrimaryRide
          const dismissBtn = document.createElement('button')
          dismissBtn.textContent = 'Dismiss'
          dismissBtn.style.cssText = mapPopupStyles.btnOutline
          btnRow.appendChild(acceptBtn)
          btnRow.appendChild(dismissBtn)
          popupContent.appendChild(btnRow)
          marker.bindPopup(popupContent)

          acceptBtn.onclick = () => {
            marker.closePopup()
            const snap = snapToNearestTrailPoint(displayLat, displayLon, trailsRef.current)
            if (snap) {
              onAcceptPhotoRef.current(photo.id, snap.trail.id, snap.lat, snap.lon)
            } else {
              // No trail nearby: accept at current GPS position without trail association
              onAcceptPhotoRef.current(photo.id, '', displayLat, displayLon)
            }
          }
          dismissBtn.onclick = () => marker.closePopup()
        } else {
          const popupContent = document.createElement('div')
          popupContent.style.cssText = mapPopupStyles.column
          const img = document.createElement('img')
          img.src = thumbSrc
          img.alt = ''
          img.style.cssText = mapPopupStyles.imgThumb
          popupContent.appendChild(img)
          const label = document.createElement('p')
          label.style.cssText = mapPopupStyles.label
          label.textContent = 'Ride photo'
          popupContent.appendChild(label)
          const viewBtnAccepted = document.createElement('button')
          viewBtnAccepted.type = 'button'
          viewBtnAccepted.textContent = 'View full size'
          viewBtnAccepted.style.cssText = `${mapPopupStyles.btnOutline};width:100%;box-sizing:border-box`
          viewBtnAccepted.onclick = () => {
            onOpenPhotoLightboxRef.current?.(photo.blobUrl)
            marker.closePopup()
          }
          popupContent.appendChild(viewBtnAccepted)
          marker.bindPopup(popupContent)
        }

        marker.addTo(photoMarkersLayerRef.current!)
      }
    }
  }, [ridePhotos, photosVisibleRideIds])

  // Effect 10b: public trail photo pins
  useEffect(() => {
    if (!trailPhotoMarkersLayerRef.current || !mapRef.current) return
    trailPhotoMarkersLayerRef.current.clearLayers()

    for (const photo of trailPhotos) {
      const displayLat = photo.accepted && photo.trailLat != null ? photo.trailLat : photo.lat
      const displayLon = photo.accepted && photo.trailLon != null ? photo.trailLon : photo.lon
      if (displayLat == null || displayLon == null) continue

      const thumbSrc = photo.thumbnailUrl || photo.blobUrl
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:38px;height:38px;border-radius:6px;border:2px solid ${MAP.forest};box-shadow:0 1px 4px rgba(0,0,0,.35);overflow:hidden;background:${MAP.mud}">
          <img src="${thumbSrc}" style="width:100%;height:100%;object-fit:cover" />
        </div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      })

      const marker = L.marker([displayLat, displayLon], { icon })

      if (!photo.accepted) {
        const popupContent = document.createElement('div')
        popupContent.style.cssText = mapPopupStyles.column
        const img = document.createElement('img')
        img.src = thumbSrc
        img.style.cssText = mapPopupStyles.imgThumb
        popupContent.appendChild(img)

        const label = document.createElement('p')
        label.style.cssText = mapPopupStyles.label
        label.textContent = photo.isLocal
          ? 'Pin to trail (demo — sign in with Strava to save for everyone)'
          : 'Accept — snap to nearest trail'
        popupContent.appendChild(label)

        const viewTrailUnaccepted = document.createElement('button')
        viewTrailUnaccepted.type = 'button'
        viewTrailUnaccepted.textContent = 'View full size'
        viewTrailUnaccepted.style.cssText = `${mapPopupStyles.btnOutline};width:100%;box-sizing:border-box`
        viewTrailUnaccepted.onclick = () => {
          onOpenPhotoLightboxRef.current?.(photo.blobUrl)
          marker.closePopup()
        }
        popupContent.appendChild(viewTrailUnaccepted)

        const btnRow = document.createElement('div')
        btnRow.style.cssText = mapPopupStyles.btnRow
        const acceptBtn = document.createElement('button')
        acceptBtn.textContent = 'Accept'
        acceptBtn.style.cssText = mapPopupStyles.btnPrimaryTrail
        const dismissBtn = document.createElement('button')
        dismissBtn.textContent = 'Dismiss'
        dismissBtn.style.cssText = mapPopupStyles.btnOutline
        btnRow.appendChild(acceptBtn)
        btnRow.appendChild(dismissBtn)
        popupContent.appendChild(btnRow)

        marker.bindPopup(popupContent)

        acceptBtn.onclick = () => {
          marker.closePopup()
          const snap = snapToNearestTrailPoint(displayLat, displayLon, trailsRef.current)
          if (snap) {
            void onAcceptTrailPhotoRef.current(photo.id, snap.trail.id, snap.lat, snap.lon)
          }
        }
        dismissBtn.onclick = () => marker.closePopup()
      } else {
        const popupContent = document.createElement('div')
        popupContent.style.cssText = mapPopupStyles.column
        const img = document.createElement('img')
        img.src = thumbSrc
        img.alt = ''
        img.style.cssText = mapPopupStyles.imgThumb
        popupContent.appendChild(img)
        const label = document.createElement('p')
        label.style.cssText = mapPopupStyles.label
        label.textContent = photo.isLocal
          ? 'Demo preview — sign in to share this pin with everyone.'
          : 'Pinned to trail'
        popupContent.appendChild(label)
        const viewTrailAccepted = document.createElement('button')
        viewTrailAccepted.type = 'button'
        viewTrailAccepted.textContent = 'View full size'
        viewTrailAccepted.style.cssText = `${mapPopupStyles.btnOutline};width:100%;box-sizing:border-box`
        viewTrailAccepted.onclick = () => {
          onOpenPhotoLightboxRef.current?.(photo.blobUrl)
          marker.closePopup()
        }
        popupContent.appendChild(viewTrailAccepted)
        marker.bindPopup(popupContent)
      }
      marker.addTo(trailPhotoMarkersLayerRef.current)
    }
  }, [trailPhotos])

  const officialMapDomRef = useRef<{ holder: HTMLDivElement; img: HTMLImageElement } | null>(null)

  useEffect(() => {
    const map = mapRef.current
    const layer = officialMapLayer

    const teardownDom = () => {
      if (officialMapDomRef.current) {
        officialMapDomRef.current.holder.remove()
        officialMapDomRef.current = null
      }
    }

    if (!map || !layer?.visible || !layer.transform) {
      teardownDom()
      return
    }

    const container = map.getContainer()
    let pair = officialMapDomRef.current
    if (!pair || !pair.holder.isConnected) {
      teardownDom()
      const holder = document.createElement('div')
      holder.style.cssText =
        'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:380;overflow:hidden'
      container.appendChild(holder)
      const img = document.createElement('img')
      img.draggable = false
      img.alt = ''
      img.style.position = 'absolute'
      img.style.left = '0'
      img.style.top = '0'
      img.style.transformOrigin = '0 0'
      holder.appendChild(img)
      pair = { holder, img }
      officialMapDomRef.current = pair
    }

    const { img } = pair
    img.src = layer.blobUrl

    const update = () => {
      const m = mapRef.current
      const lay = officialMapLayerRef.current
      const dom = officialMapDomRef.current
      if (!m || !lay?.visible || !lay.transform || !dom) return
      const t = lay.transform
      const w = t.imageWidth
      const h = t.imageHeight
      const im = dom.img
      const ll00 = imagePixelToLatLng(0, 0, t.p1Img, t.p1Ll, t.p2Img, t.p2Ll)
      const llw0 = imagePixelToLatLng(w, 0, t.p1Img, t.p1Ll, t.p2Img, t.p2Ll)
      const ll0h = imagePixelToLatLng(0, h, t.p1Img, t.p1Ll, t.p2Img, t.p2Ll)
      const p00 = m.latLngToContainerPoint(L.latLng(ll00.lat, ll00.lon))
      const pW0 = m.latLngToContainerPoint(L.latLng(llw0.lat, llw0.lon))
      const p0H = m.latLngToContainerPoint(L.latLng(ll0h.lat, ll0h.lon))
      const a = (pW0.x - p00.x) / w
      const c = (p0H.x - p00.x) / h
      const e = p00.x
      const b = (pW0.y - p00.y) / w
      const d = (p0H.y - p00.y) / h
      const f = p00.y
      im.style.width = `${w}px`
      im.style.height = `${h}px`
      im.style.opacity = String(lay.opacity)
      im.style.transform = `matrix(${a},${b},${c},${d},${e},${f})`
    }

    const onLoad = () => {
      update()
    }
    img.addEventListener('load', onLoad)
    map.on('zoom move zoomend moveend', update)
    update()

    return () => {
      img.removeEventListener('load', onLoad)
      map.off('zoom move zoomend moveend', update)
      teardownDom()
    }
  }, [officialMapLayer])

  // OSM way layer — visible when OSM tool is active
  useEffect(() => {
    if (!osmLayerRef.current) return
    osmLayerRef.current.clearLayers()
    if (!osmToolActive || osmWays.length === 0) return

    const osmColor = '#0ea5e9'
    const osmColorSelected = MAP.primary
    const osmHoverColor = '#facc15'

    for (const way of osmWays) {
      const isSelected = staged?.isOsmWaySelected(way.osmId) ?? false
      const color = isSelected ? osmColorSelected : osmColor

      const visibleLine = L.polyline(way.polyline, {
        color,
        weight: isSelected ? 5 : 3,
        opacity: isSelected ? 1 : 0.7,
        ...catalogLineHints,
      }).addTo(osmLayerRef.current!)

      const hitArea = L.polyline(way.polyline, {
        color: 'transparent',
        weight: 20,
        opacity: 0,
        interactive: true,
      }).addTo(osmLayerRef.current!)

      const tooltipLabel = way.name
        ? `${way.name} — ${way.distanceKm.toFixed(2)} km`
        : `${way.highway ?? 'way'} — ${way.distanceKm.toFixed(2)} km`
      hitArea.bindTooltip(tooltipLabel, {
        sticky: true,
        direction: 'top',
        className: 'osm-way-tooltip',
        offset: [0, -8],
      })

      let glowLine: L.Polyline | null = null

      hitArea.on('click', () => {
        onOsmWaySelectedRef.current?.(way)
      })

      hitArea.on('mouseover', () => {
        if (!isSelected) {
          glowLine = L.polyline(way.polyline, {
            color: osmHoverColor,
            weight: 10,
            opacity: 0.3,
            interactive: false,
          }).addTo(osmLayerRef.current!)
          visibleLine.setStyle({ color: osmHoverColor, weight: 5, opacity: 1 })
        }
      })
      hitArea.on('mouseout', () => {
        if (glowLine) {
          glowLine.remove()
          glowLine = null
        }
        visibleLine.setStyle({
          color: isSelected ? osmColorSelected : osmColor,
          weight: isSelected ? 5 : 3,
          opacity: isSelected ? 1 : 0.7,
        })
      })
    }
  }, [osmToolActive, osmWays, staged?.segments]) // eslint-disable-line react-hooks/exhaustive-deps

  // Strava segment layer — visible when Strava tool is active
  useEffect(() => {
    if (!stravaLayerRef.current) return
    stravaLayerRef.current.clearLayers()
    if (!stravaToolActive || stravaSegments.length === 0) return

    const stravaColor = '#FC4C02'
    const stravaColorSelected = MAP.primary
    const stravaHoverColor = '#facc15'

    for (const seg of stravaSegments) {
      const isSelected = staged?.isStravaSegmentSelected(seg.segmentId) ?? false
      const color = isSelected ? stravaColorSelected : stravaColor

      const visibleLine = L.polyline(seg.polyline, {
        color,
        weight: isSelected ? 5 : 3,
        opacity: isSelected ? 1 : 0.7,
        ...catalogLineHints,
      }).addTo(stravaLayerRef.current!)

      const hitArea = L.polyline(seg.polyline, {
        color: 'transparent',
        weight: 20,
        opacity: 0,
        interactive: true,
      }).addTo(stravaLayerRef.current!)

      const distKm = (seg.distance / 1000).toFixed(2)
      const tooltipLabel = `${seg.name} — ${distKm} km · ${seg.avgGrade.toFixed(1)}%`
      hitArea.bindTooltip(tooltipLabel, {
        sticky: true,
        direction: 'top',
        className: 'osm-way-tooltip',
        offset: [0, -8],
      })

      let glowLine: L.Polyline | null = null

      hitArea.on('click', () => {
        onStravaSegmentSelectedRef.current?.(seg)
      })

      hitArea.on('mouseover', () => {
        if (!isSelected) {
          glowLine = L.polyline(seg.polyline, {
            color: stravaHoverColor,
            weight: 10,
            opacity: 0.3,
            interactive: false,
          }).addTo(stravaLayerRef.current!)
          visibleLine.setStyle({ color: stravaHoverColor, weight: 5, opacity: 1 })
        }
      })
      hitArea.on('mouseout', () => {
        if (glowLine) {
          glowLine.remove()
          glowLine = null
        }
        visibleLine.setStyle({
          color: isSelected ? stravaColorSelected : stravaColor,
          weight: isSelected ? 5 : 3,
          opacity: isSelected ? 1 : 0.7,
        })
      })
    }
  }, [stravaToolActive, stravaSegments, staged?.segments]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up snap tool state when exiting draw mode or switching tools
  useEffect(() => {
    if (!drawToolActive || staged?.drawTool !== 'snap') {
      setSnapFirstPoint(null)
      setSnapLoading(false)
      setSnapAnchorPoints([])
      setSnapAnchorIndices([])
      isRecalculatingRef.current = false
    }
  }, [drawToolActive, staged?.drawTool])

  // Clear snap state when trail is cleared
  useEffect(() => {
    if (drawToolActive && staged?.segments.length === 0) {
      setSnapFirstPoint(null)
      setSnapAnchorPoints([])
      setSnapAnchorIndices([])
      isRecalculatingRef.current = false
    }
  }, [drawToolActive, staged?.segments.length])

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
        data-basemap={basemapStyle}
        suppressHydrationWarning
      />
      {officialMapAlignHandler && <OfficialMapAlignBanner />}
      {(placingPhoto || placingTrailPhoto) && (
        <PinPlacementBanner
          placingPhoto={placingPhoto}
          placingTrailPhoto={placingTrailPhoto}
          onCancelPlace={onCancelPlace}
        />
      )}

      {/* Unified add-trail panel (drag handle persists position in localStorage) */}
      {addTrailMode && staged && (
        <FloatingDraggableToolsPanel title="Add trail">
          <AddTrailPanel
            rootClassName="w-full max-w-none rounded-none border-0 shadow-none"
            activeTool={staged.activeTool}
            onSetActiveTool={staged.setActiveTool}
            drawTool={staged.drawTool}
            onSetDrawTool={staged.setDrawTool}
            activeEnd={staged.activeEnd}
            onSetActiveEnd={staged.setActiveEnd}
            canUndo={staged.canUndo}
            canRedo={staged.canRedo}
            onUndo={staged.undo}
            onRedo={staged.redo}
            onClearDraw={staged.clearAll}
            segments={staged.segments}
            onRemoveSegment={staged.removeSegment}
            rides={rides}
            activeRideId={gpxActiveRideId}
            onSetActiveRide={onSetGpxActiveRide ?? (() => {})}
            trimStart={trimStart}
            trimSegment={trimSegment}
            onStepTrimPoint={onStepTrimPoint ?? (() => {})}
            onClearTrimPoint={onClearTrimPoint ?? (() => {})}
            onAddTrimSegment={onAddTrimSegment ?? (() => {})}
            osmLoading={osmLoading}
            osmError={osmError}
            osmWayCount={osmWays.length}
            showStravaTab={showStravaTab}
            stravaLoading={stravaLoading}
            stravaError={stravaError}
            stravaSegmentCount={stravaSegments.length}
            stravaSegments={stravaSegments}
            onStravaSegmentSelected={onStravaSegmentSelected ?? (() => {})}
            isStravaSegmentSelected={staged?.isStravaSegmentSelected ?? (() => false)}
            onCancel={() => onEditModeChange?.(null)}
            canUploadGpx={canUploadGpx}
            onRidesUploaded={onRidesUploaded}
          />
        </FloatingDraggableToolsPanel>
      )}


      {isCoarsePointer && onEditModeChange && (
        <MobileAddPhotoFab editMode={editMode} onEditModeChange={onEditModeChange} />
      )}
    </div>
  )
}
