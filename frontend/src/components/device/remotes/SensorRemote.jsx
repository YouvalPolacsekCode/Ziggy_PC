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

const TONE = {
  on:   { bg: 'color-mix(in srgb, var(--info) 12%, var(--surface))', fg: 'var(--info)' },
  ok:   { bg: 'color-mix(in srgb, var(--ok) 10%, var(--surface))',   fg: 'var(--ok)'   },
  warn: { bg: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', fg: 'var(--warn)' },
  err:  { bg: 'color-mix(in srgb, var(--err) 12%, var(--surface))',  fg: 'var(--err)'  },
  idle: { bg: 'var(--surface)',                                       fg: 'var(--ink-mute)' },
}

export function SensorRemote({ entity }) {
  const facts = deviceFacts(entity)
  const tone = TONE[statusTone(facts)] || TONE.idle

  // Numeric sensor: big number display
  const isNumeric = [KIND.TEMPERATURE, KIND.HUMIDITY, KIND.POWER_METER].includes(facts.kind)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Big reading */}
      <div className="z-card" style={{
        padding: '36px 24px', borderRadius: 18,
        background: tone.bg, color: tone.fg,
        textAlign: 'center', borderColor: 'transparent',
      }}>
        <div style={{
          fontSize: isNumeric ? 60 : 36, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1,
        }}>
          {facts.stateLabel}
        </div>
        <div className="z-mono" style={{ fontSize: 11, marginTop: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {facts.meta.label}
        </div>
      </div>

      {/* Diagnostics */}
      <div className="z-card" style={{ padding: 14, borderRadius: 14 }}>
        <span className="z-eyebrow" style={{ display: 'block', marginBottom: 10 }}>Diagnostics</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {facts.battery != null && (
            <DiagRow Icon={facts.battery < 20 ? BatteryLow : Battery} label="Battery" value={`${facts.battery}%`} tone={facts.battery < 20 ? 'err' : 'idle'} />
          )}
          {facts.rssi != null && (
            <DiagRow Icon={Wifi} label="Signal" value={`${facts.rssi} dBm`} />
          )}
          {facts.lastUpdated && (
            <DiagRow Icon={Clock} label="Last update" value={formatTime(facts.lastUpdated)} />
          )}
          {!facts.isAvailable && (
            <DiagRow label="Availability" value="Unavailable" tone="warn" />
          )}
        </div>
      </div>
    </div>
  )
}

function DiagRow({ Icon, label, value, tone = 'idle' }) {
  const fg = tone === 'err' ? 'var(--err)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink-2)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
      {Icon && <Icon size={13} strokeWidth={1.7} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />}
      <span style={{ color: 'var(--ink-faint)', flex: 1 }}>{label}</span>
      <span className="z-mono" style={{ color: fg, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function formatTime(iso) {
  try {
    const d = new Date(iso)
    const diff = (Date.now() - d.getTime()) / 1000
    if (diff < 60)    return `${Math.round(diff)}s ago`
    if (diff < 3600)  return `${Math.round(diff / 60)}m ago`
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
    return d.toLocaleString()
  } catch { return '—' }
}

export default SensorRemote
