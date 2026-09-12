/**
 * DeviceCard — the single device tile/row used everywhere in Ziggy.
 *
 * Replaces six bespoke implementations:
 *   - Dashboard.ControlTile           → variant="tile"
 *   - Rooms.LightTile                 → variant="tile"   kind="light"
 *   - Rooms.ClimateRowCard            → variant="row"    kind="ac"
 *   - Rooms.MediaRowCard              → variant="row"    kind="tv"
 *   - Rooms.DeviceRow                 → variant="row"
 *   - Devices.DeviceCard / IRDeviceCard → variant="row"
 *
 * Three variants, one mental model:
 *   - "tile"    square card, dashboard quick controls & light grid
 *   - "row"     flex row, devices list & room detail
 *   - "compact" small inline chip, automation pickers
 *
 * Tap rules:
 *   - Tap toggle/inline control → fire the command (event.stopPropagation)
 *   - Tap the card body         → navigate to /devices/:entity_id
 *
 * Backend-agnostic: relies on lib/devices.js facts + sendDeviceCommand,
 * so an IR-AC and an HA-climate render identical inline affordances.
 */

import { useNavigate } from 'react-router-dom'
import { memo, useState } from 'react'
import {
  Power, Lightbulb, Sun, Tv2, Speaker, Snowflake, Wind, Wifi,
  DoorOpen, Lock as LockIcon, AlarmSmoke, Droplets, Activity, Camera,
  Thermometer, Plug, Square, ArrowUp, ArrowDown, Play, Pause,
  ChevronRight, Volume2, VolumeX, Cog, BatteryLow,
} from 'lucide-react'
import { deviceFacts, sendDeviceCommand, kindMeta, KIND, isLightKind, commandAvailable } from '../../lib/devices'
import { DeviceIcon } from '../../lib/deviceIcons'
import { useMotionOn } from '../../motion/flag'
import { useScrub } from '../../motion/gestures'
// See Slider.jsx: the controls that depend on these rules import them
// themselves, so a dropped @import can never take them out of the bundle.
import '../../motion/controls.css'
import { useUIStore } from '../../stores/uiStore'
import { useDeviceStore } from '../../stores/deviceStore'
import logger from '../../lib/logger'
import { useT, t as i18nT, useTranslatedName } from '../../lib/i18n'

// ─── Icon mapping ───────────────────────────────────────────────────────────
const KIND_ICONS = {
  light:        Lightbulb,
  switch:       Plug,
  plug:         Plug,
  tv:           Tv2,
  soundbar:     Speaker,
  projector:    Tv2,
  ac:           Snowflake,
  fan:          Wind,
  cover:        Square,
  lock:         LockIcon,
  alarm:        AlarmSmoke,
  vacuum:       Cog,
  humidifier:   Droplets,
  water_heater: Droplets,
  valve:        Droplets,
  lawn_mower:   Cog,
  camera:       Camera,
  motion:       Activity,
  door:         DoorOpen,
  window:       DoorOpen,
  leak:         Droplets,
  occupancy:    Activity,
  smoke:        AlarmSmoke,
  temperature:  Thermometer,
  humidity:     Droplets,
  power_meter:  Plug,
  binary:       Activity,
  sensor:       Activity,
  person:       Activity,
  unknown:      Cog,
}

function KindIcon({ kind, customIcon, size = 18, fill = true }) {
  // Delegates to the shared DeviceIcon so the live icon-style toggle (Emoji /
  // Line / 3D) applies here too. In emoji mode this is identical to before:
  // each kind in lib/devices.js (KIND_META) carries an emoji glyph. KIND_ICONS
  // (Lucide outlines) is kept around for any caller that explicitly wants the
  // line style.
  return <DeviceIcon kind={kind} customIcon={customIcon} size={size} fill={fill} />
}

// ─── Inline mini-controls ───────────────────────────────────────────────────

// 40×40 — comfortably above Apple's 28pt minimum without dominating a tile.
function ToggleButton({ facts, onClick, size = 'sm' }) {
  const dim = 40
  const enabled = commandAvailable(facts.entity, 'toggle')
  const motionOn = useMotionOn()
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (enabled) onClick() }}
      disabled={!enabled}
      aria-label={facts.isOn ? i18nT('deviceCard.turnOff') : i18nT('deviceCard.turnOn')}
      title={enabled ? '' : i18nT('deviceCard.powerNotLearned')}
      // The power button takes the hover ring: on a pointer-fine screen the
      // hit target is worth announcing before the click. Drawn as a
      // box-shadow in motion/controls.css, so the row cannot shift.
      data-motion-ring
      style={{
        width: dim, height: dim, borderRadius: 'var(--r-ctl)',
        background: facts.isOn ? 'var(--ink)' : 'var(--surface-2)',
        color:      facts.isOn ? 'var(--bg)'  : 'var(--ink-mute)',
        border: '0.5px solid ' + (facts.isOn ? 'var(--ink)' : 'var(--line)'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: enabled ? 'pointer' : 'not-allowed',
        // The ring arrives on this button's OWN press curve. Adding
        // box-shadow here rather than deleting the inline value keeps the
        // colour timing character-for-character what it is with the layer
        // off — an inline transition outranks the rule in controls.css, so
        // the two must not both try to own this property.
        transition: motionOn
          ? 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard), box-shadow var(--dur-press) var(--ease-standard)'
          : 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
        flexShrink: 0,
        opacity: enabled ? 1 : 0.4,
      }}
    >
      <Power size={size === 'lg' ? 20 : 18} strokeWidth={2} />
    </button>
  )
}

function TempStepper({ facts, onCommand }) {
  // Surface IR ac_memory temp as fallback for entities without HA target_temp.
  const irMemTemp = facts.entity?._irDevice?.ac_memory?.temp ?? null
  const t = facts.targetTemp ?? irMemTemp ?? facts.currentTemp
  const upOk   = commandAvailable(facts.entity, 'temp_up')
  const downOk = commandAvailable(facts.entity, 'temp_down')
  return (
    <div onClick={(e) => e.stopPropagation()} style={{
      display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
      background: 'var(--surface-2)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)',
      padding: 2,
    }}>
      <button onClick={() => downOk && onCommand('temp_down')} aria-label={i18nT('deviceCard.cooler')} disabled={!downOk}
        title={downOk ? '' : 'temp_down not learned'} style={iconBtn(40, !downOk)}><ArrowDown size={18} /></button>
      <span className="z-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', minWidth: 40, textAlign: 'center' }}>
        {t != null ? `${Math.round(t)}°` : '—'}
      </span>
      <button onClick={() => upOk && onCommand('temp_up')} aria-label={i18nT('deviceCard.warmer')} disabled={!upOk}
        title={upOk ? '' : 'temp_up not learned'} style={iconBtn(40, !upOk)}><ArrowUp size={18} /></button>
    </div>
  )
}

function PlayPauseButton({ facts, onCommand }) {
  const playing = facts.state === 'playing'
  const enabled = commandAvailable(facts.entity, 'play_pause')
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (enabled) onCommand('play_pause') }}
      disabled={!enabled}
      aria-label={playing ? i18nT('common.pause') : i18nT('common.play')}
      title={enabled ? '' : 'play/pause not learned'}
      data-motion-ring
      style={{
        width: 40, height: 40, borderRadius: '50%',
        background: 'var(--ink)', color: 'var(--bg)',
        border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: enabled ? 'pointer' : 'not-allowed', flexShrink: 0,
        opacity: enabled ? 1 : 0.4,
      }}
    >
      {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginInlineStart: 2 }} />}
    </button>
  )
}

function VolumeBars({ facts }) {
  if (facts.volume == null) return null
  const bars = 4
  const filled = Math.ceil((facts.volume / 100) * bars)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} style={{
          width: 3, height: 4 + i * 3, borderRadius: 1,
          background: i < filled ? 'var(--ink-2)' : 'var(--line-2)',
        }} />
      ))}
    </div>
  )
}

function CoverButtons({ onCommand }) {
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      <button onClick={() => onCommand('open')}  style={iconBtn(40)} aria-label={i18nT('common.open')}><ArrowUp size={18} /></button>
      <button onClick={() => onCommand('close')} style={iconBtn(40)} aria-label={i18nT('common.closed')}><ArrowDown size={18} /></button>
    </div>
  )
}

function StatusPill({ tone, label }) {
  const map = {
    on:    { bg: 'color-mix(in srgb, var(--info) 12%, var(--surface-2))', fg: 'var(--info)' },
    off:   { bg: 'var(--surface-2)', fg: 'var(--ink-mute)' },
    warn:  { bg: 'color-mix(in srgb, var(--warn) 12%, var(--surface-2))', fg: 'var(--warn-text)' },
    err:   { bg: 'color-mix(in srgb, var(--err) 12%, var(--surface-2))',  fg: 'var(--err-text)'  },
    ok:    { bg: 'color-mix(in srgb, var(--ok) 12%, var(--surface-2))',   fg: 'var(--ok-text)'   },
  }
  const c = map[tone] || map.off
  return (
    <span style={{
      padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500,
      background: c.bg, color: c.fg, lineHeight: '18px', flexShrink: 0, whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

function iconBtn(size, disabled = false) {
  return {
    width: size, height: size, borderRadius: 'var(--r-ctl)',
    background: 'transparent', border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
    opacity: disabled ? 0.35 : 1,
  }
}

// ─── Sensor-status tone resolution ──────────────────────────────────────────

function sensorTone(facts) {
  switch (facts.kind) {
    case KIND.MOTION:
    case KIND.OCCUPANCY:  return facts.state === 'on' ? 'on' : 'off'
    case KIND.DOOR:
    case KIND.WINDOW:     return facts.state === 'on' ? 'warn' : 'ok'
    case KIND.LEAK:
    case KIND.SMOKE:      return facts.state === 'on' ? 'err' : 'ok'
    default:              return 'off'
  }
}

// ─── Inline control picker — what shows on the right side of a card/row ────

function InlineControl({ facts, onCommand, variant }) {
  if (!facts.isAvailable) {
    return <StatusPill tone="warn" label={i18nT('common.unavailable')} />
  }

  // Read-only sensor kinds: just render value or status
  switch (facts.kind) {
    case KIND.MOTION:
    case KIND.OCCUPANCY:
    case KIND.DOOR:
    case KIND.WINDOW:
    case KIND.LEAK:
    case KIND.SMOKE:
      return <StatusPill tone={sensorTone(facts)} label={facts.stateLabel} />

    case KIND.TEMPERATURE:
    case KIND.HUMIDITY:
    case KIND.POWER_METER:
    case KIND.SENSOR:
      return <span className="z-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{facts.stateLabel}</span>

    case KIND.CAMERA:
      return <StatusPill tone="on" label={i18nT('cameras.live')} />

    case KIND.PERSON:
      return <StatusPill tone={facts.state === 'home' ? 'on' : 'off'} label={facts.stateLabel} />

    case KIND.LIGHT:
    case KIND.LAMP:
    case KIND.LED_STRIP:
    case KIND.SWITCH:
    case KIND.PLUG:
    case KIND.FAN:
    case KIND.HUMIDIFIER:
    case KIND.WATER_HEATER:
    case KIND.VALVE:
    case KIND.LAWN_MOWER:
      return <ToggleButton facts={facts} onClick={() => onCommand('toggle')} />

    case KIND.AC: {
      if (variant === 'tile') {
        return <ToggleButton facts={facts} onClick={() => onCommand('toggle')} />
      }
      // Arrows are always visible (not gated on isOn). For IR ACs, temp_up
      // / temp_down will power the unit on first if needed (backend
      // send_ac_temperature handles power-first). For HA ACs the same is
      // routed through HA's set_temperature path.
      return (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {facts.capabilities.has('temp') && <TempStepper facts={facts} onCommand={onCommand} />}
          <ToggleButton facts={facts} onClick={() => onCommand('toggle')} />
        </div>
      )
    }

    case KIND.TV:
    case KIND.SOUNDBAR:
    case KIND.PROJECTOR: {
      if (variant === 'tile') {
        return <ToggleButton facts={facts} onClick={() => onCommand('toggle')} />
      }
      // Always show the power toggle — previously it hid when the device was
      // on, leaving only play/pause and making it impossible to turn off from
      // the room view. Play/pause stays additive when the device supports it.
      return (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {facts.isOn && facts.capabilities.has('play_pause') && (
            <PlayPauseButton facts={facts} onCommand={onCommand} />
          )}
          <ToggleButton facts={facts} onClick={() => onCommand('toggle')} />
        </div>
      )
    }

    case KIND.COVER:
      return <CoverButtons onCommand={onCommand} />

    case KIND.LOCK:
      return <StatusPill tone={facts.state === 'locked' ? 'ok' : 'warn'} label={facts.stateLabel} />

    case KIND.ALARM:
      return <StatusPill tone={facts.isOn ? 'warn' : 'ok'} label={facts.stateLabel} />

    case KIND.VACUUM:
      return <ToggleButton facts={facts} onClick={() => onCommand(facts.isOn ? 'dock' : 'start')} />

    default:
      return null
  }
}

// ─── Tile variant ───────────────────────────────────────────────────────────

/**
 * Tile interaction model:
 *  - Tap                  → toggle on/off (or navigate if not toggleable)
 *  - Top-right arrow      → navigate to /devices/:id
 *
 * `dense` makes the tile smaller for 4-up rows (Dashboard quick controls).
 * Default 3-up sizing is used by the room page light grid.
 */
function TileCard({ facts, onCommand, onOpen, dense = false, tileStyle = 'tinted', pending = false }) {
  const isOnState    = facts.isOn
  const tint         = facts.tint
  const isToggleable = facts.meta.toggle && facts.isAvailable
  const deviceName   = useTranslatedName(facts.name)
  const motionOn     = useMotionOn()
  const [scrubValue, setScrubValue] = useState(null)

  // Two visual modes:
  //   'tinted'   — original behavior. Each device kind tints the whole tile
  //                with its own warm personality via facts.tint, mixed against
  //                --tile-base (theme-aware beige/brown). Subtle on/off
  //                gradation, never inverts. Default for everything except
  //                surfaces that explicitly opt in.
  //   'inverted' — home-page Dashboard behavior. Tile flips to var(--ink)/
  //                var(--bg) when on so a grid of active tiles reads as a
  //                bold status display, not a pastel control panel. Icon box
  //                picks up the accent tint, glyph keeps the kind tint for
  //                personality. Opt-in via the `tileStyle` prop; Rooms passes
  //                it through to align room-detail tiles with the home grid.
  //
  // Keeping both paths means the room-detail design can be flipped back to
  // the original tinted style by toggling a single constant in Rooms.jsx.
  let bg, fg, borderColor, iconColor, iconBg, subColor, arrowBg, arrowColor
  if (tileStyle === 'inverted') {
    bg          = isOnState ? 'var(--ink)'                                            : 'var(--surface)'
    fg          = isOnState ? 'var(--bg)'                                             : 'var(--ink)'
    borderColor = isOnState ? 'var(--ink)'                                            : 'var(--line)'
    iconBg      = isOnState ? 'color-mix(in srgb, var(--accent) 30%, transparent)'    : 'var(--surface-2)'
    iconColor   = isOnState ? tint                                                    : 'var(--ink-2)'
    subColor    = isOnState ? 'color-mix(in srgb, var(--bg) 70%, transparent)'        : 'var(--ink-faint)'
    arrowBg     = isOnState ? 'color-mix(in srgb, var(--bg) 14%, transparent)'        : 'var(--surface-2)'
    arrowColor  = isOnState ? 'var(--bg)'                                             : 'var(--ink-mute)'
  } else {
    // Tinted (original).
    bg          = isOnState
      ? `color-mix(in srgb, ${tint} 24%, var(--tile-base))`
      : `color-mix(in srgb, ${tint} 8%,  var(--tile-base))`
    borderColor = isOnState
      ? `color-mix(in srgb, ${tint} 36%, var(--line))`
      : `color-mix(in srgb, ${tint} 14%, var(--line))`
    fg          = 'var(--ink)'
    iconColor   = isOnState ? `color-mix(in srgb, ${tint} 80%, var(--ink))` : 'var(--ink-mute)'
    iconBg      = isOnState
      ? `color-mix(in srgb, ${tint} 36%, var(--tile-base))`
      : `color-mix(in srgb, ${tint} 14%, var(--tile-base))`
    subColor    = isOnState ? 'var(--ink-2)' : 'var(--ink-faint)'
    arrowBg     = isOnState
      ? `color-mix(in srgb, ${tint} 20%, var(--tile-base))`
      : `color-mix(in srgb, ${tint} 6%,  var(--tile-base))`
    arrowColor  = isOnState ? 'var(--ink)' : 'var(--ink-mute)'
  }

  const handleClick = (e) => {
    if (e.target?.closest('[data-tile-stop]')) return
    if (isToggleable) onCommand('toggle')
    else onOpen()
  }

  // Scrub-to-dim. A horizontal drag across a dimmable light's tile sets its
  // brightness without opening anything; a tap still toggles and a vertical
  // drag still belongs to the scroller. useScrub owns that three-way
  // disambiguation — this only says what the value means and when it is sent.
  // The command goes on release, never per frame: one radio call, not forty.
  // `brightness` is declared for every light-kind, IR included, so it is not on
  // its own a dimmability test. A light that is on and reports a level is one.
  const scrubbable = motionOn
    && isLightKind(facts.kind)
    && facts.isAvailable
    && facts.isOn
    && facts.brightness != null
    && commandAvailable(facts.entity, 'set_brightness')
  const scrub = useScrub({
    value: scrubValue ?? facts.brightness ?? 100,
    min: 1, max: 100, step: 5,
    enabled: scrubbable,
    onChange: setScrubValue,
    onCommit: (v) => { setScrubValue(null); onCommand('set_brightness', { value: v }) },
    onTap: handleClick,
  })
  const shownBrightness = scrubValue ?? facts.brightness

  // Dimensions per density. Dense is sized for the 4-col home grid; both
  // keep the name at Headline/Subhead size and the arrow at a 32px target
  // (above the 28pt minimum; 44 would dominate a 128px tile).
  const padding      = dense ? 10 : 12
  const minHeight    = dense ? 104 : 132
  const aspectRatio  = dense ? '1 / 1' : '1 / 1.05'
  const radius       = 'var(--r-card)'
  const iconBoxSize  = dense ? 28 : 34
  const iconSize     = dense ? 16 : 19
  const arrowSize    = 28
  const arrowOffset  = 8
  const nameSize     = dense ? 13 : 15
  const stateSize    = 12

  return (
    <button
      // While the tile is scrubbable the POINTER path belongs to useScrub —
      // it decides whether a press was a tap, a scrub or a scroll, and a
      // click firing as well would toggle the light at the end of every
      // drag. The keyboard path must survive that: Enter and Space on a
      // native button produce a click with `detail === 0`, which no pointer
      // ever does, so this keeps the tile operable without a keyboard-only
      // branch and without double-firing.
      onClick={scrubbable ? (e) => { if (e.detail === 0) handleClick(e) } : handleClick}
      {...(scrubbable ? scrub.handlers : null)}
      data-on={String(isOnState)}
      data-pending={pending ? 'true' : undefined}
      style={{
        position: 'relative', width: '100%',
        aspectRatio, minHeight,
        padding, borderRadius: radius,
        background: bg, color: fg,
        border: '0.5px solid ' + borderColor,
        textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        // THE TRAP: with the layer on, the shared `[data-on]` rule owns the
        // state transition (220ms in, 160ms out) and an inline transition
        // here would outrank it and silently kill the hook. Off, this is
        // character-for-character the value it has always had.
        ...(motionOn ? null : { transition: 'background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)' }),
        // A horizontal scrub has to beat the scroller to the gesture; a
        // vertical one still belongs to the page.
        ...(scrubbable ? { touchAction: 'pan-y' } : null),
      }}
    >
      <div data-motion-icon style={{
        width: iconBoxSize, height: iconBoxSize, borderRadius: 'var(--r-ctl)',
        background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: iconColor,
      }}>
        <KindIcon kind={facts.kind} size={iconSize} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {/* Name wraps to 2 lines max; the state line stays single-line. */}
        <div dir="auto" style={{
          fontSize: nameSize,
          fontWeight: 600, lineHeight: 1.2,
          letterSpacing: '-0.01em',
          overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          wordBreak: 'break-word' }}>
          {deviceName}
        </div>
        <div className="z-mono" style={{ fontSize: stateSize, lineHeight: '18px', color: subColor,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {facts.stateLabel}{shownBrightness != null && facts.isOn ? ` · ${shownBrightness}%` : ''}
        </div>
      </div>

      {/* Arrow to device detail */}
      <span
        data-tile-stop
        onClick={(e) => { e.stopPropagation(); onOpen() }}
        role="button"
        tabIndex={0}
        aria-label={i18nT('deviceCard.openDetails')}
        style={{
          position: 'absolute', top: arrowOffset, insetInlineEnd: arrowOffset,
          width: arrowSize, height: arrowSize, borderRadius: 'var(--r-ctl)',
          background: arrowBg,
          cursor: 'pointer',
          color: arrowColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <ChevronRight size={18} strokeWidth={2} className="icon-flip-rtl" />
      </span>
    </button>
  )
}

// ─── Row variant ────────────────────────────────────────────────────────────

function RowCard({ facts, onCommand, onOpen, dense = false, metrics = [], pending = false }) {
  const tint = facts.tint
  const deviceName = useTranslatedName(facts.name)
  const motionOn = useMotionOn()
  const iconBg = facts.isOn
    ? `color-mix(in srgb, ${tint} 14%, var(--surface-2))`
    : 'var(--surface-2)'
  const iconColor = facts.isOn ? tint : 'var(--ink-mute)'

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      className="z-card"
      data-on={String(facts.isOn)}
      data-pending={pending ? 'true' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: dense ? '8px 12px' : '12px 16px', minHeight: 48,
        cursor: 'pointer', borderRadius: 'var(--r-card)',
        // See TileCard: with the layer on the shared rules own the state
        // transition; off, this is exactly the value it has always had.
        ...(motionOn ? null : { transition: 'background var(--dur-press) var(--ease-standard)' }),
      }}
    >
      {/* Icon tile */}
      <div data-motion-icon style={{
        width: 40, height: 40, borderRadius: 'var(--r-ctl)',
        background: iconBg, color: iconColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <KindIcon kind={facts.kind} size={19} />
      </div>

      {/* Name + state + (optional) metric pills */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div dir="auto" className="z-headline" style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {deviceName}
        </div>
        <div className="z-mono z-subhead" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {secondaryLine(facts)}
        </div>
        <MetricPills metrics={metrics} />
      </div>

      {/* Inline primary control */}
      <InlineControl facts={facts} onCommand={onCommand} variant="row" />

      {/* Chevron to detail */}
      <ChevronRight size={18} strokeWidth={1.75} className="icon-flip-rtl" style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
    </div>
  )
}

function secondaryLine(facts) {
  const bits = []
  bits.push(facts.stateLabel)
  if (facts.brightness != null && isLightKind(facts.kind) && facts.isOn) bits.push(`${facts.brightness}%`)
  if (facts.kind === KIND.AC && facts.hvacMode && facts.isOn) bits.push(facts.hvacMode)
  if ((facts.kind === KIND.TV || facts.kind === KIND.SOUNDBAR) && facts.mediaTitle) bits.push(facts.mediaTitle)
  if (facts.kind === KIND.PERSON) return facts.stateLabel
  if (facts.isIr) bits.push('IR')
  else if (facts.hasIr) bits.push('IR + WiFi')
  if (!facts.isAvailable) bits.push(i18nT('common.unavailable'))
  return bits.join(' · ')
}

// Compact unit label for a metric pill. Some sensors report wonky units
// (kg/m²/s for power, J for energy); we don't try to be clever — surface
// the unit the device reports if any, otherwise fall back to a guess based on
// device_class so a numerically meaningful pill never reads as just "125".
const _METRIC_FALLBACK_UNITS = {
  power:           'W',
  current:         'A',
  voltage:         'V',
  energy:          'kWh',
  temperature:     '°',
  humidity:        '%',
  illuminance:     'lx',
  battery:         '%',
  signal_strength: 'dBm',
  duration:        'min',
}

function _fmtMetricValue(state) {
  if (state == null || state === 'unavailable' || state === 'unknown') return null
  const n = Number(state)
  if (!Number.isFinite(n)) return String(state)
  if (Math.abs(n) >= 100) return Math.round(n).toString()
  if (Math.abs(n) >= 10)  return n.toFixed(1).replace(/\.0$/, '')
  return n.toFixed(2).replace(/\.?0+$/, '')
}

function MetricPills({ metrics }) {
  if (!Array.isArray(metrics) || metrics.length === 0) return null
  const visible = metrics
    .map((m) => {
      const v = _fmtMetricValue(m.state)
      if (v == null) return null
      const unit = m.unit || _METRIC_FALLBACK_UNITS[m.device_class] || ''
      return { dc: m.device_class, value: v, unit }
    })
    .filter(Boolean)
    .slice(0, 3)
  if (visible.length === 0) return null
  return (
    <div className="z-mono" style={{
      display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, alignItems: 'center',
      fontSize: 12, lineHeight: '18px', color: 'var(--ink-mute)',
    }}>
      {visible.map((m, i) => (
        <span
          key={`${m.dc}-${i}`}
          title={m.dc}
          style={{
            padding: '2px 8px', borderRadius: 999,
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
            color: 'var(--ink-mute)', whiteSpace: 'nowrap',
          }}
        >
          {m.value}{m.unit ? (m.unit === '°' ? '°' : ` ${m.unit}`) : ''}
        </span>
      ))}
    </div>
  )
}

// ─── Compact variant — small chip for pickers ───────────────────────────────

function CompactCard({ facts, onCommand, onOpen, pending = false }) {
  const deviceName = useTranslatedName(facts.name)
  return (
    <button
      onClick={onOpen}
      className="z-chip"
      data-on={String(facts.isOn)}
      data-pending={pending ? 'true' : undefined}
      style={{ gap: 8, padding: '8px 12px', minHeight: 36, cursor: 'pointer' }}
    >
      <span data-motion-icon style={{ color: facts.isOn ? facts.tint : 'var(--ink-mute)', display: 'flex' }}>
        <KindIcon kind={facts.kind} size={16} />
      </span>
      <span dir="auto" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{deviceName}</span>
      <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{facts.stateLabel}</span>
    </button>
  )
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * DeviceCard — pass an `entity` (HA or IR-shaped). The card derives kind,
 * capabilities, inline controls, and tap routing from lib/devices.js.
 *
 * Props:
 *   entity   — required. When the entity is the primary of a multi-entity
 *              physical device, attach `_group` (built by deviceStore's
 *              getGroupedEntities) to surface the group name + metric pills.
 *   variant  — 'tile' | 'row' | 'compact'   (default 'row')
 *   onOpen   — optional override for tap (default: navigate /devices/:id)
 *   dense    — row variant: tighter padding
 */
function DeviceCardImpl({ entity, variant = 'row', onOpen, dense = false, tileStyle = 'tinted' }) {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [pending, setPending] = useState(false)

  if (!entity) return null
  const rawFacts = deviceFacts(entity)
  // When this entity is the primary of a real multi-entity group, prefer the
  // group's HA device-registry name (already suffix-cleaned by the backend
  // — e.g. "Switcher Boiler" instead of the primary entity's friendly name
  // "Switcher Boiler Power"). Solo entities pass through unchanged.
  const group = entity._group || null
  const facts = (group && group.name)
    ? { ...rawFacts, name: group.name }
    : rawFacts
  const groupMetrics = group?.metrics || []

  const open = () => {
    if (onOpen) return onOpen(facts)
    navigate(`/devices/${encodeURIComponent(facts.id)}`)
  }

  const onCommand = async (command, params) => {
    if (pending) return
    setPending(true)
    // One click → one log line, no matter how many internal calls follow.
    // Most users will only have logging at "off"; this is a no-op then.
    logger.click('DeviceCard', command, {
      entity_id: entity?.entity_id,
      ir_device: entity?._irDevice?.id,
      domain: entity?.domain,
      room: entity?.room,
      params,
    })

    // Optimistic update — flip the displayed state immediately so the tile
    // doesn't appear to "do nothing" while the HA round-trip completes.
    // Reverts if the call fails. WebSocket state_changed events overwrite
    // these once HA confirms (or corrects) the real value.
    const store = useDeviceStore.getState()
    let revert = null
    if (command === 'toggle' && facts.meta.toggle) {
      const nextState = facts.isOn ? 'off' : 'on'
      if (facts.isIr) {
        const irId = entity._irDevice?.id
        if (irId) {
          const prev = entity.assumed_state
          store.updateIrAssumedState(irId, nextState)
          revert = () => store.updateIrAssumedState(irId, prev ?? 'unknown')
        }
      } else {
        const prev = entity.state
        store.updateEntityState(entity.entity_id, nextState)
        revert = () => store.updateEntityState(entity.entity_id, prev)
      }
    }

    try {
      await sendDeviceCommand(entity, command, params)
      // No post-call verify: HA's REST POST already blocks until HA
      // commits the new state, and ha_subscriber broadcasts state_changed
      // (with full attributes) within ~10 ms of that commit. A second
      // getEntityState() round-trip would either return the SAME data the
      // WS event is about to deliver, or race ahead of it and read a
      // stale value from the same cache the WS is updating. Either way
      // it's wasted work on the user-perceived latency path. If WS is
      // disconnected, the optimistic state stays until reconnect — the
      // ha_connected banner already surfaces this.
    } catch (e) {
      revert?.()
      logger.error('device_command_failed', e, {
        entity_id: entity?.entity_id, command,
        reverted: !!revert,
      })
      addToast(e.message || i18nT('deviceCard.controlFailed'), 'error')
    } finally {
      setPending(false)
    }
  }

  if (variant === 'tile')    return <TileCard    facts={facts} onCommand={onCommand} onOpen={open} dense={dense} group={group} metrics={groupMetrics} tileStyle={tileStyle} pending={pending} />
  if (variant === 'compact') return <CompactCard facts={facts} onCommand={onCommand} onOpen={open} pending={pending} />
  return <RowCard facts={facts} onCommand={onCommand} onOpen={open} dense={dense} metrics={groupMetrics} pending={pending} />
}

// Memoize on entity reference + variant. updateEntityState preserves
// references for untouched entities, so a single light flicker no longer
// drags every other card on a room/devices page through a render. The
// touched card still re-renders because its `entity` is a fresh reference.
export const DeviceCard = memo(DeviceCardImpl, (prev, next) => (
  prev.entity    === next.entity   &&
  prev.variant   === next.variant  &&
  prev.dense     === next.dense    &&
  prev.onOpen    === next.onOpen   &&
  prev.tileStyle === next.tileStyle
))

export default DeviceCard
