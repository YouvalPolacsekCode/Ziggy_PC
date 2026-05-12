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
import AdminSettings from './pages/AdminSettings'
import { useUIStore } from './stores/uiStore'
import { useWebSocket } from './hooks/useWebSocket'
import { useDeviceStore } from './stores/deviceStore'
import { useAutomationStore } from './stores/automationStore'
import { useAuthStore } from './stores/authStore'
import LoginPage from './pages/LoginPage'

const _AUTOMATION_INTENTS = new Set([
  'create_automation', 'update_automation', 'delete_automation',
  'toggle_automation', 'assign_automation_to_room',
])

function AppRoutes() {
  const { connected, messages } = useWebSocket()
  const { updateEntityState } = useDeviceStore()
  const { fetchAutomations } = useAutomationStore()
  const { addToast } = useUIStore()

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) return

    // Live HA entity state push
    if (last.type === 'state_changed' && last.entity_id) {
      updateEntityState(last.entity_id, last.new_state, last.attributes)
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
        <Route path="admin" element={<AdminSettings />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const { theme } = useUIStore()
  const { authenticated } = useAuthStore()

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  if (!authenticated) return <LoginPage />

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
