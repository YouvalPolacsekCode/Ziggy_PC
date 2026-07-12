// Per-home routing config — the runtime source of truth for "which Ziggy home
// does this native install talk to".
//
// Background: the Capacitor app used to hardcode a single prod backend
// (app.ziggy-home.com) in nativeApiBase.js. A fresh Canary Home is unreachable
// that way. This module holds a list of paired homes + an active-home
// selection, each carrying the per-home reachable base URL captured at pairing.
//
// Storage strategy — dual write:
//   • localStorage (synchronous mirror): read at module-eval so the fetch/WS
//     shim in nativeApiBase.js can resolve the active base URL *synchronously*
//     at request time, with zero await. This is what makes routing work on the
//     very first request after boot for a returning user.
//   • Capacitor Preferences (durable, async): the survives-everything copy on
//     native. hydrateFromDurable() reconciles it into memory when the sync
//     mirror is empty (e.g. WebView storage was evicted).
//
// A home record:
//   {
//     home_id:   "home_01HV...",              // opaque, backend-issued
//     baseUrl:   "https://<home>.hubs..."      // HTTP(S) prefix for /api/* + paths
//                | "https://relay/api/proxy/<id>",  // relay-proxy prefix works too
//     wsBaseUrl: "wss://<home>.hubs..."         // WS(S) prefix for /ws + WS paths
//     relayUrl:  "https://relay..." | null,     // relay origin (reference)
//     label:     "..." | null,
//   }
//
// baseUrl is stored as an opaque string *prefix*: the shim just does
// `baseUrl + path`. That lets a direct per-home host and a relay-proxy path
// both work without branching (Stream 3 may hand us either).

import { storage } from './native'

const HOMES_KEY  = 'ziggy_homes'
const ACTIVE_KEY = 'ziggy_active_home_id'

const _hasLS = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage !== null }
  catch { return false }
})()

function _readLS(key)        { try { return _hasLS ? localStorage.getItem(key) : null } catch { return null } }
function _writeLS(key, val)  { try { if (_hasLS) localStorage.setItem(key, val) } catch { /* quota / private mode */ } }
function _removeLS(key)      { try { if (_hasLS) localStorage.removeItem(key) } catch { /* ignore */ } }

function _stripSlash(v) {
  if (!v || typeof v !== 'string') return null
  const s = v.trim().replace(/\/+$/, '')
  return s || null
}

// Convert an HTTP(S) base prefix into its WS(S) equivalent, preserving any
// path prefix (relay-proxy case). Pure string work — the URL protocol setter
// refuses http↔ws swaps, so we don't use it.
export function deriveWsBase(baseUrl) {
  const b = _stripSlash(baseUrl)
  if (!b) return null
  if (/^https:\/\//i.test(b)) return 'wss://' + b.slice('https://'.length)
  if (/^http:\/\//i.test(b))  return 'ws://'  + b.slice('http://'.length)
  if (/^wss?:\/\//i.test(b))  return b
  return null
}

function _normalizeHome(h) {
  if (!h || !h.home_id) return null
  const baseUrl = _stripSlash(h.baseUrl)
  return {
    home_id:   String(h.home_id),
    baseUrl:   baseUrl,
    wsBaseUrl: _stripSlash(h.wsBaseUrl) || deriveWsBase(baseUrl),
    relayUrl:  _stripSlash(h.relayUrl),
    label:     h.label || null,
  }
}

function _parseHomes(raw) {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map(_normalizeHome).filter(Boolean)
  } catch { return [] }
}

// ── in-memory sync cache (hydrated from the localStorage mirror at eval) ──────
let _homes    = _parseHomes(_readLS(HOMES_KEY))
let _activeId = _readLS(ACTIVE_KEY) || (_homes[0]?.home_id ?? null)

// Provisional routing target — used mid-pairing, before the backend has
// confirmed a home_id, so the pair request itself reaches the right home
// (the QR carries the base). Cleared once the home is finalized.
let _provisional = null   // { baseUrl, wsBaseUrl } | null

// Swallow both sync throws and async rejections from a fire-and-forget durable
// write. storage.set is async, so a rejection can't be caught by a plain
// try/catch — it would surface as an unhandled rejection.
function _durable(op) {
  try { Promise.resolve(op()).catch(() => {}) } catch { /* ignore */ }
}

function _persist() {
  _writeLS(HOMES_KEY, JSON.stringify(_homes))
  if (_activeId) _writeLS(ACTIVE_KEY, _activeId)
  else           _removeLS(ACTIVE_KEY)
  // Durable async mirror (native Preferences). Fire-and-forget; failures on
  // the web path (no Preferences plugin) are harmless — localStorage above is
  // already the web source of truth.
  _durable(() => storage.set(HOMES_KEY, JSON.stringify(_homes)))
  if (_activeId) _durable(() => storage.set(ACTIVE_KEY, _activeId))
  else           _durable(() => storage.remove(ACTIVE_KEY))
}

// ── reads (synchronous) ──────────────────────────────────────────────────────
export function listHomesSync()   { return _homes.map(h => ({ ...h })) }
export function getActiveHomeId()  { return _activeId }
export function getActiveHomeSync() {
  return _homes.find(h => h.home_id === _activeId) || null
}
export function getActiveBaseUrlSync() {
  return getActiveHomeSync()?.baseUrl || null
}
export function getActiveWsBaseSync() {
  const h = getActiveHomeSync()
  return h?.wsBaseUrl || deriveWsBase(h?.baseUrl) || null
}

// Resolution used by the request shim: a provisional pairing target wins (so
// first-pair traffic reaches the new home), else the active home, else null
// (the shim falls back to the compiled-in PROD default for legacy installs).
export function resolveHttpBaseSync() {
  if (_provisional?.baseUrl) return _provisional.baseUrl
  return getActiveBaseUrlSync()
}
export function resolveWsBaseSync() {
  if (_provisional?.wsBaseUrl) return _provisional.wsBaseUrl
  return getActiveWsBaseSync()
}

// ── writes ───────────────────────────────────────────────────────────────────
export function upsertHome(home) {
  const n = _normalizeHome(home)
  if (!n) return null
  const i = _homes.findIndex(h => h.home_id === n.home_id)
  if (i >= 0) _homes[i] = { ..._homes[i], ...n }
  else        _homes.push(n)
  if (!_activeId) _activeId = n.home_id
  _persist()
  return n
}

export function setActiveHome(home_id) {
  if (home_id && _homes.some(h => h.home_id === home_id)) {
    _activeId = String(home_id)
    _persist()
    return true
  }
  return false
}

export function removeHome(home_id) {
  const before = _homes.length
  _homes = _homes.filter(h => h.home_id !== home_id)
  if (_activeId === home_id) _activeId = _homes[0]?.home_id ?? null
  if (_homes.length !== before) _persist()
}

export function clearHomes() {
  _homes = []
  _activeId = null
  _provisional = null
  _removeLS(HOMES_KEY)
  _removeLS(ACTIVE_KEY)
  _durable(() => storage.remove(HOMES_KEY))
  _durable(() => storage.remove(ACTIVE_KEY))
}

// ── provisional target (pairing handshake) ───────────────────────────────────
export function setProvisionalTarget(baseUrl) {
  const b = _stripSlash(baseUrl)
  _provisional = b ? { baseUrl: b, wsBaseUrl: deriveWsBase(b) } : null
  return _provisional
}
export function clearProvisionalTarget() { _provisional = null }

// ── durable reconciliation (native returning-user cold start) ────────────────
// Fills the in-memory cache from Capacitor Preferences when the synchronous
// localStorage mirror came up empty. Never clobbers a populated cache, so a
// fresh write during onboarding can't be overwritten by a slow async read.
export async function hydrateFromDurable() {
  try {
    if (_homes.length === 0) {
      const parsed = _parseHomes(await storage.get(HOMES_KEY))
      if (parsed.length) {
        _homes = parsed
        _writeLS(HOMES_KEY, JSON.stringify(_homes))
      }
    }
    if (!_activeId && _homes.length) {
      const a = await storage.get(ACTIVE_KEY)
      _activeId = (a && _homes.some(h => h.home_id === a)) ? a : _homes[0].home_id
      _writeLS(ACTIVE_KEY, _activeId)
    }
  } catch { /* ignore — sync mirror already covers the common path */ }
}
