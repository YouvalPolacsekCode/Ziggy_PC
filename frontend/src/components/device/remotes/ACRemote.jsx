/**
 * ACRemote — unified climate remote.
 *
 * Works for:
 *   - HA climate entities (full attribute set: hvac_modes, fan_modes, etc.)
 *   - Pure IR climate (assumed_state only; modes derived from learned commands)
 *   - Hybrid (HA climate with linked IR — fallbacks for missing services)
 *
 * Temperature control is a big ▲ / ▼ pair — most physical AC remotes ship
 * with only up/down buttons (no absolute setpoint). Each button is disabled
 * if its IR command is unlearned (commandAvailable check); HA climates use
 * HA's computed step path.
 *
 * Below the stepper:
 *   - Mode chips (Auto / Cool / Heat / Fan / Dry)
 *   - Fan-speed chips (Auto / Low / Med / High / Turbo)
 *   - Swing / preset chips when applicable
 *   - Schedule card (optional, fed by `automations` prop)
 *   - AI suggestion card (optional, fed by `suggestion` prop)
 *   - Big On/Off button at the bottom
 */

import { ChevronUp, ChevronDown, Power, Snowflake, Flame, Wind, Zap, Sparkles, ChevronRight } from 'lucide-react'
import { commandAvailable, deviceFacts, extrasForRemote, sendDeviceCommand } from '../../../lib/devices'
import { useUIStore } from '../../../stores/uiStore'
import { useDeviceStore } from '../../../stores/deviceStore'
import { useT, t as i18nT } from '../../../lib/i18n'

// Commands rendered as first-class controls by ACRemote — excluded from the
// "Extras" row so they don't appear twice. Discrete temp_<N> setpoints are
// also consumed because step-mode covers them via the dispatcher.
const AC_REMOTE_CONSUMES = new Set([
  'power', 'power_on', 'power_off',
  'mode_cool', 'mode_heat', 'mode_fan', 'mode_auto', 'mode_dry',
  'fan_low', 'fan_medium', 'fan_high', 'fan_auto', 'fan_turbo',
  'swing_on', 'swing_off', 'swing_vertical', 'swing_horizontal',
  'temp_up', 'temp_down', 'temperature_up', 'temperature_down',
])
for (let t = 16; t <= 30; t++) AC_REMOTE_CONSUMES.add(`temp_${t}`)

const HVAC_MODE_ICONS = {
  off:      Power,
  cool:     Snowflake,
  heat:     Flame,
  auto:     null,
  heat_cool:null,
  fan_only: Wind,
  dry:      null,
}

// Resolved at render time so labels track the active language. Keys map to
// i18n entries under `acRemote.hvac.*`.
const HVAC_MODE_LABEL_KEYS = {
  off: 'acRemote.hvac.off', cool: 'acRemote.hvac.cool', heat: 'acRemote.hvac.heat',
  auto: 'acRemote.hvac.auto', heat_cool: 'acRemote.hvac.heatCool',
  fan_only: 'acRemote.hvac.fan', dry: 'acRemote.hvac.dry',
}
const HVAC_MODE_LABELS = new Proxy({}, {
  get: (_, k) => HVAC_MODE_LABEL_KEYS[k] ? i18nT(HVAC_MODE_LABEL_KEYS[k]) : k,
})

const TINT_BY_MODE = {
  cool:     'var(--info)',
  heat:     'var(--warn)',
  dry:      'var(--accent)',
  fan_only: 'var(--ink-mute)',
  auto:     'var(--ok)',
  heat_cool:'var(--ok)',
  off:      'var(--ink-ghost)',
}

export function ACRemote({ entity, automations, suggestion }) {
  const addToast = useUIStore((s) => s.addToast)
  const facts = deviceFacts(entity)
  const caps  = facts.capabilities
  const accent = TINT_BY_MODE[facts.hvacMode] || 'var(--info)'

  // Surface the current target temp. HA exposes target_temperature; for pure
  // IR we read the last commanded value from ac_memory.
  const irMemTemp = entity?._irDevice?.ac_memory?.temp ?? null
  const displayTemp = facts.targetTemp ?? irMemTemp

  // Fire a command + optimistically flip the assumed-state for IR ACs so
  // the toggle label ("Turn On" ↔ "Turn Off") rotates immediately on press.
  // The backend echoes the same change a beat later; if the request fails,
  // we revert. sendDeviceCommand uses the discrete `power_on`/`power_off` IR
  // codes when they've been learned, falling back to the toggle `power` code.
  const fire = async (cmd, params) => {
    const irId = entity?._irDevice?.id
    let revert = null
    if (irId && (cmd === 'toggle' || cmd === 'power_on' || cmd === 'power_off')) {
      const prev = entity._irDevice?.assumed_state
      const next = cmd === 'power_off' ? 'off'
        : cmd === 'power_on'  ? 'on'
        : (facts.isOn ? 'off' : 'on')
      const store = useDeviceStore.getState()
      store.updateIrAssumedState?.(irId, next)
      revert = () => store.updateIrAssumedState?.(irId, prev ?? 'unknown')
    }
    try { await sendDeviceCommand(entity, cmd, params) }
    catch (e) { revert?.(); addToast(e.message || i18nT('remote.commandFailed'), 'error') }
  }

  // Modes — HA's hvac_modes if available, else derived from IR learned commands
  const modes      = facts.hvacModes?.length ? facts.hvacModes : deriveIrModes(facts)
  const fanModes   = facts.fanModes?.length  ? facts.fanModes  : deriveIrFanModes(facts)
  const swingModes = facts.swingModes?.length ? facts.swingModes : (facts.isIr ? ['on', 'off'] : [])

  const upOk    = commandAvailable(entity, 'temp_up')
  const downOk  = commandAvailable(entity, 'temp_down')
  const powerOk = commandAvailable(entity, 'toggle')

  // Learned commands not consumed by the standard chips — e.g. eco, sleep,
  // ionizer, light, plus any user-defined custom commands. Rendered as
  // generic chips in the Extras row so the remote always reflects what's
  // actually learned.
  const extras    = extrasForRemote(entity, AC_REMOTE_CONSUMES)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'center' }}>

      {/* Temperature stepper — ▲ / temp / ▼ */}
      <TempStepper
        temp={displayTemp}
        hvacLabel={(HVAC_MODE_LABELS[facts.hvacMode] || facts.stateLabel || '').toUpperCase()}
        currentTemp={facts.currentTemp}
        upOk={upOk}
        downOk={downOk}
        accent={accent}
        onUp={() => fire('temp_up')}
        onDown={() => fire('temp_down')}
      />

      {/* Mode chips */}
      {modes.length > 0 && (
        <ModeRow
          items={modes}
          current={facts.hvacMode}
          renderLabel={(m) => HVAC_MODE_LABELS[m] || m}
          isEnabled={(m) => commandAvailable(entity, 'set_hvac_mode', { mode: m })}
          onPick={(m) => fire('set_hvac_mode', { mode: m })}
        />
      )}

      {/* Fan chips */}
      {caps.has('fan_mode') && fanModes.length > 0 && (
        <SubChipRow label={i18nT('remote.fanSpeedHeading')} items={fanModes} current={facts.fanMode}
          isEnabled={(m) => commandAvailable(entity, 'set_fan_mode', { mode: m })}
          onPick={(m) => fire('set_fan_mode', { mode: m })} />
      )}

      {/* Swing chips */}
      {caps.has('swing') && swingModes.length > 0 && (
        <SubChipRow label={i18nT('remote.swingHeading')} items={swingModes} current={facts.swingMode}
          isEnabled={(m) => commandAvailable(entity, 'set_swing_mode', { mode: m })}
          onPick={(m) => fire('set_swing_mode', { mode: m })} />
      )}

      {/* Preset chips */}
      {caps.has('preset') && facts.presetModes?.length > 0 && (
        <SubChipRow label={i18nT('remote.presetHeading')} items={facts.presetModes} current={facts.presetMode}
          isEnabled={(m) => commandAvailable(entity, 'set_preset_mode', { mode: m })}
          onPick={(m) => fire('set_preset_mode', { mode: m })} />
      )}

      {/* Extras — learned commands without dedicated UI (eco, sleep, custom…). */}
      {extras.length > 0 && (
        <ExtraChipRow label={i18nT('remote.extras')} items={extras} onPick={(id) => fire('ir_raw', { name: id })} />
      )}

      {/* Macros removed — IR power codes are toggles on most ACs, so
          a "Cool 22°" macro that starts with `power_on` flipped an
          already-on unit OFF. See the matching note in TVRemote. */}

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

      {/* Power footer — single toggle. Uses the discrete `power_on` /
          `power_off` codes when learned (via IR_COMMAND_MAP fallback chain),
          so this button rotates between on and off correctly. Assumed state
          is updated optimistically inside `fire()`. */}
      <button
        onClick={() => powerOk && fire('toggle')}
        disabled={!powerOk}
        title={powerOk ? '' : i18nT('remote.powerNotLearnedYet')}
        className="z-btn-primary"
        style={{
          width: '100%', height: 48, fontSize: 14, letterSpacing: '0.02em',
          background: facts.isOn ? 'var(--ink)' : 'var(--surface)',
          color: facts.isOn ? 'var(--bg)' : 'var(--ink)',
          border: facts.isOn ? 'none' : '0.5px solid var(--line)',
          opacity: powerOk ? 1 : 0.45,
          cursor: powerOk ? 'pointer' : 'not-allowed',
        }}
      >
        {facts.isOn ? i18nT('remote.turnOff') : i18nT('remote.turnOn')}
      </button>
    </div>
  )
}

// Generic chip row for the Extras / Macros sections. Same visual language as
// the SubChipRow but doesn't track an "active" selection (these are one-shot).
function ExtraChipRow({ label, items, onPick, accent }) {
  if (!items?.length) return null
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="z-eyebrow">{label}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((m) => {
          const id = typeof m === 'string' ? m : m.id
          const lbl = typeof m === 'string' ? m : m.label
          return (
            <button key={id} onClick={() => onPick(id)}
              style={{
                padding: '7px 12px', borderRadius: 9,
                background: 'var(--surface-2)',
                color: accent || 'var(--ink-2)',
                border: '0.5px solid var(--line)',
                fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                textTransform: 'capitalize',
              }}>{(lbl + '').replace(/_/g, ' ')}</button>
          )
        })}
      </div>
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

// ─── Stepper — big ▲ / temp / ▼ ────────────────────────────────────────────

function TempStepper({ temp, hvacLabel, currentTemp, upOk, downOk, accent, onUp, onDown }) {
  // Wide, low-profile arrows — full card width, ~80px tall. Icon stretched
  // horizontally so the chevron reads as a big tap target across the card.
  const arrowBtn = (enabled, Icon, onClick, label) => (
    <button
      onClick={() => enabled && onClick()}
      disabled={!enabled}
      aria-label={label}
      title={enabled ? label : `${label} not learned`}
      style={{
        width: '100%', maxWidth: 280, height: 72,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: enabled ? `color-mix(in srgb, ${accent} 14%, var(--surface))` : 'var(--surface)',
        color: enabled ? accent : 'var(--ink-ghost)',
        border: `0.5px solid ${enabled ? `color-mix(in srgb, ${accent} 30%, var(--line))` : 'var(--line)'}`,
        borderRadius: 16, cursor: enabled ? 'pointer' : 'not-allowed',
        opacity: enabled ? 1 : 0.45,
        touchAction: 'manipulation',
        padding: 0,
      }}
    >
      {/* Wide-but-not-huge chevron. Stretches to ~45% of the button width
          (capped via maxWidth on the button itself) and uses
          non-scaling-stroke so the line weight stays clean. */}
      <svg
        width="45%" height="40"
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        fill="none" stroke="currentColor" strokeWidth="3"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ display: 'block' }}
      >
        {Icon === ChevronUp
          ? <polyline points="6 24 50 8 94 24" vectorEffect="non-scaling-stroke" />
          : <polyline points="6 8 50 24 94 8" vectorEffect="non-scaling-stroke" />}
      </svg>
    </button>
  )
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {arrowBtn(upOk, ChevronUp, onUp, i18nT('remote.tempUpAria'))}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--ink)', lineHeight: 1 }}>
          {temp != null ? `${Math.round(temp)}°` : '—'}
        </div>
        <div className="z-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 6, letterSpacing: '0.06em' }}>
          {hvacLabel}
          {currentTemp != null ? ` · ${Math.round(currentTemp)}° NOW` : ''}
        </div>
      </div>
      {arrowBtn(downOk, ChevronDown, onDown, i18nT('remote.tempDownAria'))}
    </div>
  )
}

// ─── Chip rows ─────────────────────────────────────────────────────────────

function ModeRow({ items, current, renderLabel, isEnabled, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', width: '100%' }}>
      {items.map((m) => {
        const active  = current === m
        const enabled = isEnabled ? isEnabled(m) : true
        const Icon    = HVAC_MODE_ICONS[m]
        return (
          <button key={m}
            onClick={() => enabled && onPick(m)}
            disabled={!enabled}
            title={enabled ? '' : `${renderLabel(m)} not learned`}
            style={{
              padding: '9px 14px', borderRadius: 10,
              background: active ? 'var(--ink)' : 'var(--surface)',
              color: active ? 'var(--bg)' : 'var(--ink-2)',
              border: '0.5px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
              fontSize: 12, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6, textTransform: 'capitalize',
              opacity: enabled ? 1 : 0.4,
            }}>
            {Icon ? <Icon size={13} /> : null}
            {renderLabel(m)}
          </button>
        )
      })}
    </div>
  )
}

function SubChipRow({ label, items, current, isEnabled, onPick }) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="z-eyebrow">{label}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((m) => {
          const active  = current === m
          const enabled = isEnabled ? isEnabled(m) : true
          return (
            <button key={m}
              onClick={() => enabled && onPick(m)}
              disabled={!enabled}
              title={enabled ? '' : `${m} not learned`}
              style={{
                padding: '7px 12px', borderRadius: 9,
                background: active ? 'var(--ink)' : 'var(--surface-2)',
                color:      active ? 'var(--bg)'  : 'var(--ink-2)',
                border: '0.5px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
                fontSize: 11.5, fontWeight: 500, cursor: enabled ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                textTransform: 'capitalize',
                opacity: enabled ? 1 : 0.4,
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
      href="/actions"
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
      href="/actions"
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
  if (t.platform === 'sun' && t.event) return t.event === 'sunset' ? i18nT('remote.runsAtSunset') : i18nT('remote.runsAtSunrise')
  return null
}

export default ACRemote
