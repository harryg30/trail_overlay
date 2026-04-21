// ISOLATED world: handles extension APIs + fetching

const DEFAULT_API_URL = "https://trail-overlay.vercel.app";

/** Envelope so Strava/page postMessage traffic cannot collide with our protocol. */
const TO_BRIDGE = "__trailOverlayToBridge";
const FROM_BRIDGE = "__trailOverlayFromBridge";

function injectMainWorldScript(fileName) {
  const marker = `trail-overlay-injected-${fileName}`;
  if (document.documentElement?.getAttribute(marker) === "1") return;
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL(fileName);
  script.async = false;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
  document.documentElement?.setAttribute(marker, "1");
}

// Firefox MV2 runs content scripts in an isolated context; inject these into page context.
injectMainWorldScript("content-init.js");
injectMainWorldScript("content.js");

async function getApiUrl() {
  const items = await chrome.storage.sync.get({ apiUrl: DEFAULT_API_URL });
  const raw = String(items.apiUrl ?? DEFAULT_API_URL).trim();
  return raw
    .replace(/^https:\/\/localhost/, "http://localhost")
    .replace(/\/$/, "");
}

/** Parse JSON body; on !ok or parse error return null (quiet for Strava console). */
async function readJsonResponse(_label, _requestUrl, resp) {
  const text = await resp.text();
  if (!resp.ok) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/** Prefer onChanged.newValue when a key changed; sync.get can lag behind writes. */
function boolFromStorageChange(change, fallback) {
  if (!change) return fallback;
  if (change.newValue === undefined) return fallback;
  return change.newValue !== false;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.trailBookmarkIds) {
    const raw = changes.trailBookmarkIds.newValue;
    const ids = Array.isArray(raw)
      ? raw.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    window.postMessage(
      {
        type: "TRAIL_BOOKMARKS_CHANGED",
        ids,
        [FROM_BRIDGE]: true
      },
      "*"
    );
  }
  if (areaName !== "sync") return;
  if (changes.apiUrl) {
    window.postMessage(
      {
        type: "API_URL_CHANGED",
        apiUrl: changes.apiUrl.newValue,
        [FROM_BRIDGE]: true
      },
      "*"
    );
  }
  if (
    changes.overlayEnabled ||
    changes.overlayTrailsVisible ||
    changes.overlayNetworksVisible ||
    changes.overlayTrailPhotosVisible ||
    changes.overlayBookmarkHighlightColor
  ) {
    chrome.storage.sync.get(
      {
        overlayEnabled: true,
        overlayTrailsVisible: true,
        overlayNetworksVisible: true,
        overlayTrailPhotosVisible: true,
        overlayBookmarkHighlightColor: "yellow"
      },
      (items) => {
        window.postMessage(
          {
            type: "LAYER_PREFS_CHANGED",
            enabled: boolFromStorageChange(
              changes.overlayEnabled,
              items.overlayEnabled !== false
            ),
            trailsVisible: boolFromStorageChange(
              changes.overlayTrailsVisible,
              items.overlayTrailsVisible !== false
            ),
            networksVisible: boolFromStorageChange(
              changes.overlayNetworksVisible,
              items.overlayNetworksVisible !== false
            ),
            photosVisible: boolFromStorageChange(
              changes.overlayTrailPhotosVisible,
              items.overlayTrailPhotosVisible !== false
            ),
            bookmarkHighlightColor:
              typeof items.overlayBookmarkHighlightColor === "string" &&
              items.overlayBookmarkHighlightColor.trim().length > 0
                ? items.overlayBookmarkHighlightColor.trim()
                : "yellow",
            [FROM_BRIDGE]: true
          },
          "*"
        );
      }
    );
  }
});

window.addEventListener("message", async (event) => {
  if (!event.data || event.data[TO_BRIDGE] !== true) return;

  if (event.data?.type === "GET_API_URL") {
    const requestId = event.data.requestId;
    try {
      const apiUrl = await getApiUrl();
      window.postMessage(
        {
          type: "API_URL_RESPONSE",
          requestId,
          apiUrl,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    } catch (_) {
      window.postMessage(
        {
          type: "API_URL_RESPONSE",
          requestId,
          apiUrl: DEFAULT_API_URL,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    }
    return;
  }

  if (event.data?.type === "GET_OVERLAY_PREFS") {
    const requestId = event.data.requestId;
    try {
      const items = await chrome.storage.sync.get({
        overlayEnabled: true,
        overlayTrailsVisible: true,
        overlayNetworksVisible: true,
        overlayTrailPhotosVisible: true,
        overlayBookmarkHighlightColor: "yellow"
      });
      window.postMessage(
        {
          type: "OVERLAY_PREFS_RESPONSE",
          requestId,
          enabled: items.overlayEnabled !== false,
          trailsVisible: items.overlayTrailsVisible !== false,
          networksVisible: items.overlayNetworksVisible !== false,
          photosVisible: items.overlayTrailPhotosVisible !== false,
          bookmarkHighlightColor:
            typeof items.overlayBookmarkHighlightColor === "string" &&
            items.overlayBookmarkHighlightColor.trim().length > 0
              ? items.overlayBookmarkHighlightColor.trim()
              : "yellow",
          [FROM_BRIDGE]: true
        },
        "*"
      );
    } catch (_) {
      window.postMessage(
        {
          type: "OVERLAY_PREFS_RESPONSE",
          requestId,
          enabled: true,
          trailsVisible: true,
          networksVisible: true,
          photosVisible: true,
          bookmarkHighlightColor: "yellow",
          [FROM_BRIDGE]: true
        },
        "*"
      );
    }
    return;
  }

  if (event.data?.type === "SET_ENABLED") {
    const requestId = event.data.requestId;
    try {
      await chrome.storage.sync.set({ overlayEnabled: event.data.enabled });
    } catch (_) {}
    window.postMessage(
      { type: "ENABLED_SET", requestId, [FROM_BRIDGE]: true },
      "*"
    );
    return;
  }

  if (event.data?.type === "GET_TRAILS") {
    const requestId = event.data.requestId;
    try {
      const apiUrl = await getApiUrl();
      const requestUrl = `${apiUrl}/api/trails`;
      const resp = await fetch(requestUrl);
      const data = await readJsonResponse("trails", requestUrl, resp);
      window.postMessage(
        {
          type: "TRAILS_RESPONSE",
          trails: data?.trails ?? [],
          requestId,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    } catch (_) {
      window.postMessage(
        {
          type: "TRAILS_RESPONSE",
          trails: [],
          requestId,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    }
    return;
  }

  if (event.data?.type === "GET_NETWORKS") {
    const requestId = event.data.requestId;
    try {
      const apiUrl = await getApiUrl();
      const requestUrl = `${apiUrl}/api/networks`;
      const resp = await fetch(requestUrl);
      const data = await readJsonResponse("networks", requestUrl, resp);
      window.postMessage(
        {
          type: "NETWORKS_RESPONSE",
          networks: data?.networks ?? [],
          requestId,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    } catch (_) {
      window.postMessage(
        {
          type: "NETWORKS_RESPONSE",
          networks: [],
          requestId,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    }
    return;
  }

  if (event.data?.type === "GET_TRAIL_PHOTOS") {
    const requestId = event.data.requestId;
    const { north, south, east, west, limit } = event.data;
    let requestUrl = "";
    try {
      const apiUrl = await getApiUrl();
      const lim =
        Number.isFinite(limit) && limit > 0
          ? Math.min(500, Math.floor(limit))
          : 500;
      requestUrl = `${apiUrl}/api/trail-photos?north=${encodeURIComponent(
        north
      )}&south=${encodeURIComponent(south)}&east=${encodeURIComponent(
        east
      )}&west=${encodeURIComponent(west)}&limit=${lim}`;
      const bg = await chrome.runtime.sendMessage({
        type: "FETCH_TRAIL_PHOTOS",
        url: requestUrl
      });
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
      if (!bg) {
        throw new Error("FETCH_TRAIL_PHOTOS: empty response");
      }
      if (bg.error) {
        throw new Error(bg.error);
      }
      let data = null;
      if (bg.ok && bg.text) {
        try {
          data = JSON.parse(bg.text);
        } catch (_) {
          data = null;
        }
      }
      const photosOut = Array.isArray(data?.photos) ? data.photos : [];
      window.postMessage(
        {
          type: "TRAIL_PHOTOS_RESPONSE",
          photos: photosOut,
          requestId,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    } catch {
      window.postMessage(
        {
          type: "TRAIL_PHOTOS_RESPONSE",
          photos: [],
          requestId,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    }
    return;
  }

  if (event.data?.type === "GET_TRAIL_PHOTOS_BY_TRAIL") {
    const requestId = event.data.requestId;
    const trailId = event.data.trailId;
    const limitIn = event.data.limit;
    let requestUrl = "";
    try {
      const apiUrl = await getApiUrl();
      const lim =
        Number.isFinite(limitIn) && limitIn > 0
          ? Math.min(200, Math.floor(limitIn))
          : 80;
      if (typeof trailId !== "string" || !trailId.trim()) {
        throw new Error("Missing trailId");
      }
      requestUrl = `${apiUrl}/api/trail-photos?trailId=${encodeURIComponent(
        trailId.trim()
      )}&limit=${encodeURIComponent(String(lim))}`;
      const bg = await chrome.runtime.sendMessage({
        type: "FETCH_TRAIL_PHOTOS",
        url: requestUrl
      });
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
      if (!bg) {
        throw new Error("FETCH_TRAIL_PHOTOS: empty response");
      }
      if (bg.error) {
        throw new Error(bg.error);
      }
      let data = null;
      if (bg.ok && bg.text) {
        try {
          data = JSON.parse(bg.text);
        } catch (_) {
          data = null;
        }
      }
      const photosOut = Array.isArray(data?.photos) ? data.photos : [];
      window.postMessage(
        {
          type: "TRAIL_PHOTOS_RESPONSE",
          photos: photosOut,
          requestId,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    } catch {
      window.postMessage(
        {
          type: "TRAIL_PHOTOS_RESPONSE",
          photos: [],
          requestId,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    }
    return;
  }

  if (event.data?.type === "GET_TRAIL_BOOKMARKS") {
    const requestId = event.data.requestId;
    try {
      const items = await chrome.storage.local.get({ trailBookmarkIds: [] });
      const raw = items.trailBookmarkIds;
      const ids = Array.isArray(raw)
        ? raw.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [];
      window.postMessage(
        {
          type: "TRAIL_BOOKMARKS_RESPONSE",
          requestId,
          ids,
          [FROM_BRIDGE]: true
        },
        "*"
      );
    } catch {
      window.postMessage(
        {
          type: "TRAIL_BOOKMARKS_RESPONSE",
          requestId,
          ids: [],
          [FROM_BRIDGE]: true
        },
        "*"
      );
    }
    return;
  }

  if (event.data?.type === "SET_TRAIL_BOOKMARKS") {
    const requestId = event.data.requestId;
    const raw = event.data.ids;
    const ids = Array.isArray(raw)
      ? raw.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    try {
      await chrome.storage.local.set({ trailBookmarkIds: ids });
    } catch (_) {
      /* ignore */
    }
    window.postMessage(
      { type: "TRAIL_BOOKMARKS_SET", requestId, [FROM_BRIDGE]: true },
      "*"
    );
    return;
  }

  if (event.data?.type === "GET_GOOGLE_MAPS_API_KEY") {
    if (
      event.source !== window ||
      event.data?.requestSource !== "trail-overlay-content"
    ) {
      return;
    }

    const requestId = event.data.requestId;
    try {
      const items = await chrome.storage.sync.get({ googleMapsApiKey: "" });
      window.postMessage(
        {
          type: "GOOGLE_MAPS_API_KEY_RESPONSE",
          requestId,
          apiKey: items.googleMapsApiKey || "",
          [FROM_BRIDGE]: true
        },
        "*"
      );
    } catch {
      window.postMessage(
        {
          type: "GOOGLE_MAPS_API_KEY_RESPONSE",
          requestId,
          apiKey: "",
          [FROM_BRIDGE]: true
        },
        "*"
      );
    }
    return;
  }
});
