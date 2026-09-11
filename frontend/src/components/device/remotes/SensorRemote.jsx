/**
 * SensorRemote — read-only "Control" view for sensor kinds.
 *
 * Sensors don't have controls — but we still want a proper Control tab so the
 * IA is consistent. Shows: large current reading, status pill, contextual
 * details (battery / signal / last update), and any linked automations the
 * user might want to disable.
 */

import { deviceFacts, KIND } from '../../../lib/devices'
import { Battery, BatteryLow, Wifi, Clock } from 'lucide-react'
import { t as i18nT } from '../../../lib/i18n'

function statusTone(facts) {
  switch (facts.kind) {
    case KIND.MOTION:
    case KIND.OCCUPANCY:  return facts.state === 'on' ? 'on' : 'idle'
    case KIND.DOOR:
    case KIND.WINDOW:     return facts.state === 'on' ? 'warn' : 'ok'
    case KIND.LEAK:
    case KIND.SMOKE:      return facts.state === 'on' ? 'err' : 'ok'
    default:              return 'idle'
  }
}

// The reading is ≥ 34px, so the raw status tokens are fine on it; the
// caption under it stays ink-mute.
const TONE = {
  on:   { bg: 'color-mix(in srgb, var(--info) 12%, var(--surface))', fg: 'var(--info)' },
  ok:   { bg: 'color-mix(in srgb, var(--ok) 10%, var(--surface))',   fg: 'var(--ok)'   },
  warn: { bg: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', fg: 'var(--warn)' },
  err:  { bg: 'color-mix(in srgb, var(--err) 12%, var(--surface))',  fg: 'var(--err)'  },
  idle: { bg: 'var(--surface)',                                       fg: 'var(--ink)' },
}

export function SensorRemote({ entity }) {
  const facts = deviceFacts(entity)
  const tone = TONE[statusTone(facts)] || TONE.idle

  // Numeric sensor: the reading is the page's single hero number (56);
  // word states (Open / Motion / Clear) sit at Large Title.
  const isNumeric = [KIND.TEMPERATURE, KIND.HUMIDITY, KIND.POWER_METER].includes(facts.kind)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Big reading */}
      <div className="z-card" style={{
        padding: 24,
        background: tone.bg,
        textAlign: 'center', borderColor: 'transparent',
        transition: 'background var(--dur-state) var(--ease-standard)',
      }}>
        <div className={isNumeric ? 'z-mono' : 'z-display'} style={{
          color: tone.fg,
          ...(isNumeric ? { fontSize: 56, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' } : {}),
        }}>
          {facts.stateLabel}
        </div>
        <div style={{ fontSize: 13, marginTop: 8, color: 'var(--ink-mute)' }}>
          {facts.meta.label}
        </div>
      </div>

      {/* Diagnostics */}
      <div className="z-card" style={{ padding: 12 }}>
        <span className="z-headline" style={{ display: 'block', marginBottom: 4 }}>{i18nT('sensorRemote.diagnostics')}</span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {facts.battery != null && (
            <DiagRow Icon={facts.battery < 20 ? BatteryLow : Battery} label={i18nT('sensorRemote.battery')} value={`${facts.battery}%`} tone={facts.battery < 20 ? 'err' : 'idle'} />
          )}
          {facts.rssi != null && (
            <DiagRow Icon={Wifi} label={i18nT('sensorRemote.signal')} value={`${facts.rssi} dBm`} />
          )}
          {facts.lastUpdated && (
            <DiagRow Icon={Clock} label={i18nT('sensorRemote.lastUpdate')} value={formatTime(facts.lastUpdated)} />
          )}
          {!facts.isAvailable && (
            <DiagRow label={i18nT('sensorRemote.availability')} value={i18nT('common.unavailable')} tone="warn" />
          )}
        </div>
      </div>
    </div>
  )
}

function DiagRow({ Icon, label, value, tone = 'idle' }) {
  const fg = tone === 'err' ? 'var(--err-text)' : tone === 'warn' ? 'var(--warn-text)' : 'var(--ink)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40, fontSize: 13 }}>
      {Icon && <Icon size={18} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />}
      <span style={{ color: 'var(--ink-mute)', flex: 1 }}>{label}</span>
      <span className="z-mono" style={{ color: fg, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function formatTime(iso) {
  try {
    const d = new Date(iso)
    const diff = (Date.now() - d.getTime()) / 1000
    if (diff < 60)    return i18nT('deviceDetail.secondsAgo', { n: Math.round(diff) })
    if (diff < 3600)  return i18nT('deviceDetail.minutesAgo', { n: Math.round(diff / 60) })
    if (diff < 86400) return i18nT('deviceDetail.hoursAgo', { n: Math.round(diff / 3600) })
    return d.toLocaleString()
  } catch { return '—' }
}

export default SensorRemote
