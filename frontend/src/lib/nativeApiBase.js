// Native-shell API base rewrite.
//
// Inside the Capacitor app the WebView serves files from capacitor://localhost
// (or https://localhost on Android with androidScheme:'https'). Every fetch to
// '/api/...' resolves to that local origin, which has no backend. The fix:
// when running natively, rewrite relative API URLs (and any WebSocket pointed
// at localhost) to the production Ziggy backend.
//
// Done as a one-shot fetch + WebSocket monkey-patch instead of touching every
// store/page that hardcodes '/api/...'. The alternative — editing ~20 files —
// would silently re-break the moment someone added a new fetch with a string
// literal. This shim makes the rewrite invariant of call sites.
//
// MUST be imported before any module that issues a request — i.e. before App.
// See main.jsx.

import { isNative } from './native'
import {
  resolveHttpBaseSync,
  resolveWsBaseSync,
  hydrateFromDurable,
} from './homeConfig'

// Compiled-in fallback for legacy single-home installs (and the very first
// paint before any home is paired). The base URL is now RUNTIME-configurable:
// homeConfig resolves the active per-home base (captured at pairing) at request
// time. When no home is configured yet, we fall back to these constants so the
// existing founder build keeps working byte-for-byte.
const PROD_HTTP = 'https://app.ziggy-home.com'
const PROD_WS   = 'wss://app.ziggy-home.com'

// Kick off the durable (Capacitor Preferences) reconciliation early so a
// returning user's saved home is in memory ASAP. The synchronous localStorage
// mirror already covers the common cold-start path; this only matters if the
// WebView's localStorage was evicted. Fire-and-forget — resolve*Sync() below
// reads whatever is currently cached.
if (isNative()) { hydrateFromDurable().catch(() => {}) }

function _shouldRewriteHttp(url) {
  // Only rewrite path-only URLs. Anything fully-qualified (https://..., the
  // relay base, an absolute external resource) is already pointed where the
  // caller wants it and must not be touched.
  return typeof url === 'string' && url.startsWith('/')
}

// Resolve the active HTTP base at call time (per-home) with the compiled-in
// PROD default as the safety net. Exported for tests.
export function rewriteHttpUrl(url) {
  if (!_shouldRewriteHttp(url)) return url
  const base = resolveHttpBaseSync() || PROD_HTTP
  return base + url
}

// Exported for tests. Rewrites path-only or localhost-origin WS URLs to the
// active per-home WS base (falls back to PROD_WS). The WS base may itself carry
// a path prefix (relay-proxy case), so we append the original path + query
// (the latter carries the bearer ?token=...).
export function rewriteWsUrl(url) {
  if (typeof url !== 'string') return url
  const wsBase = (resolveWsBaseSync() || PROD_WS).replace(/\/+$/, '')
  // Path-only WebSocket URLs (rare but legal) — same logic as fetch.
  if (url.startsWith('/')) return wsBase + url
  // useWebSocket.js builds `wss://${window.location.host}/ws` which under
  // Capacitor evaluates to wss://localhost/ws — the WebView's own origin,
  // not the backend. Point it at the active per-home WS base while preserving
  // path + query.
  try {
    const u = new URL(url)
    if (u.host === 'localhost' || u.hostname === 'localhost') {
      return wsBase + u.pathname + u.search
    }
  } catch {
    // Not a parseable URL — leave it alone, let the WebSocket constructor
    // surface the original error to the caller.
  }
  return url
}

if (isNative() && typeof window !== 'undefined') {
  // ── fetch ────────────────────────────────────────────────────────────────
  const _origFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (_shouldRewriteHttp(input)) {
      return _origFetch(rewriteHttpUrl(input), init)
    }
    return _origFetch(input, init)
  }

  // ── WebSocket ────────────────────────────────────────────────────────────
  // Subclass so static constants (OPEN/CONNECTING/CLOSED) inherit via the
  // prototype chain. Replacing window.WebSocket with a plain function would
  // strip those and break code that reads readyState comparisons.
  const _OrigWS = window.WebSocket
  class _ZiggyWS extends _OrigWS {
    constructor(url, protocols) {
      super(rewriteWsUrl(url), protocols)
    }
  }
  window.WebSocket = _ZiggyWS
}
