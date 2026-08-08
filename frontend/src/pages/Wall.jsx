// Wall — the tablet wall dashboard, mounted at /wall OUTSIDE AppShell.
//
// ADDITIVE SURFACE. The existing /hub route and every app page are untouched;
// this is a new screen that coexists with them. A tablet paired for /hub works
// here with no re-pairing, because both read the same tablet registry.
//
// What this file owns:
//   - which view is showing (board / automations)
//   - the idle timer and wake handling
//   - the toast queue
//   - the capability policy + PIN gate wiring
//   - the shared `ctx` every module receives
//
// Everything else is delegated: the grid to WallGrid, device truth to
// deviceStore, and the realtime fabric to the app-wide WebSocket singleton.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWallStore } from '../stores/wallStore'
import { useDeviceStore } from '../stores/deviceStore'
import { useWsConnected, useWsMessages } from '../hooks/useWebSocket'
import { useT } from '../lib/i18n'
import { getTabletId, setTabletId as persistTabletId, getTabletToken, setTabletToken } from '../lib/hubTablet'
import { isWallMode } from '../lib/wallMode'
import { getWallPolicy, wallTabletHeartbeat, wallWentIdle, getWeather, setWallMode, adoptThisWallTablet } from '../lib/api'
import { useCapabilityGuard } from '../wall/useWallControl'
import { deviceFacts } from '../lib/devices'
import RoomsRail from '../wall/RoomsRail'
import WallGrid from '../wall/WallGrid'
import { WallHeader, ConnectionChip, WallToast, IdleScreen, PinGate, ModulePicker } from '../wall/WallChrome'
import { AutomationsView, DevicesModal } from '../wall/WallViews'
import { PairBanner, PairDialog } from '../wall/PairPanel'
import '../wall/wall.css'

const HEARTBEAT_MS = 60_000
const WEATHER_MS   = 15 * 60_000

export default function Wall() {
  const t = useT()
  // Held in state, not a memo: pairing sets it mid-session and the page must
  // start persisting layouts immediately, without a reload.
  const [tabletId, setTabletId] = useState(() => getTabletId())
  const [tabletToken, setTabletTokenState] = useState(() => getTabletToken())

  const layout      = useWallStore((s) => s.layout)
  const editing     = useWallStore((s) => s.editing)
  const fetchLayout = useWallStore((s) => s.fetchLayout)
  const dropElevation = useWallStore((s) => s.dropElevation)

  const fetchAll   = useDeviceStore((s) => s.fetchAll)
  const ziggyRooms = useDeviceStore((s) => s.ziggyRooms)
  const entities   = useDeviceStore((s) => s.entities)

  const connected = useWsConnected()
  const messages  = useWsMessages()

  const [view, setView]           = useState('home')
  const [railOpen, setRailOpen]   = useState(false)
  const [devicesOpen, setDevices] = useState(false)
  const [pickerOpen, setPicker]   = useState(false)
  const [idle, setIdle]           = useState(false)
  const [policy, setPolicy]       = useState(null)
  const [weather, setWeather]     = useState(null)
  const [toast, setToast]         = useState(null)
  const [pairOpen, setPairOpen]   = useState(false)
  const [pairHidden, setPairHidden] = useState(false)

  const toastTimer = useRef(null)
  const idleTimer  = useRef(null)

  // ── toast ────────────────────────────────────────────────────────────────
  const showToast = useCallback((text, tone) => {
    if (!text) return
    clearTimeout(toastTimer.current)
    setToast({ text, tone })
    toastTimer.current = setTimeout(() => setToast(null), tone === 'err' ? 4200 : 2800)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const guard = useCapabilityGuard(policy, showToast)

  // ── installable as its own app ───────────────────────────────────────────
  // "Add to home screen" installs whatever manifest the CURRENT document
  // points at. With only the app-wide manifest linked, installing from /wall
  // produced a shortcut to the phone app instead — which is what happened on
  // the first tablet. Swapping the link while this page is mounted gives the
  // wall its own install: distinct `id`, start_url /wall, fullscreen, so a
  // kiosk panel opens with no browser chrome at all.
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]')
    if (!link) return
    const previous = link.getAttribute('href')
    link.setAttribute('href', '/wall.webmanifest')
    // Landscape/portrait is the panel's business, but the theme colour should
    // match the wall rather than the app.
    return () => { if (previous) link.setAttribute('href', previous) }
  }, [])

  // ── wall identity ────────────────────────────────────────────────────────
  // Tell the API layer to stamp this tablet's id on every request while the
  // wall is on screen, so the hub can enforce its capability policy at the
  // point commands are served. Cleared on unmount so navigating away from
  // /wall in the same browser goes back to normal app permissions.
  useEffect(() => {
    // Only a PAIRED tablet has a credential. An unpaired visitor keeps their
    // own session and their own permissions — they are a person in a browser,
    // not a wall panel (see wall_policy.unrestricted_policy).
    setWallMode(!!tabletToken, tabletToken)
    return () => setWallMode(false)
  }, [tabletToken])

  // ── adopt this device, once ──────────────────────────────────────────────
  // Choosing "use this as a wall dashboard" already says everything a pairing
  // code would, and the user is signed in ON this device. Asking them to fetch
  // a six-digit code from a second device to prove it again is pure friction —
  // especially right after they have just paired the device itself. So a
  // wall-mode device provisions its own tablet identity silently.
  //
  // The code flow still exists for setting a panel up from somewhere else.
  const adoptingRef = useRef(false)
  useEffect(() => {
    if (tabletToken || !isWallMode() || adoptingRef.current) return
    adoptingRef.current = true
    adoptThisWallTablet(document.title || 'Wall tablet')
      .then((res) => {
        if (!res?.tablet_id) return
        persistTabletId(res.tablet_id)
        setTabletToken(res.tablet_token || null)
        setTabletId(res.tablet_id)
        setTabletTokenState(res.tablet_token || null)
        fetchLayout()
      })
      .catch(() => { adoptingRef.current = false })
  }, [tabletToken, fetchLayout])

  // ── boot ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchLayout()
    fetchAll({ maxAge: 15_000 })
    getWallPolicy(tabletId).then((r) => setPolicy(r?.policy || null)).catch(() => {})
  }, [fetchLayout, fetchAll, tabletId])

  // ── heartbeat ────────────────────────────────────────────────────────────
  // Keeps Settings → Tablets honest about which wall panels are alive.
  useEffect(() => {
    if (!tabletId) return
    wallTabletHeartbeat(tabletId).catch(() => {})
    const id = setInterval(() => wallTabletHeartbeat(tabletId).catch(() => {}), HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [tabletId])

  // ── weather ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let dead = false
    const load = () => getWeather().then((w) => {
      if (dead || !w) return
      const temp = w.temperature ?? w.temp ?? w.current?.temperature
      const desc = w.condition ?? w.description ?? w.current?.condition
      const city = w.city ?? w.location ?? ''
      setWeather([temp != null ? `${Math.round(temp)}°` : null, desc, city].filter(Boolean).join(' · '))
    }).catch(() => {})
    load()
    const id = setInterval(load, WEATHER_MS)
    return () => { dead = true; clearInterval(id) }
  }, [])

  // ── reconnect recovery ───────────────────────────────────────────────────
  // A wall left running through a hub reboot must not sit on a stale picture.
  // When the socket comes back, re-read the world rather than trusting
  // whatever we had before the gap.
  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current) {
      fetchAll({ force: true })
      fetchLayout()
    }
    wasConnected.current = connected
  }, [connected, fetchAll, fetchLayout])

  // ── idle ─────────────────────────────────────────────────────────────────
  const idleEnabled = layout?.idle?.enabled !== false
  const idleAfterMs = (layout?.idle?.timeout_s ?? 300) * 1000

  const resetIdle = useCallback(() => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    if (!idleEnabled || editing) return
    idleTimer.current = setTimeout(() => {
      setIdle(true)
      // Walking away re-locks anything a PIN opened — on the tablet and on
      // the hub, so a stale elevation can't outlive the person who earned it.
      dropElevation()
      if (tabletId) wallWentIdle(tabletId).catch(() => {})
    }, idleAfterMs)
  }, [idleEnabled, idleAfterMs, editing, dropElevation, tabletId])

  useEffect(() => {
    resetIdle()
    const events = ['pointerdown', 'keydown', 'wheel']
    events.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }))
    return () => {
      clearTimeout(idleTimer.current)
      events.forEach((e) => window.removeEventListener(e, resetIdle))
    }
  }, [resetIdle])

  // ── idle status line ─────────────────────────────────────────────────────
  const idleStatus = useMemo(() => {
    const map = new Map(entities.map((e) => [e.entity_id, e]))
    let lit = 0
    for (const r of (ziggyRooms || [])) {
      for (const d of (r.devices || [])) {
        const e = map.get(d.entity_id)
        if (!e) continue
        const f = deviceFacts(e)
        if (f.domain === 'light' && f.isOn) { lit++; break }
      }
    }
    return lit ? t('wall.idle.nRoomsLit', { n: lit }) : t('wall.idle.allQuiet')
  }, [ziggyRooms, entities, t])

  // Modules receive one object rather than a dozen props, so adding a module
  // never means threading a new prop through the grid.
  const ctx = useMemo(() => ({
    toast: showToast,
    guard,
    policy,
    tabletId,
    removeModule: useWallStore.getState().removeModule,
  }), [showToast, guard, policy, tabletId])

  const railCollapsed = layout?.rail?.collapsed

  return (
    <div
      className={`zw-page${editing ? ' is-editing' : ''}${connected ? '' : ' is-stale'}`}
      dir={document?.documentElement?.dir || 'ltr'}
    >
      <WallHeader
        view={view}
        setView={setView}
        onOpenDevices={() => guard('devices', () => setDevices(true))}
        onOpenRail={() => setRailOpen(true)}
        weather={weather}
        policy={policy}
      />

      {!tabletId && !pairHidden && !isWallMode() && (
        <PairBanner onOpen={() => setPairOpen(true)} onDismiss={() => setPairHidden(true)} />
      )}

      {view === 'home' ? (
        <div className="zw-body">
          {!railCollapsed && (
            <RoomsRail
              open={railOpen}
              onClose={() => setRailOpen(false)}
              guard={guard}
              toast={showToast}
            />
          )}
          <WallGrid ctx={ctx} />
        </div>
      ) : (
        <AutomationsView ctx={ctx} />
      )}

      {editing && (
        <button className="zw-fab" onClick={() => setPicker(true)} aria-label={t('wall.addModule')}>+</button>
      )}

      <ModulePicker open={pickerOpen} onClose={() => setPicker(false)} policy={policy} />
      <DevicesModal open={devicesOpen} onClose={() => setDevices(false)} ctx={ctx} />
      <PairDialog
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        onPaired={(res) => {
          setTabletId(res.tablet_id)
          setTabletTokenState(res.tablet_token || null)
          setPairOpen(false)
          // A freshly-paired tablet gets its own layout + policy rows.
          fetchLayout()
          getWallPolicy(res.tablet_id).then((r) => setPolicy(r?.policy || null)).catch(() => {})
          showToast('✓ ' + t('wall.pairTablet'))
        }}
      />
      <PinGate tabletId={tabletId} />
      <ConnectionChip connected={connected} />
      <WallToast toast={toast} />

      {idle && <IdleScreen onWake={resetIdle} status={idleStatus} />}
    </div>
  )
}
