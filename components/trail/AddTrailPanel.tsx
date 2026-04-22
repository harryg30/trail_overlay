'use client'

import { useState, useMemo, useRef } from 'react'
import type { Ride, TrimPoint, TrimSegment, StagedSegment, AddTrailTool } from '@/lib/types'
import type { TrailEditTool } from '@/lib/modes/types'
import type { ActiveEnd } from '@/hooks/useStagedTrail'
import type { OsmWayFeature } from '@/lib/overpass'
import type { StravaSegmentFeature } from '@/lib/strava-segments'
import { EndpointControls } from '@/components/shared/EndpointControls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faEraser,
  faMapLocationDot,
  faPencil,
  faRoute,
  faRotateLeft,
  faRotateRight,
  faScissors,
  faUpload,
  faXmark,
  faMagnet,
} from '@fortawesome/free-solid-svg-icons'
import { uploadRideFilesClient } from '@/lib/upload-rides-client'

const toolBtn = (active: boolean) =>
  cn(
    'flex size-7 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
    active
      ? 'border-foreground bg-foreground text-background'
      : 'border-border bg-card text-foreground hover:bg-mud/80'
  )

const tabBtn = (active: boolean) =>
  cn(
    'inline-flex min-w-[4.5rem] flex-1 basis-0 items-center justify-center gap-1.5 whitespace-nowrap py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-b-2',
    active
      ? 'border-primary text-primary'
      : 'border-transparent text-muted-foreground hover:text-foreground'
  )

export interface AddTrailPanelProps {
  activeTool: AddTrailTool
  onSetActiveTool: (t: AddTrailTool) => void
  drawTool: TrailEditTool
  onSetDrawTool: (t: TrailEditTool) => void
  activeEnd: ActiveEnd
  onSetActiveEnd: (e: ActiveEnd) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClearDraw: () => void
  segments: StagedSegment[]
  onRemoveSegment: (id: string) => void
  // GPX
  rides: Ride[]
  activeRideId: string | null
  onSetActiveRide: (id: string | null) => void
  trimStart: TrimPoint | null
  trimSegment: TrimSegment | null
  onStepTrimPoint: (which: 'start' | 'end', delta: number) => void
  onClearTrimPoint: (which: 'start' | 'end') => void
  onAddTrimSegment: () => void
  // OSM
  osmLoading: boolean
  osmError: string | null
  osmWayCount: number
  // Strava
  showStravaTab: boolean
  stravaLoading: boolean
  stravaError: string | null
  stravaSegmentCount: number
  stravaSegments: StravaSegmentFeature[]
  onStravaSegmentSelected: (feature: StravaSegmentFeature) => void
  isStravaSegmentSelected: (segmentId: number) => boolean
  // General
  onCancel: () => void
  /** Applied to the root container (e.g. when nested in a draggable shell). */
  rootClassName?: string
  /** When true, GPX tab shows upload control (requires signed-in user for API). */
  canUploadGpx?: boolean
  onRidesUploaded?: (rides: Ride[]) => void
}

export function AddTrailPanel({
  activeTool,
  onSetActiveTool,
  drawTool,
  onSetDrawTool,
  activeEnd,
  onSetActiveEnd,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClearDraw,
  segments,
  onRemoveSegment,
  rides,
  activeRideId,
  onSetActiveRide,
  trimStart,
  trimSegment,
  onStepTrimPoint,
  onClearTrimPoint,
  onAddTrimSegment,
  osmLoading,
  osmError,
  osmWayCount,
  showStravaTab,
  stravaLoading,
  stravaError,
  stravaSegmentCount,
  stravaSegments,
  onStravaSegmentSelected,
  isStravaSegmentSelected,
  onCancel,
  rootClassName,
  canUploadGpx = false,
  onRidesUploaded,
}: AddTrailPanelProps) {
  const [rideQuery, setRideQuery] = useState('')
  const rideListRef = useRef<HTMLDivElement>(null)

  const filteredRides = useMemo(() => {
    if (!rideQuery.trim()) return rides.slice(0, 50)
    const q = rideQuery.toLowerCase()
    return rides.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 50)
  }, [rides, rideQuery])

  const handleSetTool = (tool: AddTrailTool) => {
    if (tool !== 'gpx') setRideQuery('')
    onSetActiveTool(tool)
  }

  return (
    <div
      className={cn(
        'flex w-[min(96vw,36rem)] flex-col gap-0 rounded-lg border-2 border-foreground bg-card shadow-[3px_3px_0_0_var(--foreground)]',
        rootClassName
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Tab bar: min widths + nowrap so each mode’s icon and label stay one line; scroll if needed */}
      <div className="flex min-w-0 overflow-x-auto border-b border-border">
        <button type="button" className={tabBtn(activeTool === 'draw')} onClick={() => handleSetTool('draw')}>
          <FontAwesomeIcon icon={faPencil} className="h-3 w-3 shrink-0" />
          Draw
        </button>
        <button type="button" className={tabBtn(activeTool === 'gpx')} onClick={() => handleSetTool('gpx')}>
          <FontAwesomeIcon icon={faRoute} className="h-3 w-3 shrink-0" />
          GPX
        </button>
        <button type="button" className={tabBtn(activeTool === 'osm')} onClick={() => handleSetTool('osm')}>
          <FontAwesomeIcon icon={faMapLocationDot} className="h-3 w-3 shrink-0" />
          OSM
        </button>
        {showStravaTab && (
          <button type="button" className={tabBtn(activeTool === 'strava')} onClick={() => handleSetTool('strava')}>
            <svg className="h-3 w-3 shrink-0" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
              <path d="M158.4 0L7 292h89.2l62.2-131.4L220.6 292h88.5L158.4 0zm88.5 292l-88.5 186.7L69.8 292H24.1l134.3 220L292.6 292h-45.7z" />
            </svg>
            Strava
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          title="Close"
          className="shrink-0 px-2.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tool content */}
      <div className="px-3 py-2 flex flex-col gap-2">
        <StagingHistoryToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
          onClear={onClearDraw}
          clearDisabled={segments.length === 0}
        />

        {activeTool === 'draw' && (
          <DrawTools
            drawTool={drawTool}
            onSetDrawTool={onSetDrawTool}
            activeEnd={activeEnd}
            onSetActiveEnd={onSetActiveEnd}
            hasSegments={segments.length > 0}
          />
        )}

        {activeTool === 'gpx' && (
          <GpxTools
            rides={filteredRides}
            rideQuery={rideQuery}
            onRideQueryChange={setRideQuery}
            activeRideId={activeRideId}
            onSetActiveRide={onSetActiveRide}
            trimStart={trimStart}
            trimSegment={trimSegment}
            onStepTrimPoint={onStepTrimPoint}
            onClearTrimPoint={onClearTrimPoint}
            onAddTrimSegment={onAddTrimSegment}
            rideListRef={rideListRef}
            canUploadGpx={canUploadGpx}
            onRidesUploaded={onRidesUploaded}
          />
        )}

        {activeTool === 'osm' && (
          <OsmTools
            osmLoading={osmLoading}
            osmError={osmError}
            osmWayCount={osmWayCount}
          />
        )}

        {activeTool === 'strava' && (
          <StravaTools
            loading={stravaLoading}
            error={stravaError}
            segmentCount={stravaSegmentCount}
            segments={stravaSegments}
            onSegmentSelected={onStravaSegmentSelected}
            isSegmentSelected={isStravaSegmentSelected}
            rides={rides}
            activeRideId={activeRideId}
            onSetActiveRide={onSetActiveRide}
            trimStart={trimStart}
            trimSegment={trimSegment}
            onStepTrimPoint={onStepTrimPoint}
            onClearTrimPoint={onClearTrimPoint}
            onAddTrimSegment={onAddTrimSegment}
          />
        )}
      </div>

      {/* Staged segments chips */}
      {segments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">
            Segments
          </span>
          {segments.map((seg, i) => (
            <SegmentChip key={seg.id} segment={seg} index={i} onRemove={() => onRemoveSegment(seg.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function StagingHistoryToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  clearDisabled,
}: {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  clearDisabled: boolean
}) {
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">History</span>
      <button type="button" title="Undo" className={toolBtn(false)} onClick={onUndo} disabled={!canUndo}>
        <FontAwesomeIcon icon={faRotateLeft} className={cn('h-3 w-3', !canUndo && 'opacity-40')} />
      </button>
      <button type="button" title="Redo" className={toolBtn(false)} onClick={onRedo} disabled={!canRedo}>
        <FontAwesomeIcon icon={faRotateRight} className={cn('h-3 w-3', !canRedo && 'opacity-40')} />
      </button>
      <Button type="button" variant="outlineThick" size="xs" onClick={onClear} disabled={clearDisabled}>
        Clear
      </Button>
    </div>
  )
}

function DrawTools({
  drawTool,
  onSetDrawTool,
  activeEnd,
  onSetActiveEnd,
  hasSegments,
}: {
  drawTool: TrailEditTool
  onSetDrawTool: (t: TrailEditTool) => void
  activeEnd: ActiveEnd
  onSetActiveEnd: (e: ActiveEnd) => void
  hasSegments: boolean
}) {
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
      <button type="button" title="Pencil" className={toolBtn(drawTool === 'pencil')} onClick={() => onSetDrawTool('pencil')}>
        <FontAwesomeIcon icon={faPencil} className="h-3 w-3" />
      </button>
      <button type="button" title="Eraser" className={toolBtn(drawTool === 'eraser')} onClick={() => onSetDrawTool('eraser')}>
        <FontAwesomeIcon icon={faEraser} className="h-3 w-3" />
      </button>
      <button type="button" title="Section eraser" className={toolBtn(drawTool === 'section-eraser')} onClick={() => onSetDrawTool('section-eraser')}>
        <FontAwesomeIcon icon={faScissors} className="h-3 w-3" />
      </button>
      <button type="button" title="Snap to OSM" className={toolBtn(drawTool === 'snap')} onClick={() => onSetDrawTool('snap')}>
        <FontAwesomeIcon icon={faMagnet} className="h-3 w-3" />
      </button>
      {hasSegments && (
        <>
          <span className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            title="Extend from start"
            onClick={() => onSetActiveEnd('start')}
            className={cn(
              'flex size-5 items-center justify-center rounded-full border-2 transition-colors',
              activeEnd === 'start'
                ? 'border-green-500 bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                : 'border-green-500/50 bg-green-500/20 hover:bg-green-500/40'
            )}
          >
            <span className="sr-only">Extend from start</span>
          </button>
          <button
            type="button"
            title="Extend from end"
            onClick={() => onSetActiveEnd('end')}
            className={cn(
              'flex size-5 items-center justify-center rounded-full border-2 transition-colors',
              activeEnd === 'end'
                ? 'border-red-500 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
                : 'border-red-500/50 bg-red-500/20 hover:bg-red-500/40'
            )}
          >
            <span className="sr-only">Extend from end</span>
          </button>
        </>
      )}
      <p className="ml-auto max-w-[12rem] text-right text-[10px] leading-snug text-muted-foreground">
        {drawTool === 'section-eraser'
          ? 'Click two points to erase between'
          : drawTool === 'snap'
            ? 'Click to snap to road; click 2nd point to auto-route'
            : hasSegments
              ? (activeEnd === 'start' ? 'Drawing from start' : 'Drawing from end')
              : 'Click map to draw'}
        {drawTool === 'pencil' && hasSegments && ' · Pencil: tap line/midpoint to insert; right-click a point to trim toward start or end.'}
      </p>
    </div>
  )
}

function GpxTools({
  rides,
  rideQuery,
  onRideQueryChange,
  activeRideId,
  onSetActiveRide,
  trimStart,
  trimSegment,
  onStepTrimPoint,
  onClearTrimPoint,
  onAddTrimSegment,
  rideListRef,
  canUploadGpx,
  onRidesUploaded,
}: {
  rides: Ride[]
  rideQuery: string
  onRideQueryChange: (q: string) => void
  activeRideId: string | null
  onSetActiveRide: (id: string | null) => void
  trimStart: TrimPoint | null
  trimSegment: TrimSegment | null
  onStepTrimPoint: (which: 'start' | 'end', delta: number) => void
  onClearTrimPoint: (which: 'start' | 'end') => void
  onAddTrimSegment: () => void
  rideListRef: React.RefObject<HTMLDivElement | null>
  canUploadGpx: boolean
  onRidesUploaded?: (rides: Ride[]) => void
}) {
  const gpxUploadRef = useRef<HTMLInputElement>(null)
  const [gpxUploading, setGpxUploading] = useState(false)
  const [gpxUploadError, setGpxUploadError] = useState<string | null>(null)

  const handleGpxUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0 || !onRidesUploaded) return
    setGpxUploading(true)
    setGpxUploadError(null)
    const { rides: newRides, errors } = await uploadRideFilesClient(files)
    if (newRides.length > 0) onRidesUploaded(newRides)
    if (errors.length > 0) setGpxUploadError(errors.join(', '))
    setGpxUploading(false)
    if (gpxUploadRef.current) gpxUploadRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={gpxUploadRef}
        type="file"
        accept=".gpx,.zip"
        multiple
        className="hidden"
        onChange={handleGpxUploadChange}
      />
      {canUploadGpx ? (
        <Button
          type="button"
          variant="outlineThick"
          size="xs"
          className="h-8 w-full gap-1.5 text-[11px] font-semibold"
          disabled={gpxUploading}
          onClick={() => gpxUploadRef.current?.click()}
        >
          <FontAwesomeIcon icon={faUpload} className="h-3 w-3" />
          {gpxUploading ? 'Uploading…' : 'Upload GPX / ZIP'}
        </Button>
      ) : (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Sign in to upload GPX or ZIP files from here (or use the catalog drawer).
        </p>
      )}
      {gpxUploadError && <p className="text-[11px] text-destructive">{gpxUploadError}</p>}
      <Input
        type="text"
        value={rideQuery}
        onChange={(e) => onRideQueryChange(e.target.value)}
        placeholder="Search rides…"
        className="h-7 text-xs"
      />
      <div ref={rideListRef} className="max-h-[120px] overflow-y-auto flex flex-col gap-0.5">
        {rides.length === 0 && (
          <p className="text-[11px] text-muted-foreground py-1">No rides match.</p>
        )}
        {rides.map((ride) => (
          <button
            key={ride.id}
            type="button"
            onClick={() => onSetActiveRide(activeRideId === ride.id ? null : ride.id)}
            className={cn(
              'flex items-center justify-between rounded px-2 py-1 text-left text-[11px] transition-colors',
              activeRideId === ride.id
                ? 'bg-primary/15 text-primary font-semibold'
                : 'text-foreground hover:bg-mud/60'
            )}
          >
            <span className="truncate flex-1 min-w-0 mr-2">{ride.name}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{(ride.distance / 1000).toFixed(1)} km</span>
          </button>
        ))}
      </div>
      {activeRideId && !trimStart && (
        <p className="text-[11px] text-muted-foreground">Click the ride on the map to set start point.</p>
      )}
      {trimStart && !trimSegment && (
        <p className="text-[11px] font-semibold text-primary">Start set — click to set end point.</p>
      )}
      {trimSegment && (
        <div className="flex flex-col gap-1.5">
          <EndpointControls onStep={onStepTrimPoint} onClear={onClearTrimPoint} />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {trimSegment.distanceKm.toFixed(2)} km · {trimSegment.polyline.length} pts
            </span>
            <Button type="button" variant="default" size="xs" onClick={onAddTrimSegment}>
              Add segment
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function OsmTools({
  osmLoading,
  osmError,
  osmWayCount,
}: {
  osmLoading: boolean
  osmError: string | null
  osmWayCount: number
}) {
  return (
    <div className="flex flex-col gap-1">
      {osmLoading && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground animate-pulse">
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading OSM trails…
        </div>
      )}
      {osmError && (
        <p className="text-[11px] text-destructive">{osmError}</p>
      )}
      {!osmLoading && !osmError && osmWayCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {osmWayCount} way{osmWayCount !== 1 ? 's' : ''} loaded — click to select / deselect.
        </p>
      )}
      {!osmLoading && !osmError && osmWayCount === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Zoom in to load OSM trails, then click to select.
        </p>
      )}
    </div>
  )
}

function StravaTools({
  loading,
  error,
  segmentCount,
  segments,
  onSegmentSelected,
  isSegmentSelected,
  rides,
  activeRideId,
  onSetActiveRide,
  trimStart,
  trimSegment,
  onStepTrimPoint,
  onClearTrimPoint,
  onAddTrimSegment,
}: {
  loading: boolean
  error: string | null
  segmentCount: number
  segments: StravaSegmentFeature[]
  onSegmentSelected: (feature: StravaSegmentFeature) => void
  isSegmentSelected: (segmentId: number) => boolean
  rides: Ride[]
  activeRideId: string | null
  onSetActiveRide: (id: string | null) => void
  trimStart: TrimPoint | null
  trimSegment: TrimSegment | null
  onStepTrimPoint: (which: 'start' | 'end', delta: number) => void
  onClearTrimPoint: (which: 'start' | 'end') => void
  onAddTrimSegment: () => void
}) {
  const [subTab, setSubTab] = useState<'rides' | 'segments'>('rides')
  const [segQuery, setSegQuery] = useState('')
  const [rideQuery, setRideQuery] = useState('')
  const rideListRef = useRef<HTMLDivElement | null>(null)

  const filteredSegments = useMemo(() => {
    if (!segQuery.trim()) return segments
    const q = segQuery.toLowerCase()
    return segments.filter((s) => s.name.toLowerCase().includes(q))
  }, [segments, segQuery])

  const filteredRides = useMemo(() => {
    if (!rideQuery.trim()) return rides
    const q = rideQuery.toLowerCase()
    return rides.filter((r) => r.name.toLowerCase().includes(q))
  }, [rides, rideQuery])

  return (
    <div className="flex flex-col gap-2">
      {/* Sub-tab toggle */}
      <div className="flex rounded-sm border-2 border-foreground overflow-hidden text-[10px] font-bold uppercase tracking-wider">
        <button
          type="button"
          onClick={() => setSubTab('rides')}
          className={cn(
            'flex-1 py-1 transition-colors',
            subTab === 'rides' ? 'bg-foreground text-background' : 'text-foreground hover:bg-mud/60'
          )}
        >
          Rides
        </button>
        <button
          type="button"
          onClick={() => setSubTab('segments')}
          className={cn(
            'flex-1 py-1 transition-colors border-l-2 border-foreground',
            subTab === 'segments' ? 'bg-foreground text-background' : 'text-foreground hover:bg-mud/60'
          )}
        >
          Segments
        </button>
      </div>

      {/* Rides sub-tab */}
      {subTab === 'rides' && (
        <>
          <Input
            type="text"
            value={rideQuery}
            onChange={(e) => setRideQuery(e.target.value)}
            placeholder="Search rides…"
            className="h-7 text-xs"
          />
          <div ref={rideListRef} className="max-h-[120px] overflow-y-auto flex flex-col gap-0.5">
            {filteredRides.length === 0 && (
              <p className="text-[11px] text-muted-foreground py-1">No rides match.</p>
            )}
            {filteredRides.map((ride) => (
              <button
                key={ride.id}
                type="button"
                onClick={() => onSetActiveRide(activeRideId === ride.id ? null : ride.id)}
                className={cn(
                  'flex items-center justify-between rounded px-2 py-1 text-left text-[11px] transition-colors',
                  activeRideId === ride.id
                    ? 'bg-primary/15 text-primary font-semibold'
                    : 'text-foreground hover:bg-mud/60'
                )}
              >
                <span className="truncate flex-1 min-w-0 mr-2">{ride.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{(ride.distance / 1000).toFixed(1)} km</span>
              </button>
            ))}
          </div>
          {activeRideId && !trimStart && (
            <p className="text-[11px] text-muted-foreground">Click the ride on the map to set start point.</p>
          )}
          {trimStart && !trimSegment && (
            <p className="text-[11px] font-semibold text-primary">Start set — click to set end point.</p>
          )}
          {trimSegment && (
            <div className="flex flex-col gap-1.5">
              <EndpointControls onStep={onStepTrimPoint} onClear={onClearTrimPoint} />
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {trimSegment.distanceKm.toFixed(2)} km · {trimSegment.polyline.length} pts
                </span>
                <Button type="button" variant="default" size="xs" onClick={onAddTrimSegment}>
                  Add segment
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Segments sub-tab */}
      {subTab === 'segments' && (
        <>
          {segmentCount > 0 && (
            <Input
              type="text"
              value={segQuery}
              onChange={(e) => setSegQuery(e.target.value)}
              placeholder="Search segments…"
              className="h-7 text-xs"
            />
          )}
          {loading && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground animate-pulse">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading Strava segments…
            </div>
          )}
          {error && (
            <p className="text-[11px] text-destructive">{error}</p>
          )}
          {!loading && !error && segmentCount === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Zoom in to load Strava segments, then click to select.
            </p>
          )}
          {!loading && filteredSegments.length > 0 && (
            <div className="max-h-[140px] overflow-y-auto flex flex-col gap-0.5">
              {filteredSegments.map((seg) => {
                const selected = isSegmentSelected(seg.segmentId)
                const distKm = (seg.distance / 1000).toFixed(2)
                return (
                  <button
                    key={seg.segmentId}
                    type="button"
                    onClick={() => onSegmentSelected(seg)}
                    className={cn(
                      'flex items-center justify-between rounded px-2 py-1 text-left text-[11px] transition-colors',
                      selected
                        ? 'bg-primary/15 text-primary font-semibold'
                        : 'text-foreground hover:bg-mud/60'
                    )}
                  >
                    <span className="truncate flex-1 min-w-0 mr-2">{seg.name}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{distKm} km</span>
                  </button>
                )
              })}
            </div>
          )}
          {!loading && !error && segmentCount > 0 && filteredSegments.length === 0 && segQuery && (
            <p className="text-[11px] text-muted-foreground">No segments match &ldquo;{segQuery}&rdquo;</p>
          )}
        </>
      )}
    </div>
  )
}

const sourceColors: Record<string, string> = {
  draw: 'bg-primary/20 text-primary border-primary/30',
  gpx: 'bg-electric/20 text-electric border-electric/30',
  osm: 'bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-500/30',
  strava: 'bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/30',
}

function SegmentChip({ segment, index, onRemove }: { segment: StagedSegment; index: number; onRemove: () => void }) {
  const label =
    segment.source === 'draw'
      ? `Draw (${segment.polyline.length})`
      : segment.source === 'gpx'
        ? `GPX`
        : segment.source === 'osm'
          ? (segment.name ?? `OSM ${segment.osmWayId}`)
          : segment.source === 'strava'
            ? (segment.name ?? `Strava ${segment.stravaSegmentId}`)
            : '?'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        sourceColors[segment.source] ?? 'bg-muted text-foreground border-border'
      )}
    >
      <span className="truncate max-w-[8rem]">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 hover:text-destructive transition-colors"
        title="Remove segment"
      >
        <FontAwesomeIcon icon={faXmark} className="h-2.5 w-2.5" />
      </button>
    </span>
  )
}
