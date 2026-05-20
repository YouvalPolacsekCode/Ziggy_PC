/**
 * DeviceRemote — picks the right per-kind remote for any device.
 *
 * Replaces the IR-vs-HA branching in Remote.jsx and the
 * domain switch in components/ui/DeviceControls.jsx#DeviceControls.
 *
 * Switching is by canonical KIND (from lib/devices.js), NOT HA domain —
 * an IR-AC and an HA-climate both render the same ACRemote.
 *
 * For kinds where the existing per-domain components in DeviceControls.jsx
 * already work well (Light, Cover, Lock, Vacuum, Fan/HA, generic), we wrap
 * them rather than rewrite. New unified components only exist where they
 * were missing: TVRemote, ACRemote, SensorRemote.
 */

import { getKind, KIND, deviceFacts, sendDeviceCommand } from '../../lib/devices'
import { useUIStore } from '../../stores/uiStore'
import { callHaService } from '../../lib/api'

import { TVRemote }    from './remotes/TVRemote'
import { ACRemote }    from './remotes/ACRemote'
import { SensorRemote } from './remotes/SensorRemote'

import {
  LightControls, CoverControls, FanControls, LockControls, VacuumControls,
  GenericControls,
} from '../ui/DeviceControls'

export function DeviceRemote({ entity, automations, suggestion }) {
  const addToast = useUIStore((s) => s.addToast)

  if (!entity) return null
  const kind = getKind(entity)

  // Shared service handler for the legacy DeviceControls-based remotes that
  // take `onService(service, data)` and assume HA. New unified remotes
  // (TVRemote, ACRemote) call sendDeviceCommand directly so they work for IR.
  const onService = async (service, data) => {
    try {
      await callHaService(entity.domain, service, { entity_id: entity.entity_id, ...(data || {}) })
    } catch (e) {
      addToast(e.message || 'Control failed', 'error')
    }
  }

  switch (kind) {
    case KIND.TV:
    case KIND.SOUNDBAR:
    case KIND.PROJECTOR:
      return <TVRemote entity={entity} />

    case KIND.AC:
      return <ACRemote entity={entity} automations={automations} suggestion={suggestion} />

    case KIND.LIGHT:
      return <LightControls entity={entity} onService={onService} />

    case KIND.COVER:
      return <CoverControls entity={entity} onService={onService} />

    case KIND.LOCK:
      return <LockControls entity={entity} onService={onService} />

    case KIND.VACUUM:
      return <VacuumControls entity={entity} onService={onService} />

    case KIND.FAN:
      // IR fans use a simplified version inline; HA fans get the rich controls
      if (entity._ir) return <IrFanRemote entity={entity} />
      return <FanControls entity={entity} onService={onService} />

    case KIND.SWITCH:
    case KIND.PLUG:
      return <SwitchRemote entity={entity} />

    case KIND.MOTION:
    case KIND.OCCUPANCY:
    case KIND.DOOR:
    case KIND.WINDOW:
    case KIND.LEAK:
    case KIND.SMOKE:
    case KIND.TEMPERATURE:
    case KIND.HUMIDITY:
    case KIND.POWER_METER:
    case KIND.SENSOR:
    case KIND.BINARY:
    case KIND.PERSON:
    case KIND.CAMERA:
      return <SensorRemote entity={entity} />

    default:
      return <GenericControls entity={entity} onService={onService} />
  }
}

// ─── IR fan remote — minimal: power + speed steps ───────────────────────────

function IrFanRemote({ entity }) {
  const addToast = useUIStore((s) => s.addToast)
  const facts = deviceFacts(entity)
  const fire = async (cmd, params) => {
    try { await sendDeviceCommand(entity, cmd, params) }
    catch (e) { addToast(e.message || 'Command failed', 'error') }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
      <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--ink)' }}>{facts.stateLabel}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {['low', 'medium', 'high'].map((s) => (
          <button key={s}
            onClick={() => fire('set_speed_preset', { mode: s })}
            style={{
              padding: '10px 18px', borderRadius: 10,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              color: 'var(--ink-2)', textTransform: 'capitalize',
            }}
          >{s}</button>
        ))}
      </div>
      <button
        onClick={() => fire('toggle')}
        className="z-btn-primary"
        style={{ width: '100%', height: 48, fontSize: 14 }}
      >
        {facts.isOn ? 'Turn Off' : 'Turn On'}
      </button>
    </div>
  )
}

// ─── Switch/plug remote — big toggle + power reading if available ───────────

function SwitchRemote({ entity }) {
  const addToast = useUIStore((s) => s.addToast)
  const facts = deviceFacts(entity)
  const fire = async (cmd) => {
    try { await sendDeviceCommand(entity, cmd) }
    catch (e) { addToast(e.message || 'Command failed', 'error') }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center' }}>
      <div className="z-card" style={{
        width: '100%', padding: '40px 24px', borderRadius: 18, textAlign: 'center',
        background: facts.isOn ? 'color-mix(in srgb, var(--ok) 10%, var(--surface))' : 'var(--surface)',
      }}>
        <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: '-0.04em', color: facts.isOn ? 'var(--ok)' : 'var(--ink-mute)' }}>
          {facts.stateLabel}
        </div>
        <div className="z-mono" style={{ fontSize: 10.5, marginTop: 8, color: 'var(--ink-faint)', letterSpacing: '0.06em' }}>
          {facts.meta.label.toUpperCase()}
        </div>
      </div>
      <button
        onClick={() => fire('toggle')}
        className="z-btn-primary"
        style={{ width: '100%', height: 52, fontSize: 14 }}
      >
        {facts.isOn ? 'Turn Off' : 'Turn On'}
      </button>
    </div>
  )
}

export default DeviceRemote
