import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import { RoomsList, RoomDetail } from './pages/Rooms'
import Devices from './pages/Devices'
import DeviceDetail from './pages/DeviceDetail'
import Automations from './pages/Automations'
import Routines from './pages/Routines'
import Scenes from './pages/Scenes'
import AIChat from './pages/AIChat'
import Tasks from './pages/Tasks'
import Settings from './pages/Settings'
import Memory from './pages/Memory'
import VirtualDevices from './pages/VirtualDevices'
import Suggestions from './pages/Suggestions'
import Anomalies from './pages/Anomalies'
import QuickAsks from './pages/QuickAsks'
import Cameras from './pages/Cameras'
import AdminSettings from './pages/AdminSettings'
import { useUIStore } from './stores/uiStore'
import { useWebSocket } from './hooks/useWebSocket'
import { useDeviceStore } from './stores/deviceStore'
import { useAutomationStore } from './stores/automationStore'
import { useAuthStore } from './stores/authStore'
import { useCameraStore } from './stores/cameraStore'
import LoginPage from './pages/LoginPage'
import { getAuthStatus } from './lib/api'

const _AUTOMATION_INTENTS = new Set([
  'create_automation', 'update_automation', 'delete_automation',
  'toggle_automation', 'assign_automation_to_room',
])

function AppRoutes() {
  const { connected, messages } = useWebSocket()
  const { updateEntityState } = useDeviceStore()
  const { fetchAutomations } = useAutomationStore()
  const { addToast } = useUIStore()
  const { addMotionEvent } = useCameraStore()

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) return

    // Live HA entity state push
    if (last.type === 'state_changed' && last.entity_id) {
      updateEntityState(last.entity_id, last.new_state, last.attributes)

      // Real-time motion events — feed cameraStore for live motion log
      const domain = last.entity_id.split('.')[0]
      if (
        domain === 'binary_sensor' &&
        last.attributes?.device_class === 'motion' &&
        last.new_state === 'on'
      ) {
        addMotionEvent({
          entity_id: last.entity_id,
          name: last.attributes?.friendly_name || last.entity_id.split('.')[1]?.replace(/_/g, ' '),
          state: 'on',
          timestamp: new Date().toISOString(),
          type: 'motion',
        })
      }
      if (domain === 'camera' && last.new_state === 'detected') {
        addMotionEvent({
          entity_id: last.entity_id,
          name: last.attributes?.friendly_name || last.entity_id.split('.')[1]?.replace(/_/g, ' '),
          state: 'detected',
          timestamp: new Date().toISOString(),
          type: 'camera',
        })
      }
    }

    // Automation store refresh — fires whenever a chat command modifies automations
    // so Automations page and room detail views reflect the change immediately.
    if (last.type === 'ziggy_response' && last.ok && _AUTOMATION_INTENTS.has(last.intent)) {
      fetchAutomations()
    }

    // Automation / routine execution result
    if (last.type === 'execution_result') {
      const { label, ok, steps_total, steps_failed, errors } = last
      if (ok) {
        addToast(`${label} — ${steps_total} step${steps_total !== 1 ? 's' : ''} completed`, 'success')
      } else {
        const detail = errors?.[0] ? `\n${errors[0]}` : ''
        addToast(
          `${label} — ${steps_failed}/${steps_total} step${steps_total !== 1 ? 's' : ''} failed${detail}`,
          'error',
          7000,
        )
      }
    }
  }, [messages])

  return (
    <Routes>
      <Route element={<AppShell connected={connected} />}>
        <Route index element={<Dashboard />} />
        <Route path="rooms" element={<RoomsList />} />
        <Route path="rooms/:roomId" element={<RoomDetail />} />
        <Route path="devices" element={<Devices />} />
        <Route path="devices/:entityId" element={<DeviceDetail />} />
        <Route path="automations" element={<Automations />} />
        <Route path="routines" element={<Routines />} />
        <Route path="scenes" element={<Scenes />} />
        <Route path="chat" element={<AIChat />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="memory" element={<Memory />} />
        <Route path="settings" element={<Settings />} />
        <Route path="virtual-devices" element={<VirtualDevices />} />
        <Route path="suggestions" element={<Suggestions />} />
        <Route path="anomalies" element={<Anomalies />} />
        <Route path="quick-asks" element={<QuickAsks />} />
        <Route path="cameras" element={<Cameras />} />
        <Route path="admin" element={<AdminSettings />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const { theme } = useUIStore()
  const { authenticated, setRole, logout } = useAuthStore()

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  // Refresh role on every app load (soft — never auto-logout)
  useEffect(() => {
    if (!authenticated) return
    getAuthStatus()
      .then(d => { if (d.role) setRole(d.role) })
      .catch(() => {})
  }, [])

  if (!authenticated) return <LoginPage />

  // Force Home on cold start. sessionStorage is cleared when the tab/PWA is
  // closed, so this fires once per session and never during in-session navigation.
  if (!sessionStorage.getItem('ziggy_session')) {
    sessionStorage.setItem('ziggy_session', '1')
    window.history.replaceState(null, '', '/')
  }

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
