/**
 * Hex fallbacks for map canvas (Leaflet cannot read CSS variables on canvas).
 * Always use the light “catalog” palette so vectors match the basemap in any UI theme.
 * Chrome around the map (zoom bar, popups) uses `--map-chrome-*` in globals.css.
 */
import type { PathOptions } from 'leaflet'
import type { Trail } from '@/lib/types'

export const MAP = {
  foreground: '#242030',
  card: '#f4f0e7',
  primary: '#e07828',
  primaryFg: '#14111a',
  forest: '#2f6a52',
  /** Brighter than `forest` for easy-difficulty polylines on varied basemaps. */
  forestBright: '#34a56d',
  /**
   * Intermediate / “blue square” trails — poster-blue (90s MTB legibility on the map).
   * UI accents still use `electric` (violet); polylines need a clear blue read.
   */
  trailBlueSquare: '#156be8',
  electric: '#6d3dd4',
  destructive: '#c43229',
  mud: '#d4c8b4',
  secondary: '#3d6450',
  /** Distinct from trail difficulty lines; reads as “track / activity”. */
  rideLine: '#5a3fc9',
  haloLight: '#f4f0e7',
  mutedLabel: '#5a5466',
  outlineBorder: '#4a4558',
  white: '#ffffff',
  /** GPS accuracy ring + dot (electric family). */
  locationAccuracyStroke: '#6d3dd4',
  locationAccuracyFill: '#9d5cf0',
  locationDotBorder: '#5b21b6',
  locationDotFill: '#6d3dd4',
  /** Averaged trim preview */
  trimAverage: '#b91cac',
  thumbnailBg: '#d4d4d8',
} as const

export type MapPalette = { [K in keyof typeof MAP]: string }

export function trailLineColor(
  difficulty: Trail['difficulty'],
  palette: MapPalette = MAP
): string {
  switch (difficulty) {
    case 'easy':
      return palette.forestBright
    case 'intermediate':
      return palette.trailBlueSquare
    case 'hard':
      return palette.foreground
    case 'pro':
      return palette.primary
    case 'not_set':
    default:
      return palette.primary
  }
}

export function rideLineColor(palette: MapPalette = MAP): string {
  return palette.rideLine
}

export function networkPolygonLeafletStyle(
  isSelected: boolean,
  palette: MapPalette = MAP
): PathOptions {
  return {
    color: palette.electric,
    weight: isSelected ? 3 : 2,
    fillColor: palette.electric,
    fillOpacity: isSelected ? 0.25 : 0.1,
    opacity: isSelected ? 1 : 0.7,
  }
}

/** Chunkier print-era polylines (Leaflet path options). */
export const catalogLineHints = {
  lineCap: 'butt' as const,
  lineJoin: 'miter' as const,
}

export const mapLabelFontStack = `'Russo One', Impact, ui-sans-serif, sans-serif`

export function trailMidpointLabelHtml(
  opts: {
    trailColor: string
    diffIcon: string
    name: string
    labelAngle: number
  },
  palette: MapPalette = MAP
): string {
  const { trailColor, diffIcon, name, labelAngle } = opts
  const halo = palette.haloLight
  return `<div style="font-family:${mapLabelFontStack};font-size:11px;font-weight:400;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;pointer-events:none;line-height:1.35;color:${palette.foreground};transform:rotate(${labelAngle}deg);transform-origin:0 50%;text-shadow:-1px -1px 0 ${halo},1px -1px 0 ${halo},-1px 1px 0 ${halo},1px 1px 0 ${halo}"><span style="color:${trailColor}">${diffIcon}</span>${diffIcon ? '\u00a0' : ''}${name}</div>`
}

export function networkCentroidLabelHtml(name: string, palette: MapPalette = MAP): string {
  const halo = palette.haloLight
  return `<div style="font-family:${mapLabelFontStack};font-size:13px;font-weight:400;letter-spacing:0.05em;text-transform:uppercase;white-space:nowrap;cursor:pointer;color:${palette.electric};text-shadow:-1px -1px 0 ${halo},1px -1px 0 ${halo},-1px 1px 0 ${halo},1px 1px 0 ${halo}">${name}</div>`
}

export function buildMapPopupStyles(m: MapPalette) {
  return {
    column: 'display:flex;flex-direction:column;gap:8px;min-width:160px',
    columnWide: 'display:flex;flex-direction:column;gap:8px;min-width:180px',
    btnRow: 'display:flex;gap:6px',
    label: `font-size:12px;color:${m.mutedLabel};margin:0`,
    btnPrimaryRide: `flex:1;padding:4px 8px;background:${m.primary};color:${m.primaryFg};border:2px solid ${m.foreground};border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:2px 2px 0 0 ${m.foreground}`,
    btnPrimaryRideFullWidth: `padding:4px 8px;background:${m.primary};color:${m.primaryFg};border:2px solid ${m.foreground};border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:2px 2px 0 0 ${m.foreground}`,
    btnPrimaryTrail: `flex:1;padding:4px 8px;background:${m.forest};color:${m.card};border:2px solid ${m.foreground};border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:2px 2px 0 0 ${m.foreground}`,
    btnPrimaryTrailFullWidth: `padding:4px 8px;background:${m.forest};color:${m.card};border:2px solid ${m.foreground};border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:2px 2px 0 0 ${m.foreground}`,
    btnOutline: `padding:4px 8px;border:2px solid ${m.foreground};border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;background:${m.card};color:${m.foreground};box-shadow:2px 2px 0 0 ${m.foreground}`,
    imgThumb: `width:160px;height:120px;object-fit:cover;border-radius:4px;border:2px solid ${m.outlineBorder}`,
  } as const
}

export const mapPopupStyles = buildMapPopupStyles(MAP)

export function locateControlSvg(palette: MapPalette = MAP): string {
  const s = palette.foreground
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="none">' +
    `<path d="M10 2v2" stroke="${s}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M10 16v2" stroke="${s}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M2 10h2" stroke="${s}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M16 10h2" stroke="${s}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M10 14a4 4 0 1 0 0-8a4 4 0 0 0 0 8Z" stroke="${s}" stroke-width="2"/>` +
    '</svg>'
  )
}

/** Stacked-layers icon for basemap style picker (Leaflet control button). */
export function basemapControlSvg(palette: MapPalette = MAP): string {
  const s = palette.foreground
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none">' +
    `<path d="M12 2 2 7l10 5 10-5-10-5Z" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="m2 12 10 5 10-5M2 17l10 5 10-5" stroke="${s}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    '</svg>'
  )
}

export function refineNodeDivHtml(
  size: number,
  borderColor: string,
  palette: MapPalette = MAP
): string {
  return `<div style="width:${size}px;height:${size}px;background:${borderColor};border:2px solid ${palette.foreground};border-radius:50%;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`
}

export function refineMidpointDivHtml(
  borderColor: string,
  palette: MapPalette = MAP
): string {
  return `<div style="width:10px;height:10px;background:${palette.card};border:2px solid ${borderColor};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>`
}

/** Insert midpoint for add-trail draw / wide tap target — visible dot centered in a larger hit area. */
export function drawInsertMidpointDivHtml(
  borderColor: string,
  palette: MapPalette = MAP
): string {
  const inner = 10
  const outer = 28
  return (
    `<div style="width:${outer}px;height:${outer}px;display:flex;align-items:center;justify-content:center;pointer-events:auto">` +
    `<div style="width:${inner}px;height:${inner}px;background:${palette.card};border:2px solid ${borderColor};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>` +
    `</div>`
  )
}

export function drawTrailNodeDivHtml(
  size: number,
  borderColor: string,
  palette: MapPalette = MAP
): string {
  return `<div style="width:${size}px;height:${size}px;background:${borderColor};border:2px solid ${palette.foreground};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`
}

export function drawNetworkNodeDivHtml(
  size: number,
  borderColor: string,
  palette: MapPalette = MAP
): string {
  return `<div style="width:${size}px;height:${size}px;background:${borderColor};border:2px solid ${palette.foreground};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`
}

export function snapAnchorPointDivHtml(
  size: number = 14,
  palette: MapPalette = MAP
): string {
  return `<div style="width:${size}px;height:${size}px;background:${palette.electric};border:3px solid ${palette.foreground};border-radius:50%;box-shadow:0 0 0 3px ${palette.electric}40,0 2px 6px rgba(0,0,0,.5)"></div>`
}

export function snapMidpointDivHtml(
  size: number = 10,
  palette: MapPalette = MAP
): string {
  return `<div style="width:${size}px;height:${size}px;background:${palette.electric};border:2px dashed ${palette.foreground};border-radius:50%;opacity:0.6;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`
}
