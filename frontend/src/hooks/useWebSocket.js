import { useEffect, useRef, useState, useCallback } from 'react'

function getWsUrl() {
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

const WS_URL = getWsUrl()
const MIN_RETRY_MS   = 3_000
const MAX_RETRY_MS   = 30_000
const PING_INTERVAL  = 20_000   // send a ping every 20s to keep tunnel alive

export function useWebSocket() {
  const ws             = useRef(null)
  const retryCount     = useRef(0)
  const reconnectTimer = useRef(null)
  const pingTimer      = useRef(null)
  const [messages,  setMessages]  = useState([])
  const [connected, setConnected] = useState(false)

  const clearTimers = () => {
    clearTimeout(reconnectTimer.current)
    clearInterval(pingTimer.current)
  }

  const connect = useCallback(() => {
    // Don't open a new socket if one is already open or connecting
    if (ws.current?.readyState === WebSocket.OPEN ||
        ws.current?.readyState === WebSocket.CONNECTING) return

    // Don't try to connect when the page is hidden (mobile backgrounded).
    // We'll reconnect on visibilitychange instead.
    if (document.visibilityState === 'hidden') return

    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen = () => {
      setConnected(true)
      retryCount.current = 0
      clearTimeout(reconnectTimer.current)

      // Keepalive ping — prevents Cloudflare Tunnel from closing idle WS.
      // Server ignores non-JSON or unknown message types gracefully.
      pingTimer.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }))
        }
      }, PING_INTERVAL)
    }

    socket.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        if (data.type === 'pong') return  // ignore server pong responses
        setMessages(prev => [...prev.slice(-199), { ...data, ts: Date.now() }])
      } catch { /* ignore non-JSON frames */ }
    }

    socket.onclose = () => {
      clearInterval(pingTimer.current)
      setConnected(false)

      // Don't schedule a reconnect if the page is hidden — wait for
      // visibilitychange to trigger it when the user comes back.
      if (document.visibilityState === 'hidden') return

      const delay = Math.min(MIN_RETRY_MS * 2 ** retryCount.current, MAX_RETRY_MS)
      retryCount.current = Math.min(retryCount.current + 1, 6)
      reconnectTimer.current = setTimeout(connect, delay)
    }

    // Don't manually call socket.close() on error — let the browser clean up
    // naturally. Calling close() here triggers onclose BEFORE the socket is
    // actually closed, which then schedules a reconnect that races the cleanup.
    socket.onerror = () => { /* handled by onclose */ }
  }, [])

  // Initial connection
  useEffect(() => {
    connect()
    return () => {
      clearTimers()
      ws.current?.close()
    }
  }, [connect])

  // Reconnect when the page becomes visible (phone came back from background)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(reconnectTimer.current)
        retryCount.current = 0
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [connect])

  return { messages, connected }
}
