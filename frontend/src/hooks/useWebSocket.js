import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react'
import logger from '../lib/logger'
import { useAuthStore } from '../stores/authStore'

function getWsBaseUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // When accessing via Cloudflare Tunnel (https), the WS goes through
  // Tunnel → Vite proxy → FastAPI. Cloudflare requires keepalives to
  // maintain idle WS connections, which Vite's proxy doesn't send.
  // Workaround: if on HTTPS (tunnel), connect directly to the backend
  // port using the same hostname so the tunnel routes it correctly.
  // In dev (localhost), use the Vite proxy at port 3000 as before.
  const host = window.location.host
  return `${proto}//${host}/ws`
}

// Reconnect cadence. Ziggy's backend takes ~10-15s to fully boot (many
// threads + Whisper model warmup), so a classic exponential backoff lands
// you in a long wait window right around the time the server actually
// comes back up. Linear-then-capped instead:
//   - attempts 1-5: 750ms apart (covers most restart windows)
//   - attempts 6+: 3s apart (gentle on a truly-down server)
const FAST_RETRY_MS    = 750
const FAST_RETRY_LIMIT = 5
const SLOW_RETRY_MS    = 3_000
const PING_INTERVAL    = 20_000

// Buffer size: 50 covers the deepest look-back any current consumer does (the
// Dashboard walks newest-to-oldest until it hits a seen ts) without keeping
// hundreds of state_changed payloads (~1–2 KB each) live in React state.
const MESSAGE_BUFFER_SIZE = 50

// ─── Module-level singleton ─────────────────────────────────────────────────
// Why: a previous version tied the WebSocket's lifecycle to a React
// component (WebSocketProvider). Three things kept knocking it loose:
//   1. React StrictMode (dev) double-mounts the Provider on first paint
//      → close + reopen, briefly flipping `connected` and triggering the
//      offline banner.
//   2. Vite HMR re-evaluates the module on every edit → the Provider's
//      cleanup runs and closes the socket. Showed up as endless
//      "WebSocket connected/disconnected" pairs in the backend logs.
//   3. Auth/route changes that remount any ancestor would cycle the WS.
// Owning the connection at module scope decouples it from React: the
// component only *subscribes* to state changes. The socket survives any
// React reconciliation, including StrictMode + HMR.
let _socket             = null
let _retryCount         = 0
let _reconnectTimer     = null
let _pingTimer          = null
let _messages           = []
let _connected          = false
const _listeners        = new Set()   // () => void — fired on any state change
// App-wide WS subscription filter. null = legacy firehose (default, backward
// compatible). Set via wsSubscribe(); re-sent after every reconnect so the
// backend doesn't fall back to firehose mode after a network blip.
let _subscription       = null

function _retryDelay(attempt) {
  return attempt < FAST_RETRY_LIMIT ? FAST_RETRY_MS : SLOW_RETRY_MS
}

function _emit() {
  for (const fn of _listeners) {
    try { fn() } catch { /* swallow */ }
  }
}

function _clearTimers() {
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
  if (_pingTimer)      { clearInterval(_pingTimer);     _pingTimer = null }
}

function _connect() {
  // Already open or in-flight — don't open another socket.
  if (_socket?.readyState === WebSocket.OPEN ||
      _socket?.readyState === WebSocket.CONNECTING) return

  // Don't connect when the tab is hidden — visibilitychange retries on focus.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

  // Auth gate: the /ws endpoint now requires a bearer token in the URL.
  // Re-read from authStore on every connect so token rotation (re-login,
  // session refresh) takes effect on the next reconnect without us caching
  // anything at WS-instance scope. No token → no socket; the logout-aware
  // subscriber below kicks us back into _connect() when login completes.
  const token = useAuthStore.getState().token
  if (!token) {
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
    return
  }
  const url = `${getWsBaseUrl()}?token=${encodeURIComponent(token)}`

  const socket = new WebSocket(url)
  _socket = socket

  socket.onopen = () => {
    _connected = true
    _retryCount = 0
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
    logger.ws('ws_open')
    // Re-send the app's subscription filter after every (re)connect so the
    // backend doesn't fall back to firehose mode for clients that opted in.
    if (_subscription) {
      try {
        socket.send(JSON.stringify({ type: 'subscribe', ..._subscription }))
      } catch { /* swallow */ }
    }
    _pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL)
    _emit()
  }

  socket.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data)
      if (data.type === 'pong') return
      if (data.type !== 'debug_event') {
        logger.ws('ws_message', { type: data.type })
      }
      // New array reference so React subscribers see the change.
      _messages = _messages.length >= MESSAGE_BUFFER_SIZE
        ? [..._messages.slice(-(MESSAGE_BUFFER_SIZE - 1)), { ...data, ts: Date.now() }]
        : [..._messages, { ...data, ts: Date.now() }]
      _emit()
    } catch { /* ignore non-JSON frames */ }
  }

  socket.onclose = (evt) => {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null }
    _connected = false
    logger.ws('ws_close', {
      code: evt?.code, reason: evt?.reason || undefined,
      retry_count: _retryCount,
    })
    _emit()
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    // 4401 = unauthenticated. Don't busy-loop reconnect against bad creds —
    // the authStore subscriber re-kicks us when the token changes (re-login).
    if (evt?.code === 4401) {
      _retryCount = 0
      return
    }
    const delay = _retryDelay(_retryCount)
    _retryCount = Math.min(_retryCount + 1, 6)
    logger.ws('ws_reconnect_scheduled', { delay_ms: delay, attempt: _retryCount })
    _reconnectTimer = setTimeout(_connect, delay)
  }

  // Don't manually call socket.close() on error — let the browser handle it.
  socket.onerror = () => { logger.ws('ws_error') }
}

// Visibility handler — register exactly once at module load so it's not
// tied to any React component lifecycle.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
    _retryCount = 0
    _connect()
  })
}

// Auth-token observer — token rotation closes any live socket; a fresh token
// kicks _connect(). Zustand fires this on every store mutation, so we filter
// to actual transitions of the token field. Registered once at module load.
let _lastToken = useAuthStore.getState().token
useAuthStore.subscribe((state) => {
  const next = state.token
  if (next === _lastToken) return
  _lastToken = next
  _clearTimers()
  if (_socket) {
    try { _socket.close() } catch { /* swallow */ }
    _socket = null
  }
  _connected = false
  _emit()
  if (next) _connect()
})

// Kick off the first connection at module-eval time. Vite HMR may re-import
// this module — the readyState guard inside _connect() prevents a duplicate
// socket in that case. Unauthenticated users no-op out of _connect() until
// the authStore subscriber above fires on login.
_connect()

// ─── React-facing API ──────────────────────────────────────────────────────
// Split contexts so consumers subscribe only to what they need. Before:
// a single { messages, connected } context made every WS message re-render
// every consumer including AppShell, Sidebar, and every page on the route.

const MessagesContext  = createContext(_messages)
const ConnectedContext = createContext(_connected)

export function WebSocketProvider({ children }) {
  const [messages,  setMessages]  = useState(_messages)
  const [connected, setConnected] = useState(_connected)

  useEffect(() => {
    // Subscribe to module-level events; sync initial state once.
    const listener = () => {
      setMessages(_messages)
      setConnected(_connected)
    }
    _listeners.add(listener)
    listener()   // catch any state change between module load and mount
    return () => { _listeners.delete(listener) }
  }, [])

  return createElement(
    ConnectedContext.Provider,
    { value: connected },
    createElement(
      MessagesContext.Provider,
      { value: messages },
      children,
    ),
  )
}

// Compatibility shim — existing callers `const { connected, messages } = useWebSocket()`
// keep working. Prefer the split hooks in new code so re-renders track only
// the data you read.
export function useWebSocket() {
  const messages  = useContext(MessagesContext)
  const connected = useContext(ConnectedContext)
  return useMemo(() => ({ messages, connected }), [messages, connected])
}

// Subscribe to messages only. Re-renders on every WS push.
export function useWsMessages() {
  return useContext(MessagesContext)
}

// Subscribe to connection state only. Re-renders ONLY on connect/disconnect.
export function useWsConnected() {
  return useContext(ConnectedContext)
}

// Opt into a narrower WS broadcast filter for this app session.
//   wsSubscribe({ types: ['anomaly_active', 'presence_transition'] })
//   wsSubscribe({ entities: ['light.kitchen'] })
//   wsSubscribe(null)   // clear → resume firehose
// Persists across reconnects (re-sent on every onopen). Default is firehose
// so calling this is purely opt-in; callers should be aware they are
// narrowing the *app-wide* WS, not their own component's view.
export function wsSubscribe(filter) {
  _subscription = (filter && (filter.types?.length || filter.entities?.length))
    ? { types: filter.types || undefined, entities: filter.entities || undefined }
    : null
  if (_socket?.readyState === WebSocket.OPEN) {
    try {
      _socket.send(JSON.stringify(
        _subscription ? { type: 'subscribe', ..._subscription }
                      : { type: 'unsubscribe' }
      ))
    } catch { /* swallow */ }
  }
}
