import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { WebSocketProvider } from './hooks/useWebSocket'
import './index.css'

// In dev mode on localhost, unregister any stale SWs and wipe caches so they
// don't serve cached JS over the Vite dev server. App.jsx now also gates its
// SW re-registration to !import.meta.env.DEV, so the unregister sticks.
if (import.meta.env.DEV && 'serviceWorker' in navigator && window.location.hostname === 'localhost') {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister())
  })
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WebSocketProvider>
      <App />
    </WebSocketProvider>
  </React.StrictMode>
)
