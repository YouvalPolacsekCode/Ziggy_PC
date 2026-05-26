/**
 * Per-device source-button usage tracker.
 *
 * Modern TVs/Cast/Apple TV media_players expose dozens of sources (HDMI
 * inputs + every installed streaming app). Showing them all flat is
 * unusable. This module records how often the user picks each source and
 * lets the remote pin the most-used ones up top — Netflix on a media stick,
 * HDMI 2 on a setup where that's the user's PS5.
 *
 * Storage: a single localStorage entry, keyed by entity_id, valued by
 * { source_name: pickCount }. No server round-trip; the data is intentionally
 * device-local (one household member's "most-used" shouldn't override
 * another's on a shared tablet).
 *
 *   {
 *     "media_player.living_room_tv": { "Netflix": 47, "HDMI 1": 12, "YouTube": 3 },
 *     "media_player.bedroom_tv":     { "Apple TV": 22, "Plex": 8 }
 *   }
 *
 * Failure mode: localStorage unavailable / corrupt → reads return empty,
 * writes are no-ops. The remote falls back to HA's source_list ordering.
 */

const KEY = 'ziggy_source_usage'

// Cap how many entities we track so a long-lived install doesn't grow the
// localStorage entry indefinitely. When over cap, drop the least-used.
const MAX_ENTITIES = 100

function _read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : {}
  } catch {
    return {}
  }
}

function _write(data) {
  try {
    const eids = Object.keys(data)
    if (eids.length > MAX_ENTITIES) {
      // Drop the entities with the smallest cumulative usage to stay under cap.
      const ranked = eids
        .map(e => [e, Object.values(data[e] || {}).reduce((a, b) => a + Number(b || 0), 0)])
        .sort((a, b) => a[1] - b[1])
      for (const [e] of ranked.slice(0, eids.length - MAX_ENTITIES)) {
        delete data[e]
      }
    }
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // localStorage full / disabled / private mode — silently drop the write.
  }
}

/**
 * Record that the user picked `source` on `entityId`. Call this from the
 * remote's tap handler, NOT from state-changed events — we want to capture
 * intent (the user pressed the button), not the device's own auto-switches
 * (HDMI-CEC, app launches from a phone, etc.).
 */
export function bumpSourceUse(entityId, source) {
  if (!entityId || !source) return
  const data = _read()
  if (!data[entityId]) data[entityId] = {}
  const key = String(source)
  data[entityId][key] = (Number(data[entityId][key]) || 0) + 1
  _write(data)
}

/** Raw counts: `{ source: count }` for a single entity. Empty when unknown. */
export function getSourceCounts(entityId) {
  if (!entityId) return {}
  return _read()[entityId] || {}
}

/**
 * Re-order a source list so the most-frequently-picked sources appear first.
 * Stable: sources with equal usage (including all-zero on a fresh device) keep
 * their original HA order. The currently-active source is always pulled to
 * the front so the user can see what's selected even if it's been touched
 * less often than other recents.
 *
 *   sources       — array as TVRemote already builds it (mix of HA strings
 *                   and IR `{cmd, label}` objects).
 *   entityId      — the device this source list belongs to.
 *   activeSource  — facts.source (HA's reported current selection), used to
 *                   force-pin it. May be null.
 *
 * Returns a new array; never mutates the input.
 */
export function rankSources(sources, entityId, activeSource = null) {
  if (!Array.isArray(sources) || sources.length === 0) return []
  const counts = getSourceCounts(entityId)
  const _label = (s) => (typeof s === 'string' ? s : s?.label || s?.cmd || '')
  const _count = (s) => Number(counts[_label(s)]) || 0
  // Decorate-sort-undecorate to preserve original order as the tie-breaker.
  return sources
    .map((s, i) => ({ s, i, c: _count(s), active: _label(s) === activeSource }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1   // active first
      if (a.c !== b.c) return b.c - a.c                      // most-used next
      return a.i - b.i                                       // stable
    })
    .map(({ s }) => s)
}
