import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import { RoomsList, RoomDetail } from './pages/Rooms'
import Devices from './pages/Devices'
import Automations from './pages/Automations'
import Routines from './pages/Routines'
import Scenes from './pages/Scenes'
import AIChat from './pages/AIChat'
import Tasks from './pages/Tasks'
import Settings from './pages/Settings'
import Memory from './pages/Memory'
import VirtualDevices from './pages/VirtualDevices'
import Suggestions from './pages/Suggestions'
import QuickAsks from './pages/QuickAsks'
import { useUIStore } from './stores/uiStore'
import { useWebSocket } from './hooks/useWebSocket'
import { useDeviceStore } from './stores/deviceStore'

function AppRoutes() {
  const { connected, messages } = useWebSocket()
  const { updateEntityState } = useDeviceStore()

  // Apply live HA state updates from WebSocket
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) return
    if (last.type === 'state_changed' && last.entity_id) {
      updateEntityState(last.entity_id, last.new_state, last.attributes)
    }
  }, [messages])

  return (
    <Routes>
      <Route element={<AppShell connected={connected} />}>
        <Route index element={<Dashboard />} />
        <Route path="rooms" element={<RoomsList />} />
        <Route path="rooms/:roomId" element={<RoomDetail />} />
        <Route path="devices" element={<Devices />} />
        <Route path="automations" element={<Automations />} />
        <Route path="routines" element={<Routines />} />
        <Route path="scenes" element={<Scenes />} />
        <Route path="chat" element={<AIChat />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="memory" element={<Memory />} />
        <Route path="settings" element={<Settings />} />
        <Route path="virtual-devices" element={<VirtualDevices />} />
        <Route path="suggestions" element={<Suggestions />} />
        <Route path="quick-asks" element={<QuickAsks />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const { theme } = useUIStore()

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
