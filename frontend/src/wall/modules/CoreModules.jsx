// Modules backed by data Ziggy already has.
//
// Every one of these reads from an existing store or endpoint — none of them
// introduces a parallel source of truth, and none of them holds device state
// of its own. If the phone app shows a light as on, so does the wall, because
// both are reading the same `deviceStore` fed by the same WebSocket.

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { deviceFacts } from '../../lib/devices'
import { useT, useTranslatedName, useLangStore } from '../../lib/i18n'
import { translateNamePhrase } from '../../lib/i18n/nameDict'
import { useDeviceActions } from '../useWallControl'
import {
  sendChat, getRoutines, runRoutine, getTasks, updateTask,
  getWeather, getAlerts, getMode, getModeOptions, setMode,
  getQuickAsks, runDirectIntent,
} from '../../lib/api'

// ─── Ziggy ──────────────────────────────────────────────────────────────────
// Tap-to-type in v1. The mic is deliberately absent, not broken: a tablet on
// http://<lan-ip> is not a secure context, so getUserMedia is unavailable and
// a mic button would be a button that silently does nothing.

export const ZiggyModule = memo(function ZiggyModule({ ctx }) {
  const t = useT()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState(null)

  const send = useCallback(async () => {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    setText('')
    setReply(null)
    try {
      const res = await sendChat(q, [], 'wall')
      const msg = res?.message || res?.response || res?.reply
      setReply(msg || null)
      if (msg) ctx.toast?.(msg)
    } catch (e) {
      ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err')
    } finally {
      setBusy(false)
      // The answer lives in the toast; the card returns to its resting hint so
      // the next person walking up sees an invitation, not someone else's chat.
      setTimeout(() => setReply(null), 8000)
    }
  }, [text, busy, ctx, t])

  return (
    <div className="zw-ziggy">
      <div className={`zw-orb${busy ? ' is-busy' : ''}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="zw-ziggy-title">
          {busy ? t('wall.ziggy.thinking') : (reply || t('wall.ziggy.title'))}
        </div>
        <input
          className="zw-ziggy-input"
          value={text}
          disabled={busy}
          placeholder={t('wall.ziggy.hint')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
        />
      </div>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--ok)', flex: 'none' }} />
    </div>
  )
})

// ─── Scenes ─────────────────────────────────────────────────────────────────
// "Scenes" in the design map onto Ziggy's real on-demand routines. The module
// shows the ones the user picked (or the first few) rather than a hardcoded
// four, so the tiles reflect this home rather than a mockup's home.

export const ScenesModule = memo(function ScenesModule({ mod, ctx }) {
  const t = useT()
  const [routines, setRoutines] = useState([])
  const [asks, setAsks] = useState([])
  const [running, setRunning] = useState(null)
  const picked = mod.config?.ids

  useEffect(() => {
    let dead = false
    getRoutines().then((r) => { if (!dead) setRoutines(r?.routines || r || []) }).catch(() => {})
    // Quick-asks are one-tap actions too, and most homes have them long before
    // they have on-demand routines. Without this the card sat empty on a real
    // home that had plenty of one-tap actions — just not of the type it asked for.
    getQuickAsks().then((r) => { if (!dead) setAsks(Array.isArray(r) ? r : (r?.quick_asks || [])) }).catch(() => {})
    return () => { dead = true }
  }, [])

  const tiles = useMemo(() => {
    const rs = (Array.isArray(routines) ? routines : []).map((r) => ({
      key: `r:${r.id}`, name: r.name, sub: r.description || r.summary || '',
      run: () => runRoutine(r.id),
    }))
    const qs = (Array.isArray(asks) ? asks : []).map((a) => ({
      key: `a:${a.id}`, name: `${a.icon ? a.icon + ' ' : ''}${a.label}`, sub: '',
      run: () => runDirectIntent(a.intent, a.params || {}),
    }))
    const all = [...rs, ...qs]
    if (Array.isArray(picked) && picked.length) {
      const byKey = new Map(all.map((x) => [x.key, x]))
      const chosen = picked.map((k) => byKey.get(String(k))).filter(Boolean)
      if (chosen.length) return chosen
    }
    return all.slice(0, 6)
  }, [routines, asks, picked])

  const run = useCallback(async (tile) => {
    setRunning(tile.key)
    await ctx.guard('scenes', async () => {
      try {
        await tile.run()
        ctx.toast?.(`✓ ${tile.name}`)
      } catch (e) {
        ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err')
      }
    })
    setRunning(null)
  }, [ctx, t])

  return (
    <>
      <div className="zw-card-head"><span className="zw-eyebrow">{t('wall.mod.scenes')}</span></div>
      <div className="zw-card">
        {tiles.length === 0
          ? <div className="zw-empty">{t('wall.scenes.empty')}</div>
          : (
            <div className="zw-scenes">
              {tiles.map((tile, i) => (
                <button
                  key={tile.key}
                  className={`zw-scene${i === 0 ? ' is-dark' : ''}`}
                  onClick={() => run(tile)}
                >
                  <div className="zw-scene-name">{tile.name}</div>
                  <div className="zw-scene-sub">
                    {running === tile.key ? t('wall.scenes.running') : tile.sub}
                  </div>
                </button>
              ))}
            </div>
          )}
      </div>
    </>
  )
})

// ─── Pinned devices ─────────────────────────────────────────────────────────
// Reuses `deviceStore.pinnedShortcuts` — the very same pins the phone app
// uses, so pinning on a phone shows up on the wall.

export const PinnedModule = memo(function PinnedModule({ mod, ctx }) {
  const t = useT()
  const entities = useDeviceStore((s) => s.entities)
  const quick    = useDeviceStore((s) => s.quickControlIds)
  const actions  = useDeviceActions({ toast: ctx.toast, guard: ctx.guard })
  // Chips render in a .map, so the hook form isn't available per item —
  // read the language once and translate inline, same dictionary either way.
  const lang     = useLangStore((s) => s.lang)

  // This card's OWN list, stored in the tablet's layout, so a wall can pin
  // different things than the phone. `quickControlIds` lives in per-USER
  // prefs and is therefore shared with every other surface that user opens —
  // fine as a starting point, wrong as the only option.
  //
  // (`pinnedShortcuts` is not a candidate at all: it holds
  // {type:'routine'|'ask', id}, never devices.)
  const chosen = mod?.config?.entity_ids
  const ids = useMemo(
    () => (Array.isArray(chosen) && chosen.length ? chosen : (quick || [])).slice(0, 24),
    [chosen, quick],
  )

  const facts = useMemo(() => {
    const map = new Map(entities.map((e) => [e.entity_id, e]))
    return ids.map((id) => map.get(id)).filter(Boolean).map(deviceFacts)
  }, [ids, entities])

  return (
    <>
      <div className="zw-card-head"><span className="zw-eyebrow">{t('wall.pinned')}</span></div>
      <div className="zw-card">
        <div className="zw-card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 9, padding: 12, alignContent: 'flex-start' }}>
          {facts.length === 0 && <div className="zw-empty">{t('wall.pinnedEmpty')}</div>}
          {facts.map((f) => (
            <button
              key={f.id}
              className={`zw-chip${f.isOn ? ' is-on' : ''}`}
              onClick={() => actions.toggle(f)}
            >
              <span className="zw-chip-label">{translateNamePhrase(f.name, lang)}</span>
              <span className="zw-chip-state">{f.stateLabel}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
})

// ─── Single room ────────────────────────────────────────────────────────────

export const RoomModule = memo(function RoomModule({ mod, ctx }) {
  const t = useT()
  // Same grouped view as the rail and the app's Rooms page — see RoomsRail.
  const rawRooms   = useDeviceStore((s) => s.ziggyRooms)
  const groups     = useDeviceStore((s) => s.deviceGroups)
  const groupByEid = useDeviceStore((s) => s.groupByEntityId)
  const groupById  = useDeviceStore((s) => s.groupById)
  const ziggyRooms = useMemo(
    () => useDeviceStore.getState().getGroupedZiggyRooms(),
    [rawRooms, groups, groupByEid, groupById],
  )
  const entities   = useDeviceStore((s) => s.entities)
  const actions    = useDeviceActions({ toast: ctx.toast, guard: ctx.guard })
  const lang       = useLangStore((s) => s.lang)

  const room = useMemo(
    () => (ziggyRooms || []).find((r) => r.id === mod.config?.room_id) || (ziggyRooms || [])[0],
    [ziggyRooms, mod.config?.room_id],
  )
  const roomName = useTranslatedName(room?.name || '')

  const facts = useMemo(() => {
    if (!room) return []
    const map = new Map(entities.map((e) => [e.entity_id, e]))
    return (room.devices || []).map((d) => map.get(d.entity_id)).filter(Boolean).map(deviceFacts)
  }, [room, entities])

  return (
    <>
      <div className="zw-card-head"><span className="zw-eyebrow">{roomName || t('wall.mod.room')}</span></div>
      <div className="zw-card">
        <div className="zw-card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 9, padding: 12, alignContent: 'flex-start' }}>
          {facts.length === 0 && <div className="zw-empty">{t('wall.rail.noDevices')}</div>}
          {facts.map((f) => (
            <button key={f.id} className={`zw-chip${f.isOn ? ' is-on' : ''}`} onClick={() => actions.toggle(f)}>
              <span className="zw-chip-label">{translateNamePhrase(f.name, lang)}</span>
              <span className="zw-chip-state">{f.stateLabel}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
})

// ─── Clock ──────────────────────────────────────────────────────────────────

export const ClockModule = memo(function ClockModule() {
  const now = useNow(30_000)
  return (
    <div className="zw-card" style={{ alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ fontSize: 'clamp(30px,5vw,64px)', fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="zw-eyebrow" style={{ marginTop: 6 }}>
        {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
    </div>
  )
})

/** Shared ticking clock. One interval per consumer, cleaned up on unmount —
 *  this screen runs for months, so a leaked interval is a real bug. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

// ─── Weather ────────────────────────────────────────────────────────────────

export const WeatherModule = memo(function WeatherModule() {
  const t = useT()
  const [w, setW] = useState(null)
  // Fallback source. `weather_router` is present in the tree but not
  // registered in server.py, so /api/weather 404s on many hubs. Most homes
  // have a HA `weather.*` entity anyway, and that is already flowing through
  // deviceStore — so read it rather than showing a permanently empty card.
  const haWeather = useDeviceStore(
    useCallback((s) => s.entities.find((e) => (e.domain || e.entity_id?.split('.')[0]) === 'weather'), []),
  )

  useEffect(() => {
    let dead = false
    const load = () => getWeather().then((r) => { if (!dead) setW(r) }).catch(() => {})
    load()
    const id = setInterval(load, 15 * 60_000)
    return () => { dead = true; clearInterval(id) }
  }, [])

  const temp = w?.temperature ?? w?.temp ?? w?.current?.temperature
    ?? haWeather?.temperature ?? null
  const desc = w?.condition ?? w?.description ?? w?.current?.condition
    ?? haWeather?.state ?? null

  return (
    <div className="zw-card" style={{ justifyContent: 'center', padding: 16 }}>
      <span className="zw-eyebrow">{t('wall.mod.weather')}</span>
      <div style={{ fontSize: 'clamp(24px,3.2vw,42px)', fontWeight: 800, letterSpacing: '-0.03em', marginTop: 4 }}>
        {temp != null ? `${Math.round(temp)}°` : '—'}
      </div>
      {desc && <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>{desc}</div>}
    </div>
  )
})

// ─── Tasks ──────────────────────────────────────────────────────────────────

export const TasksModule = memo(function TasksModule({ mod }) {
  const t = useT()
  const limit = mod.config?.limit ?? 6
  const [tasks, setTasks] = useState([])

  const load = useCallback(() => {
    getTasks().then((r) => setTasks(r?.tasks || [])).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = useCallback(async (task) => {
    const next = !task.done
    setTasks((cur) => cur.map((x) => (x.id === task.id ? { ...x, done: next } : x)))
    try { await updateTask(task.id, { done: next }) }
    catch { setTasks((cur) => cur.map((x) => (x.id === task.id ? { ...x, done: !next } : x))) }
  }, [])

  const rows = useMemo(() => tasks.filter((x) => !x.done).slice(0, limit), [tasks, limit])

  return (
    <>
      <div className="zw-card-head"><span className="zw-eyebrow">{t('wall.mod.tasks')}</span></div>
      <div className="zw-card">
        <div className="zw-card-body" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.length === 0 && <div className="zw-empty">{t('tasks.empty') || '—'}</div>}
          {rows.map((x) => (
            <div key={x.id} onClick={() => toggle(x)} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
              <span style={{ width: 20, height: 20, borderRadius: 6, border: '2px solid var(--line-2)', flex: 'none' }} />
              <span style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {x.task || x.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
})

// ─── Alerts ─────────────────────────────────────────────────────────────────

export const AlertsModule = memo(function AlertsModule({ mod }) {
  const t = useT()
  const limit = mod.config?.limit ?? 5
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    let dead = false
    const load = () => getAlerts?.().then((r) => {
      if (!dead) setAlerts((r?.alerts || r || []).slice(0, limit))
    }).catch(() => {})
    load()
    const id = setInterval(load, 60_000)
    return () => { dead = true; clearInterval(id) }
  }, [limit])

  return (
    <>
      <div className="zw-card-head"><span className="zw-eyebrow">{t('wall.mod.alerts')}</span></div>
      <div className="zw-card">
        <div className="zw-card-body">
          {alerts.length === 0 && <div className="zw-empty">—</div>}
          {alerts.map((a, i) => (
            <div key={a.id || i} style={{ padding: '10px 15px', borderBottom: '0.5px solid var(--line)' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{a.title || a.message}</div>
              {a.detail && <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{a.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  )
})

// ─── Modes ──────────────────────────────────────────────────────────────────

export const ModesModule = memo(function ModesModule({ ctx }) {
  const t = useT()
  const [modes, setModes] = useState([])
  const [active, setActive] = useState(null)

  const load = useCallback(() => {
    // Options and current mode are two endpoints; fetch together so the tile
    // never renders a list with nothing highlighted.
    Promise.all([getModeOptions().catch(() => null), getMode().catch(() => null)])
      .then(([opts, cur]) => {
        setModes(opts?.options || opts?.modes || opts || [])
        setActive(cur?.mode ?? cur?.active ?? cur ?? null)
      })
  }, [])
  useEffect(() => { load() }, [load])

  const pick = useCallback((m) => ctx.guard('scenes', async () => {
    const id = m.id || m.key || m
    const prev = active
    setActive(id)
    try { await setMode(id) }
    catch (e) { setActive(prev); ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err') }
  }), [ctx, active, t])

  return (
    <>
      <div className="zw-card-head"><span className="zw-eyebrow">{t('wall.mod.modes')}</span></div>
      <div className="zw-card">
        <div className="zw-card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, alignContent: 'flex-start' }}>
          {modes.length === 0 && <div className="zw-empty">—</div>}
          {modes.map((m) => {
            const id = m.id || m.key || m
            return (
              <button key={id} className={`zw-chip${active === id ? ' is-on' : ''}`} onClick={() => pick(m)}>
                <span className="zw-chip-label">{m.name || m.label || id}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
})
