// MAIN world, document_idle.
// Strava uses Mapbox GL JS (not Leaflet). Adds trail polylines via addSource/addLayer.
// Coordinates: DB stores [lat, lng]; Mapbox requires [lng, lat].

const DEFAULT_API_URL = "https://trail-overlay.vercel.app";
const SOURCE_ID = "trail-overlay";
const LAYER_ID = "trail-overlay-lines";
/** Wider stroke under main line when `bookmarked` feature-state is true (color from extension settings). */
const LAYER_ID_BOOKMARK_HALO = "trail-overlay-lines-bookmark-halo";
/** Invisible wide line to make hover/click easier. */
const LAYER_ID_HITBOX = "trail-overlay-lines-hitbox";

const NETWORK_SOURCE_ID = "network-overlay";
const NETWORK_FILL_LAYER = "network-overlay-fill";
const NETWORK_BORDER_LAYER = "network-overlay-border";
const NETWORK_LABEL_LAYER = "network-overlay-label";

/** Unified bottom-right panel: viewport trail list + divider + bookmark stack (inside `.mapboxgl-map`). */
const TRAIL_SONNER_PANEL_ID = "trail-overlay-sonner-panel";
/** Bumps when panel DOM/CSS structure changes so stale roots are recreated. */
const TRAIL_SONNER_PANEL_LAYOUT = "v2-bottom-up-tabs";
// Bookmarks are hidden behind a single “Bookmarks” card; hover reveals list.
/** Max trails listed in the scroll region (overflow summarized). */
const TRAIL_SONNER_LIST_MAX = 200;
/** Single z-index for the unified panel (below centered trail modal). */
const TRAIL_PANEL_Z = 10040;
/** Centered trail detail modal over the map (above the trail panel). */
const TRAIL_INFO_DRAWER_Z = 10050;
const TRAIL_INFO_DRAWER_ID = "trail-overlay-trail-info-drawer";

/** Main trail line: difficulty color; thick when hovered / detail modal open. */
const TRAIL_LINE_PAINT = {
  "line-color": ["get", "color"],
  "line-width": [
    "case",
    ["boolean", ["feature-state", "highlight"], false],
    10,
    4
  ],
  "line-opacity": [
    "case",
    ["boolean", ["feature-state", "highlight"], false],
    1,
    0.85
  ]
};

/** Increase hit target without changing visuals (slightly non-zero opacity to keep events reliable). */
const TRAIL_LINE_HITBOX_PAINT = {
  "line-color": "#000000",
  "line-width": 18,
  "line-opacity": 0.001
};

const BOOKMARK_HALO_PRESET_HEX = {
  yellow: "#e6c619",
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e"
};
const DEFAULT_BOOKMARK_HALO_HEX = BOOKMARK_HALO_PRESET_HEX.yellow;

function parseUserHexColor(s) {
  const t = String(s ?? "").trim();
  if (!t.startsWith("#")) return null;
  const h = t.slice(1);
  if (/^[0-9a-f]{6}$/i.test(h)) return `#${h.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(h)) {
    const a = h[0].toLowerCase();
    const b = h[1].toLowerCase();
    const c = h[2].toLowerCase();
    return `#${a}${a}${b}${b}${c}${c}`;
  }
  return null;
}

/** Preset name or `#rrggbb` / `#rgb` from extension popup → Mapbox line color. */
function resolveBookmarkHaloLineColor(raw) {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (BOOKMARK_HALO_PRESET_HEX[key]) return BOOKMARK_HALO_PRESET_HEX[key];
  return parseUserHexColor(key) || DEFAULT_BOOKMARK_HALO_HEX;
}

function buildBookmarkHaloPaint(lineColorHex) {
  return {
    "line-color": lineColorHex,
    "line-width": [
      "case",
      ["boolean", ["feature-state", "bookmarked"], false],
      12,
      0
    ],
    "line-opacity": [
      "case",
      ["boolean", ["feature-state", "bookmarked"], false],
      0.2,
      0
    ],
    "line-blur": 0.85
  };
}

// Match lib/map-theme.ts trailLineColor(MAP) — same hex fallbacks as the website Leaflet map.
const DIFFICULTY_COLORS = {
  easy: "#34a56d",
  intermediate: "#156be8",
  hard: "#242030",
  pro: "#e07828",
  not_set: "#e07828"
};

function difficultyColor(d) {
  return DIFFICULTY_COLORS[d] ?? DIFFICULTY_COLORS.not_set;
}

/** Stable id for Mapbox feature-state / dock (must match GeoJSON promoteId). */
function trailMapFeatureId(trail, index) {
  if (trail.id != null && String(trail.id).length > 0) {
    return String(trail.id);
  }
  return `__trail_idx_${index}`;
}

/** Resolve GeoJSON `properties.trailId` to the cached trail row (same indexing as GeoJSON build). */
function findTrailByFeatureId(trails, featureTrailId) {
  if (!trails?.length || featureTrailId == null) return null;
  const fid = String(featureTrailId);
  for (let i = 0; i < trails.length; i++) {
    if (trailMapFeatureId(trails[i], i) === fid) {
      return { trail: trails[i], index: i, featureId: fid };
    }
  }
  return null;
}

let bridgeRequestSeq = 0;

/** Must match content-bridge.js — avoids Strava/page postMessage collisions (e.g. VV handlers). */
const TO_BRIDGE = "__trailOverlayToBridge";
const FROM_BRIDGE = "__trailOverlayFromBridge";

function fetchFromBridgeWithTimeout(
  requestType,
  responseType,
  fallbackValue,
  mapResponse,
  payload = {},
  timeoutMs = 2000
) {
  const requestId = ++bridgeRequestSeq;
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    function finish(value) {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      window.removeEventListener("message", handler);
      resolve(value);
    }

    function handler(event) {
      if (
        event.data?.type === responseType &&
        event.data[FROM_BRIDGE] === true &&
        event.data.requestId === requestId
      ) {
        finish(mapResponse(event.data));
      }
    }

    timer = setTimeout(() => finish(fallbackValue), timeoutMs);
    window.addEventListener("message", handler);
    window.postMessage(
      { type: requestType, requestId, [TO_BRIDGE]: true, ...payload },
      "*"
    );
  });
}

/** API base URL comes only from the extension popup (chrome.storage), via the isolated bridge. */
function fetchApiUrlFromBridge() {
  return fetchFromBridgeWithTimeout(
    "GET_API_URL",
    "API_URL_RESPONSE",
    DEFAULT_API_URL,
    (data) => data.apiUrl || DEFAULT_API_URL,
    {},
    5000
  );
}

function fetchTrails() {
  return fetchFromBridgeWithTimeout(
    "GET_TRAILS",
    "TRAILS_RESPONSE",
    [],
    (data) => data.trails,
    {},
    8000
  );
}

function fetchNetworks() {
  return fetchFromBridgeWithTimeout(
    "GET_NETWORKS",
    "NETWORKS_RESPONSE",
    [],
    (data) => data.networks,
    {},
    8000
  );
}

const DEFAULT_OVERLAY_PREFS = {
  enabled: true,
  trailsVisible: true,
  networksVisible: true,
  photosVisible: true,
  bookmarkHighlightColor: "yellow"
};

function fetchOverlayPrefsFromBridge() {
  return fetchFromBridgeWithTimeout(
    "GET_OVERLAY_PREFS",
    "OVERLAY_PREFS_RESPONSE",
    { ...DEFAULT_OVERLAY_PREFS },
    (data) => ({
      enabled: data.enabled !== false,
      trailsVisible: data.trailsVisible !== false,
      networksVisible: data.networksVisible !== false,
      photosVisible: data.photosVisible !== false,
      bookmarkHighlightColor:
        typeof data.bookmarkHighlightColor === "string" &&
        data.bookmarkHighlightColor.trim().length > 0
          ? data.bookmarkHighlightColor.trim()
          : DEFAULT_OVERLAY_PREFS.bookmarkHighlightColor
    })
  );
}

function fetchTrailBookmarksFromBridge() {
  return fetchFromBridgeWithTimeout(
    "GET_TRAIL_BOOKMARKS",
    "TRAIL_BOOKMARKS_RESPONSE",
    [],
    (data) => {
      const ids = Array.isArray(data.ids) ? data.ids : [];
      return ids.map((x) => String(x ?? "").trim()).filter(Boolean);
    }
  );
}

function persistTrailBookmarksToBridge(ids) {
  return fetchFromBridgeWithTimeout(
    "SET_TRAIL_BOOKMARKS",
    "TRAIL_BOOKMARKS_SET",
    undefined,
    () => undefined,
    { ids }
  );
}

function fetchTrailPhotosFromBridge(bounds) {
  return fetchFromBridgeWithTimeout(
    "GET_TRAIL_PHOTOS",
    "TRAIL_PHOTOS_RESPONSE",
    [],
    (data) => data.photos || [],
    {
      north: bounds.north,
      south: bounds.south,
      east: bounds.east,
      west: bounds.west,
      limit: bounds.limit ?? 500
    },
    8000
  );
}

function fetchTrailPhotosByTrailFromBridge(trailId, limit = 80) {
  const tid = normalizeTrailIdKey(trailId);
  return fetchFromBridgeWithTimeout(
    "GET_TRAIL_PHOTOS_BY_TRAIL",
    "TRAIL_PHOTOS_RESPONSE",
    [],
    (data) => data.photos || [],
    { trailId: tid, limit },
    8000
  );
}

function addClickNudge(map) {
  const canvas = map.getCanvas();

  map.on("click", (e) => {
    const rect = canvas.getBoundingClientRect();

    // Convert lngLat to screen pixel coords
    const point = map.project(e.lngLat);

    const clientX = rect.left + point.x;
    const clientY = rect.top + point.y;

    // Small offset (tweak this!)
    const offsetX = 3;
    const offsetY = 3;

    // Dispatch a synthetic mousemove
    const moveEvent = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: clientX + offsetX,
      clientY: clientY + offsetY,
      view: window
    });

    canvas.dispatchEvent(moveEvent);
  });
}

// --- MAP DETECTION ---

function isMapboxLikeMap(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.addSource === "function" &&
    typeof v.addLayer === "function" &&
    typeof v.isStyleLoaded === "function"
  );
}

let lastReactMapProbeMs = 0;
const REACT_MAP_PROBE_INTERVAL_MS = 1500;

function hasReactInternals(el) {
  if (!el) return false;
  for (const key of Object.getOwnPropertyNames(el)) {
    if (
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactProps$") ||
      key.startsWith("__reactContainer$")
    ) {
      return true;
    }
  }
  return false;
}

function collectReactRootsAroundElement(el, maxDepth = 4) {
  const roots = [];
  let cur = el;
  let depth = 0;
  while (cur && depth <= maxDepth) {
    for (const key of Object.getOwnPropertyNames(cur)) {
      if (
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactContainer$")
      ) {
        try {
          const root = cur[key];
          if (root && (typeof root === "object" || typeof root === "function")) {
            roots.push(root);
          }
        } catch (_) {}
      }
    }
    cur = cur.parentElement;
    depth += 1;
  }
  return roots;
}

function findMapInObjectGraph(roots, maxNodes = 6000) {
  if (!roots || roots.length === 0) return null;

  const queue = roots.slice();
  const seen = new Set();
  let visited = 0;

  while (queue.length > 0 && visited < maxNodes) {
    const node = queue.shift();
    if (!node || (typeof node !== "object" && typeof node !== "function")) {
      continue;
    }
    if (seen.has(node)) continue;
    seen.add(node);
    visited += 1;

    if (isMapboxLikeMap(node)) return node;

    const keys = Object.getOwnPropertyNames(node);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "ownerDocument" || key === "parentNode" || key === "window") {
        continue;
      }
      let value;
      try {
        value = node[key];
      } catch (_) {
        continue;
      }
      if (!value || (typeof value !== "object" && typeof value !== "function")) {
        continue;
      }
      if (value === window || value === document) continue;
      if (!seen.has(value)) queue.push(value);
    }
  }

  return null;
}

function findMapViaReactInternals(containers) {
  for (const container of containers) {
    const roots = collectReactRootsAroundElement(container);
    const found = findMapInObjectGraph(roots);
    if (found) {
      console.debug("[TrailOverlay] Map found via React internals probe");
      return found;
    }
  }
  return null;
}

function findMapOnContainer(container) {
  if (!container) return null;

  const directCandidates = [
    container._mapboxgl_map,
    container._maplibregl_map,
    container.__trailOverlayMap,
    container.__map,
    container.map
  ];
  for (const c of directCandidates) {
    if (isMapboxLikeMap(c)) return c;
  }

  // Some bundles attach map refs as non-standard expando props on the container.
  for (const key of Object.getOwnPropertyNames(container)) {
    if (key === "style") continue;
    try {
      const v = container[key];
      if (isMapboxLikeMap(v)) {
        return v;
      }
    } catch (_) {}
  }

  return null;
}

function findMapInWindowContext(win) {
  if (!win) return null;

  try {
    if (isMapboxLikeMap(win.vv_map)) return win.vv_map;
    if (isMapboxLikeMap(win._trailOverlayMap)) return win._trailOverlayMap;
    if (isMapboxLikeMap(win.__map)) return win.__map;

    const doc = win.document;
    if (doc) {
      const containers = doc.querySelectorAll(".mapboxgl-map, .maplibregl-map");
      for (const container of containers) {
        const found = findMapOnContainer(container);
        if (found) return found;
      }
    }

    const pv = win.pageView;
    if (pv) {
      const m =
        pv.map?.() || pv.mapContext?.()?.map?.() || pv.activity?.()?.map?.();
      if (m && typeof m.addLayer === "function") return m;
    }
  } catch (_) {}

  return null;
}

function findMapInSameOriginFrames() {
  for (let i = 0; i < window.frames.length; i++) {
    try {
      const fw = window.frames[i];
      const found = findMapInWindowContext(fw);
      if (found) return found;
    } catch (_) {
      // Cross-origin frame access can throw; ignore and continue.
    }
  }
  return null;
}

function tryFindMap() {
  // Strava route builder exposes the live map here; prefer it over an older captured instance.
  if (isMapboxLikeMap(window.vv_map)) {
    return window.vv_map;
  }

  if (isMapboxLikeMap(window._trailOverlayMap)) return window._trailOverlayMap;

  if (isMapboxLikeMap(window.__map)) return window.__map;

  const inCurrentWindow = findMapInWindowContext(window);
  if (inCurrentWindow) return inCurrentWindow;

  const inFrames = findMapInSameOriginFrames();
  if (inFrames) return inFrames;

  const now = Date.now();
  if (now - lastReactMapProbeMs >= REACT_MAP_PROBE_INTERVAL_MS) {
    lastReactMapProbeMs = now;
    const containers = document.querySelectorAll(".mapboxgl-map, .maplibregl-map");
    const foundViaReact = findMapViaReactInternals(containers);
    if (foundViaReact) {
      window._trailOverlayMap = foundViaReact;
      return foundViaReact;
    }
  }

  try {
    const pv = window.pageView;
    if (pv) {
      const m =
        pv.map?.() || pv.mapContext?.()?.map?.() || pv.activity?.()?.map?.();
      if (m && typeof m.addLayer === "function") return m;
    }
  } catch (_) {}

  for (const key in window) {
    try {
      const v = window[key];
      if (isMapboxLikeMap(v)) {
        return v;
      }
    } catch (_) {}
  }

  return null;
}

function getMapDetectionSnapshot() {
  const mapboxContainer = document.querySelector(".mapboxgl-map");
  const maplibreContainer = document.querySelector(".maplibregl-map");
  const container = mapboxContainer || maplibreContainer;
  let accessibleFrameCount = 0;
  let crossOriginFrameCount = 0;
  let frameMapboxContainerCount = 0;
  let frameMaplibreContainerCount = 0;

  for (let i = 0; i < window.frames.length; i++) {
    try {
      const fw = window.frames[i];
      const fdoc = fw.document;
      accessibleFrameCount += 1;
      if (fdoc) {
        frameMapboxContainerCount += fdoc.querySelectorAll(".mapboxgl-map").length;
        frameMaplibreContainerCount += fdoc.querySelectorAll(".maplibregl-map").length;
      }
    } catch (_) {
      crossOriginFrameCount += 1;
    }
  }

  return {
    href: window.location?.href || "",
    readyState: document.readyState,
    inIframe: window.top !== window,
    hasVvMap: isMapboxLikeMap(window.vv_map),
    hasCapturedMap: isMapboxLikeMap(window._trailOverlayMap),
    hasWindowMapboxgl: !!window.mapboxgl,
    hasWindowMaplibregl: !!window.maplibregl,
    hasMapContainer: !!container,
    hasReactInternalsOnContainer: hasReactInternals(container),
    mapboxContainerCount: document.querySelectorAll(".mapboxgl-map").length,
    maplibreContainerCount: document.querySelectorAll(".maplibregl-map").length,
    containerHasMapRef: !!container?._mapboxgl_map,
    frameCount: window.frames.length,
    accessibleFrameCount,
    crossOriginFrameCount,
    frameMapboxContainerCount,
    frameMaplibreContainerCount,
    userAgent: navigator.userAgent
  };
}

function snapshotToInlineString(snapshot) {
  return [
    `ready=${snapshot.readyState}`,
    `iframe=${snapshot.inIframe}`,
    `vv=${snapshot.hasVvMap}`,
    `captured=${snapshot.hasCapturedMap}`,
    `mapboxgl=${snapshot.hasWindowMapboxgl}`,
    `maplibregl=${snapshot.hasWindowMaplibregl}`,
    `containers=${snapshot.mapboxContainerCount}/${snapshot.maplibreContainerCount}`,
    `reactOnContainer=${snapshot.hasReactInternalsOnContainer}`,
    `containerRef=${snapshot.containerHasMapRef}`,
    `frames=${snapshot.frameCount}`,
    `framesAccessible=${snapshot.accessibleFrameCount}`,
    `frameContainers=${snapshot.frameMapboxContainerCount}/${snapshot.frameMaplibreContainerCount}`
  ].join(" ");
}

function waitForMap(timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const existing = tryFindMap();
    if (existing) return resolve(existing);

    const deadline = Date.now() + timeoutMs;
    const start = Date.now();
    let pollCount = 0;

    const poll = setInterval(() => {
      pollCount += 1;
      const found = tryFindMap();
      if (found) {
        clearInterval(poll);
        if (pollCount > 1) {
          console.debug("[TrailOverlay] Map discovered", {
            polls: pollCount,
            elapsedMs: Date.now() - start,
            snapshot: getMapDetectionSnapshot()
          });
        }
        resolve(found);
      } else if (Date.now() > deadline) {
        clearInterval(poll);
        const snapshot = getMapDetectionSnapshot();
        console.error("[TrailOverlay] Map probe timed out", {
          timeoutMs,
          polls: pollCount,
          elapsedMs: Date.now() - start,
          snapshot
        });
        console.error("[TrailOverlay] Map probe timed out (inline)", snapshotToInlineString(snapshot));
        reject(new Error("Map not found"));
      } else if (pollCount % 8 === 0) {
        const snapshot = getMapDetectionSnapshot();
        console.debug("[TrailOverlay] Waiting for map", {
          polls: pollCount,
          elapsedMs: Date.now() - start,
          snapshot
        });
        console.debug("[TrailOverlay] Waiting for map (inline)", snapshotToInlineString(snapshot));
      }
    }, 250);
  });
}

function waitForStyleLoaded(map, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const startedAt = Date.now();
    let pollTimer = null;
    let timeoutTimer = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (err) reject(err);
      else resolve();
    };

    const checkLoaded = () => {
      try {
        return !!(map && typeof map.isStyleLoaded === "function" && map.isStyleLoaded());
      } catch (_) {
        return false;
      }
    };

    if (checkLoaded()) {
      finish();
      return;
    }

    pollTimer = setInterval(() => {
      if (checkLoaded()) {
        console.debug("[TrailOverlay] Map style became ready via poll", {
          elapsedMs: Date.now() - startedAt
        });
        finish();
      }
    }, 250);

    timeoutTimer = setTimeout(() => {
      finish(new Error("Map style not ready"));
    }, timeoutMs);

    try {
      if (typeof map?.once === "function") {
        map.once("style.load", () => {
          console.debug("[TrailOverlay] Map style.load event received", {
            elapsedMs: Date.now() - startedAt
          });
          finish();
        });
      }
    } catch (_) {
      // Keep polling fallback alive.
    }
  });
}

// --- GEOJSON ---

function trailsToGeoJSON(trails) {
  return {
    type: "FeatureCollection",
    features: trails.map((trail, i) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: trail.polyline.map(([lat, lng]) => [lng, lat])
      },
      properties: {
        trailId: trailMapFeatureId(trail, i),
        name: trail.name,
        difficulty: trail.difficulty,
        direction: trail.direction,
        distanceKm: trail.distanceKm,
        elevationGainFt: trail.elevationGainFt,
        notes: trail.notes || "",
        color: difficultyColor(trail.difficulty)
      }
    }))
  };
}

// --- GEOJSON (networks) ---

function networksToGeoJSON(networks) {
  return {
    type: "FeatureCollection",
    features: networks
      .filter((n) => n.polygon && n.polygon.length >= 3)
      .map((n) => {
        // DB stores [lat, lng]; Mapbox requires [lng, lat]
        const coords = n.polygon.map(([lat, lng]) => [lng, lat]);
        // Close the ring
        if (
          coords[0][0] !== coords[coords.length - 1][0] ||
          coords[0][1] !== coords[coords.length - 1][1]
        ) {
          coords.push(coords[0]);
        }
        return {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [coords] },
          properties: {
            id: n.id,
            name: n.name,
            trailCount: n.trailIds ? n.trailIds.length : 0,
            trailIds: JSON.stringify(n.trailIds || [])
          }
        };
      })
  };
}

// --- MAP RENDERING ---

function addNetworksToMap(map, networks) {
  if (!map) return;

  // Remove old layers/source if present
  [NETWORK_LABEL_LAYER, NETWORK_BORDER_LAYER, NETWORK_FILL_LAYER].forEach(
    (id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    }
  );
  if (map.getSource(NETWORK_SOURCE_ID)) map.removeSource(NETWORK_SOURCE_ID);

  if (!networks.length) return;

  map.addSource(NETWORK_SOURCE_ID, {
    type: "geojson",
    data: networksToGeoJSON(networks)
  });

  // Semi-transparent fill
  map.addLayer({
    id: NETWORK_FILL_LAYER,
    type: "fill",
    source: NETWORK_SOURCE_ID,
    paint: {
      "fill-color": "#3b82f6",
      "fill-opacity": 0.1
    }
  });

  // Solid border
  map.addLayer({
    id: NETWORK_BORDER_LAYER,
    type: "line",
    source: NETWORK_SOURCE_ID,
    paint: {
      "line-color": "#3b82f6",
      "line-width": 2,
      "line-opacity": 0.7
    }
  });

  // Network name label at polygon centroid
  map.addLayer({
    id: NETWORK_LABEL_LAYER,
    type: "symbol",
    source: NETWORK_SOURCE_ID,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 13,
      "text-anchor": "center",
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"]
    },
    paint: {
      "text-color": "#1d4ed8",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2
    }
  });
}

function detachTrailLineLayerInteractions(map) {
  const h = map.__trailOverlayLineHandlers;
  if (!h) return;
  map.off("mousemove", LAYER_ID_HITBOX, h.onMousemove);
  map.off("mouseleave", LAYER_ID_HITBOX, h.onMouseleave);
  map.off("click", LAYER_ID_HITBOX, h.onClick);
  map.__trailOverlayLineHandlers = null;
}

// (removed) quick bookmark row — bookmarks are the bottom entry

function attachTrailLineLayerInteractions(map) {
  detachTrailLineLayerInteractions(map);

  const onMousemove = (e) => {
    map.getCanvas().style.cursor =
      e.features && e.features.length > 0 ? "pointer" : "";
    const fidRaw = e.features?.[0]?.properties?.trailId;
    const fid = fidRaw != null ? String(fidRaw) : null;
    if (fid && fid !== lastMapHoveredTrailFeatureId) {
      if (lastMapHoveredTrailFeatureId) {
        setSonnerTrailRowHovered(lastMapHoveredTrailFeatureId, false);
      }
      lastMapHoveredTrailFeatureId = fid;
      setSonnerTrailRowHovered(fid, true);
      // Debounce recency + reorder so fast mouse movement doesn't reshuffle the list.
      pendingHoverRecencyFeatureId = fid;
      clearTimeout(hoverRecencyDebounceTimer);
      hoverRecencyDebounceTimer = setTimeout(() => {
        const stable = pendingHoverRecencyFeatureId;
        if (!stable) return;
        noteTrailHoverRecency(stable);
        // Re-render list order with recency at the bottom (most-recent-first in DOM for column-reverse).
        scheduleTrailDockRefresh(map);
      }, 140);
    } else if (!fid && lastMapHoveredTrailFeatureId) {
      setSonnerTrailRowHovered(lastMapHoveredTrailFeatureId, false);
      lastMapHoveredTrailFeatureId = null;
      pendingHoverRecencyFeatureId = null;
      clearTimeout(hoverRecencyDebounceTimer);
    }
  };

  const onMouseleave = () => {
    map.getCanvas().style.cursor = "";
    if (lastMapHoveredTrailFeatureId) {
      setSonnerTrailRowHovered(lastMapHoveredTrailFeatureId, false);
      lastMapHoveredTrailFeatureId = null;
    }
    pendingHoverRecencyFeatureId = null;
    clearTimeout(hoverRecencyDebounceTimer);
  };

  const onClick = (e) => {
    if (!e.features?.length) return;
    const fid = e.features[0].properties?.trailId;
    const resolved = findTrailByFeatureId(cachedTrails, fid);
    if (!resolved) return;
    lastMapClickedTrailRef = {
      trail: resolved.trail,
      featureId: resolved.featureId
    };
    // Clicking a trail line should not open the info modal; the list/bookmarks handle that.
  };

  map.on("mousemove", LAYER_ID_HITBOX, onMousemove);
  map.on("mouseleave", LAYER_ID_HITBOX, onMouseleave);
  map.on("click", LAYER_ID_HITBOX, onClick);
  map.__trailOverlayLineHandlers = { onMousemove, onMouseleave, onClick };
}

function buildTrailsGeoJSONWithNetworks(trails, networks) {
  const trailNetworkName = {};
  if (networks) {
    for (const network of networks) {
      for (const trailId of network.trailIds || []) {
        trailNetworkName[trailId] = network.name;
      }
    }
  }
  const geojson = trailsToGeoJSON(trails);
  geojson.features.forEach((f, i) => {
    const networkName = trailNetworkName[trails[i]?.id];
    if (networkName) f.properties.networkName = networkName;
  });
  return geojson;
}

function applyBookmarkHaloPaintIfNeeded(map) {
  if (!map?.getLayer?.(LAYER_ID_BOOKMARK_HALO)) return;
  if (map.__trailOverlayBookmarkHaloHex === overlayBookmarkHaloHex) return;
  try {
    map.setPaintProperty(
      LAYER_ID_BOOKMARK_HALO,
      "line-color",
      overlayBookmarkHaloHex
    );
  } catch (_) {}
  map.__trailOverlayBookmarkHaloHex = overlayBookmarkHaloHex;
}

function ensureTrailBookmarkHaloLayer(map) {
  if (!map?.getSource?.(SOURCE_ID) || map.getLayer(LAYER_ID_BOOKMARK_HALO)) {
    return;
  }
  if (!map.getLayer(LAYER_ID)) return;
  map.addLayer(
    {
      id: LAYER_ID_BOOKMARK_HALO,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: buildBookmarkHaloPaint(overlayBookmarkHaloHex)
    },
    LAYER_ID
  );
  map.__trailOverlayBookmarkHaloHex = overlayBookmarkHaloHex;
}

function addTrailsToMap(map, trails, networks) {
  if (!map) return;

  const geojson = buildTrailsGeoJSONWithNetworks(trails, networks);

  const existingSource = map.getSource(SOURCE_ID);
  const existingLayer = map.getLayer(LAYER_ID);
  if (existingSource && existingLayer) {
    try {
      existingSource.setData(geojson);
    } catch (_) {
      stripTrailLineLayersFromMap(map);
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: geojson,
        promoteId: "trailId"
      });
      map.addLayer({
        id: LAYER_ID_BOOKMARK_HALO,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: buildBookmarkHaloPaint(overlayBookmarkHaloHex)
      });
      map.__trailOverlayBookmarkHaloHex = overlayBookmarkHaloHex;
      map.addLayer({
        id: LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: TRAIL_LINE_PAINT
      });
      map.addLayer({
        id: LAYER_ID_HITBOX,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: TRAIL_LINE_HITBOX_PAINT
      });
    }
    ensureTrailBookmarkHaloLayer(map);
    attachTrailLineLayerInteractions(map);
    restoreOpenTrailInfoDrawerHighlight(map);
    applyBookmarkFeatureStatesToMap(map);
    return;
  }

  if (existingSource || existingLayer) {
    stripTrailLineLayersFromMap(map);
  }

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: geojson,
    promoteId: "trailId"
  });

  map.addLayer({
    id: LAYER_ID_BOOKMARK_HALO,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: buildBookmarkHaloPaint(overlayBookmarkHaloHex)
  });
  map.__trailOverlayBookmarkHaloHex = overlayBookmarkHaloHex;
  map.addLayer({
    id: LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: TRAIL_LINE_PAINT
  });
  map.addLayer({
    id: LAYER_ID_HITBOX,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: TRAIL_LINE_HITBOX_PAINT
  });

  attachTrailLineLayerInteractions(map);
  applyBookmarkFeatureStatesToMap(map);
}

/** Remove network overlay only (does not close trail drawer or hide dock). */
function stripNetworkLayersFromMap(map) {
  if (!map) return;
  [NETWORK_LABEL_LAYER, NETWORK_BORDER_LAYER, NETWORK_FILL_LAYER].forEach(
    (id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    }
  );
  if (map.getSource(NETWORK_SOURCE_ID)) map.removeSource(NETWORK_SOURCE_ID);
}

/** Remove trail line source/layer and pointer handlers (does not close drawer). */
function stripTrailLineLayersFromMap(map) {
  if (!map) return;
  detachTrailLineLayerInteractions(map);
  try {
    document.getElementById("trail-overlay-info-panel")?.remove();
    document.getElementById("trail-overlay-dock-root")?.remove();
    document.getElementById("trail-overlay-bookmark-toasts")?.remove();
  } catch (_) {
    /* ignore */
  }
  clearDockLineHighlight(map);
  lastAppliedBookmarkIds = new Set();
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  if (map.getLayer(LAYER_ID_HITBOX)) map.removeLayer(LAYER_ID_HITBOX);
  if (map.getLayer(LAYER_ID_BOOKMARK_HALO)) {
    map.removeLayer(LAYER_ID_BOOKMARK_HALO);
  }
  try {
    delete map.__trailOverlayBookmarkHaloHex;
  } catch (_) {}
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

// --- TOGGLE HELPERS ---

let overlayEnabled = true;
let overlayTrailsVisible = true;
let overlayNetworksVisible = true;
let overlayTrailPhotosVisible = true;
/** Raw value from extension settings: `yellow` / `red` / … or `#rrggbb`. */
let overlayBookmarkHighlightColor = DEFAULT_OVERLAY_PREFS.bookmarkHighlightColor;
/** Resolved `#rrggbb` for bookmark halo; updated from overlay prefs before trail layers are built. */
let overlayBookmarkHaloHex = DEFAULT_BOOKMARK_HALO_HEX;

/** Debounced viewport fetch for trail list thumbnails only (no map markers). */
let viewportPhotoPreviewTimer = null;

/** Last bbox `GET /api/trail-photos` payload (for gallery merge + strip thumbnails). */
let lastViewportTrailPhotos = [];

/** trail DB id string -> preview image URL (from latest viewport photo fetch). */
let trailPhotoPreviewByTrailId = new Map();

function normalizeTrailIdKey(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}
let dockHighlightClearTimer = null;
let dockRefreshTimer = null;
let lastDockHighlightedId = null;

/** Trail feature ids (Mapbox promoteId / `trailMapFeatureId`) persisted in `chrome.storage.local`. */
let bookmarkedTrailIds = new Set();
/** For clearing `bookmarked` feature-state when ids are removed from the set. */
let lastAppliedBookmarkIds = new Set();

/** Last trail picked from the map line click (for quick bookmark row). `{ trail, featureId }` or `null`. */
let lastMapClickedTrailRef = null;

/** Map-hovered trail feature id (for highlighting row + recency ordering). */
let lastMapHoveredTrailFeatureId = null;
/** Most-recent-first list of hovered trail feature ids. */
let recentHoveredTrailFeatureIds = [];
/** Debounce list reordering while scrubbing across trails. */
let hoverRecencyDebounceTimer = null;
let pendingHoverRecencyFeatureId = null;

function noteTrailHoverRecency(featureId) {
  if (!featureId) return;
  const fid = String(featureId);
  recentHoveredTrailFeatureIds = [
    fid,
    ...recentHoveredTrailFeatureIds.filter((x) => x !== fid)
  ].slice(0, 40);
}

function findSonnerTrailRowEl(featureId) {
  const panel = document.getElementById(TRAIL_SONNER_PANEL_ID);
  if (!panel) return null;
  return panel.querySelector(
    `.trail-overlay-sonner-trail-row[data-feature-id="${CSS.escape(String(featureId))}"]`
  );
}

function setSonnerTrailRowHovered(featureId, on) {
  const row = featureId ? findSonnerTrailRowEl(featureId) : null;
  if (!row) return;
  if (on) {
    row.setAttribute("data-trail-overlay-map-hover", "1");
    Object.assign(row.style, {
      borderColor: "rgba(255,255,255,0.28)",
      boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
      transform: "translateZ(0)"
    });
  } else {
    row.removeAttribute("data-trail-overlay-map-hover");
    row.style.borderColor = "rgba(255,255,255,0.14)";
    row.style.boxShadow = "";
    row.style.transform = "";
  }
}

function scheduleViewportPhotoPreviewFetch(map) {
  if (!map) return;
  clearTimeout(viewportPhotoPreviewTimer);
  viewportPhotoPreviewTimer = setTimeout(() => {
    void refreshViewportTrailPhotoPreviews(map);
  }, 500);
}

async function refreshViewportTrailPhotoPreviews(map) {
  if (!map || !overlayEnabled || !overlayTrailPhotosVisible) {
    lastViewportTrailPhotos = [];
    rebuildTrailPhotoPreviewsFromPhotos([]);
    scheduleTrailDockRefresh(map);
    return;
  }
  const b = map.getBounds();
  const photos = await fetchTrailPhotosFromBridge({
    north: b.getNorth(),
    south: b.getSouth(),
    east: b.getEast(),
    west: b.getWest(),
    limit: 500
  });
  lastViewportTrailPhotos = Array.isArray(photos) ? photos : [];
  rebuildTrailPhotoPreviewsFromPhotos(photos);
  scheduleTrailDockRefresh(map);
}

function setEnabled(value) {
  overlayEnabled = value;
  return fetchFromBridgeWithTimeout(
    "SET_ENABLED",
    "ENABLED_SET",
    undefined,
    () => undefined,
    { enabled: value }
  );
}

/** Full teardown: close UI and strip all overlay map sources/layers. */
function removeLayers(map) {
  closeTrailInfoDrawer();
  hideTrailDock();
  if (!map) return;
  stripNetworkLayersFromMap(map);
  stripTrailLineLayersFromMap(map);
}

function rebuildTrailPhotoPreviewsFromPhotos(photos) {
  trailPhotoPreviewByTrailId = new Map();
  if (!photos?.length) return;
  for (const p of photos) {
    if (p.trailId == null) continue;
    const sid = normalizeTrailIdKey(p.trailId);
    if (!sid) continue;
    if (!trailPhotoPreviewByTrailId.has(sid)) {
      const url = p.thumbnailUrl || p.blobUrl;
      if (url) trailPhotoPreviewByTrailId.set(sid, url);
    }
  }
}

function trailPolylineBBoxIntersectsBounds(trail, north, south, east, west) {
  const poly = trail.polyline;
  if (!poly?.length) return false;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const pair of poly) {
    const lat = pair[0];
    const lng = pair[1];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  if (maxLat < south || minLat > north) return false;
  if (east >= west) {
    if (maxLng < west || minLng > east) return false;
  } else if (maxLng < west && minLng > east) {
    return false;
  }
  return true;
}

function getTrailsInViewport(map, trails) {
  if (!map || !trails?.length) return [];
  const b = map.getBounds();
  const north = b.getNorth();
  const south = b.getSouth();
  const east = b.getEast();
  const west = b.getWest();
  const out = [];
  for (let index = 0; index < trails.length; index++) {
    const trail = trails[index];
    if (!trail.polyline?.length) continue;
    if (trailPolylineBBoxIntersectsBounds(trail, north, south, east, west)) {
      out.push({ trail, index });
    }
  }
  return out;
}

function clearDockLineHighlight(map) {
  if (dockHighlightClearTimer) {
    clearTimeout(dockHighlightClearTimer);
    dockHighlightClearTimer = null;
  }
  if (!lastDockHighlightedId) return;
  if (map?.getSource?.(SOURCE_ID)) {
    try {
      map.setFeatureState(
        { source: SOURCE_ID, id: lastDockHighlightedId },
        { highlight: false }
      );
    } catch (_) {}
  }
  lastDockHighlightedId = null;
}

function scheduleClearDockLineHighlight(map, delay = 70) {
  if (dockHighlightClearTimer) clearTimeout(dockHighlightClearTimer);
  dockHighlightClearTimer = setTimeout(() => {
    dockHighlightClearTimer = null;
    clearDockLineHighlight(map);
  }, delay);
}

function cancelScheduleClearDockHighlight() {
  if (dockHighlightClearTimer) {
    clearTimeout(dockHighlightClearTimer);
    dockHighlightClearTimer = null;
  }
}

function setDockLineHighlight(map, featureId) {
  if (!map?.getSource?.(SOURCE_ID) || !featureId) return;
  cancelScheduleClearDockHighlight();
  if (lastDockHighlightedId && lastDockHighlightedId !== featureId) {
    try {
      map.setFeatureState(
        { source: SOURCE_ID, id: lastDockHighlightedId },
        { highlight: false }
      );
    } catch (_) {}
  }
  try {
    map.setFeatureState(
      { source: SOURCE_ID, id: featureId },
      { highlight: true }
    );
    lastDockHighlightedId = featureId;
  } catch (_) {}
}

function closeTrailInfoDrawer() {
  const drawer = document.getElementById(TRAIL_INFO_DRAWER_ID);
  if (!drawer) return;
  const map = drawer.__trailOverlayMap;
  const prev = drawer.__trailOverlayRestoreFocus;
  const escHandler = drawer.__trailOverlayEscHandler;
  const resizeHandler = drawer.__trailOverlayResizeHandler;
  if (escHandler) {
    document.removeEventListener("keydown", escHandler);
  }
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
  }
  drawer.remove();
  if (map) clearDockLineHighlight(map);
  if (prev && typeof prev.focus === "function") {
    try {
      prev.focus({ preventScroll: true });
    } catch (_) {}
  }
}

/** Re-apply Mapbox highlight for the open drawer (e.g. after style.load rebuild). */
function restoreOpenTrailInfoDrawerHighlight(map) {
  const drawer = document.getElementById(TRAIL_INFO_DRAWER_ID);
  if (!drawer || !map || !map.getSource?.(SOURCE_ID)) return;
  const fid = drawer.__trailOverlayFeatureId;
  if (fid == null) return;
  cancelScheduleClearDockHighlight();
  try {
    map.setFeatureState({ source: SOURCE_ID, id: fid }, { highlight: true });
    lastDockHighlightedId = fid;
  } catch (_) {}
}

/** Refresh drawer title/body from `cachedTrails` without closing the shell. */
function refreshOpenTrailInfoDrawerFromCache() {
  const drawer = document.getElementById(TRAIL_INFO_DRAWER_ID);
  if (!drawer || !cachedTrails?.length) return;
  const fid = drawer.__trailOverlayFeatureId;
  if (fid == null) return;
  const resolved = findTrailByFeatureId(cachedTrails, fid);
  if (!resolved) return;
  const title = drawer.querySelector("#trail-overlay-drawer-title");
  if (title) title.textContent = resolved.trail.name || "Trail";
  const inner = drawer.querySelector(".trail-overlay-drawer-inner");
  const scroll = inner?.children[1];
  if (!scroll) return;
  scroll.replaceChildren();
  appendTrailDetailMainSections(scroll, resolved.trail);
}

function hideTrailDock() {
  const root = document.getElementById(TRAIL_SONNER_PANEL_ID);
  if (root) root.style.display = "none";
  closeTrailInfoDrawer();
}

/** Mapbox map root for overlay UI (unified trail panel + modal). */
function getTrailOverlayMapDomContainer(map) {
  try {
    const canvas = map?.getCanvas?.();
    if (!canvas) return null;
    const container = canvas.closest(".mapboxgl-map") || canvas.parentElement;
    if (!container) return null;
    if (window.getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    return container;
  } catch (_) {
    return null;
  }
}

function isMapboxGlMapCanvas(el) {
  if (!el || el.tagName !== "CANVAS") return false;
  const cls = typeof el.className === "string" ? el.className : "";
  return cls.includes("mapboxgl-canvas");
}

/** Top inset inside the map box so the panel max-height clears Strava chrome above the canvas. */
function measureTrailPanelTopInsetPx(map) {
  if (!map?.getCanvas) return 64;
  try {
    const canvas = map.getCanvas();
    const r = canvas.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return 64;
    const probe = Math.min(72, Math.max(24, Math.floor(r.height * 0.08)));
    const cx = r.left + r.width * 0.5;
    const cy = r.top + probe;
    let n = document.elementFromPoint(cx, cy);
    let safety = 0;
    while (n && n !== canvas && n !== document.documentElement && safety++ < 16) {
      if (
        (n instanceof HTMLElement || n instanceof SVGElement) &&
        n.closest?.(".mapboxgl-popup")
      ) {
        return Math.max(48, probe + 8);
      }
      if (isMapboxGlMapCanvas(n)) return Math.max(48, probe);
      n = n.parentElement;
    }
    if (n === canvas) return Math.max(48, probe);
  } catch (_) {}
  return 64;
}

/** Pixels to leave empty at the map bottom so the unified trail panel stays uncovered (modal inset). */
function measureTrailDockBottomReservePx() {
  const root = document.getElementById(TRAIL_SONNER_PANEL_ID);
  if (!root) return 0;
  const cs = window.getComputedStyle(root);
  if (cs.display === "none" || cs.visibility === "hidden") return 0;
  const h = root.getBoundingClientRect().height;
  if (h < 4) return 0;
  return Math.ceil(h) + 12;
}

function refreshSonnerPanelLayout(map) {
  const panel = document.getElementById(TRAIL_SONNER_PANEL_ID);
  if (!panel || panel.style.display === "none") return;
  const m = map && isMapboxLikeMap(map) ? map : trailOverlayMapRef;
  const container = getTrailOverlayMapDomContainer(m);
  const topInset = measureTrailPanelTopInsetPx(m);
  const isHovered = panel.getAttribute("data-trail-overlay-bm-hover") === "1";
  const isMin = panel.getAttribute("data-trail-overlay-minimized") === "1";
  panel.style.pointerEvents = "auto";
  // Bottom-anchored: panel grows upward from the bottom of the map box.
  panel.style.top = "auto";
  panel.style.right = "10px";
  // Larger bottom inset when maximized (not hovered), smaller when bookmarks are open.
  panel.style.bottom = isHovered
    ? "max(14px, env(safe-area-inset-bottom, 0px))"
    : isMin
      ? "max(18px, env(safe-area-inset-bottom, 0px))"
      : "max(26px, env(safe-area-inset-bottom, 0px))";
  panel.style.left = "auto";
  if (container) {
    const ch =
      container.clientHeight ||
      Math.floor(container.getBoundingClientRect().height);
    const reserveBottom = 16;
    const avail = Math.max(160, ch - topInset - reserveBottom);
    const cap = Math.min(920, Math.floor(window.innerHeight * 0.92));
    panel.style.maxHeight = `${Math.min(cap, avail)}px`;
  } else {
    panel.style.maxHeight = "min(92vh, 920px)";
  }
  const bmHost = panel.querySelector(".trail-overlay-sonner-bookmarks");
  if (bmHost) {
    bmHost.style.maxHeight = isHovered
      ? "none"
      : isMin
        ? "52px"
        : "48px";
    bmHost.style.minHeight = "0";
    bmHost.style.overflowY = "auto";
    bmHost.style.overflowX = "hidden";
    bmHost.style.overscrollBehavior = "contain";
  }
}

function refreshTrailInfoDrawerLayoutIfOpen() {
  const dr = document.getElementById(TRAIL_INFO_DRAWER_ID);
  if (dr && typeof dr.__trailOverlayApplyInsets === "function") {
    dr.__trailOverlayApplyInsets();
  }
  refreshSonnerPanelLayout(trailOverlayMapRef);
}

function ensureBookmarkToastStyles() {
  if (document.getElementById("trail-overlay-bookmark-styles")) return;
  const s = document.createElement("style");
  s.id = "trail-overlay-bookmark-styles";
  s.textContent =
    "@keyframes trailOverlayToastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}" +
    ".trail-overlay-bookmark-toast-card{animation:trailOverlayToastIn .22s ease-out}";
  document.head.appendChild(s);
}

function ensureSonnerPanelRoot(map) {
  const container = getTrailOverlayMapDomContainer(map);
  if (!container) return null;

  let panel = document.getElementById(TRAIL_SONNER_PANEL_ID);
  if (panel && panel.parentElement !== container) {
    try {
      panel.remove();
    } catch (_) {}
    panel = null;
  }
  if (
    panel &&
    panel.getAttribute("data-trail-overlay-layout") !== TRAIL_SONNER_PANEL_LAYOUT
  ) {
    try {
      panel.remove();
    } catch (_) {}
    panel = null;
  }
  if (panel) return panel;

  ensureBookmarkToastStyles();
  panel = document.createElement("div");
  panel.id = TRAIL_SONNER_PANEL_ID;
  panel.setAttribute("data-trail-overlay-layout", TRAIL_SONNER_PANEL_LAYOUT);
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Trails and bookmarks");
  Object.assign(panel.style, {
    position: "absolute",
    zIndex: String(TRAIL_PANEL_Z),
    display: "none",
    flexDirection: "column-reverse",
    width: "min(300px, 42vw)",
    maxWidth: "100%",
    boxSizing: "border-box",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif',
    // No wrapper background: let the map show through between cards.
    overflow: "visible",
    borderRadius: "0",
    border: "none",
    background: "transparent",
    boxShadow: "none",
    backdropFilter: "none",
    minHeight: "0"
  });

  const trailsCol = document.createElement("div");
  trailsCol.className = "trail-overlay-sonner-trails-col";
  Object.assign(trailsCol.style, {
    flex: "1",
    minHeight: "0",
    display: "flex",
    flexDirection: "column-reverse",
    overflow: "hidden",
    padding: "8px 10px 0"
  });

  const label = document.createElement("div");
  label.className = "trail-overlay-sonner-trails-label";
  Object.assign(label.style, {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: "11px",
    fontWeight: "600",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.55)",
    flex: "0 0 auto",
    marginBottom: "6px"
  });
  const labelText = document.createElement("span");
  labelText.textContent = "Trails in view";
  Object.assign(labelText.style, { flex: "1", minWidth: "0" });
  label.appendChild(labelText);

  const scroll = document.createElement("div");
  scroll.className = "trail-overlay-sonner-trails-scroll";
  scroll.setAttribute("role", "list");
  Object.assign(scroll.style, {
    flex: "1",
    minHeight: "0",
    display: "flex",
    flexDirection: "column-reverse",
    gap: "6px",
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehavior: "contain",
    paddingTop: "10px",
    scrollbarWidth: "thin",
    WebkitMaskImage:
      "linear-gradient(to bottom, transparent 0%, transparent 8px, black 36px)",
    maskImage:
      "linear-gradient(to bottom, transparent 0%, transparent 8px, black 36px)"
  });
  scroll.style.setProperty("-webkit-overflow-scrolling", "touch");

  const more = document.createElement("div");
  more.className = "trail-overlay-sonner-trails-more";
  Object.assign(more.style, {
    fontSize: "11px",
    color: "rgba(255,255,255,0.5)",
    display: "none",
    flex: "0 0 auto",
    padding: "4px 0 6px"
  });

  /* column-reverse: bottom of map → “+ more”, trail rows (grow upward), label at top. */
  trailsCol.appendChild(more);
  trailsCol.appendChild(scroll);
  trailsCol.appendChild(label);

  const bookmarks = document.createElement("div");
  bookmarks.className = "trail-overlay-sonner-bookmarks";
  bookmarks.setAttribute("role", "list");
  Object.assign(bookmarks.style, {
    flex: "0 1 auto",
    display: "flex",
    flexDirection: "column",
    gap: "0",
    padding: "0 10px 6px",
    minHeight: "0",
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehavior: "contain",
    alignItems: "stretch"
  });
  bookmarks.style.setProperty("-webkit-overflow-scrolling", "touch");
  bookmarks.addEventListener("mouseenter", () => {
    setSonnerBookmarkHoverMode(panel, true);
  });
  panel.addEventListener("mouseleave", () => {
    setSonnerBookmarkHoverMode(panel, false);
  });

  /* column-reverse on panel: first child sits at map bottom (bookmark stack). */
  panel.appendChild(bookmarks);
  panel.appendChild(trailsCol);

  const controls = document.createElement("div");
  controls.className = "trail-overlay-sonner-controls";
  Object.assign(controls.style, {
    flex: "0 0 auto",
    display: "flex",
    justifyContent: "flex-end",
    padding: "0 10px 6px",
    pointerEvents: "auto"
  });
  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.setAttribute("data-trail-overlay-minimize-btn", "1");
  minBtn.setAttribute("aria-label", "Minimize trail panel");
  minBtn.textContent = "▾";
  Object.assign(minBtn.style, {
    width: "28px",
    height: "28px",
    padding: "0",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.40)",
    color: "rgba(244,244,245,0.78)",
    cursor: "pointer",
    lineHeight: "26px",
    fontSize: "14px"
  });
  minBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = panel.getAttribute("data-trail-overlay-minimized") !== "1";
    setSonnerPanelMinimized(panel, next);
  });
  controls.appendChild(minBtn);
  // In column-reverse, the last appended element sits at the top.
  panel.appendChild(controls);

  container.appendChild(panel);
  refreshSonnerPanelLayout(map);
  // Default to expanded.
  setSonnerPanelMinimized(panel, false);
  return panel;
}

function setBookmarkStateOnMap(map, featureId, on) {
  if (!map?.getSource?.(SOURCE_ID) || featureId == null) return;
  try {
    map.setFeatureState(
      { source: SOURCE_ID, id: String(featureId) },
      { bookmarked: !!on }
    );
  } catch (_) {}
}

function applyBookmarkFeatureStatesToMap(map) {
  if (!map?.getSource?.(SOURCE_ID)) return;
  for (const fid of lastAppliedBookmarkIds) {
    if (!bookmarkedTrailIds.has(fid)) {
      try {
        map.setFeatureState(
          { source: SOURCE_ID, id: String(fid) },
          { bookmarked: false }
        );
      } catch (_) {}
    }
  }
  for (const fid of bookmarkedTrailIds) {
    setBookmarkStateOnMap(map, fid, true);
  }
  lastAppliedBookmarkIds = new Set(bookmarkedTrailIds);
}

function updateDockCardBookmarkStar(btn, featureId) {
  if (!btn) return;
  const on = bookmarkedTrailIds.has(featureId);
  btn.textContent = on ? "★" : "☆";
  btn.setAttribute(
    "aria-label",
    on ? "Remove bookmark" : "Bookmark trail"
  );
  btn.setAttribute("title", on ? "Remove bookmark" : "Bookmark trail");
}

function updateDrawerBookmarkAffordanceIfOpen() {
  const dr = document.getElementById(TRAIL_INFO_DRAWER_ID);
  if (!dr) return;
  const fid = dr.__trailOverlayFeatureId;
  const btn = dr.querySelector("[data-trail-overlay-drawer-bookmark]");
  if (!btn || fid == null) return;
  const on = bookmarkedTrailIds.has(String(fid));
  btn.textContent = on ? "★" : "☆";
  btn.setAttribute(
    "aria-label",
    on ? "Remove bookmark" : "Bookmark trail"
  );
}

function updateSonnerPanelDisplayVisibility(map) {
  const panel = document.getElementById(TRAIL_SONNER_PANEL_ID);
  if (!panel) return;
  if (!map || !overlayEnabled) {
    panel.style.display = "none";
    return;
  }
  const hasBm = bookmarkedTrailIds.size > 0;
  let hasTrails = false;
  if (
    overlayTrailsVisible &&
    cachedTrails?.length &&
    map.getSource?.(SOURCE_ID)
  ) {
    hasTrails = getTrailsInViewport(map, cachedTrails).length > 0;
  }
  panel.style.display = hasBm || hasTrails ? "flex" : "none";
  if (panel.style.display === "flex") refreshSonnerPanelLayout(map);
}

async function persistBookmarksAndRefreshUi(map) {
  const ids = Array.from(bookmarkedTrailIds);
  await persistTrailBookmarksToBridge(ids);
  syncBookmarkToastStack(map);
  updateDrawerBookmarkAffordanceIfOpen();
  refreshTrailInfoDrawerLayoutIfOpen();
  const panel = document.getElementById(TRAIL_SONNER_PANEL_ID);
  if (panel) {
    for (const row of panel.querySelectorAll(
      ".trail-overlay-sonner-trail-row[data-feature-id]"
    )) {
      const fid = row.getAttribute("data-feature-id");
      const bm = row.querySelector(".trail-overlay-sonner-trail-bm");
      if (fid && bm) updateDockCardBookmarkStar(bm, fid);
    }
  }
  updateSonnerPanelDisplayVisibility(map);
}

async function toggleBookmarkForFeatureId(map, featureId) {
  if (featureId == null) return;
  const fid = String(featureId);
  if (bookmarkedTrailIds.has(fid)) {
    bookmarkedTrailIds.delete(fid);
    lastAppliedBookmarkIds.delete(fid);
    setBookmarkStateOnMap(map, fid, false);
  } else {
    bookmarkedTrailIds.add(fid);
    lastAppliedBookmarkIds.add(fid);
    setBookmarkStateOnMap(map, fid, true);
  }
  await persistBookmarksAndRefreshUi(map);
}

function syncBookmarkToastStack(map) {
  if (!map || !overlayEnabled) {
    const panel = document.getElementById(TRAIL_SONNER_PANEL_ID);
    const stack = panel?.querySelector?.(".trail-overlay-sonner-bookmarks");
    if (stack) {
      for (const el of [...stack.querySelectorAll("[data-bookmark-feature-id]")]) {
        try {
          el.remove();
        } catch (_) {}
      }
      ensureBookmarksCover(stack);
    }
    updateSonnerPanelDisplayVisibility(map);
    return;
  }
  const panel = ensureSonnerPanelRoot(map);
  if (!panel) return;
  const stack = panel.querySelector(".trail-overlay-sonner-bookmarks");
  if (!stack) return;
  ensureBookmarksCover(stack);
  // “Bookmarks” card opens the list on hover (expanded mode).
  const cover = stack.querySelector(".trail-overlay-sonner-bookmarks-cover");
  if (cover && !cover.__trailOverlayHoverHooked) {
    cover.__trailOverlayHoverHooked = true;
    cover.addEventListener("mouseenter", () => setSonnerBookmarkHoverMode(panel, true));
  }

  if (bookmarkedTrailIds.size === 0) {
    for (const el of [...stack.querySelectorAll("[data-bookmark-feature-id]")]) {
      try {
        el.remove();
      } catch (_) {}
    }
    updateSonnerPanelDisplayVisibility(map);
    refreshSonnerPanelLayout(map);
    return;
  }

  updateSonnerPanelDisplayVisibility(map);
  refreshSonnerPanelLayout(map);

  const existing = new Map();
  for (const el of stack.querySelectorAll("[data-bookmark-feature-id]")) {
    const id = el.getAttribute("data-bookmark-feature-id");
    if (id) existing.set(id, el);
  }

  for (const fid of bookmarkedTrailIds) {
    let card = existing.get(fid);
    if (!card) {
      card = document.createElement("div");
      card.setAttribute("data-bookmark-feature-id", fid);
      card.setAttribute("role", "listitem");
      card.className = "trail-overlay-bookmark-toast-card";
      Object.assign(card.style, {
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        gap: "0",
        flexShrink: "0",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(22,22,26,0.96)",
        color: "#f4f4f5",
        boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        overflow: "hidden",
        cursor: "pointer",
        minHeight: "52px"
      });

      const thumb = document.createElement("div");
      thumb.className = "trail-overlay-bm-toast-thumb";
      Object.assign(thumb.style, {
        width: "52px",
        flex: "0 0 52px",
        background: "rgba(60,60,68,0.9)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      });

      const mid = document.createElement("div");
      Object.assign(mid.style, {
        flex: "1",
        minWidth: "0",
        padding: "8px 8px 8px 4px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "2px"
      });
      const titleEl = document.createElement("div");
      titleEl.className = "trail-overlay-bm-toast-title";
      Object.assign(titleEl.style, {
        fontSize: "13px",
        fontWeight: "600",
        lineHeight: "1.25",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      });
      mid.appendChild(titleEl);

      const sub = document.createElement("div");
      sub.className = "trail-overlay-bm-toast-sub";
      Object.assign(sub.style, {
        fontSize: "11px",
        color: "rgba(244,244,245,0.55)"
      });
      mid.appendChild(sub);

      const actions = document.createElement("div");
      Object.assign(actions.style, {
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid rgba(255,255,255,0.1)"
      });
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", "Remove bookmark");
      removeBtn.textContent = "×";
      Object.assign(removeBtn.style, {
        flex: "1",
        minHeight: "44px",
        width: "40px",
        border: "none",
        margin: "0",
        padding: "0",
        cursor: "pointer",
        fontSize: "20px",
        lineHeight: "1",
        color: "#fff",
        background: "rgba(255,255,255,0.06)"
      });
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void toggleBookmarkForFeatureId(map, fid);
      });
      actions.appendChild(removeBtn);

      card.appendChild(thumb);
      card.appendChild(mid);
      card.appendChild(actions);

      card.addEventListener("click", () => {
        const resolved = cachedTrails?.length
          ? findTrailByFeatureId(cachedTrails, fid)
          : null;
        if (resolved) {
          openTrailInfoDrawer(map, resolved.trail, {
            focusReturnEl: card,
            featureId: resolved.featureId
          });
        }
      });

      attachBookmarkCardHighlightListeners(map, card, fid);
      stack.appendChild(card);
    }

    const resolved = cachedTrails?.length
      ? findTrailByFeatureId(cachedTrails, fid)
      : null;
    const titleEl = card.querySelector(".trail-overlay-bm-toast-title");
    const sub = card.querySelector(".trail-overlay-bm-toast-sub");
    const thumb = card.querySelector(".trail-overlay-bm-toast-thumb");
    if (titleEl) {
      titleEl.textContent = resolved?.trail?.name || "Trail unavailable";
    }
    if (sub) {
      sub.textContent = resolved
        ? `${Number(resolved.trail.distanceKm ?? 0).toFixed(1)} km`
        : "Not in current trail list — remove bookmark";
    }
    if (thumb) {
      const url = resolved?.trail
        ? trailDockThumbUrlForTrail(resolved.trail)
        : null;
      fillTrailDockThumbWrap(thumb, url || "", resolved?.trail ?? null, {
        variant: "toast"
      });
    }
  }

  for (const el of stack.querySelectorAll("[data-bookmark-feature-id]")) {
    const id = el.getAttribute("data-bookmark-feature-id");
    if (id && !bookmarkedTrailIds.has(id)) {
      try {
        el.remove();
      } catch (_) {}
    }
  }

  // Default state: bookmarks hidden behind the cover card.
  if (panel.getAttribute("data-trail-overlay-bm-hover") === "1") {
    setBookmarkCardsVisible(stack, true);
  } else {
    setBookmarkCardsVisible(stack, false);
  }
}

function hydrateBookmarksFromIds(ids) {
  bookmarkedTrailIds = new Set(
    (ids || []).map((x) => String(x ?? "").trim()).filter(Boolean)
  );
}

function applyExternalBookmarkIds(map, ids) {
  hydrateBookmarksFromIds(ids);
  applyBookmarkFeatureStatesToMap(map);
  syncBookmarkToastStack(map);
  updateDrawerBookmarkAffordanceIfOpen();
  const panel = document.getElementById(TRAIL_SONNER_PANEL_ID);
  if (panel) {
    for (const row of panel.querySelectorAll(
      ".trail-overlay-sonner-trail-row[data-feature-id]"
    )) {
      const fid = row.getAttribute("data-feature-id");
      const bm = row.querySelector(".trail-overlay-sonner-trail-bm");
      if (fid && bm) updateDockCardBookmarkStar(bm, fid);
    }
  }
  updateSonnerPanelDisplayVisibility(map);
}

function renderTrailPhotoGalleryInto(container, photos) {
  container.replaceChildren();
  if (!photos?.length) {
    const empty = document.createElement("p");
    empty.textContent = "No published photos pinned to this trail yet.";
    Object.assign(empty.style, {
      fontSize: "12px",
      margin: "0",
      color: "rgba(244,244,245,0.55)"
    });
    container.appendChild(empty);
    return;
  }

  const ensureFullscreenViewer = () => {
    let viewer = document.getElementById("trail-overlay-photo-fullscreen");
    if (viewer) return viewer;

    viewer = document.createElement("div");
    viewer.id = "trail-overlay-photo-fullscreen";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.setAttribute("aria-label", "Photo viewer");
    Object.assign(viewer.style, {
      position: "fixed",
      inset: "0",
      zIndex: String(TRAIL_INFO_DRAWER_Z + 5),
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      padding:
        "max(14px, env(safe-area-inset-top, 0px)) max(14px, env(safe-area-inset-right, 0px)) max(14px, env(safe-area-inset-bottom, 0px)) max(14px, env(safe-area-inset-left, 0px))",
      background: "rgba(0,0,0,0.68)",
      backdropFilter: "blur(3px)"
    });

    const inner = document.createElement("div");
    inner.className = "trail-overlay-photo-fullscreen-inner";
    Object.assign(inner.style, {
      width: "min(1100px, 100%)",
      height: "min(86vh, 920px)",
      background: "rgba(18,18,20,0.97)",
      border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: "14px",
      boxShadow: "0 28px 90px rgba(0,0,0,0.65)",
      overflow: "hidden",
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    });

    const img = document.createElement("img");
    img.className = "trail-overlay-photo-fullscreen-img";
    img.alt = "";
    Object.assign(img.style, {
      width: "100%",
      height: "100%",
      objectFit: "contain",
      background: "rgba(0,0,0,0.35)",
      display: "block"
    });

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close photo viewer");
    Object.assign(close.style, {
      position: "absolute",
      top: "10px",
      right: "10px",
      width: "40px",
      height: "40px",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(0,0,0,0.55)",
      color: "#fff",
      fontSize: "24px",
      lineHeight: "38px",
      cursor: "pointer"
    });

    const hide = () => {
      viewer.style.display = "none";
      img.src = "";
      document.removeEventListener("keydown", onKeydown);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
      }
    };

    close.addEventListener("click", (e) => {
      e.stopPropagation();
      hide();
    });
    viewer.addEventListener("click", (e) => {
      if (e.target === viewer) hide();
    });
    inner.addEventListener("click", (e) => e.stopPropagation());

    viewer.__trailOverlayShow = (src) => {
      img.src = src || "";
      viewer.style.display = "flex";
      document.addEventListener("keydown", onKeydown);
      close.focus({ preventScroll: true });
    };

    inner.appendChild(img);
    inner.appendChild(close);
    viewer.appendChild(inner);
    document.body.appendChild(viewer);
    return viewer;
  };

  const grid = document.createElement("div");
  Object.assign(grid.style, {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
    gap: "8px",
    maxHeight: "340px",
    overflowY: "auto",
    overscrollBehavior: "contain"
  });
  for (const photo of photos) {
    const url = photo.thumbnailUrl || photo.blobUrl;
    const full = photo.blobUrl || url;
    if (!url) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", "Open photo");
    Object.assign(btn.style, {
      padding: "0",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "8px",
      overflow: "hidden",
      cursor: "pointer",
      background: "#2a2a30",
      aspectRatio: "1",
      display: "block",
      width: "100%"
    });
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = url;
    Object.assign(img.style, {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block"
    });
    btn.appendChild(img);
    btn.addEventListener("click", () => {
      const viewer = ensureFullscreenViewer();
      if (typeof viewer.__trailOverlayShow === "function") {
        viewer.__trailOverlayShow(full);
      }
    });
    grid.appendChild(btn);
  }
  container.appendChild(grid);
}

function mergeTrailPhotosForGallery(trailIdKey, fromApi, fromViewport) {
  const seen = new Set();
  const out = [];
  for (const p of fromApi || []) {
    if (p?.id && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  for (const p of fromViewport || []) {
    if (!p?.id || seen.has(p.id)) continue;
    if (p.trailId == null || normalizeTrailIdKey(p.trailId) !== trailIdKey) {
      continue;
    }
    seen.add(p.id);
    out.push(p);
  }
  out.sort((a, b) => {
    const ta = a.createdAt != null ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt != null ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  return out;
}

async function loadTrailPhotoGalleryInto(bodyEl, trail) {
  const loading = document.createElement("p");
  loading.className = "trail-overlay-gallery-status";
  loading.textContent = "Loading photos…";
  Object.assign(loading.style, {
    fontSize: "12px",
    margin: "0",
    color: "rgba(244,244,245,0.55)"
  });
  bodyEl.replaceChildren(loading);

  const trailIdKey = normalizeTrailIdKey(trail.id);
  if (!trailIdKey) {
    loading.textContent =
      "Photo gallery needs a trail id from the server (this trail has none).";
    return;
  }

  const fromViewport = lastViewportTrailPhotos.filter(
    (p) => p.trailId != null && normalizeTrailIdKey(p.trailId) === trailIdKey
  );

  try {
    const fromApi = await fetchTrailPhotosByTrailFromBridge(trail.id, 80);
    const merged = mergeTrailPhotosForGallery(
      trailIdKey,
      fromApi,
      fromViewport
    );
    renderTrailPhotoGalleryInto(bodyEl, merged);
  } catch (_) {
    if (fromViewport.length > 0) {
      renderTrailPhotoGalleryInto(bodyEl, fromViewport);
    } else {
      loading.textContent = "Could not load photos.";
    }
  }
}

/** Stats, notes, network, photo gallery, and comments (shared by the in-map drawer). */
function appendTrailDetailMainSections(host, trail) {
  const stats = document.createElement("p");
  const diff =
    trail.difficulty && trail.difficulty !== "not_set"
      ? trail.difficulty
      : "unrated";
  const dist =
    typeof trail.distanceKm === "number"
      ? `${Number(trail.distanceKm).toFixed(1)} km`
      : "";
  const gain =
    typeof trail.elevationGainFt === "number"
      ? `${Math.round(trail.elevationGainFt)} ft gain`
      : "";
  const dir =
    trail.direction && trail.direction !== "not_set" ? trail.direction : "";
  stats.textContent = [diff, dist, gain, dir].filter(Boolean).join(" · ");
  Object.assign(stats.style, {
    margin: "0 0 12px",
    fontSize: "14px",
    color: "rgba(244,244,245,0.85)"
  });
  host.appendChild(stats);

  if (trail.notes) {
    const notes = document.createElement("p");
    notes.textContent = trail.notes;
    Object.assign(notes.style, {
      margin: "0 0 16px",
      fontSize: "13px",
      fontStyle: "italic",
      color: "rgba(244,244,245,0.75)"
    });
    host.appendChild(notes);
  }

  let netName;
  if (trail.id != null && cachedNetworks?.length) {
    const tid = String(trail.id);
    for (const n of cachedNetworks) {
      if ((n.trailIds || []).some((id) => String(id) === tid)) {
        netName = n.name;
        break;
      }
    }
  }
  if (netName) {
    const networkLine = document.createElement("p");
    networkLine.textContent = `Network: ${netName}`;
    Object.assign(networkLine.style, {
      margin: "0 0 16px",
      fontSize: "12px",
      color: "rgba(244,244,245,0.55)"
    });
    host.appendChild(networkLine);
  }

  const secPhotos = document.createElement("div");
  const hP = document.createElement("div");
  hP.textContent = "Trail photos";
  Object.assign(hP.style, {
    fontWeight: "600",
    fontSize: "13px",
    marginBottom: "6px"
  });
  secPhotos.appendChild(hP);
  const galleryBody = document.createElement("div");
  galleryBody.className = "trail-overlay-gallery-body";
  Object.assign(galleryBody.style, {
    marginBottom: "0",
    minHeight: "36px"
  });
  secPhotos.appendChild(galleryBody);
  host.appendChild(secPhotos);
  void loadTrailPhotoGalleryInto(galleryBody, trail);

  const secCom = document.createElement("div");
  const hC = document.createElement("div");
  hC.textContent = "Comments";
  Object.assign(hC.style, {
    fontWeight: "600",
    fontSize: "13px",
    marginBottom: "6px"
  });
  secCom.appendChild(hC);
  const pC = document.createElement("p");
  pC.textContent = "Coming soon.";
  Object.assign(pC.style, {
    fontSize: "12px",
    margin: "0 0 16px",
    color: "rgba(244,244,245,0.55)"
  });
  secCom.appendChild(pC);
  host.appendChild(secCom);
}

/**
 * Large centered modal over the Mapbox map (dimmed backdrop; click backdrop to close).
 * Keeps line highlight via featureId while open; clears on close.
 */
function openTrailInfoDrawer(map, trail, opts) {
  const focusReturnEl = opts?.focusReturnEl ?? null;
  const featureId = opts?.featureId;
  if (!map || !featureId) return;

  closeTrailInfoDrawer();
  cancelScheduleClearDockHighlight();
  setDockLineHighlight(map, featureId);

  const container = getTrailOverlayMapDomContainer(map);
  if (!container) return;

  const font =
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif';

  const drawer = document.createElement("div");
  drawer.id = TRAIL_INFO_DRAWER_ID;
  drawer.__trailOverlayMap = map;
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "trail-overlay-drawer-title");
  Object.assign(drawer.style, {
    position: "absolute",
    inset: "0",
    zIndex: String(TRAIL_INFO_DRAWER_Z),
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding:
      "max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))",
    fontFamily: font,
    pointerEvents: "auto",
    background: "rgba(0,0,0,0.52)",
    backdropFilter: "blur(3px)"
  });
  drawer.addEventListener("click", (e) => {
    if (e.target === drawer) closeTrailInfoDrawer();
  });

  const inner = document.createElement("div");
  inner.className = "trail-overlay-drawer-inner";
  Object.assign(inner.style, {
    flex: "0 1 auto",
    minHeight: "0",
    width: "min(720px, calc(100% - 8px))",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    margin: "0",
    background: "rgba(18,18,20,0.97)",
    color: "#f4f4f5",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 24px 72px rgba(0,0,0,0.55)",
    backdropFilter: "blur(10px)",
    overflow: "hidden",
    boxSizing: "border-box"
  });
  inner.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    flex: "0 0 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.1)"
  });

  const title = document.createElement("h2");
  title.id = "trail-overlay-drawer-title";
  title.textContent = trail.name || "Trail";
  Object.assign(title.style, {
    margin: "0",
    fontSize: "18px",
    fontWeight: "700",
    lineHeight: "1.25",
    flex: "1",
    minWidth: "0",
    overflow: "hidden",
    wordBreak: "break-word"
  });
  title.style.setProperty("display", "-webkit-box");
  title.style.setProperty("-webkit-box-orient", "vertical");
  title.style.setProperty("-webkit-line-clamp", "2");
  header.appendChild(title);

  const bmHeaderBtn = document.createElement("button");
  bmHeaderBtn.type = "button";
  bmHeaderBtn.setAttribute("data-trail-overlay-drawer-bookmark", "1");
  bmHeaderBtn.textContent = bookmarkedTrailIds.has(String(featureId))
    ? "★"
    : "☆";
  bmHeaderBtn.setAttribute(
    "aria-label",
    bookmarkedTrailIds.has(String(featureId))
      ? "Remove bookmark"
      : "Bookmark trail"
  );
  Object.assign(bmHeaderBtn.style, {
    flex: "0 0 auto",
    width: "36px",
    height: "36px",
    padding: "0",
    fontSize: "18px",
    lineHeight: "34px",
    cursor: "pointer",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff"
  });
  bmHeaderBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void toggleBookmarkForFeatureId(map, featureId);
  });
  header.appendChild(bmHeaderBtn);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close trail details");
  closeBtn.textContent = "×";
  Object.assign(closeBtn.style, {
    flex: "0 0 auto",
    width: "36px",
    height: "36px",
    padding: "0",
    fontSize: "22px",
    lineHeight: "34px",
    cursor: "pointer",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff"
  });
  closeBtn.addEventListener("click", () => closeTrailInfoDrawer());
  header.appendChild(closeBtn);

  const scroll = document.createElement("div");
  Object.assign(scroll.style, {
    flex: "1",
    minHeight: "0",
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: "14px 16px 20px",
    WebkitOverflowScrolling: "touch"
  });
  appendTrailDetailMainSections(scroll, trail);

  inner.appendChild(header);
  inner.appendChild(scroll);
  drawer.appendChild(inner);
  drawer.__trailOverlayFeatureId = featureId;
  container.appendChild(drawer);

  const applyDrawerEdgeInsets = () => {
    const cr = container.getBoundingClientRect();
    const pad = 28;
    const bottomReserve = measureTrailDockBottomReservePx();
    const maxH = Math.max(300, Math.floor(cr.height - pad - bottomReserve));
    const maxW = Math.max(300, Math.floor(cr.width - 16));
    inner.style.maxHeight = `${maxH}px`;
    inner.style.width = `min(720px, ${maxW}px)`;
  };
  drawer.__trailOverlayApplyInsets = applyDrawerEdgeInsets;
  applyDrawerEdgeInsets();
  requestAnimationFrame(() => {
    applyDrawerEdgeInsets();
    requestAnimationFrame(applyDrawerEdgeInsets);
  });
  const resizeHandler = () => applyDrawerEdgeInsets();
  drawer.__trailOverlayResizeHandler = resizeHandler;
  window.addEventListener("resize", resizeHandler);

  drawer.__trailOverlayRestoreFocus =
    document.activeElement &&
    document.activeElement !== document.body &&
    typeof document.activeElement.focus === "function"
      ? document.activeElement
      : focusReturnEl;

  const escHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeTrailInfoDrawer();
    }
  };
  drawer.__trailOverlayEscHandler = escHandler;
  document.addEventListener("keydown", escHandler);

  closeBtn.focus({ preventScroll: true });
  cancelScheduleClearDockHighlight();
  setDockLineHighlight(map, featureId);
}

function trailDockThumbUrlForTrail(trail) {
  const tidKey =
    trail.id != null && String(trail.id).length > 0
      ? normalizeTrailIdKey(trail.id)
      : null;
  if (tidKey && trailPhotoPreviewByTrailId.has(tidKey)) {
    return trailPhotoPreviewByTrailId.get(tidKey);
  }
  return null;
}

function trailDockStripFullSignature(inViewCount, capped, overflow) {
  const rows = capped.map(({ trail, index }) => {
    const fid = trailMapFeatureId(trail, index);
    const thumb = trailDockThumbUrlForTrail(trail) || "";
    const name = trail.name || "Trail";
    const diff = trail.difficulty || "not_set";
    return `${fid}\t${name}\t${thumb}\t${diff}`;
  });
  return `iv=${inViewCount};ov=${overflow};` + rows.join("|");
}

function trailDockStripIdSignature(inViewCount, capped, overflow) {
  const ids = capped.map(({ trail, index }) => trailMapFeatureId(trail, index));
  return `iv=${inViewCount};ov=${overflow};` + ids.join("|");
}

/**
 * When a trail has no preview photo, show ski-style difficulty shapes (circle / square / diamond(s)).
 */
function fillDifficultyIconPlaceholder(thumbWrap, difficulty) {
  const d =
    difficulty && typeof difficulty === "string" ? difficulty : "not_set";
  const row = document.createElement("div");
  row.setAttribute("role", "img");
  row.setAttribute(
    "aria-label",
    d === "easy"
      ? "Green circle, easy difficulty"
      : d === "intermediate"
        ? "Blue square, intermediate difficulty"
        : d === "hard"
          ? "Black diamond, hard difficulty"
          : d === "pro"
            ? "Double black diamond, pro difficulty"
            : "Difficulty not set"
  );
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    gap: "5px",
    pointerEvents: "none"
  });

  const diamond = (sizePx) => {
    const el = document.createElement("div");
    Object.assign(el.style, {
      width: `${sizePx}px`,
      height: `${sizePx}px`,
      background: "#1c1b22",
      border: "1.5px solid rgba(244,244,245,0.85)",
      boxSizing: "border-box",
      transform: "rotate(45deg)",
      borderRadius: "1px",
      flexShrink: "0"
    });
    return el;
  };

  if (d === "easy") {
    const c = document.createElement("div");
    Object.assign(c.style, {
      width: "24px",
      height: "24px",
      borderRadius: "50%",
      background: "#34a56d",
      border: "2px solid rgba(255,255,255,0.45)",
      boxSizing: "border-box",
      flexShrink: "0"
    });
    row.appendChild(c);
  } else if (d === "intermediate") {
    const s = document.createElement("div");
    Object.assign(s.style, {
      width: "22px",
      height: "22px",
      borderRadius: "3px",
      background: "#156be8",
      border: "2px solid rgba(255,255,255,0.45)",
      boxSizing: "border-box",
      flexShrink: "0"
    });
    row.appendChild(s);
  } else if (d === "hard") {
    row.appendChild(diamond(13));
  } else if (d === "pro") {
    row.appendChild(diamond(11));
    row.appendChild(diamond(11));
  } else {
    const c = document.createElement("div");
    Object.assign(c.style, {
      width: "22px",
      height: "22px",
      borderRadius: "50%",
      background: "rgba(120,120,132,0.85)",
      border: "2px dashed rgba(255,255,255,0.35)",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "11px",
      fontWeight: "700",
      color: "rgba(255,255,255,0.65)"
    });
    c.textContent = "?";
    row.appendChild(c);
  }

  thumbWrap.appendChild(row);
}

/**
 * @param trail Optional trail row — used for difficulty placeholder when `thumbUrl` is empty.
 * @param opts Optional `{ variant: "toast" }` for bookmark stack (taller slot).
 */
function fillTrailDockThumbWrap(thumbWrap, thumbUrl, trail, opts) {
  thumbWrap.replaceChildren();
  const isToast = opts?.variant === "toast";
  Object.assign(thumbWrap.style, {
    width: "100%",
    height: isToast ? "100%" : "44px",
    minHeight: isToast ? "52px" : "",
    background: "rgba(60,60,68,0.9)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  });
  if (thumbUrl) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = thumbUrl;
    Object.assign(img.style, {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block"
    });
    thumbWrap.appendChild(img);
  } else {
    fillDifficultyIconPlaceholder(
      thumbWrap,
      trail && typeof trail === "object" ? trail.difficulty : null
    );
  }
}

function attachTrailDockCardListeners(map, card, featureId, trail) {
  card.addEventListener("pointerenter", () => {
    setDockLineHighlight(map, featureId);
  });
  card.addEventListener("pointerleave", () => {
    const dr = document.getElementById(TRAIL_INFO_DRAWER_ID);
    if (
      dr &&
      dr.__trailOverlayFeatureId != null &&
      dr.__trailOverlayFeatureId === featureId
    ) {
      return;
    }
    scheduleClearDockLineHighlight(map);
  });
  card.addEventListener("focus", () => {
    setDockLineHighlight(map, featureId);
  });
  card.addEventListener("blur", () => {
    const dr = document.getElementById(TRAIL_INFO_DRAWER_ID);
    if (
      dr &&
      dr.__trailOverlayFeatureId != null &&
      dr.__trailOverlayFeatureId === featureId
    ) {
      return;
    }
    scheduleClearDockLineHighlight(map);
  });
  card.addEventListener("click", () => {
    openTrailInfoDrawer(map, trail, { focusReturnEl: card, featureId });
  });
}

function attachBookmarkCardHighlightListeners(map, card, featureId) {
  if (!card || !featureId) return;
  const enter = () => setDockLineHighlight(map, featureId);
  const leave = () => {
    const dr = document.getElementById(TRAIL_INFO_DRAWER_ID);
    if (dr && dr.__trailOverlayFeatureId != null && dr.__trailOverlayFeatureId === featureId) {
      return;
    }
    scheduleClearDockLineHighlight(map);
  };
  card.addEventListener("pointerenter", enter);
  card.addEventListener("pointerleave", leave);
  card.addEventListener("focus", enter);
  card.addEventListener("blur", leave);
}

function createSonnerTrailListRow(map, trail, index) {
  const featureId = trailMapFeatureId(trail, index);
  const thumbUrl = trailDockThumbUrlForTrail(trail);

  const row = document.createElement("div");
  row.className = "trail-overlay-sonner-trail-row";
  row.setAttribute("data-feature-id", featureId);
  row.setAttribute("role", "listitem");
  Object.assign(row.style, {
    display: "flex",
    flexDirection: "row",
    alignItems: "stretch",
    flexShrink: "0",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(22,22,26,0.96)",
    overflow: "hidden",
    minHeight: "52px"
  });

  const main = document.createElement("div");
  main.className = "trail-overlay-sonner-trail-main";
  main.setAttribute("role", "button");
  main.setAttribute("tabindex", "0");
  Object.assign(main.style, {
    flex: "1",
    minWidth: "0",
    display: "flex",
    flexDirection: "row",
    alignItems: "stretch",
    cursor: "pointer",
    textAlign: "left",
    color: "#f4f4f5"
  });

  const thumbWrap = document.createElement("div");
  thumbWrap.className = "trail-overlay-sonner-trail-thumb";
  Object.assign(thumbWrap.style, {
    width: "52px",
    flex: "0 0 52px",
    background: "rgba(60,60,68,0.9)"
  });
  fillTrailDockThumbWrap(thumbWrap, thumbUrl, trail, { variant: "toast" });

  const mid = document.createElement("div");
  Object.assign(mid.style, {
    flex: "1",
    minWidth: "0",
    padding: "8px 8px 8px 6px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "2px"
  });
  const titleEl = document.createElement("div");
  titleEl.className = "trail-overlay-sonner-trail-title";
  titleEl.textContent = trail.name || "Trail";
  Object.assign(titleEl.style, {
    fontSize: "13px",
    fontWeight: "600",
    lineHeight: "1.25",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  });
  const sub = document.createElement("div");
  sub.className = "trail-overlay-sonner-trail-sub";
  sub.textContent = `${Number(trail.distanceKm ?? 0).toFixed(1)} km`;
  Object.assign(sub.style, {
    fontSize: "11px",
    color: "rgba(244,244,245,0.55)"
  });
  mid.appendChild(titleEl);
  mid.appendChild(sub);

  main.appendChild(thumbWrap);
  main.appendChild(mid);
  main.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openTrailInfoDrawer(map, trail, { focusReturnEl: main, featureId });
    }
  });
  attachTrailDockCardListeners(map, main, featureId, trail);

  const bmBtn = document.createElement("button");
  bmBtn.type = "button";
  bmBtn.className = "trail-overlay-sonner-trail-bm";
  Object.assign(bmBtn.style, {
    flex: "0 0 40px",
    width: "40px",
    border: "none",
    borderLeft: "1px solid rgba(255,255,255,0.1)",
    margin: "0",
    padding: "0",
    cursor: "pointer",
    fontSize: "16px",
    lineHeight: "1",
    color: "#fff",
    background: "rgba(255,255,255,0.06)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  });
  bmBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void toggleBookmarkForFeatureId(map, featureId);
  });
  updateDockCardBookmarkStar(bmBtn, featureId);

  row.appendChild(main);
  row.appendChild(bmBtn);
  return row;
}

function applyTrailDockOverflowLine(more, overflow) {
  if (overflow > 0) {
    more.style.display = "block";
    more.textContent = `+ ${overflow} more trails in view`;
  } else {
    more.style.display = "none";
    more.textContent = "";
  }
}

function sonnerTrailScrollDistanceFromEnd(scrollEl) {
  if (!scrollEl || scrollEl.clientHeight < 1) return 0;
  return Math.max(
    0,
    scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight
  );
}

function sonnerTrailScrollSetDistanceFromEnd(scrollEl, distFromEnd) {
  if (!scrollEl) return;
  scrollEl.scrollTop = Math.max(
    0,
    scrollEl.scrollHeight - scrollEl.clientHeight - distFromEnd
  );
}

/** Safari-style stacked tabs: each card overlaps the one below; scroll pinned to newest (bottom). */
function setBookmarkCardsVisible(stack, visible) {
  if (!stack) return;
  for (const card of stack.querySelectorAll("[data-bookmark-feature-id]")) {
    card.style.display = visible ? "flex" : "none";
  }
}

function setSonnerBookmarkHoverMode(panel, on) {
  if (!panel) return;
  const trailsCol = panel.querySelector(".trail-overlay-sonner-trails-col");
  const stack = panel.querySelector(".trail-overlay-sonner-bookmarks");
  if (!stack) return;
  // When hovering bookmarks we want the cover to act like the entry card only.
  const cover = stack.querySelector(".trail-overlay-sonner-bookmarks-cover");
  const isMin = panel.getAttribute("data-trail-overlay-minimized") === "1";

  if (on) {
    panel.setAttribute("data-trail-overlay-bm-hover", "1");
    stack.setAttribute("data-trail-overlay-expanded", "1");
    if (trailsCol) trailsCol.style.display = "none";

    // Take over the panel height and show the full list.
    stack.style.flex = "1";
    stack.style.maxHeight = "none";
    stack.style.gap = "8px";
    stack.style.paddingTop = "10px";
    // Extra bottom padding so the last card/cover isn't clipped.
    stack.style.paddingBottom = "16px";
    if (cover) {
      cover.style.marginBottom = "10px";
      const hint = cover.querySelector(".trail-overlay-sonner-bookmarks-cover-hint");
      if (hint) hint.textContent = "Bookmarks";
    }

    setBookmarkCardsVisible(stack, true);
    return;
  }

  panel.removeAttribute("data-trail-overlay-bm-hover");
  stack.removeAttribute("data-trail-overlay-expanded");
  if (trailsCol) trailsCol.style.display = isMin ? "none" : "flex";

  // Collapse back to a single “Bookmarks” card.
  stack.style.flex = "0 1 auto";
  stack.style.gap = "0";
  stack.style.paddingTop = "2px";
  stack.style.paddingBottom = "8px";
  if (cover) {
    cover.style.marginBottom = "6px";
    const hint = cover.querySelector(".trail-overlay-sonner-bookmarks-cover-hint");
    if (hint) hint.textContent = "Hover to open";
  }
  setBookmarkCardsVisible(stack, false);
  refreshSonnerPanelLayout(trailOverlayMapRef);
}

function setSonnerPanelMinimized(panel, on) {
  if (!panel) return;
  const trailsCol = panel.querySelector(".trail-overlay-sonner-trails-col");
  const stack = panel.querySelector(".trail-overlay-sonner-bookmarks");
  const toggleBtns = panel.querySelectorAll("[data-trail-overlay-minimize-btn]");
  if (!stack) return;

  if (on) {
    panel.setAttribute("data-trail-overlay-minimized", "1");
    if (trailsCol) trailsCol.style.display = "none";
    stack.style.flex = "0 0 auto";
    stack.style.maxHeight = "52px";
    stack.style.overflowY = "auto";
    stack.style.paddingTop = "2px";
    stack.style.paddingBottom = "8px";
    stack.style.gap = "0";
    setBookmarkCardsVisible(stack, false);
    for (const b of toggleBtns) b.textContent = "▴";
    return;
  }

  panel.removeAttribute("data-trail-overlay-minimized");
  if (trailsCol) trailsCol.style.display = "flex";
  stack.style.flex = "0 1 auto";
  stack.style.gap = "0";
  for (const b of toggleBtns) b.textContent = "▾";
  refreshSonnerPanelLayout(trailOverlayMapRef);
  setBookmarkCardsVisible(stack, false);
}

function ensureBookmarksCover(stack) {
  if (!stack) return null;
  let cover = stack.querySelector(".trail-overlay-sonner-bookmarks-cover");
  if (cover) return cover;
  cover = document.createElement("div");
  cover.className = "trail-overlay-sonner-bookmarks-cover";
  Object.assign(cover.style, {
    position: "sticky",
    top: "0",
    zIndex: "500",
    height: "40px",
    margin: "0",
    display: "flex",
    alignItems: "center",
    pointerEvents: "auto",
    backdropFilter: "blur(8px)",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(22,22,26,0.92)",
    boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
    cursor: "pointer"
  });
  const icon = document.createElement("div");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "🔖";
  Object.assign(icon.style, {
    width: "34px",
    height: "34px",
    marginLeft: "6px",
    marginRight: "2px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    background: "rgba(0,0,0,0.22)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: "10px",
    flex: "0 0 auto"
  });
  const label = document.createElement("div");
  label.textContent = "Bookmarks";
  Object.assign(label.style, {
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "rgba(244,244,245,0.72)",
    paddingLeft: "10px",
    flex: "1",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  });
  const hint = document.createElement("div");
  hint.className = "trail-overlay-sonner-bookmarks-cover-hint";
  hint.textContent = "Hover to open";
  Object.assign(hint.style, {
    fontSize: "11px",
    color: "rgba(244,244,245,0.45)",
    paddingRight: "10px",
    flex: "0 0 auto"
  });
  cover.appendChild(icon);
  cover.appendChild(label);
  cover.appendChild(hint);
  stack.prepend(cover);
  return cover;
}

function updateTrailDockCore(map) {
  const existingPanel = document.getElementById(TRAIL_SONNER_PANEL_ID);

  if (!map || !overlayEnabled) {
    clearDockLineHighlight(map);
    if (map) {
      map.__trailOverlayDockFullSig = null;
      map.__trailOverlayDockIdSig = null;
    }
    if (existingPanel) {
      const sc = existingPanel.querySelector(".trail-overlay-sonner-trails-scroll");
      if (sc) sc.replaceChildren();
      const moreEl = existingPanel.querySelector(".trail-overlay-sonner-trails-more");
      if (moreEl) applyTrailDockOverflowLine(moreEl, 0);
    }
    updateSonnerPanelDisplayVisibility(map);
    return;
  }

  if (
    !overlayTrailsVisible ||
    !cachedTrails?.length ||
    !map.getSource(SOURCE_ID)
  ) {
    clearDockLineHighlight(map);
    if (map) {
      map.__trailOverlayDockFullSig = null;
      map.__trailOverlayDockIdSig = null;
    }
    if (existingPanel) {
      const scroll = existingPanel.querySelector(".trail-overlay-sonner-trails-scroll");
      if (scroll) scroll.replaceChildren();
      const moreEl = existingPanel.querySelector(".trail-overlay-sonner-trails-more");
      if (moreEl) applyTrailDockOverflowLine(moreEl, 0);
    }
    updateSonnerPanelDisplayVisibility(map);
    return;
  }

  const root = ensureSonnerPanelRoot(map);
  if (!root) {
    updateSonnerPanelDisplayVisibility(map);
    return;
  }

  const scroll = root.querySelector(".trail-overlay-sonner-trails-scroll");
  const more = root.querySelector(".trail-overlay-sonner-trails-more");
  if (!scroll || !more) return;

  const inView = getTrailsInViewport(map, cachedTrails);
  let capped = inView.slice(0, TRAIL_SONNER_LIST_MAX);
  if (recentHoveredTrailFeatureIds.length > 0 && capped.length > 1) {
    const rank = new Map();
    recentHoveredTrailFeatureIds.forEach((fid, i) => rank.set(fid, i));
    capped = capped
      .map((row, originalIndex) => ({ row, originalIndex }))
      .sort((a, b) => {
        const aId = trailMapFeatureId(a.row.trail, a.row.index);
        const bId = trailMapFeatureId(b.row.trail, b.row.index);
        const ar = rank.has(aId) ? rank.get(aId) : Number.POSITIVE_INFINITY;
        const br = rank.has(bId) ? rank.get(bId) : Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        return a.originalIndex - b.originalIndex;
      })
      .map((x) => x.row);
  }
  const overflow = inView.length - capped.length;

  const fullSig = trailDockStripFullSignature(inView.length, capped, overflow);
  if (fullSig === map.__trailOverlayDockFullSig) {
    applyTrailDockOverflowLine(more, overflow);
    updateSonnerPanelDisplayVisibility(map);
    if (inView.length === 0) clearDockLineHighlight(map);
    return;
  }

  const idSig = trailDockStripIdSignature(inView.length, capped, overflow);
  const prevDistFromEnd = sonnerTrailScrollDistanceFromEnd(scroll);

  if (
    idSig === map.__trailOverlayDockIdSig &&
    scroll.children.length === capped.length &&
    capped.length > 0
  ) {
    let structureOk = true;
    for (let i = 0; i < capped.length; i++) {
      const { trail, index } = capped[i];
      const featureId = trailMapFeatureId(trail, index);
      const row = scroll.children[i];
      if (
        !row ||
        row.getAttribute("data-feature-id") !== featureId ||
        !row.classList.contains("trail-overlay-sonner-trail-row")
      ) {
        structureOk = false;
        break;
      }
      const thumbUrl = trailDockThumbUrlForTrail(trail);
      const thumbWrap = row.querySelector(".trail-overlay-sonner-trail-thumb");
      if (thumbWrap) {
        fillTrailDockThumbWrap(thumbWrap, thumbUrl, trail, { variant: "toast" });
      }
      const titleEl = row.querySelector(".trail-overlay-sonner-trail-title");
      if (titleEl) titleEl.textContent = trail.name || "Trail";
      const subEl = row.querySelector(".trail-overlay-sonner-trail-sub");
      if (subEl) {
        subEl.textContent = `${Number(trail.distanceKm ?? 0).toFixed(1)} km`;
      }
      const bm = row.querySelector(".trail-overlay-sonner-trail-bm");
      if (bm) updateDockCardBookmarkStar(bm, featureId);
    }
    if (structureOk) {
      map.__trailOverlayDockFullSig = fullSig;
      sonnerTrailScrollSetDistanceFromEnd(scroll, prevDistFromEnd);
      applyTrailDockOverflowLine(more, overflow);
      updateSonnerPanelDisplayVisibility(map);
      if (inView.length === 0) clearDockLineHighlight(map);
      return;
    }
  }

  scroll.replaceChildren();
  for (const { trail, index } of capped) {
    scroll.appendChild(createSonnerTrailListRow(map, trail, index));
  }

  map.__trailOverlayDockFullSig = fullSig;
  map.__trailOverlayDockIdSig = idSig;
  sonnerTrailScrollSetDistanceFromEnd(scroll, prevDistFromEnd);

  applyTrailDockOverflowLine(more, overflow);

  updateSonnerPanelDisplayVisibility(map);
  if (inView.length === 0) {
    clearDockLineHighlight(map);
  }
}

function updateTrailDock(map) {
  updateTrailDockCore(map);
  refreshTrailInfoDrawerLayoutIfOpen();
}

function scheduleTrailDockRefresh(map) {
  if (!map) return;
  clearTimeout(dockRefreshTimer);
  dockRefreshTimer = setTimeout(() => {
    dockRefreshTimer = null;
    updateTrailDock(map);
  }, 400);
}

// Find the <ul> inside Strava's "Map display" section, then wait 500 ms for it to
// stop changing before resolving — so we inject after the sidebar has settled.
function waitForMapDisplayUl(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let settleTimer = null;

    const findUl = () => {
      for (const h4 of document.querySelectorAll("h4")) {
        if (h4.textContent.trim().toLowerCase() === "map display") {
          const section =
            h4.closest('[class*="RoutePreferenceSidebar_section"]') ||
            h4.parentElement;
          const ul = section?.querySelector("ul");
          if (ul?.querySelector("li")) return ul;
        }
      }
      return null;
    };

    const poll = setInterval(() => {
      const ul = findUl();
      if (ul) {
        clearInterval(poll);
        // Wait for sidebar to stop mutating before we inject
        clearTimeout(settleTimer);
        const observer = new MutationObserver(() => {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => {
            observer.disconnect();
            resolve(ul);
          }, 500);
        });
        observer.observe(ul, {
          childList: true,
          subtree: true,
          attributes: true
        });
        // Kick off the timer in case there are no mutations at all
        settleTimer = setTimeout(() => {
          observer.disconnect();
          resolve(ul);
        }, 500);
      } else if (Date.now() > deadline) {
        clearInterval(poll);
        resolve(null);
      }
    }, 300);
  });
}

async function injectToggle(map, enabled) {
  document.getElementById("trail-overlay-toggle-li")?.remove();

  const onChange = async (on) => {
    await setEnabled(on);
    overlayEnabled = on;
    if (on) {
      applyMapLayersFromPrefs(map, {
        enabled: true,
        trailsVisible: overlayTrailsVisible,
        networksVisible: overlayNetworksVisible,
        photosVisible: overlayTrailPhotosVisible,
        bookmarkHighlightColor: overlayBookmarkHighlightColor
      });
    } else {
      removeLayers(map);
    }
  };

  const ul = await waitForMapDisplayUl();
  if (!ul) {
    return;
  }

  // Clone the first <li> so we inherit all of Strava's CSS module classes
  const li = ul.querySelector("li").cloneNode(true);
  li.id = "trail-overlay-toggle-li";

  // Swap icon for a simple trail/mountain SVG
  const existingIcon = li.querySelector("label > div > svg, label > div > img");
  if (existingIcon) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "currentColor");
    // Simple mountain/trail path
    svg.innerHTML = '<path d="M8 2L2 13h12L8 2zm0 2.8L12.2 12H3.8L8 4.8z"/>';
    existingIcon.replaceWith(svg);
  }

  // Update label text (the innermost span inside the content div)
  const textSpan = li.querySelector("label > div > span");
  if (textSpan) textSpan.textContent = "Trail Overlay";

  // Remove conflicting id/name/for attributes
  li.querySelector("label")?.removeAttribute("for");
  const input = li.querySelector('input[type="checkbox"]');
  if (input) {
    input.removeAttribute("id");
    input.removeAttribute("name");
  }

  // Detect the "active" modifier class from any currently-active switch
  const activeSwitch = ul.querySelector(
    'span[role="checkbox"][aria-checked="true"]'
  );
  const activeClass = activeSwitch
    ? [...activeSwitch.classList].find((c) => /active/i.test(c))
    : null;

  // Apply initial enabled state
  const switchSpan = li.querySelector('span[role="checkbox"]');
  if (switchSpan) {
    const applyState = (on) => {
      if (activeClass) switchSpan.classList.toggle(activeClass, on);
      switchSpan.setAttribute("aria-checked", String(on));
      if (input) input.checked = on;
    };
    applyState(enabled);

    const toggle = () => {
      const nowOn = switchSpan.getAttribute("aria-checked") !== "true";
      applyState(nowOn);
      onChange(nowOn);
    };
    switchSpan.addEventListener("click", toggle);
    switchSpan.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle();
      }
    });
  }

  ul.appendChild(li);
}

function normalizeOverlayPrefs(prefs) {
  const raw =
    typeof prefs.bookmarkHighlightColor === "string" &&
    prefs.bookmarkHighlightColor.trim().length > 0
      ? prefs.bookmarkHighlightColor.trim()
      : DEFAULT_OVERLAY_PREFS.bookmarkHighlightColor;
  return {
    enabled: prefs.enabled !== false,
    trailsVisible: prefs.trailsVisible !== false,
    networksVisible: prefs.networksVisible !== false,
    photosVisible: prefs.photosVisible !== false,
    bookmarkHaloHex: resolveBookmarkHaloLineColor(raw)
  };
}

function overlayPrefsShallowEqual(a, b) {
  return (
    a.enabled === b.enabled &&
    a.trailsVisible === b.trailsVisible &&
    a.networksVisible === b.networksVisible &&
    a.photosVisible === b.photosVisible &&
    a.bookmarkHaloHex === b.bookmarkHaloHex
  );
}

/** True when Mapbox still has the sources/layers this pref set expects. */
function overlayMapMatchesPrefs(map, n) {
  const trailOk =
    !n.trailsVisible || (map.getSource(SOURCE_ID) && map.getLayer(LAYER_ID));
  const netOk =
    !n.networksVisible ||
    (map.getSource(NETWORK_SOURCE_ID) && map.getLayer(NETWORK_FILL_LAYER));
  return trailOk && netOk;
}

/** Keep Strava sidebar switch in sync when overlayEnabled changes from the extension popup. */
function syncStravaMapDisplayToggle(enabled) {
  const li = document.getElementById("trail-overlay-toggle-li");
  if (!li) return;
  const ul = li.closest("ul");
  const activeSwitch = ul?.querySelector(
    'span[role="checkbox"][aria-checked="true"]'
  );
  const activeClass = activeSwitch
    ? [...activeSwitch.classList].find((c) => /active/i.test(c))
    : null;
  const switchSpan = li.querySelector('span[role="checkbox"]');
  const input = li.querySelector('input[type="checkbox"]');
  if (!switchSpan) return;
  if (activeClass) switchSpan.classList.toggle(activeClass, enabled);
  switchSpan.setAttribute("aria-checked", String(enabled));
  if (input) input.checked = enabled;
}

/** Add/remove trail and network layers according to prefs (master + per-asset). */
function applyMapLayersFromPrefs(map, prefs) {
  if (!map) return;
  const n = normalizeOverlayPrefs(prefs);
  overlayBookmarkHaloHex = n.bookmarkHaloHex;
  applyBookmarkHaloPaintIfNeeded(map);

  if (!n.enabled) {
    map.__trailOverlayLastAppliedPrefs = { ...n };
    removeLayers(map);
    return;
  }

  const prev = map.__trailOverlayLastAppliedPrefs;
  if (
    prev &&
    overlayPrefsShallowEqual(prev, n) &&
    overlayMapMatchesPrefs(map, n)
  ) {
    scheduleTrailDockRefresh(map);
    syncBookmarkToastStack(map);
    return;
  }

  if (cachedTrails == null || cachedNetworks == null) {
    closeTrailInfoDrawer();
    stripTrailLineLayersFromMap(map);
    stripNetworkLayersFromMap(map);
    map.__trailOverlayLastAppliedPrefs = { ...n };
    scheduleTrailDockRefresh(map);
    syncBookmarkToastStack(map);
    return;
  }

  if (n.networksVisible) {
    if (!map.getSource(NETWORK_SOURCE_ID)) {
      addNetworksToMap(map, cachedNetworks);
    }
  } else {
    stripNetworkLayersFromMap(map);
  }

  if (!n.trailsVisible) {
    closeTrailInfoDrawer();
    stripTrailLineLayersFromMap(map);
  } else {
    addTrailsToMap(map, cachedTrails, cachedNetworks);
  }

  if (n.photosVisible) {
    scheduleViewportPhotoPreviewFetch(map);
  } else {
    lastViewportTrailPhotos = [];
    rebuildTrailPhotoPreviewsFromPhotos([]);
  }

  map.__trailOverlayLastAppliedPrefs = { ...n };
  scheduleTrailDockRefresh(map);
  syncBookmarkToastStack(map);
}

/** Sync prefs from storage (popup / other tabs / Strava master switch). */
function applyOverlayPrefsFromMessage(prefs) {
  overlayEnabled = prefs.enabled !== false;
  overlayTrailsVisible = prefs.trailsVisible !== false;
  overlayNetworksVisible = prefs.networksVisible !== false;
  overlayTrailPhotosVisible = prefs.photosVisible !== false;
  if (
    prefs.bookmarkHighlightColor != null &&
    String(prefs.bookmarkHighlightColor).trim().length > 0
  ) {
    overlayBookmarkHighlightColor = String(prefs.bookmarkHighlightColor).trim();
  }
  syncStravaMapDisplayToggle(overlayEnabled);
  const map =
    trailOverlayMapRef && isMapboxLikeMap(trailOverlayMapRef)
      ? trailOverlayMapRef
      : tryFindMap();
  if (!map) return;
  applyMapLayersFromPrefs(map, {
    enabled: overlayEnabled,
    trailsVisible: overlayTrailsVisible,
    networksVisible: overlayNetworksVisible,
    photosVisible: overlayTrailPhotosVisible,
    bookmarkHighlightColor: overlayBookmarkHighlightColor
  });
}

// --- STREET VIEW ---

const STREET_VIEW_PANEL_ID = "trail-overlay-street-view-panel";
let googleMapsApiKey = "";
let mapillaryClientToken = "";

async function fetchGoogleMapsApiKeyFromBridge() {
  return fetchFromBridgeWithTimeout(
    "GET_GOOGLE_MAPS_API_KEY",
    "GOOGLE_MAPS_API_KEY_RESPONSE",
    "",
    (data) => data.apiKey || "",
    { requestSource: "trail-overlay-content" },
    5000
  );
}

async function fetchRightClickViewerFromBridge() {
  return fetchFromBridgeWithTimeout(
    "GET_RIGHT_CLICK_VIEWER",
    "RIGHT_CLICK_VIEWER_RESPONSE",
    "mapillary",
    (data) => data.viewer || "mapillary",
    { requestSource: "trail-overlay-content" },
    5000
  );
}

async function fetchMapillaryClientTokenFromBridge() {
  return fetchFromBridgeWithTimeout(
    "GET_MAPILLARY_CLIENT_TOKEN",
    "MAPILLARY_CLIENT_TOKEN_RESPONSE",
    "",
    (data) => data.token || "",
    { requestSource: "trail-overlay-content" },
    5000
  );
}

function closeStreetViewPanel() {
  const panel = document.getElementById(STREET_VIEW_PANEL_ID);
  if (panel && panel.__streetViewPanorama) {
    panel.__streetViewPanorama = null;
  }
  if (panel && panel.__removeStreetViewMarker) {
    panel.__removeStreetViewMarker();
  }
  if (panel && panel.__cleanup) {
    panel.__cleanup();
  }
  if (panel) panel.remove();
}

function createStreetViewPanel(lat, lng) {
  closeStreetViewPanel();

  const container = document.querySelector(".mapboxgl-map, .maplibregl-map");
  if (!container) return;

  const panel = document.createElement("div");
  panel.id = STREET_VIEW_PANEL_ID;
  panel.__isExpanded = false;

  const applySize = () => {
    const isExpanded = panel.__isExpanded;
    Object.assign(panel.style, {
    position: "absolute",
    bottom: "20px",
    left: "20px",
    width: isExpanded ? "700px" : "400px",
    height: isExpanded ? "500px" : "300px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(18,18,20,0.95)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
    backdropFilter: "blur(8px)",
    zIndex: "10000",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif',
    transition: "width 0.2s ease, height 0.2s ease"
    });
  };
  applySize();

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    flex: "0 0 auto",
    background: "rgba(0,0,0,0.2)",
    zIndex: "10001"
  });

  const title = document.createElement("span");
  title.textContent = "Street View";
  Object.assign(title.style, {
    fontSize: "13px",
    fontWeight: "600",
    color: "rgba(244,244,245,0.9)"
  });

  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.textContent = "⛶";
  Object.assign(expandBtn.style, {
    width: "28px",
    height: "28px",
    padding: "0",
    border: "none",
    background: "none",
    color: "rgba(244,244,245,0.6)",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: "26px",
    marginRight: "4px"
  });
  expandBtn.addEventListener("click", () => {
    panel.__isExpanded = !panel.__isExpanded;
    expandBtn.textContent = panel.__isExpanded ? "-" : "+";
    expandBtn.style.color = panel.__isExpanded
      ? "rgba(244,244,245,0.9)"
      : "rgba(244,244,245,0.6)";
    applySize();
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  Object.assign(closeBtn.style, {
    width: "28px",
    height: "28px",
    padding: "0",
    border: "none",
    background: "none",
    color: "rgba(244,244,245,0.6)",
    cursor: "pointer",
    fontSize: "20px",
    lineHeight: "26px"
  });
  closeBtn.addEventListener("click", closeStreetViewPanel);

  header.appendChild(title);
  header.appendChild(expandBtn);
  header.appendChild(closeBtn);

  const content = document.createElement("div");
  content.id = "trail-overlay-street-view-panorama";
  content.className = "trail-overlay-street-view-content";
  Object.assign(content.style, {
    flex: "1",
    minHeight: "0",
    position: "relative",
    background: "rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  });

  // Placeholder while loading
  const loading = document.createElement("div");
  loading.textContent = "Loading Street View...";
  Object.assign(loading.style, {
    fontSize: "12px",
    color: "rgba(244,244,245,0.5)",
    textAlign: "center"
  });
  content.appendChild(loading);

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    background: "rgba(0,0,0,0.4)",
    fontSize: "11px",
    color: "rgba(244,244,245,0.6)",
    flex: "0 0 auto",
    backdropFilter: "blur(4px)"
  });
  footer.innerHTML = `<span>${lat.toFixed(4)}° ${lng.toFixed(4)}°</span><span style="font-size: 10px; color: rgba(244,244,245,0.4);">drag to pan • scroll to zoom</span>`;

  panel.appendChild(header);
  panel.appendChild(content);
  panel.appendChild(footer);
  container.appendChild(panel);

  // --- DRAG AND RESIZE ---
  let isDragging = false;
  let isResizing = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;

  header.style.cursor = "grab";
  header.addEventListener("mousedown", (e) => {
    if (e.target === expandBtn || e.target === closeBtn) return;
    isDragging = true;
    dragOffsetX = e.clientX - panel.offsetLeft;
    dragOffsetY = e.clientY - panel.offsetTop;
    header.style.cursor = "grabbing";
    e.preventDefault();
  });

  // Create resize handle
  const resizeHandle = document.createElement("div");
  Object.assign(resizeHandle.style, {
    position: "absolute",
    bottom: "0",
    right: "0",
    width: "16px",
    height: "16px",
    cursor: "nwse-resize",
    background:
      "linear-gradient(135deg, transparent 50%, rgba(244,244,245,0.3) 50%)",
    pointerEvents: "auto"
  });
  panel.appendChild(resizeHandle);

  resizeHandle.addEventListener("mousedown", (e) => {
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartWidth = panel.offsetWidth;
    resizeStartHeight = panel.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  });

  const onMouseMove = (e) => {
    if (isDragging) {
      const newLeft = e.clientX - dragOffsetX;
      const newTop = e.clientY - dragOffsetY;
      panel.style.left = `${Math.max(0, newLeft)}px`;
      panel.style.bottom = "auto";
      panel.style.top = `${Math.max(0, newTop)}px`;
    }

    if (isResizing) {
      const deltaX = e.clientX - resizeStartX;
      const deltaY = e.clientY - resizeStartY;
      const newWidth = Math.max(300, resizeStartWidth + deltaX);
      const newHeight = Math.max(200, resizeStartHeight + deltaY);
      panel.style.width = `${newWidth}px`;
      panel.style.height = `${newHeight}px`;
      panel.__isExpanded = false;
    }
  };

  const onMouseUp = () => {
    isDragging = false;
    isResizing = false;
    header.style.cursor = "grab";
  };

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  // Store cleanup function for when panel closes
  panel.__cleanup = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  // Load Street View Panorama
  loadStreetViewPanorama(content, lat, lng, panel);

  return panel;
}

async function loadStreetViewPanorama(container, lat, lng, panel) {
  if (!googleMapsApiKey || googleMapsApiKey.trim().length === 0) {
    container.replaceChildren();
    const msg = document.createElement("div");
    msg.textContent = "No API key configured. Add one in extension settings.";
    Object.assign(msg.style, {
      fontSize: "12px",
      color: "rgba(244,244,245,0.6)",
      textAlign: "center",
      padding: "16px",
      lineHeight: "1.4"
    });
    container.appendChild(msg);
    return;
  }

  try {
    // Check if Street View is available
    const metadataUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${encodeURIComponent(
      googleMapsApiKey
    )}`;

    const metaResponse = await fetch(metadataUrl);
    const metaData = await metaResponse.json();
    console.log("[StreetView] Metadata response:", metaData.status);

    if (metaData.status !== "OK" && metaData.status !== "ZERO_RESULTS") {
      throw new Error(
        metaData.status === "REQUEST_DENIED"
          ? "Invalid API key or referrer restrictions"
          : metaData.status
      );
    }

    if (metaData.status === "ZERO_RESULTS") {
      container.replaceChildren();
      const msg = document.createElement("div");
      msg.innerHTML = `No Street View available at this location.<br><span style="font-size: 10px; color: rgba(244,244,245,0.4); margin-top: 6px; display: block;">T-O debug: right click ${lat.toFixed(4)}° ${lng.toFixed(4)}°</span>`;
      Object.assign(msg.style, {
        fontSize: "12px",
        color: "rgba(244,244,245,0.5)",
        textAlign: "center",
        padding: "16px",
        lineHeight: "1.4"
      });
      container.appendChild(msg);
      return;
    }

    console.log("[StreetView] Loading Maps API...");

    // Load Maps API if not already loaded
    if (!window.google?.maps?.StreetViewPanorama) {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        googleMapsApiKey
      )}&libraries=streetview`;
      script.async = true;
      script.defer = true;

      await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("Maps API timeout"));
        }, 8000);

        const finish = (cb) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          cb();
        };

        script.onload = () => {
          finish(() => {
            console.log("[StreetView] Maps API loaded");
            resolve();
          });
        };
        script.onerror = () => {
          finish(() => {
            console.error("[StreetView] Maps API load failed");
            reject(new Error("Failed to load Maps API"));
          });
        };

        document.head.appendChild(script);
      });
    }

    // Verify google.maps is available
    if (!window.google?.maps?.StreetViewPanorama) {
      throw new Error("Maps API not available after load");
    }

    console.log("[StreetView] Creating panorama at", lat, lng);

    // Clear and prepare container
    container.replaceChildren();
    container.style.background = "#000";

    // Create panorama
    const panorama = new window.google.maps.StreetViewPanorama(container, {
      position: { lat, lng },
      pov: {
        heading: 0,
        pitch: 0
      },
      zoom: 1,
      addressControl: false,
      fullscreenControl: false,
      motionTrackingControl: false,
      panControl: true,
      zoomControl: true
    });

    panorama.addListener("status_changed", () => {
      const status = panorama.getStatus();
      console.log("[StreetView] Panorama status:", status);
      if (status === "ZERO_RESULTS") {
        container.replaceChildren();
        const msg = document.createElement("div");
        msg.textContent = "No Street View at this location.";
        Object.assign(msg.style, {
          fontSize: "12px",
          color: "rgba(244,244,245,0.5)",
          textAlign: "center",
          padding: "16px"
        });
        container.appendChild(msg);
      }
    });

    // Add marker on Mapbox with heading arrow
    if (trailOverlayMapRef && isMapboxLikeMap(trailOverlayMapRef)) {
      const map = trailOverlayMapRef;

      // Create arrow marker element
      const arrowEl = document.createElement("div");
      Object.assign(arrowEl.style, {
        width: "30px",
        height: "30px",
        background: "#fc4c02",
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "18px",
        cursor: "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        border: "2px solid white"
      });
      arrowEl.innerHTML = "→";

      const marker = new window.mapboxgl.Marker(arrowEl)
        .setLngLat([lng, lat])
        .addTo(map);

      panel.__streetViewMarker = marker;
      panel.__streetViewArrowEl = arrowEl;

      // Update arrow heading when panorama view changes
      const updateArrow = () => {
        const pov = panorama.getPov();
        if (pov && arrowEl) {
          arrowEl.style.transform = `rotate(${pov.heading}deg)`;
        }
      };

      panorama.addListener("pov_changed", updateArrow);
      updateArrow(); // Set initial heading

      panel.__removeStreetViewMarker = () => {
        if (marker) {
          marker.remove();
        }
      };
    }

    panel.__streetViewPanorama = panorama;
    console.log("[StreetView] Panorama created successfully");
  } catch (err) {
    console.error("[StreetView] Error:", err);
    container.replaceChildren();
    const msg = document.createElement("div");
    const coords = `${lat.toFixed(4)}° ${lng.toFixed(4)}°`;
    msg.innerHTML = `Error: ${err instanceof Error ? err.message : "Failed to load"}<br><span style="font-size: 10px; color: rgba(244,244,245,0.4); margin-top: 6px; display: block;">T-O debug: right click ${coords}</span>`;
    Object.assign(msg.style, {
      fontSize: "11px",
      color: "rgba(244,244,245,0.5)",
      textAlign: "center",
      padding: "16px",
      lineHeight: "1.4"
    });
    container.appendChild(msg);
  }
}

// --- MAPILLARY ---

const MAPILLARY_PANEL_ID = "trail-overlay-mapillary-panel";

function buildMapillaryAppUrl(lat, lng) {
  const url = new URL("https://www.mapillary.com/app/");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("z", "18");
  url.searchParams.set("focus", "photo");
  return url.toString();
}

function buildMapillaryEmbedUrl(imageKey) {
  const embedUrl = new URL("https://www.mapillary.com/embed");
  embedUrl.searchParams.set("image_key", String(imageKey));
  embedUrl.searchParams.set("style", "photo");
  return embedUrl.toString();
}

async function fetchNearestMapillaryImageKey(lat, lng) {
  const token = String(mapillaryClientToken || "").trim();
  if (!token) return null;

  const apiUrl = new URL("https://graph.mapillary.com/images");
  apiUrl.searchParams.set("access_token", token);
  apiUrl.searchParams.set("fields", "id,captured_at");
  apiUrl.searchParams.set("lat", String(lat));
  apiUrl.searchParams.set("lng", String(lng));
  apiUrl.searchParams.set("radius", "25");
  apiUrl.searchParams.set("limit", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(apiUrl.toString(), {
      signal: controller.signal,
      mode: "cors",
      credentials: "omit"
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.data?.[0]?.id ? String(payload.data[0].id) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function closeMapillaryPanel() {
  const panel = document.getElementById(MAPILLARY_PANEL_ID);
  if (panel && panel.__cleanup) {
    panel.__cleanup();
  }
  if (panel) panel.remove();
}

function createMapillaryPanel(lat, lng) {
  closeMapillaryPanel();

  const container = document.querySelector(".mapboxgl-map, .maplibregl-map");
  if (!container) return;

  const panel = document.createElement("div");
  panel.id = MAPILLARY_PANEL_ID;
  panel.__isExpanded = false;

  const applySize = () => {
    const isExpanded = panel.__isExpanded;
    Object.assign(panel.style, {
      position: "absolute",
      bottom: "20px",
      left: "20px",
      width: isExpanded ? "700px" : "400px",
      height: isExpanded ? "500px" : "300px",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(18,18,20,0.95)",
      boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
      backdropFilter: "blur(8px)",
      zIndex: "10000",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif',
      transition: "width 0.2s ease, height 0.2s ease"
    });
  };
  applySize();

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    flex: "0 0 auto",
    background: "rgba(0,0,0,0.2)",
    zIndex: "10001"
  });

  const title = document.createElement("span");
  title.textContent = "Mapillary";
  Object.assign(title.style, {
    fontSize: "13px",
    fontWeight: "600",
    color: "rgba(244,244,245,0.9)"
  });

  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.textContent = "⛶";
  Object.assign(expandBtn.style, {
    width: "28px",
    height: "28px",
    padding: "0",
    border: "none",
    background: "none",
    color: "rgba(244,244,245,0.6)",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: "26px",
    marginRight: "4px"
  });
  expandBtn.addEventListener("click", () => {
    panel.__isExpanded = !panel.__isExpanded;
    expandBtn.textContent = panel.__isExpanded ? "-" : "+";
    expandBtn.style.color = panel.__isExpanded
      ? "rgba(244,244,245,0.9)"
      : "rgba(244,244,245,0.6)";
    applySize();
  });

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.textContent = "↗";
  Object.assign(openBtn.style, {
    width: "28px",
    height: "28px",
    padding: "0",
    border: "none",
    background: "none",
    color: "rgba(244,244,245,0.6)",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: "26px",
    marginRight: "4px"
  });
  openBtn.addEventListener("click", () => {
    window.open(buildMapillaryAppUrl(lat, lng), "_blank");
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  Object.assign(closeBtn.style, {
    width: "28px",
    height: "28px",
    padding: "0",
    border: "none",
    background: "none",
    color: "rgba(244,244,245,0.6)",
    cursor: "pointer",
    fontSize: "20px",
    lineHeight: "26px"
  });
  closeBtn.addEventListener("click", closeMapillaryPanel);

  header.appendChild(title);
  header.appendChild(expandBtn);
  header.appendChild(openBtn);
  header.appendChild(closeBtn);

  const content = document.createElement("div");
  Object.assign(content.style, {
    flex: "1",
    minHeight: "0",
    position: "relative",
    background: "rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  });

  const loading = document.createElement("div");
  loading.textContent = "Loading Mapillary preview...";
  Object.assign(loading.style, {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    color: "rgba(244,244,245,0.55)",
    textAlign: "center",
    padding: "16px",
    background: "rgba(0,0,0,0.35)",
    zIndex: "1"
  });
  content.appendChild(loading);

  const showFallback = (reason) => {
    content.replaceChildren();
    const fallback = document.createElement("div");
    Object.assign(fallback.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      padding: "16px",
      textAlign: "center",
      color: "rgba(244,244,245,0.7)",
      fontSize: "12px",
      lineHeight: "1.4"
    });
    fallback.innerHTML = `${reason}<br>Open in a new tab to view nearby photos.`;

    const fallbackBtn = document.createElement("button");
    fallbackBtn.type = "button";
    fallbackBtn.textContent = "Open Mapillary";
    Object.assign(fallbackBtn.style, {
      border: "1px solid rgba(255,255,255,0.25)",
      borderRadius: "8px",
      padding: "6px 10px",
      background: "rgba(255,255,255,0.06)",
      color: "rgba(244,244,245,0.9)",
      cursor: "pointer",
      fontSize: "12px"
    });
    fallbackBtn.addEventListener("click", () => {
      window.open(buildMapillaryAppUrl(lat, lng), "_blank");
    });

    fallback.appendChild(fallbackBtn);
    content.appendChild(fallback);
  };

  const renderEmbedFromNearestImage = async () => {
    const imageKey = await fetchNearestMapillaryImageKey(lat, lng);
    if (!imageKey) {
      const noToken = String(mapillaryClientToken || "").trim().length === 0;
      showFallback(
        noToken
          ? "Mapillary inline preview not configured."
          : "No nearby Mapillary photo found for this location."
      );
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.src = buildMapillaryEmbedUrl(imageKey);
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.style.borderRadius = "8px";
    iframe.setAttribute("allow", "fullscreen");

    let iframeSettled = false;
    const iframeTimeout = setTimeout(() => {
      if (iframeSettled) return;
      iframeSettled = true;
      showFallback("Mapillary preview timed out.");
    }, 7000);

    iframe.addEventListener("load", () => {
      if (iframeSettled) return;
      iframeSettled = true;
      clearTimeout(iframeTimeout);
      content.replaceChildren();
      content.appendChild(iframe);
    });

    iframe.addEventListener("error", () => {
      if (iframeSettled) return;
      iframeSettled = true;
      clearTimeout(iframeTimeout);
      showFallback("Mapillary preview could not load.");
    });

    content.appendChild(iframe);
  };

  void renderEmbedFromNearestImage();

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    background: "rgba(0,0,0,0.4)",
    fontSize: "11px",
    color: "rgba(244,244,245,0.6)",
    flex: "0 0 auto",
    backdropFilter: "blur(4px)"
  });
  footer.innerHTML = `<span>${lat.toFixed(4)}° ${lng.toFixed(4)}°</span><span style="font-size: 10px; color: rgba(244,244,245,0.4);">drag to move • open link for full screen</span>`;

  panel.appendChild(header);
  panel.appendChild(content);
  panel.appendChild(footer);
  container.appendChild(panel);

  // --- DRAG ---
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.style.cursor = "grab";
  header.addEventListener("mousedown", (e) => {
    if (e.target === expandBtn || e.target === closeBtn || e.target === openBtn) return;
    isDragging = true;
    dragOffsetX = e.clientX - panel.offsetLeft;
    dragOffsetY = e.clientY - panel.offsetTop;
    header.style.cursor = "grabbing";
    e.preventDefault();
  });

  const onMouseMove = (e) => {
    if (isDragging) {
      const newLeft = e.clientX - dragOffsetX;
      const newTop = e.clientY - dragOffsetY;
      panel.style.left = `${Math.max(0, newLeft)}px`;
      panel.style.bottom = "auto";
      panel.style.top = `${Math.max(0, newTop)}px`;
    }
  };

  const onMouseUp = () => {
    isDragging = false;
    header.style.cursor = "grab";
  };

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  panel.__cleanup = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
}

function attachStreetViewRightClick(map) {
  if (!map || map.__trailOverlayStreetViewAttached) return;
  map.__trailOverlayStreetViewAttached = true;

  map.on("contextmenu", async (e) => {
    const lngLat = e.lngLat;
    if (!lngLat) return;

    e.preventDefault();

    // Fetch stored viewer preference (default: mapillary)
    const viewer = await fetchRightClickViewerFromBridge();

    if (viewer === "mapillary") {
      createMapillaryPanel(lngLat.lat, lngLat.lng);
    } else if (viewer === "streetview") {
      if (!googleMapsApiKey || googleMapsApiKey.trim().length === 0) {
        return;
      }
      createStreetViewPanel(lngLat.lat, lngLat.lng);
    }
  });
}

// --- MAIN EXECUTION ---

let cachedTrails = null;
let cachedNetworks = null;

/** Map instance we last drew on (prefs updates must hit the same Mapbox object). */
let trailOverlayMapRef = null;

let extensionInitLogged = false;
let mainInFlight = false;
let mainInFlightSkipCount = 0;
let mainLastSkipLogAt = 0;
let mainRetryTimer = null;
let mainAttemptCounter = 0;
let mapNotFoundRetryCount = 0;

function logMainStage(attemptId, stage, startedAt, extra = undefined) {
  console.debug("[TrailOverlay] main() stage", {
    attemptId,
    stage,
    elapsedMs: Date.now() - startedAt,
    ...(extra || {})
  });
}

function scheduleMainRetry(delayMs = 1500) {
  if (mainRetryTimer != null) return;
  mainRetryTimer = setTimeout(() => {
    mainRetryTimer = null;
    main();
  }, delayMs);
}

async function main() {
  if (mainInFlight) {
    mainInFlightSkipCount += 1;
    const now = Date.now();
    if (now - mainLastSkipLogAt > 5000) {
      mainLastSkipLogAt = now;
      console.debug("[TrailOverlay] main() call skipped because initialization is already in flight", {
        skippedCallsSinceLastLog: mainInFlightSkipCount
      });
      mainInFlightSkipCount = 0;
    }
    return;
  }
  mainInFlight = true;
  mainInFlightSkipCount = 0;
  const attemptId = ++mainAttemptCounter;
  const startedAt = Date.now();
  console.debug("[TrailOverlay] main() attempt started", {
    attemptId,
    url: window.location?.href || "",
    readyState: document.readyState
  });
  try {
    logMainStage(attemptId, "fetch_api_url:start", startedAt);
    await fetchApiUrlFromBridge();
    logMainStage(attemptId, "fetch_api_url:done", startedAt);

    // Fetch Google Maps API key
    logMainStage(attemptId, "fetch_google_maps_api_key:start", startedAt);
    googleMapsApiKey = await fetchGoogleMapsApiKeyFromBridge();
    logMainStage(attemptId, "fetch_google_maps_api_key:done", startedAt);

    logMainStage(attemptId, "fetch_mapillary_client_token:start", startedAt);
    mapillaryClientToken = await fetchMapillaryClientTokenFromBridge();
    logMainStage(attemptId, "fetch_mapillary_client_token:done", startedAt);

    if (!cachedTrails || !cachedNetworks) {
      logMainStage(attemptId, "fetch_trails_networks:start", startedAt);
      [cachedTrails, cachedNetworks] = await Promise.all([
        cachedTrails ?? fetchTrails(),
        cachedNetworks ?? fetchNetworks()
      ]);
      logMainStage(attemptId, "fetch_trails_networks:done", startedAt, {
        trails: Array.isArray(cachedTrails) ? cachedTrails.length : -1,
        networks: Array.isArray(cachedNetworks) ? cachedNetworks.length : -1
      });
    }

    logMainStage(attemptId, "fetch_bookmarks:start", startedAt);
    const bookmarkIds = await fetchTrailBookmarksFromBridge();
    logMainStage(attemptId, "fetch_bookmarks:done", startedAt, {
      bookmarkCount: Array.isArray(bookmarkIds) ? bookmarkIds.length : -1
    });
    hydrateBookmarksFromIds(bookmarkIds);

    logMainStage(attemptId, "wait_map_and_prefs:start", startedAt);
    const [map, prefs] = await Promise.all([
      waitForMap(),
      fetchOverlayPrefsFromBridge()
    ]);
    logMainStage(attemptId, "wait_map_and_prefs:done", startedAt);
    if (mapNotFoundRetryCount > 0) {
      console.info("[TrailOverlay] Map recovered after retries", {
        retries: mapNotFoundRetryCount,
        attemptId,
        elapsedMs: Date.now() - startedAt
      });
      mapNotFoundRetryCount = 0;
    }
    trailOverlayMapRef = map;
    overlayEnabled = prefs.enabled;
    overlayTrailsVisible = prefs.trailsVisible;
    overlayNetworksVisible = prefs.networksVisible;
    overlayTrailPhotosVisible = prefs.photosVisible !== false;
    overlayBookmarkHighlightColor =
      typeof prefs.bookmarkHighlightColor === "string" &&
      prefs.bookmarkHighlightColor.trim().length > 0
        ? prefs.bookmarkHighlightColor.trim()
        : DEFAULT_OVERLAY_PREFS.bookmarkHighlightColor;
    logMainStage(attemptId, "wait_style_loaded:start", startedAt);
    await waitForStyleLoaded(map);
    logMainStage(attemptId, "wait_style_loaded:done", startedAt);

    if (prefs.enabled) {
      applyMapLayersFromPrefs(map, prefs);
      if (!map.__trailOverlayNudgeAttached) {
        map.__trailOverlayNudgeAttached = true;
        addClickNudge(map);
      }
    }

    if (!map.__trailOverlayViewportPhotoMoveEnd) {
      map.__trailOverlayViewportPhotoMoveEnd = true;
      map.on("moveend", () => {
        scheduleViewportPhotoPreviewFetch(map);
        scheduleTrailDockRefresh(map);
      });
    }

    // Attach Street View right-click handler
    attachStreetViewRightClick(map);

    // Inject toggle once per page load (the MutationObserver inside handles re-renders)
    if (!document.getElementById("trail-overlay-toggle-li")) {
      injectToggle(map, prefs.enabled);
    }

    // Re-add if style reloads (respects current toggle state)
    if (!map.__trailOverlayStyleHook) {
      map.__trailOverlayStyleHook = true;
      map.on("style.load", async () => {
        const next = await fetchOverlayPrefsFromBridge();
        overlayEnabled = next.enabled;
        overlayTrailsVisible = next.trailsVisible;
        overlayNetworksVisible = next.networksVisible;
        overlayTrailPhotosVisible = next.photosVisible !== false;
        overlayBookmarkHighlightColor =
          typeof next.bookmarkHighlightColor === "string" &&
          next.bookmarkHighlightColor.trim().length > 0
            ? next.bookmarkHighlightColor.trim()
            : DEFAULT_OVERLAY_PREFS.bookmarkHighlightColor;
        if (next.enabled) {
          applyMapLayersFromPrefs(map, next);
          restoreOpenTrailInfoDrawerHighlight(map);
          refreshOpenTrailInfoDrawerFromCache();
        } else {
          removeLayers(map);
        }
      });
    }

    if (!extensionInitLogged) {
      extensionInitLogged = true;
      console.log("[TrailOverlay] Initialized");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Map not found") {
      mapNotFoundRetryCount += 1;
      console.warn("[TrailOverlay] Map not found yet, retrying...", {
        retryCount: mapNotFoundRetryCount,
        attemptId,
        elapsedMs: Date.now() - startedAt,
        nextRetryInMs: 2000,
        snapshot: getMapDetectionSnapshot()
      });
      scheduleMainRetry(2000);
    } else if (msg === "Map style not ready") {
      console.warn("[TrailOverlay] Map found but style is not ready yet, retrying...", {
        attemptId,
        elapsedMs: Date.now() - startedAt,
        nextRetryInMs: 1500,
        snapshot: getMapDetectionSnapshot()
      });
      scheduleMainRetry(1500);
    } else {
      alert("[TrailOverlay ERROR] " + msg);
    }
  } finally {
    mainInFlight = false;
  }
}

// Run once
main();

window.addEventListener("message", (event) => {
  if (event.data?.[FROM_BRIDGE] !== true) return;

  if (event.data.type === "API_URL_CHANGED") {
    const m =
      trailOverlayMapRef && isMapboxLikeMap(trailOverlayMapRef)
        ? trailOverlayMapRef
        : tryFindMap();
    if (m) {
      m.__trailOverlayLastAppliedPrefs = null;
      m.__trailOverlayDockFullSig = null;
      m.__trailOverlayDockIdSig = null;
    }
    cachedTrails = null;
    cachedNetworks = null;
    main();
    return;
  }

  if (event.data.type === "LAYER_PREFS_CHANGED") {
    applyOverlayPrefsFromMessage({
      enabled: event.data.enabled,
      trailsVisible: event.data.trailsVisible,
      networksVisible: event.data.networksVisible,
      photosVisible: event.data.photosVisible,
      bookmarkHighlightColor: event.data.bookmarkHighlightColor
    });
    return;
  }

  if (event.data.type === "TRAIL_BOOKMARKS_CHANGED") {
    const m =
      trailOverlayMapRef && isMapboxLikeMap(trailOverlayMapRef)
        ? trailOverlayMapRef
        : tryFindMap();
    const ids = Array.isArray(event.data.ids) ? event.data.ids : [];
    if (m) applyExternalBookmarkIds(m, ids);
  }
});

// Re-run on Strava SPA navigation
let lastUrl = location.href;

new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;

    setTimeout(() => {
      main();
    }, 1000);
  }
}).observe(document, { subtree: true, childList: true });
