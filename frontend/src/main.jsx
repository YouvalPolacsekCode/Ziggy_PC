import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// In dev mode, unregister any service worker from previous production builds.
// Production builds (via Cloudflare tunnel) register a SW that persists in the
// browser and intercepts requests, serving stale cached JS. Unregistering it
// in dev forces the browser to fetch fresh assets directly from the Vite server.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    if (regs.length > 0) {
      regs.forEach((r) => r.unregister())
      // Reload once to fetch fresh assets without the old SW intercepting
      window.location.reload()
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
