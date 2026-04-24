import type { Trail, Network, Ride, TrailRevision, TrailRevisionPayload, TrailRevisionAction, TrailActivityItem } from '@/lib/types'

// ─── Trail ────────────────────────────────────────────────────────────────────

export type TrailRow = {
  id: string
  name: string
  difficulty: Trail['difficulty']
  direction: Trail['direction']
  polyline: [number, number][]
  distance_km: number
  elevation_gain_ft: number
  notes: string | null
  source: string
  source_ride_id: string | null
  osm_way_id: number | null
  uploaded_by_email: string | null
  created_at: string
}

export function rowToTrail(row: TrailRow): Trail {
  return {
    id: row.id,
    name: row.name,
    difficulty: row.difficulty,
    direction: row.direction,
    polyline: row.polyline,
    distanceKm: Number(row.distance_km),
    elevationGainFt: Number(row.elevation_gain_ft),
    notes: row.notes ?? undefined,
    source: row.source,
    sourceRideId: row.source_ride_id ?? undefined,
    osmWayId: row.osm_way_id ?? undefined,
    uploadedByEmail: row.uploaded_by_email ?? undefined,
    createdAt: new Date(row.created_at),
  }
}

// ─── Network ──────────────────────────────────────────────────────────────────

export type NetworkRow = {
  id: string
  name: string
  polygon: [number, number][]
  created_at: string
  trail_ids: string[] | null
}

export function rowToNetwork(row: NetworkRow): Network {
  return {
    id: row.id,
    name: row.name,
    polygon: row.polygon,
    trailIds: row.trail_ids ?? [],
    createdAt: new Date(row.created_at),
  }
}

// ─── Ride ─────────────────────────────────────────────────────────────────────

export type RideRow = {
  id: string
  name: string
  distance: number
  elevation: number
  polyline: [number, number][]
  point_count: number
  timestamp: string | null
  strava_activity_id: number | null
}

export function rowToRide(row: RideRow): Ride {
  return {
    id: row.id,
    name: row.name,
    distance: row.distance,
    elevation: row.elevation,
    polyline: row.polyline,
    pointCount: row.point_count,
    timestamp: row.timestamp ? new Date(row.timestamp) : null,
    stravaActivityId: row.strava_activity_id ?? undefined,
  }
}

// ─── Trail revisions ──────────────────────────────────────────────────────────

export type TrailRevisionRow = {
  id: string
  trail_id: string
  created_at: string
  created_by_user_id: string | null
  created_by_name: string | null
  change_set_id: string | null
  parent_revision_id: string | null
  action: string
  summary: string | null
  payload: TrailRevisionPayload
}

export function rowToRevision(row: TrailRevisionRow): TrailRevision {
  return {
    id: row.id,
    trailId: row.trail_id,
    createdAt: new Date(row.created_at),
    createdByUserId: row.created_by_user_id ?? undefined,
    createdByName: row.created_by_name ?? undefined,
    changeSetId: row.change_set_id ?? undefined,
    parentRevisionId: row.parent_revision_id ?? undefined,
    action: row.action as TrailRevisionAction,
    summary: row.summary ?? undefined,
    payload: row.payload,
  }
}

export type TrailActivityRow = {
  revision_id: string
  trail_id: string
  trail_name: string
  action: string
  summary: string | null
  change_set_id: string | null
  change_set_comment: string | null
  created_at: string
  created_by_user_id: string | null
  created_by_name: string | null
}

export function rowToActivityItem(row: TrailActivityRow): TrailActivityItem {
  return {
    revisionId: row.revision_id,
    trailId: row.trail_id,
    trailName: row.trail_name,
    action: row.action as TrailRevisionAction,
    summary: row.summary ?? undefined,
    changeSetId: row.change_set_id ?? undefined,
    changeSetComment: row.change_set_comment ?? undefined,
    createdAt: new Date(row.created_at),
    createdByUserId: row.created_by_user_id ?? undefined,
    createdByName: row.created_by_name ?? undefined,
  }
}
