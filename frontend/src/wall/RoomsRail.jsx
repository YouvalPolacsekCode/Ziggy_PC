// Rooms rail — the wall dashboard's fixed furniture.
//
// Always present, always the leading edge, never movable and never removable.
// Rationale: a wall dashboard's primary job is "show me the house"; making
// that a card the user can accidentally delete would let them break the one
// thing the screen exists for.
//
// Room membership comes straight from the device registry via
// `deviceStore.ziggyRooms`. The rail never derives, infers, or invents a room
// — that would violate the user-driven room ownership rule.

import { memo, useCallback, useMemo, useState } from 'react'
import { useDeviceStore, applyRoomsOrder } from '../stores/deviceStore'
import { deviceFacts } from '../lib/devices'
import { useT, useTranslatedName } from '../lib/i18n'
import { useDeviceActions } from './useWallControl'

const CONTROLLABLE = new Set(['light', 'switch', 'media_player', 'climate', 'fan', 'water_heater'])

// ─── one device row ─────────────────────────────────────────────────────────

const DeviceRow = memo(function DeviceRow({ entity, actions, pending }) {
  const t = useT()
  const facts = useMemo(() => deviceFacts(entity), [entity])
  // Same name translation the app's DeviceCard uses, so "Ceiling Light" reads
  // as "אור תקרה" on the wall exactly as it does on a phone.
  const deviceName = useTranslatedName(facts?.name || '')
  const [confirmUnlock, setConfirmUnlock] = useState(false)
  // Local echo so the slider tracks the finger instead of waiting for the hub
  // to answer; cleared as soon as a real value arrives.
  const [dimEcho, setDimEcho] = useState(null)

  if (!facts) return null

  const isLock    = facts.domain === 'lock'
  const isLight   = facts.domain === 'light'
  const isClimate = facts.domain === 'climate'
  const offline   = !facts.isAvailable && !facts.hasIr
  const isPending = !!pending[facts.id]

  // State line. Deliberately reuses the app's own stateLabel so the wall and
  // the phone never describe the same device differently.
  let stateText = facts.stateLabel
  let stateTone = ''
  if (offline)            { stateText = t('wall.dev.offline'); stateTone = 'is-err' }
  else if (isLock)        { stateTone = facts.state === 'locked' ? 'is-on' : 'is-err' }
  else if (facts.isOn) {
    stateTone = 'is-on'
    if (isLight && facts.brightness != null)  stateText = `${t('wall.dev.on')} · ${facts.brightness}%`
    if (isClimate && facts.targetTemp != null) stateText = `${t('wall.dev.cool')} · ${facts.targetTemp}°`
  } else {
    // Match the lowercase register of the on-states above, so a column of
    // rows doesn't alternate between "on · 80%" and "Off".
    stateText = t('wall.dev.off')
  }

  const showDim  = isLight && facts.isOn && facts.capabilities?.has?.('brightness')
  const showTemp = isClimate && facts.isOn
  const dimValue = dimEcho ?? facts.brightness ?? 100

  return (
    <div className={`zw-dev${offline ? ' is-offline' : ''}${isPending ? ' is-pending' : ''}`}>
      <div className="zw-dev-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="zw-dev-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deviceName}
          </div>
          <div className={`zw-dev-state ${stateTone}`}>{stateText}</div>
        </div>

        {!isLock && !offline && facts.domain !== 'binary_sensor' && facts.domain !== 'sensor' && (
          <button
            className={`zw-switch is-sm${facts.isOn ? ' is-on' : ''}`}
            aria-label={deviceName}
            aria-pressed={facts.isOn}
            onClick={(e) => { e.stopPropagation(); actions.toggle(facts) }}
          />
        )}

        {isLock && (
          confirmUnlock ? (
            <>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{t('wall.lock.unlockQ')}</span>
              <button className="zw-pill is-danger" onClick={(e) => {
                e.stopPropagation(); setConfirmUnlock(false); actions.setLock(facts, false)
              }}>{t('common.yes')}</button>
              <button className="zw-pill" onClick={(e) => { e.stopPropagation(); setConfirmUnlock(false) }}>
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <button
              className={`zw-pill${facts.state === 'locked' ? ' is-locked' : ' is-danger'}`}
              onClick={(e) => {
                e.stopPropagation()
                // Locking is always safe and immediate. Unlocking a door from
                // a screen anyone in the house can reach asks first.
                if (facts.state === 'locked') setConfirmUnlock(true)
                else actions.setLock(facts, true)
              }}
            >
              {facts.state === 'locked' ? `🔒 ${t('wall.lock.locked')}` : t('wall.lock.lock')}
            </button>
          )
        )}

      </div>

      {/* The setpoint stepper gets its own row rather than sharing the header.
          Inline, it squeezed the device name to "Livi…" and wrapped the state
          onto two lines on a 1024px tablet, where the rail is only ~235px. */}
      {showTemp && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="zw-step" aria-label="-" onClick={(e) => {
            e.stopPropagation(); actions.setTemperature(facts, (facts.targetTemp ?? 24) - 1)
          }}>−</button>
          <span className="zw-temp">{facts.targetTemp ?? '—'}°</span>
          <button className="zw-step" aria-label="+" onClick={(e) => {
            e.stopPropagation(); actions.setTemperature(facts, (facts.targetTemp ?? 24) + 1)
          }}>+</button>
        </div>
      )}

      {showDim && (
        <input
          type="range" min="1" max="100"
          className="zw-dim"
          value={dimValue}
          onChange={(e) => setDimEcho(+e.target.value)}
          // Commit on release, not on every pixel — otherwise a single drag
          // fires ~80 service calls at the bulb.
          onPointerUp={() => { if (dimEcho != null) { actions.setBrightness(facts, dimEcho); setDimEcho(null) } }}
          onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { actions.setBrightness(facts, dimValue); setDimEcho(null) } }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  )
})

// ─── one room ───────────────────────────────────────────────────────────────

const RoomCard = memo(function RoomCard({ room, entityMap, expanded, onExpand, actions, pending }) {
  const t = useT()
  // Same name-translation path the Rooms page uses, so "Living Room" reads as
  // "סלון" on the wall exactly as it does on a phone.
  const roomName = useTranslatedName(room.name)

  const devices = useMemo(
    () => (room.devices || []).map((d) => entityMap[d.entity_id]).filter(Boolean),
    [room.devices, entityMap],
  )

  const { statusText, anyOn } = useMemo(() => {
    let lightsOn = 0, otherOn = 0, offline = 0, locked = 0, unlocked = 0
    for (const e of devices) {
      const f = deviceFacts(e)
      if (!f.isAvailable && !f.hasIr) { offline++; continue }
      if (f.domain === 'lock') { f.state === 'locked' ? locked++ : unlocked++; continue }
      if (!CONTROLLABLE.has(f.domain)) continue
      if (!f.isOn) continue
      if (f.domain === 'light') lightsOn++
      else otherOn++
    }

    // Say what's actually true. The earlier version counted only lights, which
    // rendered "all off" next to a green master switch whenever a room had a
    // dishwasher running and its lamp off — the status line contradicting the
    // control right beside it.
    const parts = []
    if (lightsOn === 1) parts.push(t('wall.rail.oneLight'))
    else if (lightsOn > 1) parts.push(t('wall.rail.nLights', { n: lightsOn }))
    if (otherOn) parts.push(t('wall.rail.nActive', { n: otherOn }))
    if (!parts.length) {
      // A room whose only devices are locks/sensors has nothing to be "off",
      // so report the lock instead of claiming everything is off.
      if (unlocked) parts.push(t('wall.rail.unlocked'))
      else if (locked) parts.push(t('wall.rail.locked'))
      else parts.push(t('wall.rail.allOff'))
    }
    if (offline) parts.push(t('wall.rail.nOffline', { n: offline }))

    return { statusText: parts.join(' · '), anyOn: lightsOn + otherOn > 0 }
  }, [devices, t])

  // Master switch: all-off when anything is on, else lights-on. Never touches
  // an offline device (the command would just fail) and never turns on a TV
  // or a kettle by surprise — "on" means lights.
  const master = useCallback((e) => {
    e.stopPropagation()
    for (const ent of devices) {
      const f = deviceFacts(ent)
      if (!f.isAvailable && !f.hasIr) continue
      if (!CONTROLLABLE.has(f.domain)) continue
      if (anyOn) { if (f.isOn) actions.toggle(f) }
      else if (f.domain === 'light' && !f.isOn) actions.toggle(f)
    }
  }, [devices, anyOn, actions])

  return (
    <div className="zw-room">
      <button className="zw-room-head" onClick={onExpand} aria-expanded={expanded}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="zw-room-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {roomName}
          </div>
          <div className={`zw-room-status${anyOn ? ' is-active' : ''}`}>{statusText}</div>
        </div>
        <span
          className={`zw-switch${anyOn ? ' is-on' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={roomName}
          onClick={master}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') master(e) }}
        />
        <span className={`zw-chev${expanded ? ' is-open' : ''}`}>▾</span>
      </button>

      {expanded && (
        <div className="zw-room-body">
          {devices.length === 0
            ? <div className="zw-empty">{t('wall.rail.noDevices')}</div>
            : devices.map((e) => (
                <DeviceRow key={e.entity_id} entity={e} actions={actions} pending={pending} />
              ))}
        </div>
      )}
    </div>
  )
})

// ─── the rail ───────────────────────────────────────────────────────────────

export default function RoomsRail({ open, onClose, guard, toast }) {
  const t = useT()
  const ziggyRooms = useDeviceStore((s) => s.ziggyRooms)
  const entities   = useDeviceStore((s) => s.entities)
  const roomsOrder = useDeviceStore((s) => s.roomsOrder)

  const [expanded, setExpanded] = useState(null)
  const actions = useDeviceActions({ toast, guard })

  // entity_id → entity, so a room's device list resolves in O(1) instead of
  // scanning `entities` once per device per render.
  const entityMap = useMemo(() => {
    const m = Object.create(null)
    for (const e of entities) m[e.entity_id] = e
    return m
  }, [entities])

  // Honour the same room order the rest of the app uses.
  const rooms = useMemo(
    () => applyRoomsOrder(ziggyRooms || [], roomsOrder),
    [ziggyRooms, roomsOrder],
  )

  const statusLine = useMemo(() => {
    let active = 0
    let lock = null
    for (const r of rooms) {
      let lit = false
      for (const d of (r.devices || [])) {
        const e = entityMap[d.entity_id]
        if (!e) continue
        const f = deviceFacts(e)
        if (f.domain === 'light' && f.isOn) lit = true
        if (f.domain === 'lock' && lock === null) lock = f.state === 'locked'
      }
      if (lit) active++
    }
    const parts = [t('wall.rail.nActive', { n: active })]
    if (lock !== null) parts.push(lock ? t('wall.rail.locked') : t('wall.rail.unlocked'))
    return parts.join(' · ')
  }, [rooms, entityMap, t])

  return (
    <>
      {open && <div className="zw-rail-scrim" onClick={onClose} />}
      <aside className={`zw-rail${open ? ' is-open' : ''}`}>
        <div className="zw-rail-head">
          <span className="zw-eyebrow">{t('wall.rooms')}</span>
          <span className="zw-eyebrow" style={{ letterSpacing: '.08em' }}>· {statusLine}</span>
        </div>
        <div className="zw-rail-list">
          {rooms.length === 0
            ? <div className="zw-empty">{t('wall.rail.noRooms')}</div>
            : rooms.map((r) => (
                <RoomCard
                  key={r.id || r.room || r.name}
                  room={r}
                  entityMap={entityMap}
                  expanded={expanded === (r.id || r.room || r.name)}
                  onExpand={() => setExpanded((cur) => {
                    const key = r.id || r.room || r.name
                    return cur === key ? null : key
                  })}
                  actions={actions}
                  pending={actions.pending}
                />
              ))}
        </div>
      </aside>
    </>
  )
}
