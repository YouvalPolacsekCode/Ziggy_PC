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

import { useState, useEffect } from 'react'
import { getKind, KIND, deviceFacts, sendDeviceCommand } from '../../lib/devices'
import { useUIStore } from '../../stores/uiStore'
import { callHaService } from '../../lib/api'
import { t as i18nT } from '../../lib/i18n'

import { TVRemote }    from './remotes/TVRemote'
import { ACRemote }    from './remotes/ACRemote'
import { SensorRemote } from './remotes/SensorRemote'
import BoilerRemote    from './remotes/BoilerRemote'
import { MediaTransportRemote } from './remotes/MediaTransportRemote'
import { findVendorAdapter } from '../../lib/mediaPlayerVendors'

import {
  LightControls, CoverControls, FanControls, LockControls, VacuumControls,
  GenericControls,
} from '../ui/DeviceControls'

// Streamer / Cast / Fire TV / Apple TV in app mode all show up as TV-kind
// media_player entities but have no useful nav surface — no IR, no paired
// remote.*, no vendor adapter, and (usually) a near-empty source list.
// They DO have rich media metadata (title, art, position, app_name) and
// transport (play/pause/skip/seek). The right UI for those is a media
// player, not a remote — see MediaTransportRemote.
//
// Resolution order:
//   1. group.capabilities — if the backend grouped a streamer with a
//      companion remote entity (Cast + Android-TV-Remote union), surface
//      the TVRemote because the d-pad is now meaningful. Otherwise route
//      streamer-style entities (app_awareness + no source list) to the
//      MediaTransport surface.
//   2. Legacy heuristic for ungrouped entities (no IR, no vendor adapter,
//      short source list, has app_name).
//
// LG webOS playing Stremio: vendor adapter matches → routed to TVRemote.
// Chromecast playing Stremio: no adapter, no IR, no companion remote →
// MediaTransport. Chromecast paired with Android-TV-Remote → TVRemote
// (group capabilities show os_nav=true).
function _isMediaAppDevice(entity) {
  if (!entity) return false
  if (entity._ir || entity._linkedIr) return false

  const caps = entity._group?.capabilities
  if (caps) {
    // Backend says it has nav (companion remote / IR codes) AND app awareness:
    // it's an "active TV surface" — route to TVRemote.
    if (caps.os_nav) return false
    // No nav at all but transport works and an app is running → streamer.
    if (caps.app_awareness && caps.media_transport) return true
  }

  if (findVendorAdapter(entity)) return false
  const sources = entity.source_list
                || entity.attributes?.source_list
                || []
  if (sources.length > 5) return false
  const appName = entity.app_name || entity.attributes?.app_name
  return !!appName
}

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
      addToast(e.message || i18nT('deviceCard.controlFailed'), 'error')
    }
  }

  switch (kind) {
    case KIND.TV:
    case KIND.SOUNDBAR:
    case KIND.RECEIVER:
    case KIND.PROJECTOR:
      if (_isMediaAppDevice(entity)) return <MediaTransportRemote entity={entity} />
      return <TVRemote entity={entity} />

    case KIND.AC:
      return <ACRemote entity={entity} automations={automations} suggestion={suggestion} />

    case KIND.WATER_HEATER:
      return <BoilerRemote entity={entity} />

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
    catch (e) { addToast(e.message || i18nT('deviceRemote.commandFailed'), 'error') }
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
        {facts.isOn ? i18nT('deviceCard.turnOff') : i18nT('deviceCard.turnOn')}
      </button>
    </div>
  )
}

// ─── Switch/plug remote — big toggle + power reading if available ───────────

function SwitchRemote({ entity }) {
  const addToast = useUIStore((s) => s.addToast)
  // Optimistic UI: predicted on/off applies immediately on tap and is cleared
  // when the real entity state arrives via the WS state-change broadcast.
  // Some integrations (Switcher's switcher_kis) make HA block its REST
  // service call until the device acks — 1-3s on a busy boiler — and the
  // toggle felt frozen during that time.
  const [predictedOn, setPredictedOn] = useState(null)
  useEffect(() => { setPredictedOn(null) }, [entity?.state])

  const facts = deviceFacts(entity)
  const isOn = predictedOn != null ? predictedOn : facts.isOn

  const fire = async (cmd) => {
    setPredictedOn(cmd === 'turn_on' ? true : cmd === 'turn_off' ? false : !facts.isOn)
    try { await sendDeviceCommand(entity, cmd) }
    catch (e) {
      setPredictedOn(null)
      addToast(e.message || 'Command failed', 'error')
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center' }}>
      <div className="z-card" style={{
        width: '100%', padding: '40px 24px', borderRadius: 18, textAlign: 'center',
        background: isOn ? 'color-mix(in srgb, var(--ok) 10%, var(--surface))' : 'var(--surface)',
        opacity: predictedOn != null ? 0.85 : 1,
        transition: 'opacity 0.15s',
      }}>
        <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: '-0.04em', color: isOn ? 'var(--ok)' : 'var(--ink-mute)' }}>
          {isOn ? i18nT('common.on') : i18nT('common.off')}
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
        {isOn ? i18nT('deviceCard.turnOff') : i18nT('deviceCard.turnOn')}
      </button>
    </div>
  )
}

export default DeviceRemote
