// Runs at document_start in MAIN world — before any page scripts.
// Intercepts window.mapboxgl being set by Strava, then wraps Map constructor
// to capture the latest map instance at window._trailOverlayMap (fallback when vv_map is absent).
;(function () {
  console.debug('[TrailOverlay:init] content-init loaded', {
    href: window.location?.href || '',
    readyState: document.readyState,
    inIframe: window.top !== window,
    frameCount: window.frames.length,
  })

  function isMapboxLikeMap(v) {
    return (
      v &&
      typeof v === 'object' &&
      typeof v.addSource === 'function' &&
      typeof v.addLayer === 'function' &&
      typeof v.isStyleLoaded === 'function'
    )
  }

  function captureMap(instance, source) {
    if (!isMapboxLikeMap(instance)) return
    window._trailOverlayMap = instance
    console.debug('[TrailOverlay:init] Captured map instance', { source })
  }

  function patchMapLibrary(lib, libName) {
    if (!lib || !lib.Map || lib._trailOverlayPatched) return
    lib._trailOverlayPatched = true
    console.debug('[TrailOverlay:init] Patching map constructor', { lib: libName })

    const OrigMap = lib.Map
    function PatchedMap(...args) {
      const instance = new OrigMap(...args)
      captureMap(instance, `${libName}.Map`)
      return instance
    }
    PatchedMap.prototype = OrigMap.prototype
    Object.setPrototypeOf(PatchedMap, OrigMap)
    for (const key of Object.getOwnPropertyNames(OrigMap)) {
      if (key === 'prototype' || key === 'length' || key === 'name') continue
      try {
        Object.defineProperty(PatchedMap, key, Object.getOwnPropertyDescriptor(OrigMap, key))
      } catch (_) {}
    }
    lib.Map = PatchedMap
  }

  function hookWindowProperty(name, onSet) {
    const existingDesc = Object.getOwnPropertyDescriptor(window, name)
    if (existingDesc && !existingDesc.configurable) {
      console.debug('[TrailOverlay:init] Cannot hook non-configurable property', { name })
      return
    }

    let value = window[name]
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get () {
        return value
      },
      set (val) {
        value = val
        onSet(val)
        Object.defineProperty(window, name, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: val,
        })
      },
    })
  }

  if (window.vv_map) {
    captureMap(window.vv_map, 'window.vv_map existing')
  }
  hookWindowProperty('vv_map', (val) => {
    console.debug('[TrailOverlay:init] window.vv_map assigned')
    captureMap(val, 'window.vv_map assigned')
  })

  if (window.mapboxgl) {
    console.debug('[TrailOverlay:init] mapboxgl already present on window')
    patchMapLibrary(window.mapboxgl, 'mapboxgl')
  }
  hookWindowProperty('mapboxgl', (val) => {
    console.debug('[TrailOverlay:init] window.mapboxgl assigned, applying patch')
    patchMapLibrary(val, 'mapboxgl')
  })

  if (window.maplibregl) {
    console.debug('[TrailOverlay:init] maplibregl already present on window')
    patchMapLibrary(window.maplibregl, 'maplibregl')
  }
  hookWindowProperty('maplibregl', (val) => {
    console.debug('[TrailOverlay:init] window.maplibregl assigned, applying patch')
    patchMapLibrary(val, 'maplibregl')
  })
})()
