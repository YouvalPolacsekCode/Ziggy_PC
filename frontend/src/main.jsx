import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// In dev mode on localhost, unregister any stale SWs from production builds
// so they don't serve cached JS over the Vite dev server.
// IMPORTANT: do NOT reload after unregistering — App.jsx registers /sw.js for
// push notifications (on HTTPS), and if we reload, App.jsx registers again,
// main.jsx finds it again, reloads again → infinite reload loop on the phone.
// Simply unregistering is enough: the SW is deactivated for future navigations.
if (import.meta.env.DEV && 'serviceWorker' in navigator && window.location.hostname === 'localhost') {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister())
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
