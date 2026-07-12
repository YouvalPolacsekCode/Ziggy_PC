// Pairing capture — turn a scanned/typed pair payload into a persisted,
// active per-home routing config.
//
// The pairing QR (minted by the PWA, see components/PairWithPhone.jsx) looks
// like:
//     ziggy://pair?code=ABC123&base=https%3A%2F%2F<home>.hubs.ziggy-home.com
// and may additionally carry a relay hint:
//     &relay=https%3A%2F%2Frelay.ziggy-home.com&home=home_01HV...
//
// Flow:
//   1. parsePairPayload(raw)  → { code, baseUrl, relayUrl, homeId }
//   2. applyPairingTarget()   → set a provisional routing target so the
//                               subsequent POST /api/mobile/pair reaches THIS
//                               home (critical for a fresh Canary Home the app
//                               has never talked to before).
//   3. finalizeHome()         → after pair() returns, persist the authoritative
//                               per-home base (derived from the response's
//                               webhook_url / ws_url) and make it the active
//                               home; clears the provisional target.
//
// Owned by Stream 4. Consumes Stream 3's provision contract defensively: it
// works whether the QR carries a direct per-home host, a relay+home_id pair,
// or nothing at all (in which case the base is recovered from the pair
// response — which the backend always populates with per-home URLs).

import {
  upsertHome,
  setActiveHome,
  setProvisionalTarget,
  clearProvisionalTarget,
  deriveWsBase,
} from './homeConfig'

function _cleanUrl(v) {
  if (!v) return null
  let s = String(v).trim()
  try { s = decodeURIComponent(s) } catch { /* already decoded */ }
  s = s.replace(/\/+$/, '')
  return /^https?:\/\//i.test(s) ? s : null
}

// origin (scheme://host[:port]) of an http(s) URL, no path.
function _httpOrigin(url) {
  if (!url) return null
  try { return new URL(url).origin } catch { return null }
}

// origin of a ws(s) URL, expressed as its http(s) equivalent.
function _wsUrlToHttpOrigin(wsUrl) {
  if (!wsUrl || typeof wsUrl !== 'string') return null
  let s = wsUrl.trim()
  if (/^wss:\/\//i.test(s)) s = 'https://' + s.slice('wss://'.length)
  else if (/^ws:\/\//i.test(s)) s = 'http://' + s.slice('ws://'.length)
  return _httpOrigin(s)
}

/**
 * Parse a raw scanned/typed pair payload.
 * Accepts: a bare code ("ABC123"), a ziggy://pair?... deep link, or any
 * string with a `code=` query param. Unknown/extra params are ignored.
 */
export function parsePairPayload(raw) {
  const out = { code: null, baseUrl: null, relayUrl: null, homeId: null }
  if (!raw) return out
  const s = String(raw).trim()

  const q = s.indexOf('?')
  if (q >= 0) {
    let params = null
    try { params = new URLSearchParams(s.slice(q + 1)) } catch { params = null }
    if (params) {
      const c = (params.get('code') || '').trim().toUpperCase()
      if (c) out.code = c
      out.baseUrl  = _cleanUrl(params.get('base') || params.get('url') || params.get('host'))
      out.relayUrl = _cleanUrl(params.get('relay'))
      out.homeId   = (params.get('home') || params.get('home_id') || '').trim() || null
    }
  }

  if (!out.code) {
    const m = s.match(/([A-Za-z0-9]{4,12})/)
    if (m) out.code = m[1].toUpperCase()
  }

  // No explicit base but we have relay + home_id → synthesize the relay-proxy
  // prefix. Matches the /api/proxy/{home_id} contract in backend/lib/api.js.
  if (!out.baseUrl && out.relayUrl && out.homeId) {
    out.baseUrl = out.relayUrl.replace(/\/+$/, '') + '/api/proxy/' + out.homeId
  }

  return out
}

/**
 * Set the provisional routing target so the immediately-following pair request
 * reaches the intended home. No-op (returns null) when the payload carries no
 * base — the app then falls back to the active/default home, which is correct
 * for the single-home founder build and for re-pairing an already-known home.
 */
export function applyPairingTarget(parsed) {
  if (parsed?.baseUrl) {
    setProvisionalTarget(parsed.baseUrl)
    return parsed.baseUrl
  }
  return null
}

/**
 * Persist the paired home and make it active.
 *
 * Base-URL precedence (most authoritative first):
 *   1. origin of pairResponse.webhook_url  — backend-declared per-home host
 *   2. origin of pairResponse.ws_url        — same host, WS scheme
 *   3. parsed.baseUrl                        — the QR's hint
 * The WS base is derived from whichever HTTP base won, so HTTP and WS always
 * share host + path-prefix (safe under both direct-host and relay-proxy).
 *
 * Returns the persisted home record, or null if no home_id could be resolved
 * (in which case the provisional target is cleared and nothing is stored).
 */
export function finalizeHome({ parsed = null, pairResponse = null, label = null } = {}) {
  const resp = pairResponse || {}
  const baseUrl =
    _httpOrigin(resp.webhook_url) ||
    _wsUrlToHttpOrigin(resp.ws_url) ||
    parsed?.baseUrl ||
    null

  const home_id = resp.home_id || parsed?.homeId || null
  if (!home_id) {
    clearProvisionalTarget()
    return null
  }

  const home = upsertHome({
    home_id,
    baseUrl,
    wsBaseUrl: deriveWsBase(baseUrl),
    relayUrl: parsed?.relayUrl || null,
    label,
  })
  setActiveHome(home_id)
  clearProvisionalTarget()
  return home
}
