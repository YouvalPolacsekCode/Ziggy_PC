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

// Mode tint drives the stepper's fill + arrow glyph (≥ 20px, so the raw
// status tokens are allowed). Never the brand accent: that is reserved for
// the page's one primary action.
const TINT_BY_MODE = {
  cool:     'var(--info)',
  heat:     'var(--warn)',
  dry:      'var(--ink-2)',
  fan_only: 'var(--ink-mute)',
  auto:     'var(--ok)',
  heat_cool:'var(--ok)',
  off:      'var(--ink-faint)',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center' }}>

      {/* Temperature stepper — ▲ / temp / ▼ */}
      <TempStepper
        temp={displayTemp}
        hvacLabel={HVAC_MODE_LABELS[facts.hvacMode] || facts.stateLabel || ''}
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
          width: '100%',
          opacity: powerOk ? 1 : 0.45,
          cursor: powerOk ? 'pointer' : 'not-allowed',
        }}
      >
        {facts.isOn ? i18nT('remote.turnOff') : i18nT('remote.turnOn')}
      </button>
    </div>
  )
}

// One chip style for every mode / fan / swing / preset / extra button:
// `.z-chip` type (13/500, capsule) stretched to a 44px target. Selected =
// surface-2 fill + ink text + 0.5px ink line — never inverted, never accent.
function chipStyle({ active = false, enabled = true } = {}) {
  return {
    minHeight: 44, padding: '0 16px', boxSizing: 'border-box',
    background: 'var(--surface-2)',
    color: active ? 'var(--ink)' : 'var(--ink-2)',
    border: '0.5px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
    fontWeight: active ? 600 : 500,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit', textTransform: 'capitalize',
    opacity: enabled ? 1 : 0.4,
    transition: 'border-color var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)',
  }
}

// Generic chip row for the Extras / Macros sections. Same visual language as
// the SubChipRow but doesn't track an "active" selection (these are one-shot).
function ExtraChipRow({ label, items, onPick }) {
  if (!items?.length) return null
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="z-eyebrow">{label}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {items.map((m) => {
          const id = typeof m === 'string' ? m : m.id
          const lbl = typeof m === 'string' ? m : m.label
          return (
            <button key={id} onClick={() => onPick(id)} className="z-chip" style={chipStyle()}>
              {(lbl + '').replace(/_/g, ' ')}
            </button>
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
        color: enabled ? accent : 'var(--ink-faint)',
        border: `0.5px solid ${enabled ? `color-mix(in srgb, ${accent} 30%, var(--line))` : 'var(--line)'}`,
        borderRadius: 'var(--r-card)', cursor: enabled ? 'pointer' : 'not-allowed',
        opacity: enabled ? 1 : 0.45,
        touchAction: 'manipulation',
        padding: 0,
        transition: 'background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)',
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
        <div className="z-display z-mono" style={{ color: 'var(--ink)' }}>
          {temp != null ? `${Math.round(temp)}°` : '—'}
        </div>
        <div className="z-mono" style={{ fontSize: 15, color: 'var(--ink-mute)', marginTop: 4 }}>
          {hvacLabel}
          {currentTemp != null ? ` · ${Math.round(currentTemp)}°${i18nT('remote.now')}` : ''}
        </div>
      </div>
      {arrowBtn(downOk, ChevronDown, onDown, i18nT('remote.tempDownAria'))}
    </div>
  )
}

// ─── Chip rows ─────────────────────────────────────────────────────────────

function ModeRow({ items, current, renderLabel, isEnabled, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', width: '100%' }}>
      {items.map((m) => {
        const active  = current === m
        const enabled = isEnabled ? isEnabled(m) : true
        const Icon    = HVAC_MODE_ICONS[m]
        return (
          <button key={m}
            onClick={() => enabled && onPick(m)}
            disabled={!enabled}
            aria-pressed={active}
            title={enabled ? '' : i18nT('remote.notLearned', { name: renderLabel(m) })}
            className="z-chip"
            style={chipStyle({ active, enabled })}>
            {Icon ? <Icon size={18} strokeWidth={1.75} /> : null}
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {items.map((m) => {
          const active  = current === m
          const enabled = isEnabled ? isEnabled(m) : true
          return (
            <button key={m}
              onClick={() => enabled && onPick(m)}
              disabled={!enabled}
              aria-pressed={active}
              title={enabled ? '' : i18nT('remote.notLearned', { name: m })}
              className="z-chip"
              style={chipStyle({ active, enabled })}>{(m + '').replace(/_/g, ' ')}</button>
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
      className="z-card"
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        minHeight: 56, padding: '8px 16px',
        textDecoration: 'none', cursor: 'pointer',
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 'var(--r-ctl)', flexShrink: 0,
        background: 'var(--surface-2)',
        color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Zap size={20} strokeWidth={1.75} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div dir="auto" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {trigger || automation.name}
        </div>
        <div dir="auto" style={{ fontSize: 15, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{automation.name}</div>
      </div>
      <ChevronRight size={18} strokeWidth={1.75} className="icon-flip-rtl" style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
    </a>
  )
}

// A suggestion is a nudge, not the page's primary action — it reads as a
// soft card in ink, with no accent tint.
function SuggestionCard({ suggestion }) {
  return (
    <a
      href="/actions"
      className="z-card-soft"
      style={{
        width: '100%', display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '12px 16px',
        textDecoration: 'none', cursor: 'pointer', color: 'var(--ink)',
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 'var(--r-ctl)', flexShrink: 0,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Sparkles size={20} strokeWidth={1.75} />
      </div>
      <div style={{ flex: 1, minWidth: 0, alignSelf: 'center' }}>
        <div dir="auto" style={{ fontSize: 17, color: 'var(--ink)', lineHeight: 1.3 }}>
          {suggestion.user_message}
          {suggestion.status === 'pending' && (
            <span style={{ fontWeight: 600 }}>{i18nT('remote.makeRoutine')}</span>
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
  if (t.platform === 'time' && t.at) return i18nT('remote.willRunAt', { when: t.at })
  if (t.type === 'time' && t.value) return i18nT('remote.willRunAt', { when: t.value })
  if (t.platform === 'sun' && t.event) return t.event === 'sunset' ? i18nT('remote.runsAtSunset') : i18nT('remote.runsAtSunrise')
  return null
}

export default ACRemote
