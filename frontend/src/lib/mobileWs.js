// Mobile WebSocket client — auto-reconnect, ping/pong, payload dispatcher.
//
// Only used in the native shell. The PWA still uses the existing useWebSocket
// hook against the original /ws endpoint. This module talks to /api/mobile/ws
// using the per-device auth token issued at pair time.
//
// Usage:
//   const ws = createMobileWs({
//     onMessage: (msg) => { ... },
//     onStatus:  (status) => { ... },   // 'connecting' | 'open' | 'closed' | 'error'
//   })
//   ws.start()
//   // ... later
//   ws.stop()

import { getDeviceToken, getDeviceWsUrl } from './mobileApi'

const HEARTBEAT_MS   = 25_000   // every 25s send a 'ping' frame
const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

export function createMobileWs({ onMessage, onStatus } = {}) {
  let socket          = null
  let heartbeatTimer  = null
  let reconnectTimer  = null
  let backoff         = MIN_BACKOFF_MS
  let stopped         = false
  let lastUrl         = null

  const emit = (status) => { try { onStatus?.(status) } catch {} }

  const clearTimers = () => {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  }

  const scheduleReconnect = () => {
    if (stopped) return
    if (reconnectTimer) return
    emit('closed')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      open()
    }, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }

  const open = async () => {
    if (stopped) return

    const [token, baseUrl] = await Promise.all([getDeviceToken(), getDeviceWsUrl()])
    if (!token || !baseUrl) {
      // Not paired yet — try again later in case pairing completes.
      scheduleReconnect()
      return
    }

    // Append token as ?token=... since browsers can't set Authorization on
    // `new WebSocket(...)`. Backend reads request.query_params['token'].
    const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
    lastUrl = url
    emit('connecting')

    let s
    try {
      s = new WebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }
    socket = s

    s.addEventListener('open', () => {
      backoff = MIN_BACKOFF_MS
      emit('open')
      // Start heartbeats — backend replies 'pong' to 'ping' text frames.
      heartbeatTimer = setInterval(() => {
        try { s.send('ping') } catch {}
      }, HEARTBEAT_MS)
    })

    s.addEventListener('message', (ev) => {
      if (ev.data === 'pong') return
      let parsed
      try { parsed = JSON.parse(ev.data) } catch { return }
      try { onMessage?.(parsed) } catch {}
    })

    s.addEventListener('close', () => {
      clearTimers()
      socket = null
      scheduleReconnect()
    })

    s.addEventListener('error', () => {
      emit('error')
      // The 'close' event fires after 'error' — let it handle reconnect.
    })
  }

  return {
    start() {
      stopped = false
      backoff = MIN_BACKOFF_MS
      open()
    },
    stop() {
      stopped = true
      clearTimers()
      if (socket) { try { socket.close() } catch {}; socket = null }
    },
    isOpen() { return socket?.readyState === WebSocket.OPEN },
    url() { return lastUrl },
  }
}
