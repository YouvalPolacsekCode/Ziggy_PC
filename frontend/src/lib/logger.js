/**
 * Ziggy frontend logger.
 *
 * Why this exists
 * ───────────────
 * The Debug page is filled by the backend's debug bus, which already covers
 * everything that happens server-side. What was missing was the *click*: a
 * tap on a device tile, the page it came from, the request_id that was
 * generated for it, the round-trip timing, and the WebSocket events that
 * arrived in response. This module fills that gap.
 *
 * Levels are the same words the backend uses (off | basic | verbose | trace)
 * so the Debug page can show a single unified feed.
 *
 *   off      — nothing.
 *   basic    — user-meaningful actions only (clicks, navigation, API failures).
 *   verbose  — adds API request/response + WS connect/disconnect.
 *   trace    — adds WS message types, store dispatches, render timings.
 *
 * Default is "off" so a normal user never pays for any of this. Bump the
 * level from the Debug page; the choice survives reloads via localStorage.
 *
 * Correlation
 * ───────────
 * `newRequestId()` mints a `f_<rand>` id. Pass it into `api(...)` so the
 * HTTP layer can attach `X-Request-Id`; the backend middleware will reuse
 * the same id for the entire request → service → HA chain. That's what
 * makes the Debug page able to show a click and a state ack as one row.
 *
 * Redaction
 * ─────────
 * The backend bus also sanitizes, but we strip locally before ever sending
 * — so a misconfigured FE never POSTs a token to the network.
 *
 * Batching
 * ────────
 * Events are buffered and flushed at most every 750 ms (or immediately if
 * the buffer fills). Fire-and-forget — a failed flush drops the batch
 * silently because debug telemetry must never break the app.
 */

const LEVEL_INT = { off: 0, basic: 1, verbose: 2, trace: 3 }
const ALL_LEVELS = ['off', 'basic', 'verbose', 'trace']
const LS_LEVEL_KEY = 'ziggy_fe_log_level'

const SENSITIVE_KEY_PATTERNS = [
  /token/i, /password/i, /api[_-]?key/i, /secret/i, /auth/i,
  /salt/i, /credential/i, /bearer/i,
]

function isSensitive(key) {
  return SENSITIVE_KEY_PATTERNS.some(p => p.test(String(key)))
}

function sanitize(value, depth = 0) {
  if (depth > 5) return value
  if (value == null) return value
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitive(k) ? '••••••••' : sanitize(v, depth + 1)
    }
    return out
  }
  return value
}

function newRequestId() {
  // Short and human-readable so it fits in the Debug page row.
  return 'f_' + Math.random().toString(36).slice(2, 12)
}

// ─── Buffer + level ──────────────────────────────────────────────────────────

const MAX_BUFFER = 500
const FLUSH_EVERY_MS = 750
const FLUSH_AT_COUNT = 25

let _level = (() => {
  try {
    const stored = localStorage.getItem(LS_LEVEL_KEY)
    return ALL_LEVELS.includes(stored) ? stored : 'off'
  } catch {
    return 'off'
  }
})()

const _ring = []          // most-recent events, capped at MAX_BUFFER
const _outbox = []        // events waiting to ship to the backend
let _flushTimer = null

function setLevel(level) {
  if (!ALL_LEVELS.includes(level)) return
  _level = level
  try { localStorage.setItem(LS_LEVEL_KEY, level) } catch {}
}

function getLevel() { return _level }

function isActive(eventLevel) {
  return LEVEL_INT[_level] >= LEVEL_INT[eventLevel]
}

// ─── Core emit ───────────────────────────────────────────────────────────────

function _push(level, step, data, requestId, scope) {
  if (!isActive(level)) return null
  const safe = data ? sanitize(data) : undefined
  const ev = {
    id: Math.random().toString(36).slice(2, 14),
    ts: new Date().toISOString(),
    scope: scope || 'frontend',
    level,
    step,
    request_id: requestId || null,
    data: safe,
  }
  _ring.push(ev)
  if (_ring.length > MAX_BUFFER) _ring.shift()
  _outbox.push(ev)
  if (_outbox.length >= FLUSH_AT_COUNT) {
    _flushNow()
  } else {
    _scheduleFlush()
  }
  return ev
}

function _scheduleFlush() {
  if (_flushTimer) return
  _flushTimer = setTimeout(_flushNow, FLUSH_EVERY_MS)
}

async function _flushNow() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
  if (_outbox.length === 0) return
  // Drain — copy & clear before await so concurrent pushes don't get lost.
  const batch = _outbox.splice(0, _outbox.length)
  try {
    const token = (typeof localStorage !== 'undefined')
      ? localStorage.getItem('ziggy_token') || ''
      : ''
    await fetch('/api/debug/frontend-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ events: batch.map(e => ({
        scope: e.scope,
        level: e.level,
        step: e.step,
        request_id: e.request_id,
        data: e.data,
      })) }),
      // Keep the page snappy — never block on logger I/O.
      keepalive: true,
    })
  } catch {
    // Logger drop-in must never throw. Keep the local ring buffer; the
    // user can still inspect it from the Debug page.
  }
}

// Force an immediate flush before unload so the click that navigates away
// isn't lost. Browsers honor sendBeacon-equivalent semantics for keepalive.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', _flushNow)
  window.addEventListener('beforeunload', _flushNow)
}

// ─── Public helpers ──────────────────────────────────────────────────────────
//
// All of these are *no-ops* when the level is below threshold — guard logic
// lives inside _push so callers can be sprinkled without worrying about cost.

function click(component, label, extra = {}) {
  return _push('basic', `click:${component}`, { label, ...extra })
}

function action(name, extra = {}, requestId) {
  return _push('basic', name, extra, requestId)
}

function navigate(from, to) {
  return _push('basic', 'navigate', { from, to })
}

function api(method, path, requestId, extra = {}) {
  // VERBOSE on entry; the response logs a separate basic line on failure
  // and verbose on success (see lib/api.js).
  return _push('verbose', 'api_request', { method, path, ...extra }, requestId)
}

function apiResponse(method, path, requestId, status, durationMs, extra = {}) {
  const level = status >= 400 ? 'basic' : 'verbose'
  return _push(level, 'api_response', {
    method, path, status, duration_ms: durationMs,
    result: status >= 500 ? 'server_error'
           : status >= 400 ? 'client_error'
           : 'ok',
    ...extra,
  }, requestId)
}

function apiError(method, path, requestId, error, durationMs) {
  return _push('basic', 'api_error', {
    method, path, duration_ms: durationMs,
    error: String(error?.message || error),
    result: 'exception',
  }, requestId)
}

function ws(step, extra = {}) {
  // BASIC: open/close/error. VERBOSE: ping/pong, message types.
  const level = step === 'ws_message' ? 'verbose' : 'basic'
  return _push(level, step, extra)
}

function error(step, err, extra = {}) {
  return _push('basic', step, {
    error: String(err?.message || err),
    stack: err?.stack ? String(err.stack).split('\n').slice(0, 5).join('\n') : undefined,
    result: 'exception',
    ...extra,
  })
}

function trace(step, extra = {}, requestId) {
  return _push('trace', step, extra, requestId)
}

function snapshot() {
  return _ring.slice()
}

function clear() { _ring.length = 0 }

const logger = {
  setLevel, getLevel, isActive,
  newRequestId,
  click, action, navigate,
  api, apiResponse, apiError,
  ws,
  error, trace,
  snapshot, clear,
}

export default logger
export {
  setLevel, getLevel, isActive,
  newRequestId,
  click, action, navigate,
  api, apiResponse, apiError,
  ws,
  error, trace,
  snapshot, clear,
}
