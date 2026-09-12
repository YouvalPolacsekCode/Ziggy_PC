import React from 'react'
import { createRoot } from 'react-dom/client'
import Lab from './Lab'
import './lab.css'

// No StrictMode. The lab is a visual instrument: a double-mount would replay
// every entrance animation in the concepts and make two identical palettes
// look different from each other for a frame.
createRoot(document.getElementById('lab')).render(<Lab />)
