const DEFAULT_API_URL = 'https://trail-overlay.vercel.app'
const GOOGLE_MAPS_ORIGIN = 'https://maps.googleapis.com/*'

const PRESET_NAMES = ['yellow', 'red', 'blue', 'green']

function tryOriginPattern(rawUrl) {
  try {
    const u = new URL(String(rawUrl ?? '').trim())
    return `${u.origin}/*`
  } catch {
    return null
  }
}

function tryNormalizeHex(s) {
  const t = String(s ?? '').trim()
  if (!t.startsWith('#')) return null
  const h = t.slice(1)
  if (/^[0-9a-f]{6}$/i.test(h)) return `#${h.toLowerCase()}`
  if (/^[0-9a-f]{3}$/i.test(h)) {
    const a = h[0].toLowerCase()
    const b = h[1].toLowerCase()
    const c = h[2].toLowerCase()
    return `#${a}${a}${b}${b}${c}${c}`
  }
  return null
}

function classifyHighlight(stored) {
  const raw = String(stored ?? 'yellow').trim().toLowerCase()
  if (PRESET_NAMES.includes(raw)) return { preset: raw, hex: '' }
  const hex = tryNormalizeHex(raw)
  if (hex) return { preset: 'custom', hex }
  return { preset: 'yellow', hex: '' }
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('apiUrl')
  const saveBtn = document.getElementById('save')
  const status = document.getElementById('status')
  const showTrails = document.getElementById('showTrails')
  const showNetworks = document.getElementById('showNetworks')
  const showTrailPhotos = document.getElementById('showTrailPhotos')
  const bookmarkHaloPreset = document.getElementById('bookmarkHaloPreset')
  const bookmarkHaloHex = document.getElementById('bookmarkHaloHex')
  const googleMapsApiKey = document.getElementById('googleMapsApiKey')
  const validateKeyBtn = document.getElementById('validateKey')
  const keyStatus = document.getElementById('keyStatus')
  const rightClickViewer = document.getElementById('rightClickViewer')

  const storageDefaults = {
    apiUrl: DEFAULT_API_URL,
    overlayTrailsVisible: true,
    overlayNetworksVisible: true,
    overlayTrailPhotosVisible: true,
    overlayBookmarkHighlightColor: 'yellow',
    googleMapsApiKey: '',
    rightClickViewer: 'mapillary'
  }

  let hexSaveTimer = null

  const ensureOriginPermission = async (originPattern) => {
    if (!chrome.permissions?.contains || !chrome.permissions?.request) return true
    return new Promise((resolve) => {
      chrome.permissions.contains({ origins: [originPattern] }, (hasPermission) => {
        if (chrome.runtime?.lastError) {
          resolve(false)
          return
        }
        if (hasPermission) {
          resolve(true)
          return
        }
        chrome.permissions.request({ origins: [originPattern] }, (granted) => {
          if (chrome.runtime?.lastError) {
            resolve(false)
            return
          }
          resolve(Boolean(granted))
        })
      })
    })
  }

  const syncHexVisibility = () => {
    const isCustom = bookmarkHaloPreset.value === 'custom'
    bookmarkHaloHex.style.display = isCustom ? 'block' : 'none'
  }

  const saveBookmarkHighlight = (value, okMessage) => {
    chrome.storage.sync.set({ overlayBookmarkHighlightColor: value }, () => {
      status.textContent = okMessage
      setTimeout(() => { status.textContent = '' }, 2000)
    })
  }

  const validateGoogleMapsKey = async (key) => {
    if (!key || key.trim().length === 0) {
      keyStatus.textContent = ''
      return
    }

    keyStatus.textContent = 'Validating...'
    keyStatus.style.color = '#666'
    validateKeyBtn.disabled = true

    try {
      const granted = await ensureOriginPermission(GOOGLE_MAPS_ORIGIN)
      if (!granted) {
        keyStatus.textContent = '✗ Permission denied for maps.googleapis.com'
        keyStatus.style.color = '#ef4444'
        return
      }

      // Test with Street View metadata API (free call)
      const lat = 40.7128
      const lng = -74.0060
      const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${encodeURIComponent(key.trim())}`

      const response = await fetch(url)
      const data = await response.json()

      if (data.status === 'OK') {
        keyStatus.textContent = '✓ Valid API key'
        keyStatus.style.color = '#22c55e'
        chrome.storage.sync.set({ googleMapsApiKey: key.trim() })
      } else if (data.status === 'ZERO_RESULTS') {
        keyStatus.textContent = '✓ Key is valid (no Street View at test location)'
        keyStatus.style.color = '#22c55e'
        chrome.storage.sync.set({ googleMapsApiKey: key.trim() })
      } else if (data.status === 'REQUEST_DENIED') {
        keyStatus.textContent = '✗ Invalid API key or API not enabled'
        keyStatus.style.color = '#ef4444'
      } else {
        keyStatus.textContent = `✗ Error: ${data.status}`
        keyStatus.style.color = '#ef4444'
      }
    } catch (_) {
      keyStatus.textContent = '✗ Error validating key'
      keyStatus.style.color = '#ef4444'
    } finally {
      validateKeyBtn.disabled = false

      if (keyStatus.style.color === 'rgb(34, 197, 94)') {
        setTimeout(() => {
          keyStatus.textContent = ''
          keyStatus.style.color = '#666'
        }, 2000)
      }
    }
  }

  chrome.storage.sync.get(storageDefaults, (items) => {
    input.value = items.apiUrl
    showTrails.checked = items.overlayTrailsVisible !== false
    showNetworks.checked = items.overlayNetworksVisible !== false
    showTrailPhotos.checked = items.overlayTrailPhotosVisible !== false
    googleMapsApiKey.value = items.googleMapsApiKey || ''
    rightClickViewer.value = items.rightClickViewer || 'mapillary'

    const { preset, hex } = classifyHighlight(items.overlayBookmarkHighlightColor)
    bookmarkHaloPreset.value = preset
    if (hex) bookmarkHaloHex.value = hex
    else if (preset === 'custom') bookmarkHaloHex.value = ''
    syncHexVisibility()
  })

  saveBtn.addEventListener('click', () => {
    const url = input.value.trim().replace(/\/$/, '')
    const originPattern = tryOriginPattern(url)
    const shouldRequest = originPattern && originPattern.startsWith('https://')

    const persist = () => {
      chrome.storage.sync.set({ apiUrl: url }, () => {
        status.textContent = 'Saved.'
        setTimeout(() => { status.textContent = '' }, 2000)
      })
    }

    if (!shouldRequest) {
      persist()
      return
    }

    chrome.permissions.request({ origins: [originPattern] }, (granted) => {
      if (!granted) {
        status.textContent = 'Permission denied — API URL not saved.'
        setTimeout(() => { status.textContent = '' }, 2500)
        return
      }
      persist()
    })
  })

  validateKeyBtn.addEventListener('click', () => {
    validateGoogleMapsKey(googleMapsApiKey.value)
  })

  googleMapsApiKey.addEventListener('input', () => {
    keyStatus.textContent = ''
    keyStatus.style.color = '#666'
  })

  showTrails.addEventListener('change', () => {
    chrome.storage.sync.set({ overlayTrailsVisible: showTrails.checked }, () => {
      status.textContent = showTrails.checked ? 'Trails on.' : 'Trails hidden.'
      setTimeout(() => { status.textContent = '' }, 2000)
    })
  })

  showNetworks.addEventListener('change', () => {
    chrome.storage.sync.set({ overlayNetworksVisible: showNetworks.checked }, () => {
      status.textContent = showNetworks.checked ? 'Networks on.' : 'Networks hidden.'
      setTimeout(() => { status.textContent = '' }, 2000)
    })
  })

  showTrailPhotos.addEventListener('change', () => {
    chrome.storage.sync.set({ overlayTrailPhotosVisible: showTrailPhotos.checked }, () => {
      status.textContent = showTrailPhotos.checked
        ? 'List thumbnails on (uses map viewport).'
        : 'List thumbnails off.'
      setTimeout(() => { status.textContent = '' }, 2000)
    })
  })

  bookmarkHaloPreset.addEventListener('change', () => {
    syncHexVisibility()
    if (bookmarkHaloPreset.value === 'custom') {
      const hex = tryNormalizeHex(bookmarkHaloHex.value)
      if (hex) {
        bookmarkHaloHex.value = hex
        saveBookmarkHighlight(hex, 'Bookmark outline color saved.')
      } else {
        bookmarkHaloHex.value = ''
        bookmarkHaloHex.focus()
        status.textContent = 'Enter a hex color (e.g. #e6c619).'
        setTimeout(() => { status.textContent = '' }, 2500)
      }
      return
    }
    saveBookmarkHighlight(
      bookmarkHaloPreset.value,
      `Bookmark outline: ${bookmarkHaloPreset.options[bookmarkHaloPreset.selectedIndex].text}.`
    )
  })

  bookmarkHaloHex.addEventListener('input', () => {
    if (bookmarkHaloPreset.value !== 'custom') return
    clearTimeout(hexSaveTimer)
    hexSaveTimer = setTimeout(() => {
      const hex = tryNormalizeHex(bookmarkHaloHex.value)
      if (!hex) return
      bookmarkHaloHex.value = hex
      saveBookmarkHighlight(hex, 'Bookmark outline color saved.')
    }, 400)
  })

  bookmarkHaloHex.addEventListener('blur', () => {
    if (bookmarkHaloPreset.value !== 'custom') return
    const hex = tryNormalizeHex(bookmarkHaloHex.value)
    if (hex) {
      bookmarkHaloHex.value = hex
      saveBookmarkHighlight(hex, 'Bookmark outline color saved.')
    }
  })

  rightClickViewer.addEventListener('change', () => {
    chrome.storage.sync.set({ rightClickViewer: rightClickViewer.value }, () => {
      status.textContent = `Right-click viewer: ${rightClickViewer.options[rightClickViewer.selectedIndex].text}.`
      setTimeout(() => { status.textContent = '' }, 2000)
    })
  })
})
