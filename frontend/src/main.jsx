// MUST be first — installs the native-shell fetch/WebSocket shim that
// rewrites relative '/api/...' calls to the prod backend when running
// inside Capacitor. Any module imported before this could fire a request
// against the WebView's local origin during eval and miss the rewrite.
import './lib/nativeApiBase'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { WebSocketProvider } from './hooks/useWebSocket'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { initOtaWatchdog } from './lib/nativeOtaWatchdog'
import './index.css'

// In dev mode, unregister any stale SWs and wipe caches so they don't serve
// cached JS over the Vite dev server. Applies on every dev hostname — not
// just localhost — so phones on the LAN (e.g. 192.168.x.x) also pick up
// edits live instead of being stuck on an old production bundle.
// App.jsx gates its SW re-registration to !import.meta.env.DEV, so the
// unregister sticks.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister())
  })
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Top-level safety net — if anything during App render throws (bad
        data shape, undefined.map slipping past defensive defaults, lazy
        chunk failure), the user sees the friendly fallback instead of a
        blank screen. AppShell's PageErrorBoundary still wraps each route
        for per-route reset semantics; this is the outer catch-all. */}
    <ErrorBoundary label="root">
      <WebSocketProvider>
        <App />
      </WebSocketProvider>
    </ErrorBoundary>
  </React.StrictMode>
)

// Tell @capgo/capacitor-updater the new bundle booted successfully — must
// happen within appReadyTimeout (10s in capacitor.config.ts) on the very
// first launch after a hot-swap, otherwise the plugin reverts to the
// previous bundle as broken. PWA / non-native is a no-op.
initOtaWatchdog()
