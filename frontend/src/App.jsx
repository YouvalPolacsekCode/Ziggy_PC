import { useEffect, useRef, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
// Dashboard is the home route — load eagerly so the first paint after login
// is a real render, not a Suspense fallback.
import Dashboard from './pages/Dashboard'

// Lazy routes: ship as their own chunks so the initial bundle only carries
// what's needed for the home route. Every other page only loads when the
// user actually navigates to it. Admin / Ops pages are role-gated and most
// users will never hit them — keeping them out of main.js shaves ~50–100 KB
// off cold-start parse time.
const RoomsList       = lazy(() => import('./pages/Rooms').then(m => ({ default: m.RoomsList })))
const RoomDetail      = lazy(() => import('./pages/Rooms').then(m => ({ default: m.RoomDetail })))
const Devices         = lazy(() => import('./pages/Devices'))
const DeviceDetail    = lazy(() => import('./pages/DeviceDetail'))
const Remote          = lazy(() => import('./pages/Remote'))
const Automations     = lazy(() => import('./pages/Automations'))
const Routines        = lazy(() => import('./pages/Routines'))
const AIChat          = lazy(() => import('./pages/AIChat'))
const Tasks           = lazy(() => import('./pages/Tasks'))
const Settings        = lazy(() => import('./pages/Settings'))
const Memory          = lazy(() => import('./pages/Memory'))
const VirtualDevices  = lazy(() => import('./pages/VirtualDevices'))
const Suggestions     = lazy(() => import('./pages/Suggestions'))
const Anomalies       = lazy(() => import('./pages/Anomalies'))
const QuickAsks       = lazy(() => import('./pages/QuickAsks'))
const Cameras         = lazy(() => import('./pages/Cameras'))
const AdminSettings   = lazy(() => import('./pages/AdminSettings'))
const AdminConsole    = lazy(() => import('./pages/AdminConsole'))
const CloudAdmin      = lazy(() => import('./pages/CloudAdmin'))
const DebugPage       = lazy(() => import('./pages/DebugPage'))
const HAUpdate        = lazy(() => import('./pages/HAUpdate'))
const FeatureFlags    = lazy(() => import('./pages/FeatureFlags'))
const MobileOnboarding  = lazy(() => import('./pages/MobileOnboarding'))
const MobileDiagnostics = lazy(() => import('./pages/MobileDiagnostics'))
import { useUIStore } from './stores/uiStore'
import { useWsConnected, useWsMessages } from './hooks/useWebSocket'
import { useDeviceStore } from './stores/deviceStore'
import { useAutomationStore } from './stores/automationStore'
import { useAuthStore } from './stores/authStore'
import { useCameraStore } from './stores/cameraStore'
import { useFeaturesStore, useFeature } from './stores/featuresStore'
import LoginPage from './pages/LoginPage'
import AcceptInvite from './pages/AcceptInvite'
import { getAuthStatus, getPushVapidKey, subscribePush, getMyPresencePerson, getGeneralSettings } from './lib/api'
import { setLang as setI18nLang, t as i18nT } from './lib/i18n'
import { isNative } from './lib/native'
import { getDeviceToken } from './lib/mobileApi'

// ─── Ops route guard + breadcrumb layout ─────────────────────────────────────

function ProtectedOpsRoute() {
  const role = useAuthStore(s => s.role)
  if (role !== 'super_admin') return <Navigate to="/" replace />
  return <Outlet />
}

function OpsPageWrapper({ title }) {
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    document.title = `Ziggy Admin · ${title}`
    return () => { document.title = 'Ziggy' }
  }, [title])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <div style={{
        height: 38, padding: '0 16px', flexShrink: 0,
        background: 'var(--bg-2)', borderBottom: '0.5px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button
          onClick={() => navigate('/ops')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: 'var(--ink-faint)', fontWeight: 500,
            padding: '2px 6px', borderRadius: 5,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          Admin Console
        </button>
        <span style={{ color: 'var(--line)' }}>/</span>
        <span style={{ fontSize: 11, color: 'var(--ink)', fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Outlet />
      </div>
    </div>
  )
}

// Captured at module load time — before any renders.
// 'reload' = F5/Ctrl+R (stay on current URL), 'navigate' = cold start (redirect to /).
const _navType = performance?.getEntriesByType?.('navigation')?.[0]?.type ?? 'navigate'
let _appMounted = false

const _AUTOMATION_INTENTS = new Set([
  'create_automation', 'update_automation', 'delete_automation',
  'toggle_automation', 'assign_automation_to_room',
])

// Native-shell only: if we're inside the Ziggy Home iOS/Android app AND the
// device has not yet been paired, send the user to the onboarding flow once
// per session. Pure no-op in the PWA.
function MobileOnboardingRedirector() {
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    if (!isNative()) return
    if (location.pathname === '/mobile-onboarding') return
    let cancelled = false
    ;(async () => {
      const tok = await getDeviceToken()
      if (cancelled) return
      if (!tok) navigate('/mobile-onboarding', { replace: true })
    })()
    return () => { cancelled = true }
  }, [location.pathname, navigate])
  return null
}

function AppRoutes() {
  const taskTrackingEnabled = useFeature('task_tracking')
  // `connected` only feeds AppShell's offline banner — read it via the
  // narrow context so updateEntityState's per-message work doesn't drag
  // AppShell + Sidebar through a re-render too.
  const connected = useWsConnected()
  const messages  = useWsMessages()
  // Per-field selectors — destructuring the whole store would re-render
  // AppRoutes on every store change (deviceStore mutates on every WS push,
  // dragging the whole tree through a render). The action functions are
  // stable Zustand refs, so selecting them never re-renders this component.
  const updateEntityState           = useDeviceStore(s => s.updateEntityState)
  const updateIrDeviceFromAcPacket  = useDeviceStore(s => s.updateIrDeviceFromAcPacket)
  const fetchAll                    = useDeviceStore(s => s.fetchAll)
  const fetchAutomations  = useAutomationStore(s => s.fetchAutomations)
  const addToast          = useUIStore(s => s.addToast)
  const addMotionEvent    = useCameraStore(s => s.addMotionEvent)

  // Reconnect-resync: when the WS goes false → true (Cloudflare Tunnel
  // dropped + reopened, backend restart, laptop wake from sleep), kick a
  // full fetch so entities, IR linkage, and groups catch up to whatever
  // state-changed events fired while we were offline. Skip the very first
  // open (initial app boot already calls fetchAll), but trigger every
  // subsequent reconnect — that's the case the PWA hits constantly.
  const hasConnectedOnce = useRef(false)
  useEffect(() => {
    if (!connected) return
    if (!hasConnectedOnce.current) {
      hasConnectedOnce.current = true
      return
    }
    fetchAll({ force: true }).catch(() => {})
  }, [connected, fetchAll])

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

    // Surface command failures from the backend's fire-and-forget toggle path.
    // The backend already broadcasts a corrective state_changed before this,
    // so the optimistic tile state is already reverted; we just toast the user.
    if (last.type === 'command_failed' && last.entity_id) {
      const name = last.entity_id.split('.').slice(-1)[0].replace(/_/g, ' ')
      addToast(
        last.message ? `${name}: ${last.message}` : i18nT('toast.didNotRespond', { name }),
        'error',
      )
    }

    // Physical IR remote detected — update device card state immediately + toast
    if (last.type === 'ir_command_detected') {
      const cmd = last.command?.replace(/_/g, ' ')
      // IR entities live in the store as entity_id = `ir.${device_id}`
      if (last.device_id) {
        // For AC packets that carried decoded state, merge it into
        // _irDevice.ac_memory so the card chip shows the fresh
        // temp/mode/fan. Otherwise just patch state + assumed_state.
        if (last.ac_state) {
          updateIrDeviceFromAcPacket(last.device_id, last.ac_state, last.new_assumed_state)
        } else if (last.new_assumed_state) {
          updateEntityState(`ir.${last.device_id}`, last.new_assumed_state, {
            assumed_state: last.new_assumed_state,
          })
        }
      }
      addToast(i18nT('toast.physicalRemote', { cmd }), 'info', 3000)
    }

    // Unknown IR signal — re-broadcast as a window event so Devices.jsx can
    // refresh the "Unassigned signals" badge without opening its own WS.
    if (last.type === 'ir_unknown_signal') {
      window.dispatchEvent(new CustomEvent('ziggy:ir_unknown_signal', { detail: last }))
    }

    // Automation / routine execution result
    if (last.type === 'execution_result') {
      const { label, ok, steps_total, steps_failed, errors } = last
      if (ok) {
        addToast(i18nT('toast.stepsCompleted', { label, n: steps_total }), 'success')
      } else {
        const detail = errors?.[0] ? `\n${errors[0]}` : ''
        addToast(
          i18nT('toast.stepsFailed', { label, failed: steps_failed, total: steps_total }) + detail,
          'error',
          7000,
        )
      }
    }
  }, [messages])

  return (
    <Suspense fallback={null}>
    <MobileOnboardingRedirector />
    <Routes>
      {/* ── Main consumer app ── */}
      <Route element={<AppShell connected={connected} />}>
        <Route index element={<Dashboard />} />
        <Route path="rooms" element={<RoomsList />} />
        <Route path="rooms/:roomId" element={<RoomDetail />} />
        <Route path="devices" element={<Devices />} />
        <Route path="devices/:entityId" element={<DeviceDetail />} />
        <Route path="remote/:irId" element={<Remote />} />
        <Route path="automations" element={<Automations />} />
        <Route path="routines" element={<Routines />} />
        <Route path="scenes" element={<Navigate to="/routines" replace />} />
        <Route path="chat" element={<AIChat />} />
        {taskTrackingEnabled && (
          <Route path="tasks" element={<Tasks />} />
        )}
        <Route path="memory" element={<Memory />} />
        <Route path="settings" element={<Settings />} />
        <Route path="virtual-devices" element={<VirtualDevices />} />
        <Route path="alerts" element={<Anomalies />} />
        <Route path="suggestions" element={<Suggestions />} />
        <Route path="anomalies" element={<Navigate to="/alerts" replace />} />
        <Route path="quick-asks" element={<QuickAsks />} />
        <Route path="cameras" element={<Cameras />} />
        <Route path="admin" element={<AdminSettings />} />
      </Route>

      {/* ── Mobile (Ziggy Home native app) onboarding — no AppShell, only reachable inside Capacitor ── */}
      <Route path="mobile-onboarding" element={<MobileOnboarding />} />
      <Route path="mobile-diagnostics" element={<MobileDiagnostics />} />

      {/* ── Admin / Ops console — no AppShell, role-protected ── */}
      <Route path="ops" element={<ProtectedOpsRoute />}>
        <Route index element={<AdminConsole />} />
        <Route element={<OpsPageWrapper title="Debug Console" />}>
          <Route path="debug" element={<DebugPage />} />
        </Route>
        <Route element={<OpsPageWrapper title="Cloud Administration" />}>
          <Route path="cloud" element={<CloudAdmin />} />
        </Route>
        <Route element={<OpsPageWrapper title="HA Update Checker" />}>
          <Route path="ha-update" element={<HAUpdate />} />
        </Route>
        <Route element={<OpsPageWrapper title="Feature Flags" />}>
          <Route path="features" element={<FeatureFlags />} />
        </Route>
      </Route>

      {/* ── Legacy redirect from old bookmark ── */}
      <Route path="ha-update" element={<Navigate to="/ops/ha-update" replace />} />

      {/* ── Legacy redirects (old bookmarks) ── */}
      <Route path="debug" element={<Navigate to="/ops/debug" replace />} />
      <Route path="cloud-admin" element={<Navigate to="/ops/cloud" replace />} />
    </Routes>
    </Suspense>
  )
}

export default function App() {
  // Per-field selectors — App is the outermost component below the WS
  // provider; destructuring would re-render the whole tree whenever any
  // uiStore field (toasts, modals, etc.) changes.
  const theme         = useUIStore(s => s.theme)
  const authenticated = useAuthStore(s => s.authenticated)
  const setRole       = useAuthStore(s => s.setRole)
  const logout        = useAuthStore(s => s.logout)

  useEffect(() => {
    document.documentElement.setAttribute('data-palette', theme === 'dark' ? 'dark' : 'light')
  }, [theme])

  // Refresh role on every app load (soft — never auto-logout)
  useEffect(() => {
    if (!authenticated) return
    getAuthStatus()
      .then(d => { if (d.role) setRole(d.role) })
      .catch(() => {})
    // Hydrate UI language from the server. The store is also localStorage-
    // persisted, but on a brand-new device / cleared site data, this is what
    // bootstraps the UI into Hebrew for users who chose it on another device.
    getGeneralSettings()
      .then(g => { if (g?.language) setI18nLang(g.language) })
      .catch(() => {})
    // Pull UI prefs (Dashboard pinned shortcuts + quick controls) from the
    // server so they survive PWA service-worker cache evictions and "clear
    // site data" — both wipe localStorage. Falls back silently to the
    // localStorage cache if the server is unreachable.
    useDeviceStore.getState().syncUiPrefsFromServer()
    // Feature flags drive UI gating (hidden tabs, short-circuited routes).
    // Fetch once per auth; defaults from featuresStore cover the gap.
    useFeaturesStore.getState().fetch()
  }, [authenticated])

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
  //
  // Web/PWA only — the native shell has a parallel effect below that uses
  // Capacitor.Geolocation instead. Single early-return keeps the existing
  // browser-geo code untouched on the PWA.
  useEffect(() => {
    if (isNative()) return
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

  // Native (Capacitor) foreground presence pinging — mirrors the browser
  // effect above but talks to Capacitor.Geolocation. Background coverage is
  // Phase 3 (custom ziggy-presence plugin). On web this effect is a no-op.
  useEffect(() => {
    if (!isNative()) return
    if (!authenticated) return

    const Geo = window?.Capacitor?.Plugins?.Geolocation
    if (!Geo) return

    let watchId = null
    let keepAlive = null
    let alive = true

    const start = async () => {
      try {
        const perm = await Geo.checkPermissions?.()
        if (!perm || (perm.location !== 'granted' && perm.location !== 'prompt-with-rationale')) {
          // We don't prompt here — onboarding does that explicitly. If the
          // user denied earlier, respect that and silently skip.
          if (perm?.location === 'denied') return
        }
      } catch {}

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

      try {
        watchId = await Geo.watchPosition({ enableHighAccuracy: true, timeout: 15000 },
          (pos, err) => {
            if (err || !pos?.coords) return
            lastPos = pos
            ping(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)
          })
      } catch { return }

      keepAlive = setInterval(() => {
        if (lastPos) ping(lastPos.coords.latitude, lastPos.coords.longitude, lastPos.coords.accuracy)
      }, 2 * 60 * 1000)
    }

    start()
    return () => {
      alive = false
      if (watchId) { try { Geo.clearWatch({ id: watchId }) } catch {} }
      if (keepAlive) clearInterval(keepAlive)
    }
  }, [authenticated])

  // Register service worker and subscribe to web push after login
  useEffect(() => {
    if (!authenticated) return
    if (import.meta.env.DEV) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    const register = async () => {
      try {
        // Snapshot whether the page was already controlled before registering.
        // First-ever install activates a SW that claims an uncontrolled page,
        // which fires `controllerchange` — we must NOT treat that as an
        // "update available" signal or we reload-loop on first install.
        const hadController = !!navigator.serviceWorker.controller
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

        // ── Auto-update logic ────────────────────────────────────────────
        // Reload ONCE when a brand-new SW (not the initial install) actually
        // takes control of the page, so the fresh JS/CSS bundle is served.
        // Skipped when:
        //   - The page wasn't controlled before this register call (first install).
        //   - The page is hidden (would yank an active session out from under
        //     a user mid-interaction; reload happens next foreground instead).
        let reloadedForUpdate = false
        const triggerReloadOnControlChange = () => {
          if (reloadedForUpdate) return
          if (!hadController) return                    // initial install — no reload
          if (document.visibilityState !== 'visible') return
          reloadedForUpdate = true
          window.location.reload()
        }
        // controllerchange covers both the "waiting SW activates" path and
        // any other ownership transition. Single source of truth — drop the
        // duplicate `statechange` listener that was racing against it and
        // could schedule two reloads in close succession.
        navigator.serviceWorker.addEventListener('controllerchange', triggerReloadOnControlChange)
        // Note: removed eager reg.update() on every login. Browsers already
        // re-check the SW on navigation; the explicit call here forced an
        // update-and-reload on every session start, which was the root cause
        // of the "page reloaded itself mid-click" reports.

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
