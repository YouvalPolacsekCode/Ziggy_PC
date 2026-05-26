// Single source of truth for "is the app actually connected?"
//
// Three signals feed it:
//   1. navigator.onLine          — browser network stack
//   2. WebSocket connected state — Ziggy backend is reachable + live
//   3. (future) explicit health  — for richer "degraded" states
//
// Returned shape:
//   {
//     online:        bool   — browser thinks network is up
//     wsConnected:   bool   — Ziggy WS is currently OPEN
//     status:        'online' | 'connecting' | 'offline'
//   }
//
// AppShell uses `status` to decide which banner (if any) to show. Other
// callers that only care about "can I queue this command right now?" should
// read `wsConnected`. Action buttons can pre-disable via `status !== 'online'`.

import { useEffect, useState } from 'react'
import { useWsConnected } from './useWebSocket'

function _readOnline() {
  if (typeof navigator === 'undefined') return true
  // Some embedded WebViews (notably older Capacitor builds) report
  // navigator.onLine === false even on Wi-Fi. The WS signal corrects for
  // that — when WS is open we trust it over navigator.
  return navigator.onLine !== false
}

export function useNetworkStatus() {
  const wsConnected = useWsConnected()
  const [online, setOnline] = useState(_readOnline())

  useEffect(() => {
    const update = () => setOnline(_readOnline())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // Derived status:
  //  - WS is OPEN → online (regardless of navigator.onLine, since the device
  //    is clearly reachable; navigator can lie inside WebViews).
  //  - navigator says offline AND WS is closed → offline (no network at all).
  //  - WS is closed but navigator says online → connecting (backend / tunnel
  //    blip; the WS hook is already retrying — we just need to surface it).
  let status
  if (wsConnected) status = 'online'
  else if (!online) status = 'offline'
  else status = 'connecting'

  return { online, wsConnected, status }
}

export default useNetworkStatus
