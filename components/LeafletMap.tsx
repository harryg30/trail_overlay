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
import { resolveMapCursor } from '@/lib/modes/map-cursor'
import { snapToNearestTrailPoint } from '@/lib/geo-utils'
import { nearestPolylineSegment } from '@/lib/geo-edit'
import { snapToNearestWay, routeBetweenPoints } from '@/lib/valhalla-utils'
import { attachVertexInsertHoverCursor } from '@/lib/map-vertex-insert-cursor'
import {
  MAP,
  basemapControlSvg,
  catalogLineHints,
  drawNetworkNodeDivHtml,
  drawTrailNodeDivHtml,
  drawInsertMidpointDivHtml,
  locateControlSvg,
  mapPopupStyles,
  networkCentroidLabelHtml,
  networkPolygonLeafletStyle,
  refineNodeDivHtml,
  rideLineColor,
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
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCamera } from '@fortawesome/free-solid-svg-icons'

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
  const snapFirstPointRef = useRef(snapFirstPoint)
  const snapLoadingRef = useRef(snapLoading)
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
  snapFirstPointRef.current = snapFirstPoint
  snapLoadingRef.current = snapLoading
  trailEditToolRef.current = trailEditTool
  refineModeRef.current = refineMode
  onRefinePointRemovedRef.current = onRefinePointRemoved
  const onRefineSectionEraseRef = useRef(onRefineSectionErase)
  onRefineSectionEraseRef.current = onRefineSectionErase
  onRefineInsertAfterRef.current = onRefineInsertAfter

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

  /** Locate + basemap tools under native zoom; basemap panel lists styles and persists via {@link writeStoredBasemapStyle}. */
  const installTopLeftToolControls = useCallback((map: L.Map) => {
    const ctl = L.Control.extend({
      onAdd(this: L.Control) {
        const p = MAP
        const wrap = L.DomUtil.create('div')
        wrap.style.cssText =
          'margin-top:44px;display:flex;flex-direction:column;align-items:flex-start;gap:4px'

        const locateBtn = L.DomUtil.create('button', '', wrap) as HTMLButtonElement
        locateBtn.type = 'button'
        locateBtn.title = 'Zoom to my location'
        locateBtn.setAttribute('aria-label', 'Zoom to my location')
        locateBtn.style.cssText =
          `width:30px;height:30px;border-radius:4px;background:${p.card};border:2px solid ${p.foreground};` +
          `box-shadow:2px 2px 0 0 ${p.foreground};cursor:pointer;display:flex;align-items:center;justify-content:center`
        locateBtn.innerHTML = locateControlSvg(p)

        const basemapOuter = L.DomUtil.create('div', '', wrap)
        basemapOuter.style.cssText = 'position:relative'

        const basemapToggle = L.DomUtil.create('button', '', basemapOuter) as HTMLButtonElement
        basemapToggle.type = 'button'
        basemapToggle.title = 'Base map style'
        basemapToggle.setAttribute('aria-label', 'Base map style')
        basemapToggle.setAttribute('aria-expanded', 'false')
        basemapToggle.setAttribute('aria-haspopup', 'true')
        basemapToggle.style.cssText =
          `width:30px;height:30px;border-radius:4px;background:${p.card};border:2px solid ${p.foreground};` +
          `box-shadow:2px 2px 0 0 ${p.foreground};cursor:pointer;display:flex;align-items:center;justify-content:center`
        basemapToggle.innerHTML = basemapControlSvg(p)

        const panel = L.DomUtil.create('div', '', basemapOuter) as HTMLDivElement
        panel.setAttribute('role', 'group')
        panel.setAttribute('aria-label', 'Choose base map style')
        panel.style.cssText =
          `display:none;flex-direction:column;gap:6px;position:absolute;top:34px;left:0;z-index:1000;min-width:152px;` +
          `padding:8px;border-radius:4px;background:${p.card};border:2px solid ${p.foreground};box-shadow:2px 2px 0 0 ${p.foreground}`

        const heading = L.DomUtil.create('div', '', panel) as HTMLDivElement
        heading.textContent = 'Base map'
        heading.style.cssText = `font:600 10px/1.2 system-ui,sans-serif;text-transform:uppercase;letter-spacing:0.06em;color:${p.mutedLabel}`

        const row = L.DomUtil.create('div', '', panel) as HTMLDivElement
        row.style.cssText = 'display:flex;gap:4px'

        const classicBtn = L.DomUtil.create('button', '', row) as HTMLButtonElement
        classicBtn.type = 'button'
        classicBtn.textContent = 'Classic'

        const catalogBtn = L.DomUtil.create('button', '', row) as HTMLButtonElement
        catalogBtn.type = 'button'
        catalogBtn.textContent = 'Catalog'

        const btnBase =
          `flex:1;border-radius:4px;border:2px solid ${p.foreground};cursor:pointer;` +
          `font:700 11px/1 system-ui,sans-serif;text-transform:uppercase;letter-spacing:0.04em;padding:6px 6px`

        const applySelection = (style: MapBaseStyle) => {
          const classicSel = style === 'osm'
          classicBtn.style.cssText =
            btnBase +
            `;background:${classicSel ? p.primary : p.mud};color:${classicSel ? p.primaryFg : p.foreground}` +
            (classicSel ? `;box-shadow:1px 1px 0 0 ${p.foreground}` : '')
          catalogBtn.style.cssText =
            btnBase +
            `;background:${!classicSel ? p.primary : p.mud};color:${!classicSel ? p.primaryFg : p.foreground}` +
            (!classicSel ? `;box-shadow:1px 1px 0 0 ${p.foreground}` : '')
        }
        applySelection(basemapStyleRef.current)

        const closePanel = () => {
          panel.style.display = 'none'
          basemapToggle.setAttribute('aria-expanded', 'false')
        }
        const openPanel = () => {
          applySelection(basemapStyleRef.current)
          panel.style.display = 'flex'
          basemapToggle.setAttribute('aria-expanded', 'true')
        }

        const onMapClick = () => {
          closePanel()
        }
        map.on('click', onMapClick)

        // Store for onRemove (Leaflet may use a different `this` context)
        ;(this as unknown as { _trailOnMapClick?: () => void })._trailOnMapClick = onMapClick

        basemapToggle.onclick = (ev) => {
          L.DomEvent.stopPropagation(ev)
          if (panel.style.display === 'flex') closePanel()
          else openPanel()
        }

        classicBtn.onclick = (ev) => {
          L.DomEvent.stopPropagation(ev)
          applyBasemapStyleRef.current('osm')
          applySelection('osm')
          closePanel()
        }
        catalogBtn.onclick = (ev) => {
          L.DomEvent.stopPropagation(ev)
          applyBasemapStyleRef.current('stylized')
          applySelection('stylized')
          closePanel()
        }

        locateBtn.onclick = () => {
          if (!('geolocation' in navigator)) return
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = pos.coords.latitude
              const lon = pos.coords.longitude
              const accuracyM = pos.coords.accuracy
              setUserLocation({ lat, lon, accuracyM })
              mapRef.current?.flyTo([lat, lon], Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 })
            },
            () => {
              /* ignore */
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 15_000 }
          )
        }

        L.DomEvent.disableClickPropagation(wrap)
        L.DomEvent.disableScrollPropagation(wrap)

        return wrap
      },
      onRemove(this: L.Control) {
        const h = (this as unknown as { _trailOnMapClick?: () => void })._trailOnMapClick
        if (h) map.off('click', h)
      },
    })
    const instance = new ctl({ position: 'topleft' })
    instance.addTo(map)
    return instance
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
          // Snap tool: first click snaps point, second click routes between two snapped points
          const clickLat = e.latlng.lat
          const clickLng = e.latlng.lng

          if (snapLoadingRef.current) return

          setSnapLoading(true)
          console.log('[snap] Attempting snap at', clickLat, clickLng)

          snapToNearestWay(clickLat, clickLng, 50)
            .then((result) => {
              console.log('[snap] Result:', result)
              if (!result) {
                console.warn('[snap] No snap result - check NEXT_PUBLIC_ORS_API_KEY')
                setSnapLoading(false)
                return // Could show error toast here
              }

              // Convert [lon, lat] to [lat, lon]
              const snappedPoint: [number, number] = [result.point[1], result.point[0]]
              console.log('[snap] Snapped to:', snappedPoint)

              // If this is first point, save it
              if (snapFirstPointRef.current === null) {
                console.log('[snap] First point saved:', snappedPoint)
                setSnapFirstPoint(snappedPoint)
                stagedRef.current?.appendDrawPoint(snappedPoint)
                setSnapLoading(false)
                return
              }

              // Second point: route between them
              console.log('[snap] snapFirstPointRef.current:', snapFirstPointRef.current)
              console.log('[snap] snappedPoint:', snappedPoint)
              console.log('[snap] Routing from', snapFirstPointRef.current, 'to', snappedPoint)
              routeBetweenPoints(
                snapFirstPointRef.current[0],
                snapFirstPointRef.current[1],
                snappedPoint[0],
                snappedPoint[1]
              )
                .then((routeResult) => {
                  console.log('[snap] Route result:', routeResult)
                  console.log('[snap] Route polyline length:', routeResult?.polyline?.length ?? 'undefined')
                  if (routeResult && routeResult.polyline && routeResult.polyline.length >= 1) {
                    console.log('[snap] Adding', routeResult.polyline.length, 'route points')
                    // Convert all route points [lon, lat] to [lat, lon] and add in batch
                    const routePoints = routeResult.polyline.map((point) => [point[1], point[0]] as [number, number])
                    stagedRef.current?.appendDrawPoints(routePoints)
                    setSnapFirstPoint(null)
                    setSnapLoading(false)
                  } else {
                    console.error('[snap] Route failed: polyline too short or invalid', { polyline: routeResult?.polyline })
                    setSnapFirstPoint(null)
                    setSnapLoading(false)
                    // Don't add fallback line - let user retry
                  }
                })
                .catch((err) => {
                  console.error('[snap] Route error:', err)
                  setSnapFirstPoint(null)
                  setSnapLoading(false)
                })
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

  // Map container cursor: mode + trail picker vs geometry + pencil vs eraser
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.getContainer().style.cursor = getResolvedMapCursor()
  }, [getResolvedMapCursor])

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

      const sectionEraseActiveIcon = L.divIcon({
        className: '',
        html: drawTrailNodeDivHtml(8, MAP.destructive, MAP),
        iconSize: [8, 8],
        iconAnchor: [4, 4],
      })

      drawPts.forEach((pt, i) => {
        const marker = L.marker(pt as L.LatLngExpression, {
          icon: nodeIcon,
          interactive: true,
          draggable: tool === 'pencil',
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
    }
  }, [drawToolActive, staged?.drawTool])

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
        data-basemap={basemapStyle}
        suppressHydrationWarning
      />
      {officialMapAlignHandler && (
        <div className="absolute left-1/2 top-3 z-[1001] flex max-w-[min(92vw,24rem)] -translate-x-1/2 items-center gap-2 border-2 border-electric/80 bg-primary/15 px-3 py-1.5 shadow-[3px_3px_0_0_var(--foreground)]">
          <p className="truncate text-xs font-semibold text-foreground">
            Map align: tap the same feature on the basemap
          </p>
        </div>
      )}
      {(placingPhoto || placingTrailPhoto) && (
        <div
          className={`absolute left-1/2 top-3 z-[1000] flex max-w-[min(90vw,22rem)] -translate-x-1/2 items-center gap-2 border-2 px-3 py-1.5 shadow-[3px_3px_0_0_var(--map-chrome-fg)] dark:border-[var(--map-chrome-fg)] dark:shadow-[3px_3px_0_0_var(--map-chrome-fg)] ${
            placingTrailPhoto && !placingPhoto
              ? 'border-forest/80 bg-forest/15 dark:bg-[color-mix(in_oklch,var(--map-chrome-bg),var(--forest)_18%)]'
              : 'border-primary/80 bg-primary/15 dark:bg-[color-mix(in_oklch,var(--map-chrome-bg),var(--primary)_20%)]'
          }`}
        >
          <p
            className={`truncate text-xs font-semibold dark:text-[var(--map-chrome-fg)] ${
              placingTrailPhoto && !placingPhoto ? 'text-forest' : 'text-foreground'
            }`}
          >
            Tap on or near a trail line to pin
          </p>
          <button
            type="button"
            onClick={onCancelPlace}
            className={`shrink-0 text-xs font-bold uppercase tracking-wide underline-offset-2 hover:underline dark:text-[var(--map-chrome-fg)] ${
              placingTrailPhoto && !placingPhoto ? 'text-forest' : 'text-primary'
            }`}
          >
            Cancel
          </button>
        </div>
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


      {/* Mobile floating action button: enter add-trail-photo mode even when drawer is closed */}
      {isCoarsePointer && onEditModeChange && (
        <button
          type="button"
          onClick={() => {
            onEditModeChange(editMode === 'add-trail-photo' ? null : 'add-trail-photo')
          }}
          aria-label={editMode === 'add-trail-photo' ? 'Exit add photo mode' : 'Add photo'}
          className={`absolute bottom-6 right-4 z-1000 flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-[3px_3px_0_0_var(--map-chrome-fg)] transition-colors sm:hidden ${
            editMode === 'add-trail-photo'
              ? 'border-foreground bg-forest text-secondary-foreground dark:border-[var(--map-chrome-fg)] dark:bg-[color-mix(in_oklch,var(--map-chrome-bg),var(--forest)_28%)] dark:text-[var(--map-chrome-fg)] dark:shadow-[3px_3px_0_0_var(--map-chrome-fg)]'
              : 'border-foreground bg-card text-forest dark:border-[var(--map-chrome-fg)] dark:bg-[var(--map-chrome-bg)] dark:text-[var(--map-chrome-fg)] dark:shadow-[3px_3px_0_0_var(--map-chrome-fg)]'
          }`}
          title={editMode === 'add-trail-photo' ? 'Cancel' : 'Add trail photo'}
        >
          <FontAwesomeIcon icon={faCamera} className="w-6 h-6" />
        </button>
      )}
    </div>
  )
}
