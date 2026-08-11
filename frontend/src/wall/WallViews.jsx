// The two non-board views: Automations, and the Devices modal.
//
// Both take the "full parity by reuse" route from the spec: the wall does not
// reimplement pairing or automation logic, it mounts the app's real components
// and stores at tablet scale. That way a fix to pairing lands on the wall for
// free, and the two surfaces can never drift apart in behaviour.

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useAutomationStore } from '../stores/automationStore'
import { useDeviceStore } from '../stores/deviceStore'
import { deviceFacts } from '../lib/devices'
import { useT, useTranslatedName } from '../lib/i18n'
import { useDeviceActions } from './useWallControl'
import { PairingWizard } from '../components/PairingWizard'

// ─── Automations ────────────────────────────────────────────────────────────

export const AutomationsView = memo(function AutomationsView({ ctx }) {
  const t = useT()
  const automations      = useAutomationStore((s) => s.automations)
  const fetchAutomations = useAutomationStore((s) => s.fetchAutomations)
  const toggle           = useAutomationStore((s) => s.toggleAutomation)

  useEffect(() => { fetchAutomations({ maxAge: 30_000 }) }, [fetchAutomations])

  const onCount = automations.filter((a) => a.enabled).length

  const onToggle = useCallback((a) => ctx.guard('automations', async () => {
    try { await toggle(a.id) }
    catch (e) { ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err') }
  }), [toggle, ctx, t])

  return (
    <div className="zw-autos">
      <div className="zw-eyebrow" style={{ padding: '2px 4px 10px' }}>
        {t('wall.tab.autos')} · {t('wall.autos.count', { on: onCount, total: automations.length })}
      </div>

      {automations.length === 0
        ? <div className="zw-empty">{t('wall.autos.empty')}</div>
        : (
          <div className="zw-autos-grid">
            {automations.map((a) => (
              <div key={a.id} className={`zw-auto${a.enabled ? '' : ' is-off'}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="zw-auto-name">{a.name || a.alias}</div>
                  <button
                    className={`zw-switch${a.enabled ? ' is-on' : ''}`}
                    aria-pressed={!!a.enabled}
                    aria-label={a.name || a.alias}
                    onClick={() => onToggle(a)}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 11 }}>
                  {(a.trigger_summary || a.when) && (
                    <div className="zw-auto-line">
                      <span className="zw-auto-key">{t('wall.autos.when')}</span>
                      <span className="zw-auto-val">{a.trigger_summary || a.when}</span>
                    </div>
                  )}
                  {(a.action_summary || a.then) && (
                    <div className="zw-auto-line">
                      <span className="zw-auto-key">{t('wall.autos.then')}</span>
                      <span className="zw-auto-val">{a.action_summary || a.then}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
})

// ─── Devices modal ──────────────────────────────────────────────────────────

const DeviceModalRow = memo(function DeviceModalRow({ entity, actions, pinned, onTogglePin }) {
  const facts = useMemo(() => deviceFacts(entity), [entity])
  const deviceName = useTranslatedName(facts?.name || '')
  const offline = !facts.isAvailable && !facts.hasIr

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 15px', borderBottom: '0.5px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {deviceName}
        </div>
        <div className={`zw-dev-state${offline ? ' is-err' : facts.isOn ? ' is-on' : ''}`}>
          {offline ? '—' : facts.stateLabel}
        </div>
      </div>
      <button
        onClick={() => onTogglePin(facts.id)}
        aria-label="pin"
        style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 17,
          color: pinned ? 'var(--accent)' : 'var(--ink-ghost)', padding: '0 4px',
        }}
      >★</button>
      {!offline && facts.domain !== 'sensor' && facts.domain !== 'binary_sensor' && facts.domain !== 'lock' && (
        <button
          className={`zw-switch is-sm${facts.isOn ? ' is-on' : ''}`}
          aria-pressed={facts.isOn}
          aria-label={deviceName}
          onClick={() => actions.toggle(facts)}
        />
      )}
    </div>
  )
})

const RoomGroup = memo(function RoomGroup({ room, entityMap, actions, pinnedSet, onTogglePin }) {
  const roomName = useTranslatedName(room.name)
  const devices = useMemo(
    () => (room.devices || []).map((d) => entityMap[d.entity_id]).filter(Boolean),
    [room.devices, entityMap],
  )
  if (devices.length === 0) return null

  return (
    <div>
      <div className="zw-eyebrow" style={{ margin: '14px 2px 7px' }}>{roomName}</div>
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
        {devices.map((e) => (
          <DeviceModalRow
            key={e.entity_id}
            entity={e}
            actions={actions}
            pinned={pinnedSet.has(e.entity_id)}
            onTogglePin={onTogglePin}
          />
        ))}
      </div>
    </div>
  )
})

export const DevicesModal = memo(function DevicesModal({ open, onClose, ctx }) {
  const t = useT()
  const ziggyRooms = useDeviceStore((s) => s.ziggyRooms)
  const entities   = useDeviceStore((s) => s.entities)
  const pinned     = useDeviceStore((s) => s.pinnedShortcuts)
  const setPinned  = useDeviceStore((s) => s.setPinnedShortcuts)
  const fetchAll   = useDeviceStore((s) => s.fetchAll)
  const actions    = useDeviceActions({ toast: ctx.toast, guard: ctx.guard })
  const [pairOpen, setPairOpen] = useState(false)

  const entityMap = useMemo(() => {
    const m = Object.create(null)
    for (const e of entities) m[e.entity_id] = e
    return m
  }, [entities])

  const pinnedSet = useMemo(
    () => new Set((pinned || []).map((p) => (typeof p === 'string' ? p : p?.id)).filter(Boolean)),
    [pinned],
  )

  const togglePin = useCallback((entityId) => {
    const cur = (pinned || []).map((p) => (typeof p === 'string' ? p : p?.id)).filter(Boolean)
    setPinned(cur.includes(entityId) ? cur.filter((x) => x !== entityId) : [...cur, entityId])
  }, [pinned, setPinned])

  const total = useMemo(
    () => (ziggyRooms || []).reduce((n, r) => n + (r.devices?.length || 0), 0),
    [ziggyRooms],
  )

  if (!open) return null

  return (
    <>
      <div className="zw-scrim" onClick={onClose}>
        <div className="zw-modal" onClick={(e) => e.stopPropagation()}>
          <div className="zw-modal-head">
            <div className="zw-modal-title">{t('wall.devices.title')} · {total}</div>
            <button
              className="zw-btn is-on"
              style={{ marginInlineStart: 'auto' }}
              onClick={() => ctx.guard('devices', () => setPairOpen(true))}
            >{t('wall.devices.pair')}</button>
            <button className="zw-btn zw-btn-icon" onClick={onClose}>✕</button>
          </div>
          <div className="zw-modal-body">
            {(ziggyRooms || []).map((r) => (
              <RoomGroup
                key={r.id || r.name}
                room={r}
                entityMap={entityMap}
                actions={actions}
                pinnedSet={pinnedSet}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        </div>
      </div>

      {/* The app's real pairing wizard, not a wall-specific reimplementation.
          Closing it refetches so a newly-paired device appears immediately. */}
      <PairingWizard
        open={pairOpen}
        onClose={() => { setPairOpen(false); fetchAll({ force: true }) }}
      />
    </>
  )
})
