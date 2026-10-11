// Motion Lab — standalone entry (lab.html). Mounts ONLY the lab, with a hash
// router so it can be hosted at any path (a published artifact, a static
// host). No App.jsx, no auth, no WebSocket. Built by vite.lab.config.js.
import React from 'react'
import ReactDOM from 'react-dom/client'
import MotionLab from './MotionLab'
import '../index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MotionLab standalone />
  </React.StrictMode>
)
