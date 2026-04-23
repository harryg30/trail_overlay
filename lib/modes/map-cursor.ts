import type { EditMode, AddTrailTool } from '@/lib/types'
import { MODE_REGISTRY } from './index'
import type { TrailEditTool } from '@/lib/modes/types'

/**
 * Map container cursor from active mode, phase (picker vs geometry), and trail edit tool.
 * Background layers are de-prioritized during draw/refine/draw-network so this cursor reads clearly.
 */
export function resolveMapCursor(params: {
  editMode: EditMode
  editTrailMode: boolean
  refineMode: boolean
  addTrailTool: AddTrailTool | null
  drawTool: TrailEditTool
  trailEditTool: TrailEditTool
}): string {
  const { editMode, editTrailMode, refineMode, addTrailTool, drawTool, trailEditTool } = params
  if (!editMode) return ''

  if (editMode === 'add-trail' && addTrailTool) {
    if (addTrailTool === 'draw') {
      if (drawTool === 'pencil') return 'crosshair'
      if (drawTool === 'section-eraser') return 'crosshair'
      if (drawTool === 'snap') return 'pointer'
      return 'pointer'
    }
    if (addTrailTool === 'gpx') return 'crosshair'
    if (addTrailTool === 'osm') return 'pointer'
    if (addTrailTool === 'strava') return 'pointer'
  }

  if (editMode === 'edit-trail') {
    if (editTrailMode) return 'pointer'
    if (refineMode) {
      if (trailEditTool === 'pencil') return 'grab'
      if (trailEditTool === 'section-eraser') return 'crosshair'
      return 'pointer'
    }
  }

  return MODE_REGISTRY[editMode]?.cursor ?? ''
}
