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

// Single source of truth for the prod backend. If we ever multi-home the
// native app this will need to switch to a runtime-configurable value
// (likely loaded from Preferences during pair). Phase-1 scope keeps it
// hardcoded — every customer build today points at app.ziggy-home.com.
const PROD_HTTP = 'https://app.ziggy-home.com'
const PROD_WS   = 'wss://app.ziggy-home.com'

function _shouldRewriteHttp(url) {
  // Only rewrite path-only URLs. Anything fully-qualified (https://..., the
  // relay base, an absolute external resource) is already pointed where the
  // caller wants it and must not be touched.
  return typeof url === 'string' && url.startsWith('/')
}

function _rewriteWsUrl(url) {
  if (typeof url !== 'string') return url
  // Path-only WebSocket URLs (rare but legal) — same logic as fetch.
  if (url.startsWith('/')) return PROD_WS + url
  // useWebSocket.js builds `wss://${window.location.host}/ws` which under
  // Capacitor evaluates to wss://localhost/ws — the WebView's own origin,
  // not the backend. Rewrite the host to prod while preserving path + query
  // (which includes the bearer ?token=...).
  try {
    const u = new URL(url)
    if (u.host === 'localhost' || u.hostname === 'localhost') {
      const prod = new URL(PROD_WS)
      u.protocol = prod.protocol
      u.host = prod.host
      return u.toString()
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
      return _origFetch(PROD_HTTP + input, init)
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
      super(_rewriteWsUrl(url), protocols)
    }
  }
  window.WebSocket = _ZiggyWS
}
