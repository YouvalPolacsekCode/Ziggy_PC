// Device icon resolution — bridges the emoji-based KIND_META (lib/devices.js)
// to the imported image icon sets so device icons can be switched live between
// three styles without touching stored data:
//
//   'emoji' (default) → the KIND_META emoji, i.e. exactly today's behavior
//   'line'            → flat vector SVGs   (src/assets/device-icons)
//   '3d'              → skeuomorphic PNGs   (src/assets/device-icons-3d)
//
// The active style is a UI pref (uiStore.iconStyle). Because 'emoji' is the
// default and nothing about persisted per-device icons changes, flipping back
// to Emoji is a full revert. A per-device *custom* icon is still stored as an
// emoji; in image mode we map that emoji → kind → asset so "the icon I gave"
// shows up in its new-set version too.

import { useUIStore } from '../stores/uiStore'
import { kindMeta } from './devices'

// Vite bundles every asset in these folders and hands back their final URLs.
const LINE = import.meta.glob('../assets/device-icons/*.svg',    { eager: true, query: '?url', import: 'default' })
const D3   = import.meta.glob('../assets/device-icons-3d/*.png', { eager: true, query: '?url', import: 'default' })

function urlFor(map, name) {
  if (!name) return null
  for (const [path, url] of Object.entries(map)) {
    const base = path.split('/').pop().replace(/\.(svg|png)$/, '')
    if (base === name) return url
  }
  return null
}

// kind (KIND_META key) → asset base name in each set. Filenames differ between
// the two sets, so both are listed. A missing entry falls back to emoji.
const KIND_ASSET = {
  light:        { line: 'light',        d3: 'light' },
  lamp:         { line: 'lamp',         d3: 'lamp' },
  led_strip:    { line: 'led-strip',    d3: 'light-strip' },
  switch:       { line: 'switch',       d3: 'switch' },
  plug:         { line: 'plug',         d3: 'plug' },
  tv:           { line: 'tv',           d3: 'tv' },
  soundbar:     { line: 'soundbar',     d3: 'soundbar' },
  receiver:     { line: 'receiver',     d3: 'receiver' },
  projector:    { line: 'projector',    d3: 'projector' },
  monitor:      { line: 'monitor',      d3: 'tv' },          // no 3d 'monitor'
  ac:           { line: 'ac',           d3: 'air-conditioner' },
  fan:          { line: 'fan',          d3: 'fan' },
  kettle:       { line: 'kettle',       d3: 'kettle' },
  coffee:       { line: 'coffee',       d3: 'coffee-machine' },
  cover:        { line: 'blind',        d3: 'blinds' },
  lock:         { line: 'lock',         d3: 'lock' },
  alarm:        { line: 'alarm',        d3: 'alarm' },
  vacuum:       { line: 'vacuum',       d3: 'robot-vacuum' },
  humidifier:   { line: 'humidifier',   d3: 'humidifier' },
  water_heater: { line: 'water-heater', d3: 'water-heater' },
  valve:        { line: 'valve',        d3: 'valve' },
  lawn_mower:   { line: 'mower',        d3: 'mower' },
  camera:       { line: 'camera',       d3: 'camera' },
  sensor:       { line: 'presence',     d3: 'sensors' },     // no line 'sensor'
  motion:       { line: 'motion',       d3: 'motion' },
  door:         { line: 'door',         d3: 'door' },
  window:       { line: 'window',       d3: 'window' },
  leak:         { line: 'leak',         d3: 'leak' },
  occupancy:    { line: 'presence',     d3: 'presence' },
  smoke:        { line: 'smoke',        d3: 'alarm' },      // no 3d 'smoke' glyph
  temperature:  { line: 'temperature',  d3: 'temperature' },
  humidity:     { line: 'humidity',     d3: 'water' },
  power_meter:  { line: 'power',        d3: 'power' },
  binary:       { line: 'binary',       d3: 'sensors' },     // no 3d 'binary'
  person:       { line: 'person',       d3: 'person' },
  unknown:      { line: 'unknown',      d3: 'custom' },
}

// custom emoji → kind, so a user-assigned icon resolves to the matching image.
// Covers the KIND_META emoji plus the DeviceDetail picker palette.
const EMOJI_KIND = {
  '💡': 'light', '🪔': 'lamp', '🪩': 'led_strip', '🎛️': 'switch', '🔌': 'plug',
  '📺': 'tv', '🔊': 'soundbar', '🎚️': 'receiver', '📽️': 'projector', '🖥️': 'monitor',
  '❄️': 'ac', '💨': 'fan', '🫖': 'kettle', '☕': 'coffee', '🪟': 'window', '🔒': 'lock',
  '🛡️': 'alarm', '🔔': 'alarm', '🚨': 'smoke', '🤖': 'vacuum', '💧': 'humidity',
  '🔥': 'water_heater', '🚰': 'valve', '🌿': 'lawn_mower', '🪴': 'lawn_mower',
  '📷': 'camera', '📡': 'sensor', '🛰️': 'sensor', '🚶': 'motion', '🏃': 'motion',
  '🚪': 'door', '🚱': 'leak', '👥': 'occupancy', '🌡️': 'temperature', '🔋': 'power_meter',
  '⚪': 'binary', '🧍': 'person', '👤': 'person', '📦': 'unknown',
}

// Resolve an image URL for a kind under a style. customIcon (an emoji) wins,
// mapped through EMOJI_KIND. Returns null when there's no asset → emoji fallback.
export function iconAssetFor(kind, style, customIcon) {
  const effKind = (customIcon && EMOJI_KIND[customIcon]) || kind || 'unknown'
  const names = KIND_ASSET[effKind] || KIND_ASSET.unknown
  if (style === '3d')   return urlFor(D3, names.d3)   || urlFor(LINE, names.line)
  if (style === 'line') return urlFor(LINE, names.line) || urlFor(D3, names.d3)
  return null
}

// Whether a given custom emoji has an image in the active image set (used by
// the picker to preview choices).
export function iconChoiceAsset(emoji, style) {
  return iconAssetFor(null, style === '3d' ? '3d' : 'line', emoji)
}

// Drop-in device icon. In emoji mode (default) renders the emoji span exactly
// as before; in image mode renders an <img>, falling back to emoji if an asset
// is missing.
//
// `fill`: render the image to FILL its parent icon box (used on device tiles).
//   - line SVGs just `contain` the box.
//   - 3D badges carry transparent margins around a rounded dark badge, so at
//     `contain` they'd float small inside the box with a "white frame". We
//     scale them up and clip (overflow hidden + inherited radius) so the badge
//     covers the box edge-to-edge and reads as the tile itself.
// Without `fill`, renders at a fixed `size` px (used inline, e.g. sibling rows).
export function DeviceIcon({ kind, customIcon, size = 18, fill = false, className, style: css }) {
  const iconStyle = useUIStore(s => s.iconStyle)
  if (iconStyle === 'line' || iconStyle === '3d') {
    const src = iconAssetFor(kind, iconStyle, customIcon)
    if (src) {
      if (fill) {
        const scale = iconStyle === '3d' ? '116%' : '100%'
        return (
          <span aria-hidden="true" className={className}
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                     justifyContent: 'center', overflow: 'hidden', borderRadius: 'inherit', ...css }}>
            <img src={src} alt="" style={{ width: scale, height: scale, objectFit: 'contain', flex: 'none' }} />
          </span>
        )
      }
      return (
        <img src={src} alt="" aria-hidden="true" className={className}
          style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block', ...css }} />
      )
    }
  }
  const emoji = customIcon || kindMeta(kind).icon
  return (
    <span aria-hidden="true" className={className} style={{ fontSize: size, lineHeight: 1, ...css }}>{emoji}</span>
  )
}

export const ICON_STYLES = ['emoji', 'line', '3d']
