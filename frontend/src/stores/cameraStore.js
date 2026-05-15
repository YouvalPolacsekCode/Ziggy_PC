import { create } from 'zustand'

export const useCameraStore = create((set) => ({
  cameras: [],
  motionEvents: [],

  fetchCameras: async () => {
    try {
      const r = await fetch('/api/cameras')
      if (!r.ok) return
      const data = await r.json()
      set({ cameras: data.cameras || [] })
    } catch {}
  },

  fetchMotionHistory: async (hours = 24) => {
    try {
      const r = await fetch(`/api/cameras/motion?hours=${hours}`)
      if (!r.ok) return
      const data = await r.json()
      set({ motionEvents: data.events || [] })
    } catch {}
  },

  // Called from App.jsx WebSocket handler for real-time motion events
  addMotionEvent: (event) => {
    set((state) => ({
      motionEvents: [event, ...state.motionEvents].slice(0, 200),
    }))
  },
}))

// Pure URL helpers — no fetch, safe to use in <img src>
export const cameraSnapshotUrl = (entityId) => `/api/cameras/${encodeURIComponent(entityId)}/snapshot`
export const cameraStreamUrl   = (entityId) => `/api/cameras/${encodeURIComponent(entityId)}/stream`
