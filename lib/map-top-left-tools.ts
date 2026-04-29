import L from 'leaflet'
import { MAP, basemapControlSvg, locateControlSvg } from '@/lib/map-theme'
import type { MapBaseStyle } from '@/lib/map-basemap'

export interface TopLeftToolControlOptions {
  /** Returns the currently-selected basemap style (read on each open). */
  getCurrentBasemapStyle: () => MapBaseStyle
  /** Called when the user picks a basemap style. */
  applyBasemapStyle: (style: MapBaseStyle) => void
  /** Called with the user's geolocation when the locate button succeeds. */
  onLocate: (lat: number, lon: number, accuracyM: number) => void
}

/**
 * Locate + basemap tool controls under native zoom; basemap panel lists styles.
 * Extracted from LeafletMap so the imperative DOM construction lives in one place.
 */
export function createTopLeftToolControl(
  map: L.Map,
  { getCurrentBasemapStyle, applyBasemapStyle, onLocate }: TopLeftToolControlOptions
): L.Control {
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
      applySelection(getCurrentBasemapStyle())

      const closePanel = () => {
        panel.style.display = 'none'
        basemapToggle.setAttribute('aria-expanded', 'false')
      }
      const openPanel = () => {
        applySelection(getCurrentBasemapStyle())
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
        applyBasemapStyle('osm')
        applySelection('osm')
        closePanel()
      }
      catalogBtn.onclick = (ev) => {
        L.DomEvent.stopPropagation(ev)
        applyBasemapStyle('stylized')
        applySelection('stylized')
        closePanel()
      }

      locateBtn.onclick = () => {
        if (!('geolocation' in navigator)) return
        navigator.geolocation.getCurrentPosition(
          (pos) => onLocate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
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
}
