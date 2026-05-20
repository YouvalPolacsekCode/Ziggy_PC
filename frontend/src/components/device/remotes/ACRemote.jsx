/**
 * ACRemote — unified climate remote.
 *
 * Works for:
 *   - HA climate entities (full attribute set: hvac_modes, fan_modes, etc.)
 *   - Pure IR climate (assumed_state only; modes derived from learned commands)
 *   - Hybrid (HA climate with linked IR — fallbacks for missing services)
 *
 * Centerpiece: a 260px dial that is the temperature input — vertical
 * relative-drag sets target temp (anchor on touch, ±1° per ~6px). The
 * arc + number update live; release commits via set_temp.
 *
 * Below the dial:
 *   - Mode chips (Auto / Cool / Heat / Fan / Dry)
 *   - Fan-speed chips (Auto / Low / Med / High / Turbo)
 *   - Swing / preset chips when applicable
 *   - Schedule card (optional, fed by `automations` prop)
 *   - AI suggestion card (optional, fed by `suggestion` prop)
 *   - Big On/Off button at the bottom
 */

import { useState, useEffect, useRef } from 'react'
import { Power, Snowflake, Flame, Wind, Zap, Sparkles, ChevronRight } from 'lucide-react'
import { deviceFacts, sendDeviceCommand } from '../../../lib/devices'
import { useUIStore } from '../../../stores/uiStore'

const HVAC_MODE_ICONS = {
  off:      Power,
  cool:     Snowflake,
  heat:     Flame,
  auto:     null,
  heat_cool:null,
  fan_only: Wind,
  dry:      null,
}

const HVAC_MODE_LABELS = {
  off: 'Off', cool: 'Cool', heat: 'Heat', auto: 'Auto', heat_cool: 'H/C', fan_only: 'Fan', dry: 'Dry',
}

const TINT_BY_MODE = {
  cool:     'var(--info)',
  heat:     'var(--warn)',
  dry:      'var(--accent)',
  fan_only: 'var(--ink-mute)',
  auto:     'var(--ok)',
  heat_cool:'var(--ok)',
  off:      'var(--ink-ghost)',
}

// Drag → temperature mapping
const DIAL_PIXELS_PER_DEGREE = 6

export function ACRemote({ entity, automations, suggestion }) {
  const addToast = useUIStore((s) => s.addToast)
  const facts = deviceFacts(entity)
  const caps  = facts.capabilities

  const minT = facts.minTemp
  const maxT = facts.maxTemp
  const step = facts.tempStep || 1
  const accent = TINT_BY_MODE[facts.hvacMode] || 'var(--info)'

  // Local optimistic target — anchored to facts.targetTemp, overridden during
  // drag, re-synced after commit lands (commit lock prevents WS echoes from
  // snapping the dial mid-press).
  const [target, setTarget]   = useState(facts.targetTemp ?? 22)
  const [dragging, setDragging] = useState(false)
  const committed = useRef(null)
  const gesture   = useRef({ ptr: null, startY: 0, startVal: 22 })
  useEffect(() => {
    if (dragging || facts.targetTemp == null) return
    if (committed.current != null) {
      if (Math.abs(facts.targetTemp - committed.current) <= step) {
        committed.current = null
        setTarget(facts.targetTemp)
      }
      return
    }
    setTarget(facts.targetTemp)
  }, [facts.targetTemp, dragging, step])

  const fire = async (cmd, params) => {
    try { await sendDeviceCommand(entity, cmd, params) }
    catch (e) { addToast(e.message || 'Command failed', 'error') }
  }

  // Dial pointer handlers — vertical drag = relative temp delta
  const onDialDown = (e) => {
    if (!caps.has('temp')) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    gesture.current = { ptr: e.pointerId, startY: e.clientY, startVal: target }
    setDragging(true)
  }
  const onDialMove = (e) => {
    const g = gesture.current
    if (g.ptr !== e.pointerId) return
    const dy = g.startY - e.clientY                                    // up = warmer
    const deltaSteps = Math.round(dy / DIAL_PIXELS_PER_DEGREE)
    const next = Math.max(minT, Math.min(maxT, g.startVal + deltaSteps * step))
    setTarget(next)
  }
  const onDialUp = (e) => {
    const g = gesture.current
    if (g.ptr !== e.pointerId) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    gesture.current.ptr = null
    setDragging(false)
    if (target !== facts.targetTemp) {
      committed.current = target
      fire('set_temp', { value: target })
    }
  }

  // Modes — HA's hvac_modes if available, else derived from IR learned commands
  const modes      = facts.hvacModes?.length ? facts.hvacModes : deriveIrModes(facts)
  const fanModes   = facts.fanModes?.length  ? facts.fanModes  : deriveIrFanModes(facts)
  const swingModes = facts.swingModes?.length ? facts.swingModes : (facts.isIr ? ['on', 'off'] : [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'center' }}>

      {/* Dial — drag vertically to change target temp */}
      <div
        onPointerDown={onDialDown}
        onPointerMove={onDialMove}
        onPointerUp={onDialUp}
        onPointerCancel={onDialUp}
        style={{
          position: 'relative', width: 220, height: 220,
          cursor: caps.has('temp') ? 'ns-resize' : 'default',
          touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
        }}
      >
        <Dial value={(target - minT) / (maxT - minT) * 100} color={accent} dragging={dragging} />
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 60, fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--ink)', lineHeight: 1 }}>
            {Math.round(target)}°
          </div>
          <div className="z-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 8, letterSpacing: '0.06em' }}>
            {(HVAC_MODE_LABELS[facts.hvacMode] || facts.stateLabel).toUpperCase()}
            {facts.currentTemp != null ? ` · ${Math.round(facts.currentTemp)}° NOW` : ''}
          </div>
        </div>
      </div>

      {/* Mode chips */}
      {modes.length > 0 && (
        <ModeRow
          items={modes}
          current={facts.hvacMode}
          renderLabel={(m) => HVAC_MODE_LABELS[m] || m}
          onPick={(m) => fire('set_hvac_mode', { mode: m })}
        />
      )}

      {/* Fan chips */}
      {caps.has('fan_mode') && fanModes.length > 0 && (
        <SubChipRow label="Fan Speed" items={fanModes} current={facts.fanMode} onPick={(m) => fire('set_fan_mode', { mode: m })} />
      )}

      {/* Swing chips */}
      {caps.has('swing') && swingModes.length > 0 && (
        <SubChipRow label="Swing" items={swingModes} current={facts.swingMode} onPick={(m) => fire('set_swing_mode', { mode: m })} />
      )}

      {/* Preset chips */}
      {caps.has('preset') && facts.presetModes?.length > 0 && (
        <SubChipRow label="Preset" items={facts.presetModes} current={facts.presetMode} onPick={(m) => fire('set_preset_mode', { mode: m })} />
      )}

      {/* Schedule card — surfaces any time-triggered automation that targets
          this entity. Tap to jump to /automations. */}
      {automations?.length > 0 && (
        <ScheduleCard automation={automations[0]} />
      )}

      {/* AI suggestion card — pattern-learning suggestion relevant to this
          device. Tap to view in /automations Suggested tab. */}
      {suggestion && (
        <SuggestionCard suggestion={suggestion} />
      )}

      {/* Power footer */}
      <button
        onClick={() => fire('toggle')}
        className="z-btn-primary"
        style={{
          width: '100%', height: 48, fontSize: 14, letterSpacing: '0.02em',
          background: facts.isOn ? 'var(--ink)' : 'var(--surface)',
          color: facts.isOn ? 'var(--bg)' : 'var(--ink)',
          border: facts.isOn ? 'none' : '0.5px solid var(--line)',
        }}
      >
        {facts.isOn ? 'Turn Off' : 'Turn On'}
      </button>
    </div>
  )
}

function deriveIrModes(facts) {
  if (!facts.isIr) return []
  const ir = facts.linkedIr
  if (!ir) return []
  const learned = new Set(ir.learned_commands || [])
  const result = []
  if (learned.has('mode_cool')) result.push('cool')
  if (learned.has('mode_heat')) result.push('heat')
  if (learned.has('mode_auto')) result.push('auto')
  if (learned.has('mode_fan'))  result.push('fan_only')
  if (learned.has('mode_dry'))  result.push('dry')
  return result
}

function deriveIrFanModes(facts) {
  if (!facts.isIr) return []
  const ir = facts.linkedIr
  if (!ir) return []
  const learned = new Set(ir.learned_commands || [])
  const result = []
  if (learned.has('fan_low'))    result.push('low')
  if (learned.has('fan_medium')) result.push('medium')
  if (learned.has('fan_high'))   result.push('high')
  if (learned.has('fan_auto'))   result.push('auto')
  return result
}

// ─── Dial / chips ───────────────────────────────────────────────────────────

function Dial({ value, color, dragging }) {
  const size = 260
  const r = size / 2 - 16
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(100, value)) / 100)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="12"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
        style={{ transition: dragging ? 'none' : 'stroke-dashoffset 0.25s, stroke 0.25s' }} />
    </svg>
  )
}

function ModeRow({ items, current, renderLabel, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', width: '100%' }}>
      {items.map((m) => {
        const active = current === m
        const Icon = HVAC_MODE_ICONS[m]
        return (
          <button key={m} onClick={() => onPick(m)} style={{
            padding: '9px 14px', borderRadius: 10,
            background: active ? 'var(--ink)' : 'var(--surface)',
            color: active ? 'var(--bg)' : 'var(--ink-2)',
            border: '0.5px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 6, textTransform: 'capitalize',
          }}>
            {Icon ? <Icon size={13} /> : null}
            {renderLabel(m)}
          </button>
        )
      })}
    </div>
  )
}

function SubChipRow({ label, items, current, onPick }) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="z-eyebrow">{label}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((m) => {
          const active = current === m
          return (
            <button key={m} onClick={() => onPick(m)} style={{
              padding: '7px 12px', borderRadius: 9,
              background: active ? 'var(--ink)' : 'var(--surface-2)',
              color:      active ? 'var(--bg)'  : 'var(--ink-2)',
              border: '0.5px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
              fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              textTransform: 'capitalize',
            }}>{(m + '').replace(/_/g, ' ')}</button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Data cards — automations / suggestions ────────────────────────────────

function ScheduleCard({ automation }) {
  const trigger = describeAutomationTrigger(automation)
  return (
    <a
      href="/automations"
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 14,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        textDecoration: 'none', cursor: 'pointer',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: 'color-mix(in srgb, var(--ok) 12%, var(--surface-2))',
        color: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Zap size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {trigger || automation.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{automation.name}</div>
      </div>
      <ChevronRight size={14} style={{ color: 'var(--ink-ghost)', flexShrink: 0 }} />
    </a>
  )
}

function SuggestionCard({ suggestion }) {
  return (
    <a
      href="/automations"
      style={{
        width: '100%', display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '12px 14px', borderRadius: 14,
        background: 'var(--accent-2)',
        border: '0.5px solid color-mix(in srgb, var(--accent) 22%, var(--line))',
        textDecoration: 'none', cursor: 'pointer', color: 'var(--ink)',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: 'color-mix(in srgb, var(--accent) 22%, transparent)',
        color: 'var(--accent-3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Sparkles size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.35 }}>
          {suggestion.user_message}
          {suggestion.status === 'pending' && (
            <span style={{ color: 'var(--accent-3)', fontWeight: 600 }}> Make it a routine?</span>
          )}
        </div>
      </div>
    </a>
  )
}

// Pull a human time/trigger description from an automation object.
function describeAutomationTrigger(a) {
  if (!a) return null
  const t = a.trigger || a.triggers?.[0]
  if (!t) return null
  if (t.platform === 'time' && t.at) return `Will run at ${t.at}`
  if (t.type === 'time' && t.value) return `Will run at ${t.value}`
  if (t.platform === 'sun' && t.event) return t.event === 'sunset' ? 'Runs at sunset' : 'Runs at sunrise'
  return null
}

export default ACRemote
