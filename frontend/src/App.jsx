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
import AcceptInvite from './pages/AcceptInvite'
import CloudAdmin from './pages/CloudAdmin'
import DebugPage from './pages/DebugPage'
import { getAuthStatus, getPushVapidKey, subscribePush, getMyPresencePerson } from './lib/api'

// Captured at module load time — before any renders.
// 'reload' = F5/Ctrl+R (stay on current URL), 'navigate' = cold start (redirect to /).
const _navType = performance?.getEntriesByType?.('navigation')?.[0]?.type ?? 'navigate'
let _appMounted = false

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

    // Physical IR remote detected — update device card state immediately + toast
    if (last.type === 'ir_command_detected') {
      const cmd = last.command?.replace(/_/g, ' ')
      // IR entities live in the store as entity_id = `ir.${device_id}`
      if (last.device_id && last.new_assumed_state) {
        updateEntityState(`ir.${last.device_id}`, last.new_assumed_state, {
          assumed_state: last.new_assumed_state,
        })
      }
      addToast(`Physical remote: ${cmd}`, 'info', 3000)
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
        <Route path="cloud-admin" element={<CloudAdmin />} />
        <Route path="debug" element={<DebugPage />} />
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

  // Listen for 401 from any API call — show login page without a page reload.
  // A reload drops the WS and triggers a reconnect storm when the token is bad.
  useEffect(() => {
    const handle = () => logout()
    window.addEventListener('ziggy:unauthorized', handle)
    return () => window.removeEventListener('ziggy:unauthorized', handle)
  }, [logout])

  // Presence pinging — keeps presence fresh while you use the main app.
  // Only runs if geolocation permission was already granted (won't prompt).
  // Matches the logged-in user to their presence person via name-in-email matching.
  useEffect(() => {
    if (!authenticated) return
    if (!('geolocation' in navigator)) return

    let watchId = null
    let keepAlive = null
    let alive = true

    const start = async () => {
      try {
        const perm = await navigator.permissions?.query({ name: 'geolocation' })
        if (!perm || perm.state !== 'granted') return
      } catch { return }

      let token
      try {
        const res = await getMyPresencePerson()
        token = res?.person?.token
      } catch { return }
      if (!token || !alive) return

      let lastPos = null
      const ping = (lat, lon, accuracy) => {
        fetch('/api/presence/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, lat, lon, accuracy }),
        }).catch(() => {})
      }

      watchId = navigator.geolocation.watchPosition(
        pos => { lastPos = pos; ping(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy) },
        () => {},
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      )

      keepAlive = setInterval(() => {
        if (lastPos) ping(lastPos.coords.latitude, lastPos.coords.longitude, lastPos.coords.accuracy)
      }, 2 * 60 * 1000)

      const onVisible = () => {
        if (document.visibilityState === 'visible' && lastPos)
          ping(lastPos.coords.latitude, lastPos.coords.longitude, lastPos.coords.accuracy)
      }
      document.addEventListener('visibilitychange', onVisible)
      cleanupRef = () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId)
        if (keepAlive !== null) clearInterval(keepAlive)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }

    let cleanupRef = null
    start()
    return () => { alive = false; cleanupRef?.() }
  }, [authenticated])

  // Register service worker and subscribe to web push after login
  useEffect(() => {
    if (!authenticated) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        // Only request push permission if not already granted
        if (Notification.permission === 'denied') return
        if (Notification.permission === 'default') {
          const perm = await Notification.requestPermission()
          if (perm !== 'granted') return
        }
        const { publicKey } = await getPushVapidKey()
        // Convert base64url key to Uint8Array for the browser
        const keyBytes = Uint8Array.from(
          atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')),
          c => c.charCodeAt(0)
        )
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes,
        })
        await subscribePush({
          endpoint:   sub.endpoint,
          keys:       { p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))), auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))) },
          user_agent: navigator.userAgent,
        })
      } catch {}
    }
    register()
  }, [authenticated])

  // Invite acceptance is public — render before auth wall
  if (window.location.pathname.startsWith('/invite/')) {
    const token = window.location.pathname.split('/invite/')[1]
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="*" element={<AcceptInvite />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (!authenticated) return <LoginPage />

  // Cold-start redirect: rewrite URL to '/' before BrowserRouter initializes.
  // Only fires on fresh navigations (PWA tap, new tab) — NOT on F5/Ctrl+R reloads.
  // _appMounted prevents re-firing on subsequent React re-renders.
  if (!_appMounted) {
    _appMounted = true
    if (
      _navType !== 'reload' &&
      window.location.pathname !== '/' &&
      !window.location.pathname.startsWith('/presence/')
    ) {
      window.history.replaceState(null, '', '/')
    }
  }

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
