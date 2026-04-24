export interface Ride {
  id: string;
  name: string;
  distance: number;
  elevation: number;
  polyline: [number, number][];
  timestamp: Date | null;
  pointCount: number;
  stravaActivityId?: number;
}

export interface Trail {
  id: string;
  name: string;
  difficulty: "easy" | "intermediate" | "hard" | "pro" | "not_set";
  direction: "one-way" | "out-and-back" | "loop" | "not_set";
  polyline: [number, number][];
  distanceKm: number;
  elevationGainFt: number;
  notes?: string;
  source: string;
  sourceRideId?: string;
  osmWayId?: number;
  uploadedByEmail?: string;
  createdAt: Date;
}

export interface TrimPoint {
  rideId: string;
  index: number;
}

export interface TrimSegment {
  ride: Ride;
  startIndex: number;
  endIndex: number;
  polyline: [number, number][];
  distanceKm: number;
  elevationGainFt: number;
}

export interface TrimFormState {
  name: string;
  difficulty: Trail["difficulty"];
  direction: Trail["direction"];
  notes: string;
  networkId?: string;
}

export type EditMode =
  | 'add-trail'
  | 'edit-trail'
  | 'refine-trail'
  | 'add-network'
  | 'edit-network'
  | 'add-trail-photo'
  | null

export type AddTrailTool = 'draw' | 'gpx' | 'osm' | 'strava'

export type StagedSegment =
  | { id: string; source: 'draw'; polyline: [number, number][] }
  | { id: string; source: 'gpx'; rideId: string; startIndex: number; endIndex: number; polyline: [number, number][] }
  | { id: string; source: 'osm'; osmWayId: number; name?: string; polyline: [number, number][]; reversed?: boolean }
  | { id: string; source: 'strava'; stravaSegmentId: number; name?: string; polyline: [number, number][]; reversed?: boolean }

export interface DraftTrail {
  localId: string
  isDraft: true
  name: string
  difficulty: Trail["difficulty"]
  direction: Trail["direction"]
  polyline: [number, number][]
  distanceKm: number
  elevationGainFt: number
  notes?: string
  source: string
  sourceRideId?: string
  osmWayId?: number
  networkId?: string
  createdAt: string
}

export interface Network {
  id: string;
  name: string;
  polygon: [number, number][];
  trailIds: string[];
  createdAt: Date;
}

export interface RidePhoto {
  id: string;
  rideId: string;
  blobUrl: string;
  thumbnailUrl?: string;
  lat?: number;
  lon?: number;
  takenAt?: Date;
  trailId?: string;
  trailLat?: number;
  trailLon?: number;
  accepted: boolean;
}

export interface TrailPhoto {
  id: string;
  blobUrl: string;
  thumbnailUrl?: string;
  lat?: number;
  lon?: number;
  takenAt?: Date;
  trailId?: string;
  trailLat?: number;
  trailLon?: number;
  accepted: boolean;
  status: 'published' | 'hidden' | 'flagged';
  createdByUserId?: string;
  createdAt: Date;
  /** Client-only demo photo (not persisted). */
  isLocal?: boolean;
}

export interface SaveTrailRequest {
  trails: Omit<Trail, "id" | "createdAt" | "uploadedByEmail">[];
}

export interface SaveTrailResponse {
  success: boolean;
  savedTrails?: Trail[];
  error?: string;
}

export type DigitizationTaskKind =
  | "named_route"
  | "intersection_route"
  | "loop"
  | "other";

/** Persisted JSON from `buildMapOverlayTransform` (lib/map-overlay-transform). */
export type MapOverlayTransformJson = {
  kind: "similarity_two_point";
  imageWidth: number;
  imageHeight: number;
  p1Img: { x: number; y: number };
  p1Ll: { lat: number; lon: number };
  p2Img: { x: number; y: number };
  p2Ll: { lat: number; lon: number };
  southWest: [number, number];
  northEast: [number, number];
};

export interface MapOverlayRecord {
  id: string;
  networkId: string;
  blobUrl: string;
  sourceUrl?: string;
  title?: string;
  printedDate?: string;
  imageWidth: number;
  imageHeight: number;
  transform: MapOverlayTransformJson | null;
  opacity: number;
  createdAt: Date;
}

export interface MapOverlayAlignmentPoint {
  seq: 1 | 2;
  imgX: number;
  imgY: number;
  lat: number;
  lon: number;
}

export interface NetworkDigitizationTask {
  id: string;
  networkId: string;
  mapOverlayId?: string;
  kind: DigitizationTaskKind;
  label: string;
  description?: string;
  sortOrder: number;
  completedTrailId?: string;
  completedAt?: Date;
  completedByUserId?: string;
  createdAt: Date;
}

/** Client payload for rendering the georeferenced official map on Leaflet. */
export type OfficialMapLayerPayload = {
  blobUrl: string;
  opacity: number;
  transform: MapOverlayTransformJson | null;
  visible: boolean;
};

// ─── Trail versioning ─────────────────────────────────────────────────────────

export type TrailRevisionAction = 'create' | 'update' | 'delete' | 'rollback';

/** Full trail snapshot stored in trail_revisions.payload */
export interface TrailRevisionPayload {
  name: string;
  difficulty: Trail['difficulty'];
  direction: Trail['direction'];
  polyline: [number, number][];
  distanceKm: number;
  elevationGainFt: number;
  notes?: string;
  source: string;
  sourceRideId?: string;
  osmWayId?: number;
}

export interface TrailRevision {
  id: string;
  trailId: string;
  createdAt: Date;
  createdByUserId?: string;
  createdByName?: string;
  changeSetId?: string;
  parentRevisionId?: string;
  action: TrailRevisionAction;
  summary?: string;
  payload: TrailRevisionPayload;
}

export interface TrailChangeSet {
  id: string;
  createdByUserId: string;
  createdByName?: string;
  comment?: string;
  createdAt: Date;
}

export interface TrailRevisionComment {
  id: string;
  trailId: string;
  revisionId?: string;
  authorUserId: string;
  authorName?: string;
  body: string;
  createdAt: Date;
}

/** One row in the activity feed */
export interface TrailActivityItem {
  revisionId: string;
  trailId: string;
  trailName: string;
  action: TrailRevisionAction;
  summary?: string;
  changeSetId?: string;
  changeSetComment?: string;
  createdAt: Date;
  createdByUserId?: string;
  createdByName?: string;
}
