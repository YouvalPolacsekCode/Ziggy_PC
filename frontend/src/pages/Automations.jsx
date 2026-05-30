import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { Toggle } from '../components/ui/Toggle'
import { Input, Textarea } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EntitySelect, getActionsForDomain, getActionLabel } from '../components/ui/EntitySelect'
import { useAutomationStore } from '../stores/automationStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { CONTROLLABLE_DOMAINS } from '../lib/domainRegistry'
import { getAllRooms, getEntityState, getEntities, getAutomationTemplates, getSuggestedTemplates, getSuggestionsFeed, getDeviceCommands, getIrDevices, saveCircadianBundle, deleteCircadianBundle } from '../lib/api'
import { entityDisplayName } from '../lib/utils'
import IRDeviceSelect from '../components/IRDeviceSelect'
import MediaPlayActionEditor from '../components/media/MediaPlayActionEditor'
import { useFeature } from '../stores/featuresStore'
import { RoutinesListPanel } from './Routines'
import { useT, t as tStatic } from '../lib/i18n'

// Module-level cache so the Recommended-by-Ziggy block doesn't re-flash empty
// every time the user navigates away and back. SuggestedTemplates lives in
// local component state (no store), so its cache must live outside the render.
let suggestedTemplatesCache = null

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatRelativeTime(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return tStatic('automations.time.justNow')
  if (mins < 60) return tStatic('automations.time.mAgo', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return tStatic('automations.time.hAgo', { n: hrs })
  return tStatic('automations.time.dAgo', { n: Math.floor(hrs / 24) })
}

function getTriggerTypes() {
  return [
    { value: 'time',    label: tStatic('automations.triggerTime') },
    { value: 'state',   label: tStatic('automations.triggerState') },
    { value: 'zone',    label: tStatic('automations.triggerZone') },
    { value: 'sunrise', label: tStatic('automations.triggerSunrise') },
    { value: 'sunset',  label: tStatic('automations.triggerSunset') },
    { value: 'webhook', label: tStatic('automations.triggerWebhook') },
    // App-driven trigger — automation only runs when the user taps Run.
    // Used by Fake Occupancy and any other "start when I say so" automation.
    { value: 'manual',  label: tStatic('automations.triggerManual') },
  ]
}

function getTrackerTriggerStates() {
  return [
    { value: 'home',     label: tStatic('automations.trackerArrives') },
    { value: 'not_home', label: tStatic('automations.trackerLeaves') },
  ]
}

// `ziggy_intent` (Ziggy capabilities) is intentionally omitted here — it'll
// come back behind a feature flag as part of the broader capabilities project.
function getActionTypes(opts = {}) {
  const out = [
    { value: 'call_service',         label: tStatic('automations.actionCall') },
    { value: 'device_command',       label: tStatic('automations.actionCommand') },
    { value: 'ir_command',           label: tStatic('automations.actionIR') },
    { value: 'send_intent',          label: tStatic('automations.actionSendIntent') },
    { value: 'delay',                label: tStatic('automations.actionDelay') },
    { value: 'notify',               label: tStatic('automations.actionNotify') },
    // Multi-day "Away — Simulate Presence" activation. The wizard exposes
    // window/rooms/days/TV controls; the backend hands off to
    // services.fake_occupancy_scheduler once the user taps Run.
    { value: 'fake_occupancy_start', label: tStatic('automations.actionFakeOccupancy') },
    // Music playback (Spotify / YT Music). The ActionRow's type SELECT
    // hides this option when the media_music flag is off (opts.mediaMusic).
    // It's still in the lookup table so existing media_play steps render a
    // human label, even if the flag is currently off.
    ...(opts.mediaMusic === false ? [] : [{ value: 'media_play', label: tStatic('media.action.playMedia') }]),
  ]
  return out
}

// Keys to identify groups; localized labels resolved at render time
const SEND_INTENT_GROUPS = [
  { key: 'gLights',  items: ['Turn off all lights', 'Turn on the lights in [room]', 'Set brightness in [room] to 50%', 'Set lights in [room] to warm white'] },
  { key: 'gClimate', items: ['Set AC in [room] to 22 degrees', 'Turn on AC in [room]', 'Turn off AC in [room]', 'Set AC mode to cool in [room]'] },
  { key: 'gTvMedia', items: ['Turn on the TV in [room]', 'Turn off the TV in [room]', 'Set volume to 30 on TV in [room]'] },
  { key: 'gCovers',  items: ['Open the blinds in [room]', 'Close the blinds in [room]'] },
  { key: 'gGeneral', items: ['Turn off everything', 'Good night', 'Good morning'] },
]

const SENSOR_DOMAINS  = new Set(['sensor', 'binary_sensor'])
const TRACKER_DOMAINS = new Set(['person', 'device_tracker'])

function getBinarySensorTriggerStates() {
  return {
    door:        [{ value: 'on', label: tStatic('automations.bin.openTrigger') },     { value: 'off', label: tStatic('automations.bin.closeTrigger') }],
    window:      [{ value: 'on', label: tStatic('automations.bin.openTrigger') },     { value: 'off', label: tStatic('automations.bin.closeTrigger') }],
    opening:     [{ value: 'on', label: tStatic('automations.bin.openTrigger') },     { value: 'off', label: tStatic('automations.bin.closeTrigger') }],
    motion:      [{ value: 'on', label: tStatic('automations.bin.motionTrigger') },   { value: 'off', label: tStatic('automations.bin.motionClear') }],
    occupancy:   [{ value: 'on', label: tStatic('automations.bin.occupied') },        { value: 'off', label: tStatic('automations.bin.vacant') }],
    presence:    [{ value: 'on', label: tStatic('automations.bin.presenceTrigger') }, { value: 'off', label: tStatic('automations.bin.motionClear') }],
    moisture:    [{ value: 'on', label: tStatic('automations.bin.leakTrigger') },     { value: 'off', label: tStatic('automations.bin.leakClear') }],
    smoke:       [{ value: 'on', label: tStatic('automations.bin.smokeTrigger') },    { value: 'off', label: tStatic('automations.bin.motionClear') }],
    gas:         [{ value: 'on', label: tStatic('automations.bin.gasTrigger') },      { value: 'off', label: tStatic('automations.bin.motionClear') }],
    vibration:   [{ value: 'on', label: tStatic('automations.bin.vibrationTrigger') },{ value: 'off', label: tStatic('automations.bin.vibrationStops') }],
    connectivity:[{ value: 'on', label: tStatic('automations.bin.connects') },        { value: 'off', label: tStatic('automations.bin.disconnects') }],
    lock:        [{ value: 'on', label: tStatic('automations.bin.locksTrigger') },    { value: 'off', label: tStatic('automations.bin.unlocksTrigger') }],
  }
}

function getBinarySensorConditionStates() {
  return {
    door:        [{ value: 'on', label: tStatic('automations.bin.open') },           { value: 'off', label: tStatic('automations.bin.closed') }],
    window:      [{ value: 'on', label: tStatic('automations.bin.open') },           { value: 'off', label: tStatic('automations.bin.closed') }],
    opening:     [{ value: 'on', label: tStatic('automations.bin.open') },           { value: 'off', label: tStatic('automations.bin.closed') }],
    motion:      [{ value: 'on', label: tStatic('automations.bin.motionDetected') }, { value: 'off', label: tStatic('automations.bin.noMotion') }],
    occupancy:   [{ value: 'on', label: tStatic('automations.bin.occupiedNow') },    { value: 'off', label: tStatic('automations.bin.vacantNow') }],
    presence:    [{ value: 'on', label: tStatic('automations.bin.present') },        { value: 'off', label: tStatic('automations.bin.notPresent') }],
    moisture:    [{ value: 'on', label: tStatic('automations.bin.leakDetected') },   { value: 'off', label: tStatic('automations.bin.clear') }],
    smoke:       [{ value: 'on', label: tStatic('automations.bin.smokeDetected') },  { value: 'off', label: tStatic('automations.bin.clear') }],
    gas:         [{ value: 'on', label: tStatic('automations.bin.gasDetected') },    { value: 'off', label: tStatic('automations.bin.clear') }],
    vibration:   [{ value: 'on', label: tStatic('automations.bin.vibrating') },      { value: 'off', label: tStatic('automations.bin.still') }],
    connectivity:[{ value: 'on', label: tStatic('automations.bin.connected') },      { value: 'off', label: tStatic('automations.bin.disconnected') }],
    lock:        [{ value: 'on', label: tStatic('automations.bin.locked') },         { value: 'off', label: tStatic('automations.bin.unlocked') }],
  }
}

function getDefaultBinaryTrigger() {
  return [{ value: 'on', label: tStatic('automations.bin.turnsOn') }, { value: 'off', label: tStatic('automations.bin.turnsOff') }]
}
function getDefaultBinaryCondition() {
  return [{ value: 'on', label: tStatic('automations.bin.on') }, { value: 'off', label: tStatic('automations.bin.off') }]
}

function triggerSummary(trigger) {
  if (!trigger?.type) return tStatic('automations.summary.noTrigger')
  switch (trigger.type) {
    case 'time':    return trigger.time
      ? tStatic('automations.summary.everyDayAt', { time: trigger.time.slice(0, 5) })
      : tStatic('automations.summary.timeNoTime')
    case 'state': {
      let s = tStatic('automations.summary.whenBecomes', { entity: trigger.entity_id || tStatic('automations.summary.unknownDevice'), state: trigger.state || 'on/off' })
      if (trigger.for_minutes) s += ' ' + tStatic('automations.summary.forMinutes', { n: trigger.for_minutes })
      return s
    }
    case 'numeric_state': {
      const ent = trigger.entity_id || 'sensor'
      if (trigger.above !== undefined && trigger.above !== '') return tStatic('automations.summary.risesAbove', { entity: ent, value: trigger.above })
      if (trigger.below !== undefined && trigger.below !== '') return tStatic('automations.summary.dropsBelow', { entity: ent, value: trigger.below })
      return tStatic('automations.summary.crossesThreshold', { entity: ent })
    }
    case 'zone': {
      const who  = trigger.entity_id || 'person'
      const zone = (trigger.zone || 'zone.home').replace('zone.', '')
      return tStatic(trigger.event === 'leave' ? 'automations.summary.zoneLeaves' : 'automations.summary.zoneEnters', { who, zone })
    }
    case 'sunrise': return trigger.offset
      ? tStatic('automations.summary.sunriseOffset', { offset: trigger.offset })
      : tStatic('automations.summary.atSunrise')
    case 'sunset':  return trigger.offset
      ? tStatic('automations.summary.sunsetOffset', { offset: trigger.offset })
      : tStatic('automations.summary.atSunset')
    case 'webhook': return tStatic('automations.summary.webhook', { id: trigger.webhook_id || tStatic('automations.summary.noWebhookId') })
    case 'manual':  return tStatic('automations.summary.manual')
    default:        return trigger.type
  }
}

function actionSummary(action) {
  const unk = tStatic('automations.summary.unknownDevice')
  switch (action.type) {
    case 'call_service': return `${(action.service_value || action.service?.split('.')[1] || tStatic('automations.summary.control')).replace(/_/g, ' ')} ${action.entity_id || unk}`
    case 'device_command': {
      const svc = (action.command_id || '').split('.').slice(-1)[0] || tStatic('automations.summary.command')
      return `${svc.replace(/_/g, ' ')} ${action.entity_id || unk}`
    }
    case 'ir_command':   return `${action.ir_device_name || tStatic('automations.summary.irDevice')} → ${action.ir_sequence || action.ir_command || unk}`
    case 'send_intent':  return tStatic('automations.summary.commandLabel', { text: action.text || unk })
    case 'delay':        return tStatic('automations.summary.waitSeconds', { n: action.seconds || unk })
    case 'notify':       return tStatic('automations.summary.notifyLabel', { message: action.message || unk })
    case 'fake_occupancy_start': {
      const n   = (action.rooms || []).length
      const win = `${action.window_start || '19:00'}–${action.window_end || '23:00'}`
      const dys = action.duration_days || 7
      return tStatic('automations.summary.fakeOccupancy', { n, window: win, days: dys })
    }
    case 'media_play':   return tStatic('media.action.playMedia')
    default:             return action.type
  }
}

function conditionSummary(c) {
  if (c.type === 'time') {
    const parts = []
    if (c.after)  parts.push(tStatic('automations.summary.after',  { time: c.after  }))
    if (c.before) parts.push(tStatic('automations.summary.before', { time: c.before }))
    return parts.length
      ? tStatic('automations.summary.timeWindowParts', { parts: parts.join(' ' + tStatic('automations.summary.andJoin') + ' ') })
      : tStatic('automations.summary.timeWindow')
  }
  if (!c.entity_id) return tStatic('automations.summary.incomplete')
  const name = c.entity_id.split('.')[1]?.replace(/_/g, ' ') || c.entity_id
  const val = c.value || 'on'
  switch (c.operator) {
    case 'is':     return tStatic('automations.summary.cond.is',    { name, value: val })
    case 'is_not': return tStatic('automations.summary.cond.isNot', { name, value: val })
    case 'above':  return tStatic('automations.summary.cond.above', { name, value: c.value })
    case 'below':  return tStatic('automations.summary.cond.below', { name, value: c.value })
    default:       return c.entity_id
  }
}

const ACTION_TYPE_ICON = { call_service: '⚙', device_command: '✨', ir_command: '📡', send_intent: '💬', delay: '⏱', notify: '📣', fake_occupancy_start: '🌙', media_play: '🎵' }

const selectStyle = {
  width: '100%', height: 38, padding: '0 28px 0 10px',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 9, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
  outline: 'none', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.4)' d='M0 0h10L5 6z'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
}

// ── SendIntentEditor ──────────────────────────────────────────────────────────
function SendIntentEditor({ value, onChange }) {
  const t = useT()
  const [showTemplates, setShowTemplates] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <Input
          placeholder={t('automations.sendIntent.placeholder')}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ flex: 1 }}
          dir="auto"
        />
        <button onClick={() => setShowTemplates(v => !v)} style={{
          padding: '0 10px', borderRadius: 9,
          background: 'var(--bg-2)', border: '0.5px solid var(--line)',
          color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 14, flexShrink: 0,
        }}>📝</button>
      </div>
      {showTemplates && (
        <div style={{ borderRadius: 11, border: '0.5px solid var(--line)', overflow: 'hidden', background: 'var(--surface)' }}>
          {SEND_INTENT_GROUPS.map(({ key, items }) => (
            <div key={key}>
              <p className="z-eyebrow" style={{ padding: '8px 10px 4px' }}>{t(`automations.sendIntent.${key}`)}</p>
              {items.map(tpl => (
                <button key={tpl} onClick={() => { onChange(tpl); setShowTemplates(false) }}
                  style={{
                    display: 'block', width: '100%', padding: '6px 10px',
                    background: 'none', border: 'none', textAlign: 'left',
                    fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >{tpl}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
        {t('automations.sendIntent.replaceHint')}
      </p>
    </div>
  )
}

// ── NeedsInputFields ──────────────────────────────────────────────────────────
function NeedsInputFields({ fields, entityId, serviceData, onChangeServiceData }) {
  const t = useT()
  const [attrs, setAttrs] = useState({})
  useEffect(() => {
    if (!entityId || !fields.some(f => f.fetchKey)) return
    getEntityState(entityId).then(data => setAttrs(data.attributes || {})).catch(() => {})
  }, [entityId])
  return fields.map(({ key, label, placeholder, isNumber, fetchKey }) => {
    const options    = fetchKey ? (attrs[fetchKey] || []) : []
    const currentVal = (serviceData || {})[key] ?? ''
    if (fetchKey && options.length > 0) {
      return (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</label>
          <select style={selectStyle} value={currentVal} onChange={e => onChangeServiceData({ ...(serviceData || {}), [key]: e.target.value })}>
            <option value="">{t('automations.needs.pickLabel', { label })}</option>
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      )
    }
    if (fetchKey && !entityId) return (
      <p key={key} style={{ fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>{t('automations.needs.entityHint', { label: label.toLowerCase() })}</p>
    )
    return (
      <Input
        key={key}
        label={label}
        placeholder={fetchKey && entityId ? t('automations.needs.loading') : placeholder}
        type={isNumber ? 'number' : 'text'}
        value={currentVal}
        onChange={e => { const v = isNumber ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; onChangeServiceData({ ...(serviceData || {}), [key]: v }) }}
        dir={isNumber ? undefined : 'auto'}
      />
    )
  })
}

// ── MergedActionPicker ────────────────────────────────────────────────────────
function MergedActionPicker({ haActions, irDevice, haValue, onChangeHa, onPickIrCommand }) {
  const t = useT()
  const learned = new Set(irDevice?.learned_commands || [])
  const cmds    = irDevice?.commands || {}
  const irList  = Object.keys(cmds).filter(c => cmds[c] && learned.has(c))

  const handleChange = e => {
    const val = e.target.value
    if (val.startsWith('__ir__:')) onPickIrCommand(val.slice(7))
    else onChangeHa(val)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{t('automations.action.label')}</label>
      <select style={selectStyle} value={haValue} onChange={handleChange}>
        <optgroup label={t('automations.action.haGroup')}>
          {haActions.map(a => <option key={a.value} value={a.value}>{getActionLabel(a, t)}</option>)}
        </optgroup>
        {irList.length > 0 && (
          <optgroup label={t('automations.action.irGroup', { name: irDevice?.name })}>
            {irList.map(cmd => <option key={cmd} value={`__ir__:${cmd}`}>{cmd.replace(/_/g, ' ')}</option>)}
          </optgroup>
        )}
      </select>
      {irList.length > 0 && <p style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t('automations.action.irConvertHint')}</p>}
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────
const STEP_KEYS = ['stepName', 'stepTrigger', 'stepConditions', 'stepActions', 'stepReview']
const STEP_COUNT = STEP_KEYS.length

function StepIndicator({ current, onJump, maxReached = STEP_COUNT - 1 }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 20 }}>
      {STEP_KEYS.map((sKey, i) => {
        const s = t(`automations.wizard.${sKey}`)
        const enabled = onJump && i <= maxReached
        const isCurrent = i === current
        const isDone = i < current
        return (
          <div key={sKey} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={() => enabled && onJump(i)}
              disabled={!enabled}
              title={enabled ? t('automations.wizard.goTo', { step: s }) : t('automations.wizard.completePrev')}
              style={{
                width: 24, height: 24, borderRadius: '50%', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                background: isDone ? 'var(--ink)' : isCurrent ? `color-mix(in srgb, var(--ink) 12%, var(--surface))` : 'var(--bg-2)',
                color: isDone ? 'var(--bg)' : isCurrent ? 'var(--ink)' : 'var(--ink-faint)',
                border: isCurrent ? '1.5px solid var(--ink)' : '0.5px solid var(--line)',
                cursor: enabled ? 'pointer' : 'default',
              }}
            >
              {isDone ? '✓' : i + 1}
            </button>
            {i < STEP_COUNT - 1 && (
              <div style={{ width: 20, height: 1, background: i < current ? 'var(--ink)' : 'var(--line)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── ZoneTriggerEditor ─────────────────────────────────────────────────────────
function ZoneTriggerEditor({ trigger, onChange }) {
  const t = useT()
  const [zones, setZones] = useState([])
  useEffect(() => {
    getEntities('zone').then(r => {
      setZones((r.entities || r || []).filter(e => e.entity_id?.startsWith('zone.')))
    }).catch(() => {})
  }, [])

  // Build only the non-home zones — Home is the implied default and we don't
  // make the user pick "Home" out of a one-item dropdown.
  const extraZones = zones.filter(z => z.entity_id !== 'zone.home').map(z => ({
    value: z.entity_id,
    label: entityDisplayName(z),
  }))
  const zoneOptions = [
    { value: 'zone.home', label: t('automations.editor.zoneHome') },
    ...extraZones,
  ]

  // Default the trigger to home if nothing's chosen yet. Stored value never goes
  // empty so HA always gets a valid zone target.
  useEffect(() => {
    if (!trigger.zone) onChange({ ...trigger, zone: 'zone.home' })
  }, [])

  const eventOptions = [
    { value: 'enter', label: t('automations.editor.zoneEnter') },
    { value: 'leave', label: t('automations.editor.zoneLeave') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <EntitySelect
        label={t('automations.editor.zoneTrackLabel')}
        value={trigger.entity_id || ''}
        onChange={v => onChange({ ...trigger, entity_id: v })}
        allowedDomains={TRACKER_DOMAINS}
        placeholder={t('automations.editor.zoneTrackPh')}
      />
      {/* Zone is always shown — even with only Home available — so users
          discover they can add more zones in HA (the tip below explains how). */}
      <Select
        label={t('automations.editor.zoneLabel')}
        options={zoneOptions}
        value={trigger.zone || 'zone.home'}
        onChange={e => onChange({ ...trigger, zone: e.target.value })}
      />
      <Select
        label={t('automations.editor.stateWhen')}
        options={eventOptions}
        value={trigger.event || 'enter'}
        onChange={e => onChange({ ...trigger, event: e.target.value })}
      />

      {/* Tip: approaching home */}
      <div style={{
        padding: '10px 12px', borderRadius: 10,
        background: `color-mix(in srgb, var(--info) 6%, var(--surface))`,
        border: `0.5px solid color-mix(in srgb, var(--info) 25%, var(--line))`,
      }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--info)', marginBottom: 4 }}>
          {t('automations.editor.zoneBeforeTitle')}
        </p>
        <p style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
          {t('automations.editor.zoneBeforeBody')}
        </p>
      </div>
    </div>
  )
}

// Small helper: a one-line description below a field that explains what it does.
function FieldHint({ children }) {
  return (
    <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', lineHeight: 1.5, fontFamily: '"IBM Plex Mono", monospace' }}>
      {children}
    </p>
  )
}

// ── TriggerEditor ─────────────────────────────────────────────────────────────
function TriggerEditor({ trigger, onChange }) {
  const t = useT()
  const { entities } = useDeviceStore()
  // `numeric_state` is presented to the user as a sensor-aware variant of "Device
  // State" — same picker, but the controls swap to above/below + threshold when
  // a numeric sensor is selected.
  const effectiveType = trigger.type || 'time'
  const uiType = (effectiveType === 'numeric_state') ? 'state' : effectiveType
  const triggerDomain = trigger.entity_id?.split('.')?.[0] || null
  const triggerEntity = trigger.entity_id ? entities.find(e => e.entity_id === trigger.entity_id) : null
  const isTracker     = triggerDomain === 'person' || triggerDomain === 'device_tracker'
  const isNumericSensor = triggerDomain === 'sensor'
  const BINARY_SENSOR_TRIGGER_STATES = getBinarySensorTriggerStates()
  const DEFAULT_BINARY_TRIGGER = getDefaultBinaryTrigger()
  const stateOptions  = isTracker
    ? getTrackerTriggerStates()
    : (triggerDomain === 'binary_sensor' && triggerEntity?.device_class)
      ? (BINARY_SENSOR_TRIGGER_STATES[triggerEntity.device_class] || DEFAULT_BINARY_TRIGGER)
      : DEFAULT_BINARY_TRIGGER
  const unitHint = triggerEntity?.unit_of_measurement || ''

  const handleTypeChange = e => {
    const next = e.target.value
    // Reset to clean defaults when switching type
    if (next === 'zone')    onChange({ type: 'zone',    entity_id: '', zone: 'zone.home', event: 'enter' })
    else if (next === 'state')   onChange({ type: 'state',   entity_id: '', state: 'on' })
    else if (next === 'time')    onChange({ type: 'time',    time: '' })
    else if (next === 'webhook') onChange({ type: 'webhook', webhook_id: '' })
    else if (next === 'manual')  onChange({ type: 'manual' })
    else                         onChange({ ...trigger, type: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Select label={t('automations.triggerType')} options={getTriggerTypes()} value={uiType} onChange={handleTypeChange} />

      {uiType === 'time' && (
        <Input
          label={t('automations.editor.timeLabel')}
          type="time"
          // HA stores time as "HH:MM:SS"; <input type="time"> needs "HH:MM".
          // Slice defensively so edit-existing always shows the value.
          value={(trigger.time || '').slice(0, 5)}
          onChange={e => onChange({ ...trigger, type: 'time', time: e.target.value })}
        />
      )}

      {uiType === 'state' && (
        <>
          <EntitySelect
            label={t('automations.editor.entity')}
            value={trigger.entity_id || ''}
            onChange={v => {
              const dom = v?.split('.')?.[0]
              const isT = dom === 'person' || dom === 'device_tracker'
              const isN = dom === 'sensor'
              if (isN) {
                // Numeric sensor → switch to numeric_state with above threshold
                onChange({ type: 'numeric_state', entity_id: v, above: '', below: undefined })
              } else {
                onChange({ type: 'state', entity_id: v, state: isT ? 'home' : 'on', for_minutes: undefined, above: undefined, below: undefined })
              }
            }}
          />
          {trigger.entity_id && isNumericSensor && (
            <>
              <Select
                label={t('automations.editor.triggerWhen')}
                options={[
                  { value: 'above', label: t('automations.editor.risesAboveOpt') },
                  { value: 'below', label: t('automations.editor.dropsBelowOpt') },
                ]}
                value={trigger.below !== undefined && trigger.below !== '' && (trigger.above === undefined || trigger.above === '') ? 'below' : 'above'}
                onChange={e => {
                  // Switch operator: keep the existing numeric value but move
                  // it to the chosen side of the threshold.
                  const op = e.target.value
                  const v = trigger.above ?? trigger.below ?? ''
                  if (op === 'above') onChange({ type: 'numeric_state', entity_id: trigger.entity_id, above: v, below: undefined })
                  else                onChange({ type: 'numeric_state', entity_id: trigger.entity_id, above: undefined, below: v })
                }}
              />
              <Input
                label={unitHint ? t('automations.editor.thresholdUnit', { unit: unitHint }) : t('automations.editor.threshold')}
                type="number"
                placeholder={t('automations.editor.placeholderThreshold')}
                value={trigger.above ?? trigger.below ?? ''}
                onChange={e => {
                  const v = e.target.value === '' ? '' : Number(e.target.value)
                  const usingBelow = trigger.below !== undefined && trigger.below !== '' && (trigger.above === undefined || trigger.above === '')
                  if (usingBelow) onChange({ type: 'numeric_state', entity_id: trigger.entity_id, above: undefined, below: v })
                  else            onChange({ type: 'numeric_state', entity_id: trigger.entity_id, above: v, below: undefined })
                }}
              />
              <FieldHint>{t('automations.editor.thresholdHint')}</FieldHint>
            </>
          )}
          {trigger.entity_id && !isNumericSensor && (
            <>
              <Select
                label={isTracker ? t('automations.editor.stateWhen') : t('automations.editor.newState')}
                options={stateOptions}
                value={trigger.state || (isTracker ? 'home' : 'on')}
                onChange={e => onChange({ ...trigger, type: 'state', state: e.target.value })}
              />
              <Input
                label={t('automations.editor.stayForLabel')}
                type="number"
                placeholder={t('automations.editor.stayForPh')}
                value={trigger.for_minutes || ''}
                onChange={e => {
                  const v = e.target.value
                  onChange({ ...trigger, for_minutes: v ? parseInt(v) : undefined })
                }}
              />
            </>
          )}
        </>
      )}

      {uiType === 'zone' && (
        <ZoneTriggerEditor trigger={trigger} onChange={onChange} />
      )}

      {(uiType === 'sunrise' || uiType === 'sunset') && (
        <>
          <Input label={t('automations.editor.offsetLabel')} placeholder={t('automations.editor.offsetPh')} value={trigger.offset || ''} onChange={e => onChange({ ...trigger, offset: e.target.value })} />
          <FieldHint>
            {uiType === 'sunrise' ? t('automations.editor.offsetHintSunrise') : t('automations.editor.offsetHintSunset')}
          </FieldHint>
        </>
      )}

      {uiType === 'webhook' && (
        <>
          <Input label={t('automations.editor.webhookId')} placeholder={t('automations.editor.webhookPh')} value={trigger.webhook_id || ''} onChange={e => onChange({ ...trigger, webhook_id: e.target.value })} dir="auto" />
          <FieldHint>
            {t('automations.editor.webhookHint')}
          </FieldHint>
        </>
      )}

      {uiType === 'manual' && (
        <div style={{
          padding: '10px 12px', borderRadius: 10,
          background: `color-mix(in srgb, var(--info) 6%, var(--surface))`,
          border: `0.5px solid color-mix(in srgb, var(--info) 25%, var(--line))`,
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--info)', marginBottom: 4 }}>
            {t('automations.editor.manualTitle')}
          </p>
          <p style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
            {t('automations.editor.manualBody')}
          </p>
        </div>
      )}
    </div>
  )
}

function getConditionTypes() {
  return [
    { value: 'entity', label: tStatic('automations.cond.entityType') },
    { value: 'time',   label: tStatic('automations.cond.timeType') },
  ]
}

// State options for "controllable" non-binary entities (lights, switches, TVs, etc.)
// when used as a condition. Kept short — most users want simple is/is-not on/off.
function getControllableConditionStates() {
  const on  = tStatic('automations.bin.on')
  const off = tStatic('automations.bin.off')
  return {
    light:        [{ value: 'on', label: on }, { value: 'off', label: off }],
    switch:       [{ value: 'on', label: on }, { value: 'off', label: off }],
    fan:          [{ value: 'on', label: on }, { value: 'off', label: off }],
    input_boolean:[{ value: 'on', label: on }, { value: 'off', label: off }],
    media_player: [
      { value: 'playing', label: tStatic('automations.state.playing') },
      { value: 'paused',  label: tStatic('automations.state.paused') },
      { value: 'idle',    label: tStatic('automations.state.idle') },
      { value: 'off',     label: off },
      { value: 'on',      label: on },
    ],
    climate:      [
      { value: 'cool', label: tStatic('automations.state.cooling') },
      { value: 'heat', label: tStatic('automations.state.heating') },
      { value: 'auto', label: tStatic('automations.state.auto') },
      { value: 'off',  label: off },
    ],
    cover:        [{ value: 'open',   label: tStatic('automations.bin.open') },   { value: 'closed',   label: tStatic('automations.bin.closed') }],
    lock:         [{ value: 'locked', label: tStatic('automations.bin.locked') }, { value: 'unlocked', label: tStatic('automations.bin.unlocked') }],
  }
}

// ── ConditionRow ──────────────────────────────────────────────────────────────
// Visually aligned with TriggerEditor (plain controls, no warn tint) so steps 2
// and 3 of the wizard feel like the same form. A small AND chip is drawn above
// each condition (except the first) to make "all of these must be true" explicit.
function ConditionRow({ condition, onChange, onRemove }) {
  const t = useT()
  const { entities } = useDeviceStore()
  const condType    = condition.type || 'entity'
  const domain      = condition.entity_id?.split('.')?.[0] || null
  const entity      = condition.entity_id ? entities.find(e => e.entity_id === condition.entity_id) : null
  const deviceClass = entity?.device_class || null
  const isNumericSensor = domain === 'sensor'
  const isBinary    = domain === 'binary_sensor'
  const isTracker   = domain === 'person' || domain === 'device_tracker'
  // Controllable domains use a state dropdown (no operator), since "is not on"
  // is rarely what users want and adds noise.
  const controllableStates = getControllableConditionStates()[domain] || null
  const isSimpleControllable = !!controllableStates
  const unitHint = entity?.unit_of_measurement || ''
  const BINARY_SENSOR_CONDITION_STATES = getBinarySensorConditionStates()
  const DEFAULT_BINARY_CONDITION = getDefaultBinaryCondition()

  // For binary sensors / trackers we collapse operator+value into a single Select.
  // "Motion detected" / "No motion" already implies the operator, so showing
  // both is_not and on/off is redundant.
  const binaryStateOptions = isBinary
    ? (BINARY_SENSOR_CONDITION_STATES[deviceClass] || DEFAULT_BINARY_CONDITION)
    : []
  const trackerStateOptions = [
    { value: 'home',     label: t('automations.cond.isHome') },
    { value: 'not_home', label: t('automations.cond.isAway') },
  ]

  const sharedWrapper = (children) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="z-eyebrow">{t('automations.cond.title')}</p>
        <button onClick={onRemove} title={t('automations.cond.remove')} aria-label={t('automations.cond.remove')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 4 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
      <Select
        label={t('automations.cond.type')}
        options={getConditionTypes()}
        value={condType}
        onChange={e => {
          const next = e.target.value
          if (next === 'time') onChange({ type: 'time', after: '21:00', before: '07:00' })
          else onChange({ type: 'entity', entity_id: '', operator: 'is', value: 'on' })
        }}
      />
      {children}
    </div>
  )

  // ── Time window ───────────────────────────────────────────────────────────
  if (condType === 'time') {
    return sharedWrapper(
      <>
        <Input
          label={t('automations.cond.afterLabel')}
          type="time"
          value={(condition.after || '').slice(0, 5)}
          onChange={e => onChange({ ...condition, after: e.target.value })}
        />
        <Input
          label={t('automations.cond.beforeLabel')}
          type="time"
          value={(condition.before || '').slice(0, 5)}
          onChange={e => onChange({ ...condition, before: e.target.value })}
        />
        <FieldHint>{t('automations.cond.overnightHint')}</FieldHint>
      </>
    )
  }

  // ── Entity state ──────────────────────────────────────────────────────────
  return sharedWrapper(
    <>
      <EntitySelect
        label={t('automations.editor.entity')}
        value={condition.entity_id || ''}
        onChange={v => {
          const dom = v?.split('.')?.[0]
          const isT = dom === 'person' || dom === 'device_tracker'
          const isN = dom === 'sensor'
          onChange({
            ...condition,
            type: 'entity',
            entity_id: v,
            operator: isN ? 'above' : 'is',
            value: isT ? 'home' : (isN ? '' : 'on'),
          })
        }}
        placeholder={t('automations.cond.selectEntity')}
      />
      {condition.entity_id && (
        isNumericSensor ? (
          <>
            <Select
              options={[{ value: 'above', label: t('automations.cond.isAbove') }, { value: 'below', label: t('automations.cond.isBelow') }]}
              value={condition.operator || 'above'}
              onChange={e => onChange({ ...condition, operator: e.target.value })}
            />
            <Input
              label={unitHint ? t('automations.editor.thresholdUnit', { unit: unitHint }) : t('automations.editor.threshold')}
              type="number"
              placeholder={t('automations.editor.placeholderThreshold25')}
              value={condition.value ?? ''}
              onChange={e => onChange({ ...condition, value: e.target.value })}
            />
          </>
        ) : isBinary ? (
          // Binary sensors: a single Select that already implies is/is_not.
          // We always store operator: 'is' and let value carry the meaning.
          <Select
            label={t('automations.cond.stateLabel')}
            options={binaryStateOptions}
            value={condition.value || 'on'}
            onChange={e => onChange({ ...condition, operator: 'is', value: e.target.value })}
          />
        ) : isTracker ? (
          <Select
            label={t('automations.cond.stateLabel')}
            options={trackerStateOptions}
            value={condition.value || 'home'}
            onChange={e => onChange({ ...condition, operator: 'is', value: e.target.value })}
          />
        ) : isSimpleControllable ? (
          <>
            <Select
              options={[{ value: 'is', label: t('automations.cond.is') }, { value: 'is_not', label: t('automations.cond.isNot') }]}
              value={condition.operator || 'is'}
              onChange={e => onChange({ ...condition, operator: e.target.value })}
            />
            <Select
              label={t('automations.cond.stateLabel')}
              options={controllableStates}
              value={condition.value || controllableStates[0].value}
              onChange={e => onChange({ ...condition, value: e.target.value })}
            />
          </>
        ) : (
          // Fallback for unknown domains: free-form text value with operator.
          <>
            <Select
              options={[{ value: 'is', label: t('automations.cond.is') }, { value: 'is_not', label: t('automations.cond.isNot') }]}
              value={condition.operator || 'is'}
              onChange={e => onChange({ ...condition, operator: e.target.value })}
            />
            <Input
              label={t('automations.cond.stateValueLabel')}
              placeholder={t('automations.cond.stateValuePh')}
              value={condition.value ?? ''}
              onChange={e => onChange({ ...condition, value: e.target.value })}
              dir="auto"
            />
          </>
        )
      )}
    </>
  )
}

// Small AND chip drawn between consecutive conditions to make the implicit
// "all of these must be true" relationship visible.
function AndConnector() {
  const t = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      <span style={{
        fontSize: 9, padding: '2px 8px', borderRadius: 999,
        background: 'var(--surface-2)', color: 'var(--ink-faint)',
        fontFamily: '"IBM Plex Mono", monospace', fontWeight: 700, letterSpacing: '0.08em',
      }}>{t('automations.cond.and')}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}

// ── ActionRow ─────────────────────────────────────────────────────────────────
// Renders the full HA service catalog for a chosen entity. Backed by
// services/ha_capabilities (services/ha_capabilities.py) so every command
// HA exposes for the device becomes selectable in automations / routines —
// not just the curated `call_service` shortlist.
function DeviceCommandEditor({ value, onChange }) {
  const t = useT()
  const [commands, setCommands] = useState([])
  const [loading, setLoading] = useState(false)
  const entityId = value.entity_id || ''
  const commandId = value.command_id || ''
  const params = value.params || {}

  useEffect(() => {
    let cancelled = false
    if (!entityId) { setCommands([]); return }
    setLoading(true)
    getDeviceCommands(entityId)
      .then(r => { if (!cancelled) setCommands(r?.commands || []) })
      .catch(() => { if (!cancelled) setCommands([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [entityId])

  const selectedCmd = commands.find(c => c.id === commandId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <EntitySelect
        value={entityId}
        onChange={v => onChange({ entity_id: v, command_id: '', params: {} })}
        placeholder={t('automations.action.selectDevice')}
        allowedDomains={CONTROLLABLE_DOMAINS}
      />
      {entityId && (
        <Select
          value={commandId}
          onChange={e => onChange({ command_id: e.target.value, params: {} })}
          options={[
            { value: '', label: loading ? t('automations.action.loadingCommands') : t('automations.action.chooseCommand') },
            ...commands.map(c => ({
              value: c.id,
              label: c.source === 'ir' ? t('automations.action.commandIRSuffix', { label: c.label }) : c.label,
            })),
          ]}
        />
      )}
      {selectedCmd && (selectedCmd.fields || []).map(f => (
        <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            {f.label}{f.required ? ' *' : ''}
          </span>
          {f.kind === 'number' ? (
            <Input
              type="number" min={f.min} max={f.max} step={f.step}
              value={params[f.name] ?? f.default ?? ''}
              placeholder={f.description || f.label}
              onChange={e => onChange({ params: { ...params, [f.name]: e.target.value === '' ? null : Number(e.target.value) } })}
            />
          ) : f.kind === 'select' ? (
            <Select
              value={params[f.name] ?? f.default ?? ''}
              onChange={e => onChange({ params: { ...params, [f.name]: e.target.value } })}
              options={[{ value: '', label: t('automations.action.selectPlaceholder') }, ...((f.options || []).map(o => {
                const v = typeof o === 'object' ? (o.value ?? o.label) : o
                const l = typeof o === 'object' ? (o.label ?? o.value) : o
                return { value: v, label: l }
              }))]}
            />
          ) : f.kind === 'boolean' ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={Boolean(params[f.name] ?? f.default ?? false)}
                onChange={e => onChange({ params: { ...params, [f.name]: e.target.checked } })}
              />
              <span style={{ fontSize: 12 }}>{f.label}</span>
            </label>
          ) : (
            <Input
              value={params[f.name] ?? f.default ?? ''}
              placeholder={f.description || f.label}
              onChange={e => onChange({ params: { ...params, [f.name]: e.target.value } })}
              dir="auto"
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ── FakeOccupancyEditor ───────────────────────────────────────────────────────
// Editor for the `fake_occupancy_start` step. Lets the user pick which rooms
// (their dimmable lights) to cycle, the active window, brightness, an optional
// TV blaster, and how many days to run. The saved step shape mirrors what
// services.fake_occupancy_scheduler.start() expects:
//   { type: 'fake_occupancy_start', window_start, window_end, duration_days,
//     rooms: [{id, entity_id}], tv_ir_device_id, brightness_pct }
function FakeOccupancyEditor({ action, onChange }) {
  const t = useT()
  const { entities, ziggyRooms } = useDeviceStore()
  const [irDevices, setIrDevices] = useState([])
  const [loadingIr, setLoadingIr] = useState(true)

  useEffect(() => {
    getIrDevices()
      .then(arr => setIrDevices((arr || []).filter(d => (d.type || '').toLowerCase() === 'tv')))
      .catch(() => setIrDevices([]))
      .finally(() => setLoadingIr(false))
  }, [])

  // Build the (room → first dimmable light) candidate list. ziggyRooms carries
  // each room's devices; dimmable lights expose a `brightness` attribute.
  const candidates = useMemo(() => {
    const out = []
    const seen = new Set()
    for (const room of ziggyRooms || []) {
      for (const dev of room.devices || []) {
        const eid = dev.entity_id
        if (!eid || !eid.startsWith('light.')) continue
        const ent = entities.find(e => e.entity_id === eid)
        const attrs = ent?.attributes || {}
        if (!('brightness' in attrs)) continue
        if (seen.has(room.id)) continue
        seen.add(room.id)
        out.push({ id: room.id, name: room.name, entity_id: eid })
        break
      }
    }
    return out
  }, [ziggyRooms, entities])

  const selectedRoomIds = new Set((action.rooms || []).map(r => r.id))

  const toggleRoom = (room) => {
    const next = selectedRoomIds.has(room.id)
      ? (action.rooms || []).filter(r => r.id !== room.id)
      : [...(action.rooms || []), { id: room.id, entity_id: room.entity_id }]
    onChange({ ...action, rooms: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        padding: '10px 12px', borderRadius: 10,
        background: `color-mix(in srgb, var(--info) 6%, var(--surface))`,
        border: `0.5px solid color-mix(in srgb, var(--info) 25%, var(--line))`,
      }}>
        <p style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
          {t('automations.fakeOccupancy.intro')}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          label={t('automations.fakeOccupancy.windowStart')}
          type="time"
          value={(action.window_start || '19:00').slice(0, 5)}
          onChange={e => onChange({ ...action, window_start: e.target.value })}
        />
        <Input
          label={t('automations.fakeOccupancy.windowEnd')}
          type="time"
          value={(action.window_end || '23:00').slice(0, 5)}
          onChange={e => onChange({ ...action, window_end: e.target.value })}
        />
      </div>

      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
          {t('automations.fakeOccupancy.roomsLabel')}
        </p>
        {candidates.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
            {t('automations.fakeOccupancy.noRooms')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {candidates.map(c => {
              const sel = selectedRoomIds.has(c.id)
              return (
                <button key={c.id} type="button" onClick={() => toggleRoom(c)} style={{
                  padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                  background: sel ? 'var(--ink)' : 'var(--surface)',
                  color: sel ? 'var(--bg)' : 'var(--ink-mute)',
                  border: sel ? 'none' : '0.5px solid var(--line)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>{c.name}</button>
              )
            })}
          </div>
        )}
        <FieldHint>{t('automations.fakeOccupancy.roomsHint')}</FieldHint>
      </div>

      <Input
        label={t('automations.fakeOccupancy.durationDays')}
        type="number"
        min={1}
        max={60}
        value={action.duration_days ?? 7}
        onChange={e => onChange({ ...action, duration_days: Math.max(1, parseInt(e.target.value || '1')) })}
      />

      <Input
        label={t('automations.fakeOccupancy.brightnessPct')}
        type="number"
        min={10}
        max={100}
        value={action.brightness_pct ?? 70}
        onChange={e => onChange({ ...action, brightness_pct: Math.max(10, Math.min(100, parseInt(e.target.value || '70'))) })}
      />

      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
          {t('automations.fakeOccupancy.tvLabel')}
        </p>
        {loadingIr ? (
          <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('irDeviceSelect.loading')}</p>
        ) : irDevices.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
            {t('automations.fakeOccupancy.noTV')}
          </p>
        ) : (
          <Select
            options={[
              { value: '', label: t('automations.fakeOccupancy.tvNone') },
              ...irDevices.map(d => ({ value: d.id, label: `${d.name}${d.room ? ` (${d.room.replace(/_/g, ' ')})` : ''}` })),
            ]}
            value={action.tv_ir_device_id || ''}
            onChange={e => onChange({ ...action, tv_ir_device_id: e.target.value || null })}
          />
        )}
        <FieldHint>{t('automations.fakeOccupancy.tvHint')}</FieldHint>
      </div>
    </div>
  )
}

function ActionRow({ action, index, onChange, onRemove, collapsed, onToggleCollapse, dragHandleProps }) {
  const t = useT()
  const mediaMusic = useFeature('media_music')
  const { entities } = useDeviceStore()
  const domain = action.entity_id?.split('.')?.[0] || null
  const availableActions = domain ? getActionsForDomain(domain) : [{ value: 'turn_on', label: t('automations.fallback.turnOn') }, { value: 'turn_off', label: t('automations.fallback.turnOff') }, { value: 'toggle', label: t('automations.fallback.toggle') }]
  const linkedIr = entities.find(e => e.entity_id === action.entity_id)?._linkedIr || null

  // Neutral look matching the Trigger / Conditions steps — no info tint, plain
  // surface + hairline. The drag handle and the small numeric badge are kept
  // because reordering and "step N" labelling carry real meaning here.
  if (collapsed) {
    return (
      <div onClick={onToggleCollapse} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px', borderRadius: 10,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        cursor: 'pointer',
      }}>
        <span style={{ color: 'var(--ink-faint)', cursor: 'grab', display: 'flex', touchAction: 'none' }} onClick={e => e.stopPropagation()} {...dragHandleProps}>
          <svg width="12" height="16" viewBox="0 0 9 13" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/><circle cx="2" cy="6.5" r="1.1"/><circle cx="7" cy="6.5" r="1.1"/><circle cx="2" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>
        </span>
        <span style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          background: 'var(--bg-2)', color: 'var(--ink-mute)',
          fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"IBM Plex Mono", monospace',
        }}>
          {index + 1}
        </span>
        <span style={{ fontSize: 13, flexShrink: 0 }}>{ACTION_TYPE_ICON[action.type] || '•'}</span>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {actionSummary(action)}
        </span>
        <button onClick={e => { e.stopPropagation(); onRemove() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    )
  }

  return (
    <div style={{
      border: '0.5px solid var(--line)',
      borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
      background: 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--ink-faint)', cursor: 'grab', touchAction: 'none' }} {...dragHandleProps}>
            <svg width="12" height="16" viewBox="0 0 9 13" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/><circle cx="2" cy="6.5" r="1.1"/><circle cx="7" cy="6.5" r="1.1"/><circle cx="2" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>
          </span>
          <p className="z-eyebrow">{t('automations.wizard.actionLabel', { n: index + 1 })}</p>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onToggleCollapse} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'inherit', padding: '4px 8px', borderRadius: 7 }}>{t('automations.wizard.collapse')}</button>
          <button onClick={onRemove} aria-label={t('automations.removeStep')} title={t('automations.removeStep')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 4 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </div>

      <Select options={getActionTypes({ mediaMusic })} value={action.type || 'call_service'} onChange={e => {
        const nextType = e.target.value
        // Seed sensible defaults for the few step types that have a dedicated
        // editor — otherwise the editor opens with empty fields and the user
        // has to remember every required param themselves.
        if (nextType === 'fake_occupancy_start') {
          onChange({ type: nextType, window_start: '19:00', window_end: '23:00', duration_days: 7, brightness_pct: 70, rooms: [], tv_ir_device_id: null })
        } else if (nextType === 'media_play') {
          onChange({ type: nextType, speaker_entity: '', service: 'spotify', profile: '', mode: 'playlist' })
        } else {
          onChange({ type: nextType, entity_id: '', service: '' })
        }
      }} />

      {action.type === 'ir_command' && <IRDeviceSelect value={action} onChange={patch => onChange({ ...action, ...patch })} />}

      {action.type === 'call_service' && (
        <>
          <EntitySelect value={action.entity_id || ''} onChange={v => onChange({ ...action, entity_id: v, service: 'homeassistant.turn_on', service_value: 'turn_on', service_data: undefined })} placeholder={t('automations.action.selectEntity')} allowedDomains={CONTROLLABLE_DOMAINS} />
          {linkedIr && action.entity_id ? (
            <MergedActionPicker
              haActions={availableActions}
              irDevice={linkedIr}
              haValue={action.service_value || action.service?.split('.')[1] || 'turn_on'}
              onChangeHa={val => { const def = availableActions.find(a => a.value === val) || {}; onChange({ ...action, service_value: val, service: `homeassistant.${def.haService || val}`, service_data: def.serviceData || undefined }) }}
              onPickIrCommand={cmd => onChange({ ...action, type: 'ir_command', ir_device_id: linkedIr.id, ir_device_name: linkedIr.name, ir_command: cmd, ir_sequence: undefined, service: undefined, service_value: undefined, service_data: undefined })}
            />
          ) : (
            <Select
              options={availableActions.map(a => ({ ...a, label: getActionLabel(a, t) }))}
              value={action.service_value || action.service?.split('.')[1] || 'turn_on'}
              onChange={e => { const sel = e.target.value; const def = availableActions.find(a => a.value === sel) || {}; onChange({ ...action, service_value: sel, service: `homeassistant.${def.haService || sel}`, service_data: def.serviceData || undefined }) }}
            />
          )}
          {(() => {
            const selVal = action.service_value || action.service?.split('.')[1] || 'turn_on'
            const def = availableActions.find(a => a.value === selVal)
            return def?.needsInput ? (
              <NeedsInputFields fields={def.needsInput} entityId={action.entity_id} serviceData={action.service_data} onChangeServiceData={data => onChange({ ...action, service_data: data })} />
            ) : null
          })()}
        </>
      )}

      {action.type === 'send_intent' && <SendIntentEditor value={action.text || ''} onChange={text => onChange({ ...action, text })} />}
      {action.type === 'delay'       && <Input type="number" placeholder={t('automations.action.secondsPh')} value={action.seconds || ''} onChange={e => onChange({ ...action, seconds: parseInt(e.target.value) })} />}
      {action.type === 'notify'      && <Input placeholder={t('automations.action.messagePh')} value={action.message || ''} onChange={e => onChange({ ...action, message: e.target.value })} dir="auto" />}
      {action.type === 'device_command' && <DeviceCommandEditor value={action} onChange={patch => onChange({ ...action, ...patch })} />}
      {action.type === 'fake_occupancy_start' && <FakeOccupancyEditor action={action} onChange={patch => onChange(patch)} />}
      {action.type === 'media_play' && mediaMusic && <MediaPlayActionEditor action={action} onChange={onChange} />}
    </div>
  )
}

function DraggableActionRow({ action, index, onChange, onRemove, collapsed, onToggleCollapse }) {
  const controls = useDragControls()
  return (
    <Reorder.Item value={action} dragControls={controls} dragListener={false} style={{ listStyle: 'none' }}>
      <ActionRow action={action} index={index} onChange={onChange} onRemove={onRemove} collapsed={collapsed} onToggleCollapse={onToggleCollapse} dragHandleProps={{ onPointerDown: e => controls.start(e) }} />
    </Reorder.Item>
  )
}

// A condition is "complete enough" to surface in summaries if it has an entity
// (entity-state condition) or a time bound (time-window condition).
function isCompleteCondition(c) {
  if (!c) return false
  if (c.type === 'time') return !!(c.after || c.before)
  return !!c.entity_id
}

// ── ReviewPanel ───────────────────────────────────────────────────────────────
function ReviewPanel({ name, description, trigger, conditions = [], actions }) {
  const t = useT()
  const completeConditions = conditions.filter(isCompleteCondition)
  const triggerType = trigger?.type || 'time'
  // numeric_state is presented as the "Device State" trigger family.
  const triggerLabel = getTriggerTypes().find(tt => tt.value === (triggerType === 'numeric_state' ? 'state' : triggerType))?.label
  const actionTypes = getActionTypes()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-2)', border: '0.5px solid var(--line)' }}>
        <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15, marginBottom: 4 }} dir="auto">{name || t('automations.wizard.noName')}</p>
        {description && <p style={{ fontSize: 13, color: 'var(--ink-mute)' }} dir="auto">{description}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 999,
            background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)',
            fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace',
          }}>
            {triggerLabel}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{triggerSummary(trigger)}</span>
        </div>
      </div>
      {completeConditions.length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.summary.conditionsCount', { n: completeConditions.length })}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {completeConditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: `0.5px solid var(--line)`, background: 'var(--surface)' }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>🔍</span>
                <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{conditionSummary(c)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {actions.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-faint)', textAlign: 'center', padding: '12px 0', fontStyle: 'italic' }}>{t('automations.action.noActions')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p className="z-eyebrow">{t(actions.length === 1 ? 'automations.action.actionsHeadingOne' : 'automations.action.actionsHeading', { n: actions.length })}</p>
          {actions.map((a, i) => (
            <div key={a._key || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1, background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"IBM Plex Mono", monospace' }}>{i + 1}</span>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{actionTypes.find(at => at.value === a.type)?.label || a.type}</p>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"IBM Plex Mono", monospace' }}>{actionSummary(a)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CircadianBundleWizard ─────────────────────────────────────────────────────
// Dedicated wizard for the "Smart Light Schedule" suggestion (D1). The
// regular AutomationWizard speaks the single-trigger/single-action schema;
// circadian is 4 HA automations under the hood, so this wizard renders only
// the two user-tunable knobs (lights + bedtime) and POSTs to the dedicated
// /api/automations/circadian-bundle endpoint via saveCircadianBundle().
//
// Lights pool comes from initial.defaults.lights (server-pre-filtered to
// has_color_temp_light). Falling back to filtering the live deviceStore
// covers the edit flow where the wizard reopens on an existing bundle.
function CircadianBundleWizard({ initial, onSaved, onClose }) {
  const t = useT()
  const { entities } = useDeviceStore()

  const candidateLights = useMemo(() => {
    const fromPrefill = (initial?.defaults?.lights || initial?.lights || []).filter(Boolean)
    if (fromPrefill.length > 0) return fromPrefill
    return (entities || [])
      .filter(e => {
        if (!e?.entity_id?.startsWith('light.')) return false
        const a = e.attributes || {}
        const modes = a.supported_color_modes || []
        return modes.includes('color_temp')
          || 'color_temp' in a || 'color_temp_kelvin' in a
          || a.min_color_temp_kelvin != null || a.max_color_temp_kelvin != null
          || a.min_mireds != null || a.max_mireds != null
      })
      .map(e => e.entity_id)
  }, [initial, entities])

  const [selected, setSelected] = useState(() => {
    const pre = initial?.selectedLights || initial?.defaults?.lights || candidateLights
    return new Set(pre)
  })
  const [bedtime, setBedtime] = useState(initial?.defaults?.bedtime || initial?.bedtime || '22:00')
  const [saving, setSaving]   = useState(false)
  const [error,  setError]    = useState(null)

  const toggle = (eid) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(eid)) next.delete(eid); else next.add(eid)
    return next
  })

  const isUpdate = !!initial?._isInstalled
  const noLights = candidateLights.length === 0
  const canSave  = !noLights && selected.size > 0 && /^\d{2}:\d{2}$/.test(bedtime) && !saving

  const handleConfirm = async () => {
    setSaving(true); setError(null)
    try {
      await saveCircadianBundle({ lights: Array.from(selected), bedtime })
      await onSaved?.({ updated: isUpdate })
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.circadian.failed'))
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setSaving(true); setError(null)
    try {
      await deleteCircadianBundle()
      await onSaved?.({ removed: true })
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.circadian.failed'))
      setSaving(false)
    }
  }

  const labelFor = (eid) => entityDisplayName(entities?.find(e => e.entity_id === eid)) || eid

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }}>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
        {t('automations.circadian.subtitle')}
      </p>

      {/* Lights multi-select (color-temp lights only) */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.circadian.lights')}</p>
        {noLights ? (
          <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }}>
            {t('automations.circadian.noLights')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
            {candidateLights.map(eid => {
              const checked = selected.has(eid)
              return (
                <button
                  key={eid}
                  type="button"
                  onClick={() => toggle(eid)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8,
                    background: checked ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${checked ? 'var(--ok)' : 'var(--line)'}`,
                    background: checked ? 'var(--ok)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {checked && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12l5 5L20 6"/>
                      </svg>
                    )}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{labelFor(eid)}</span>
                </button>
              )
            })}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.45 }}>
          {t('automations.circadian.lightsHelp')}
        </p>
      </div>

      {/* Bedtime */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.circadian.bedtime')}</p>
        <Input
          type="time"
          value={bedtime}
          onChange={e => setBedtime(e.target.value)}
          style={{ maxWidth: 140 }}
        />
        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.45 }}>
          {t('automations.circadian.bedtimeHelp')}
        </p>
      </div>

      {/* Daily-schedule preview */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.circadian.preview')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5, color: 'var(--ink-2)' }}>
          <div>🌅 {t('automations.circadian.previewSunrise')}</div>
          <div>☀️ {t('automations.circadian.previewNoon')}</div>
          <div>🌇 {t('automations.circadian.previewSunset')}</div>
          <div>🌙 {t('automations.circadian.previewBedtime', { time: bedtime || '22:00' })}</div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
          {error}
        </p>
      )}

      {/* Footer actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {isUpdate && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={saving}
              className="z-btn-secondary"
              style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}
            >
              {t('automations.circadian.delete')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSave}
            className="z-btn-primary"
            style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}
          >
            {isUpdate ? t('automations.circadian.update') : t('automations.circadian.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── AutomationWizard ──────────────────────────────────────────────────────────
function AutomationWizard({ initial, onSave, onClose }) {
  const t = useT()
  const [step,             setStep]           = useState(0)
  const [name,             setName]           = useState(initial?.name || '')
  const [description,      setDescription]    = useState(initial?.description || '')
  const [selectedRooms,    setSelectedRooms]  = useState(initial?.rooms || [])
  const [availableRooms,   setAvailableRooms] = useState([])
  const [trigger,          setTrigger]        = useState(initial?.trigger || { type: 'time', time: '' })
  const [actions,          setActions]        = useState(() => (initial?.actions || []).map(a => ({ ...a, _key: a._key || crypto.randomUUID() })))
  const [conditions,       setConditions]     = useState(() => (initial?.conditions || []).map(c => ({ ...c, _key: c._key || crypto.randomUUID() })))
  const [collapsedActions, setCollapsedActions] = useState(new Set())
  const [saving,           setSaving]         = useState(false)

  useEffect(() => { getAllRooms().then(r => setAvailableRooms(Array.isArray(r) ? r : r.rooms ?? [])).catch(() => {}) }, [])

  const toggleRoom = roomId => setSelectedRooms(prev => prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId])

  const addAction = () => {
    const newKey = crypto.randomUUID()
    setCollapsedActions(prev => { const next = new Set(prev); actions.forEach(a => next.add(a._key)); return next })
    setActions(a => [...a, { type: 'call_service', entity_id: '', service: 'homeassistant.turn_on', _key: newKey }])
  }

  const updateAction    = (i, val) => setActions(a => a.map((x, j) => j === i ? { ...val, _key: x._key } : x))
  const removeAction    = key => { setActions(a => a.filter(x => x._key !== key)); setCollapsedActions(prev => { const next = new Set(prev); next.delete(key); return next }) }
  const toggleCollapse  = key => setCollapsedActions(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  const canNext = () => step === 0 ? name.trim().length > 0 : !!(trigger.type || 'time')

  const handleSave = async () => {
    setSaving(true)
    // Keep entity-state conditions that have an entity AND time-window conditions
    // that have at least one bound. Anything else is half-filled noise.
    const cleanConditions = conditions
      .map(({ _key, ...rest }) => rest)
      .filter(c => (c.type === 'time' ? (c.after || c.before) : !!c.entity_id))
    const cleanActions = actions.map(({ _key, ...rest }) => rest)
    await onSave({ name, description, trigger, conditions: cleanConditions, actions: cleanActions, rooms: selectedRooms })
    setSaving(false); onClose()
  }

  // Track the furthest step the user has reached so back-jumping is free but
  // forward-jumping past unfilled gates isn't (e.g. you can't skip Name → Review
  // without first completing the trigger). When editing an existing automation,
  // every step is unlocked because the data is already filled in.
  const [maxReached, setMaxReached] = useState(initial ? STEP_COUNT - 1 : 0)
  useEffect(() => { if (step > maxReached) setMaxReached(step) }, [step])

  // Template-supplied wizard warnings (e.g. Night Watch single-mmWave guard).
  // Each entry: { id, level: "warn"|"info", text }. Rendered as a small
  // banner above the wizard steps; user can still proceed.
  const wizardWarnings = Array.isArray(initial?.warnings) ? initial.warnings : []

  return (
    <div>
      <StepIndicator
        current={step}
        maxReached={maxReached}
        onJump={(i) => setStep(i)}
      />
      {wizardWarnings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0 12px' }}>
          {wizardWarnings.map(w => (
            <div
              key={w.id || w.text}
              dir="auto"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 12.5,
                lineHeight: 1.45,
                background: w.level === 'warn' ? 'rgba(255, 196, 0, 0.12)' : 'var(--surface)',
                border: '0.5px solid ' + (w.level === 'warn' ? 'rgba(255, 196, 0, 0.45)' : 'var(--line)'),
                color: 'var(--ink)',
              }}
            >
              {w.text}
            </div>
          ))}
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input label={t('automations.namePlaceholder')} placeholder={t('automations.wizard.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} dir="auto" />
              <Textarea label={t('automations.wizard.descriptionLabel')} placeholder={t('automations.wizard.descriptionPlaceholder')} value={description} onChange={e => setDescription(e.target.value)} rows={3} dir="auto" />
              {availableRooms.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>{t('automations.wizard.roomsLabel')}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {availableRooms.map(r => {
                      const sel = selectedRooms.includes(r.id)
                      return (
                        <button key={r.id} type="button" onClick={() => toggleRoom(r.id)} style={{
                          padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                          background: sel ? 'var(--ink)' : 'var(--surface)',
                          color: sel ? 'var(--bg)' : 'var(--ink-mute)',
                          border: sel ? 'none' : '0.5px solid var(--line)',
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}>{r.name}</button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {step === 1 && <TriggerEditor trigger={trigger} onChange={setTrigger} />}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 2 }}>
                {t('automations.wizard.conditionsHint')}
              </p>
              {conditions.map((cond, i) => (
                <div key={cond._key} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {i > 0 && <AndConnector />}
                  <ConditionRow
                    condition={cond}
                    onChange={v => setConditions(cs => cs.map((c, j) => j === i ? { ...v, _key: c._key } : c))}
                    onRemove={() => setConditions(cs => cs.filter((_, j) => j !== i))}
                  />
                </div>
              ))}
              <button
                onClick={() => setConditions(cs => [...cs, { type: 'entity', entity_id: '', operator: 'is', value: 'on', _key: crypto.randomUUID() }])}
                className="z-btn-secondary"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                {conditions.length === 0 ? t('automations.wizard.addCondition') : t('automations.wizard.addAnotherCondition')}
              </button>
            </div>
          )}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Reorder.Group axis="y" values={actions} onReorder={setActions} style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {actions.map((action, i) => (
                  <DraggableActionRow key={action._key} action={action} index={i} onChange={v => updateAction(i, v)} onRemove={() => removeAction(action._key)} collapsed={collapsedActions.has(action._key)} onToggleCollapse={() => toggleCollapse(action._key)} />
                ))}
              </Reorder.Group>
              <button onClick={addAction} className="z-btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                {t('automations.wizard.addAction')}
              </button>
            </div>
          )}
          {step === 4 && <ReviewPanel name={name} description={description} trigger={trigger} conditions={conditions.map(({ _key, ...rest }) => rest)} actions={actions.map(({ _key, ...rest }) => ({ ...rest, _key }))} />}
        </motion.div>
      </AnimatePresence>
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        {step > 0 && <button onClick={() => setStep(s => s - 1)} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.back')}</button>}
        {step < STEP_COUNT - 1
          ? <button onClick={() => setStep(s => s + 1)} disabled={!canNext()} className="z-btn-primary" style={{ flex: 1 }}>{t('common.next')}</button>
          : <button onClick={handleSave} disabled={saving} className="z-btn-primary" style={{ flex: 1 }}>{saving ? t('automations.wizard.saving') : initial ? t('automations.wizard.saveChanges') : t('automations.wizard.create')}</button>
        }
      </div>
    </div>
  )
}

// ── AutomationViewModal ───────────────────────────────────────────────────────
function AutomationViewModal({ automation, roomNameMap, onEdit, onTrigger, onClose }) {
  const t = useT()
  if (!automation) return null
  const lastRun = formatRelativeTime(automation.last_triggered)
  // numeric_state belongs to the "Device State" trigger family in the UI.
  const tType = automation.trigger?.type
  const triggerTypeLabel = getTriggerTypes().find(tt => tt.value === (tType === 'numeric_state' ? 'state' : tType))?.label || t('common.unknown')
  const completeConditions = (automation.conditions || []).filter(isCompleteCondition)
  const actions = automation.actions || []
  const actionTypes = getActionTypes()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header — name, description, state pill row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: automation.enabled ? `color-mix(in srgb, var(--info) 12%, var(--surface))` : 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={automation.enabled ? 'var(--info)' : 'var(--ink-faint)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15 }} dir="auto">{automation.name}</p>
          {automation.description && <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }} dir="auto">{automation.description}</p>}
        </div>
      </div>

      {/* Trigger */}
      <div style={{ padding: '12px 14px', borderRadius: 11, background: 'var(--bg-2)', border: '0.5px solid var(--line)' }}>
        <p className="z-eyebrow" style={{ marginBottom: 6 }}>{t('automations.triggerLabel')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace' }}>
            {triggerTypeLabel}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{triggerSummary(automation.trigger)}</span>
        </div>
      </div>

      {/* Conditions — keep time-only conditions visible. AND chip between rows
          mirrors the wizard so this view answers "what will fire?" honestly. */}
      {completeConditions.length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>
            {t('automations.view.conditionsAll', { n: completeConditions.length })}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {completeConditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {i > 0 && <AndConnector />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
                  <span style={{ fontSize: 13, flexShrink: 0 }}>🔍</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{conditionSummary(c)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.view.stepsCount', { n: actions.length })}</p>
        {actions.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--ink-faint)', fontStyle: 'italic' }}>{t('automations.view.noSteps')}</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actions.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: `color-mix(in srgb, var(--info) 12%, transparent)`, color: 'var(--info)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: '"IBM Plex Mono", monospace' }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                      {ACTION_TYPE_ICON[a.type] || '•'} {actionTypes.find(at => at.value === a.type)?.label || a.type}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{actionSummary(a)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Rooms */}
      {(automation.rooms || []).length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 6 }}>{t('automations.view.rooms')}</p>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {automation.rooms.map(r => (
              <span key={r} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: `color-mix(in srgb, var(--info) 10%, var(--surface))`, color: 'var(--info)', border: '0.5px solid var(--line)' }}>
                {roomNameMap?.[r] || r.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Status footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, ${automation.enabled ? 'var(--ok)' : 'var(--ink-mute)'} 12%, transparent)`, color: automation.enabled ? 'var(--ok)' : 'var(--ink-mute)' }}>
          {automation.enabled ? t('automations.view.enabled') : t('automations.view.disabled')}
        </span>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: 'var(--bg-2)', color: 'var(--ink-faint)' }}>
          {automation.source === 'ziggy' ? t('automations.view.localScheduler') : t('automations.view.haTriggered')}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)', marginLeft: 'auto', fontFamily: '"IBM Plex Mono", monospace' }}>
          {lastRun ? t('automations.view.lastRan', { when: lastRun }) : t('automations.view.neverRun')}
        </span>
      </div>

      {/* Footer actions — quick path to edit or run from the view itself */}
      {(onEdit || onTrigger) && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '0.5px solid var(--line)', marginTop: 2 }}>
          {onTrigger && (
            <button onClick={() => { onTrigger(automation.id); onClose?.() }} className="z-btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
              {t('automations.view.runNow')}
            </button>
          )}
          {onEdit && (
            <button onClick={() => { onEdit(automation); onClose?.() }} className="z-btn-primary" style={{ flex: 1 }}>
              {t('common.edit')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── AutomationCard ────────────────────────────────────────────────────────────
// React.memo'd so a state_changed WS bump that doesn't touch this card's
// action entities can't drag it through a re-render. With 100+ automations
// on the page that was the dominant cost on every device toggle.
const AutomationCard = React.memo(function AutomationCard({
  automation, offlineEntityIds, onToggle, onView, onEdit, onDelete, onTrigger,
}) {
  const t = useT()
  const triggerLabel = getTriggerTypes().find(tt => tt.value === automation.trigger?.type)?.label

  // Check if any action entity is currently unavailable. offlineEntityIds is
  // built once at the page level and shared across rows — used to be rebuilt
  // here per card per render (N cards × M entities every WS tick).
  const offlineEntities = useMemo(() => {
    if (!offlineEntityIds || offlineEntityIds.size === 0) return []
    return (automation.actions || [])
      .filter(a => a.entity_id && offlineEntityIds.has(a.entity_id))
      .map(a => a.entity_id)
  }, [automation.actions, offlineEntityIds])
  const hasOfflineDep = automation.enabled && offlineEntities.length > 0

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: `0.5px solid ${hasOfflineDep ? 'color-mix(in srgb, var(--warn) 40%, var(--line))' : 'var(--line)'}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {(() => {
          const triggerType = automation.trigger?.type || 'time'
          const tintMap = { time: 'var(--info)', state: 'var(--ok)', zone: 'var(--accent)', sunrise: 'var(--gold)', sunset: 'var(--accent)', webhook: 'var(--warn)', manual: 'var(--ink-mute)' }
          const tint = automation.enabled ? (tintMap[triggerType] || 'var(--info)') : 'var(--ink-faint)'
          const iconMap = {
            time: <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>,
            sunrise: <><circle cx="12" cy="13" r="3"/><path d="M12 4v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20"/></>,
            sunset: <><circle cx="12" cy="13" r="3"/><path d="M12 3v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20M12 19v3"/></>,
            zone: <><path d="M12 2L4 14h7l-1 8 9-12h-7l1-8z"/></>,
            state: <><path d="M4 12l5 5L20 6"/></>,
            webhook: <><circle cx="12" cy="12" r="3"/><path d="M12 9V5a2 2 0 0 0-4 0M9 12H5a2 2 0 0 0 0 4M12 15v4a2 2 0 0 0 4 0M15 12h4a2 2 0 0 0 0-4"/></>,
          }
          return (
            <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${tint} 12%, var(--surface-2))` }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={automation.enabled ? tint : 'var(--ink-faint)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {iconMap[triggerType] || <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>}
              </svg>
            </div>
          )
        })()}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{automation.name}</p>
          {automation.description && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{automation.description}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {triggerLabel && (
              <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, ${automation.enabled ? 'var(--info)' : 'var(--ink-mute)'} 12%, transparent)`, color: automation.enabled ? 'var(--info)' : 'var(--ink-faint)' }}>
                {triggerLabel}
              </span>
            )}
            {automation.trigger?.time && <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{automation.trigger.time}</span>}
            <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{t('automations.card.stepsCount', { n: automation.actions?.length || 0 })}</span>
            {(automation.rooms || []).length > 0 && <span style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>{t('automations.card.roomsCount', { n: (automation.rooms || []).length })}</span>}
          </div>
          {hasOfflineDep && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--warn)', fontFamily: '"IBM Plex Mono", monospace' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {t(offlineEntities.length === 1 ? 'automations.suggested.offlineDepsOne' : 'automations.suggested.offlineDeps', { n: offlineEntities.length })}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Toggle checked={automation.enabled} onCheckedChange={() => onToggle(automation.id)} />
          <div style={{ display: 'flex', gap: 2 }}>
            {[
              { onClick: () => onTrigger(automation.id), color: 'var(--ok)', title: t('automations.view.runNow'), path: <path d="M5 3l14 9-14 9V3z" fill="currentColor" stroke="none"/> },
              { onClick: () => onView(automation),       color: 'var(--ink-mute)', title: t('automations.card.view'), path: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> },
              { onClick: () => onEdit(automation),       color: 'var(--ink-mute)', title: t('common.edit'),    path: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></> },
              { onClick: () => onDelete(automation.id),  color: 'var(--accent)',   title: t('common.delete'),  path: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></> },
            ].map(({ onClick, color, title, path }) => (
              <button key={title} onClick={onClick} title={title} aria-label={title} style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 4 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
})

// ── CircadianGroupRow ─────────────────────────────────────────────────────────
// Renders the 4 ziggy_circadian_* HA automations as a single feature row on the
// Active tab. The user never sees the underlying 4 entries — they see "Smart
// Light Schedule" as one thing they can toggle, edit, or remove.
function CircadianGroupRow({ group, onToggleAll, onEdit, onDelete }) {
  const t = useT()
  const { lights, bedtime, allEnabled, count } = group
  const tint = allEnabled ? 'var(--gold)' : 'var(--ink-faint)'

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${tint} 14%, var(--surface-2))`, fontSize: 18 }}>
          🌅
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em' }} dir="auto">
            {t('automations.circadian.installedBadge')}
          </p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }} dir="auto">
            {t('automations.circadian.subtitle')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, ${tint} 12%, transparent)`, color: tint }}>
              {t('automations.circadian.fourPhases')}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
              {t('automations.circadian.bedtime')}: {bedtime}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
              {lights.length}× {lights.length === 1 ? 'light' : 'lights'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Toggle checked={allEnabled} onCheckedChange={() => onToggleAll(!allEnabled)} />
          <div style={{ display: 'flex', gap: 2 }}>
            <button onClick={onEdit} title={t('common.edit')} aria-label={t('common.edit')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button onClick={onDelete} title={t('common.delete')} aria-label={t('common.delete')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}


// ── TemplateCard ──────────────────────────────────────────────────────────────
const TIER_STYLE = {
  ready:       { border: 'color-mix(in srgb, var(--ok)   30%, var(--line))', bg: 'color-mix(in srgb, var(--ok)   4%, var(--surface))', badgeBg: 'color-mix(in srgb, var(--ok)   14%, transparent)', badgeColor: 'var(--ok)',      badgeKey: 'ready' },
  partial:     { border: 'color-mix(in srgb, var(--warn) 40%, var(--line))', bg: 'color-mix(in srgb, var(--warn) 4%, var(--surface))', badgeBg: 'color-mix(in srgb, var(--warn) 14%, transparent)', badgeColor: 'var(--warn)',    badgeKey: 'incomplete' },
  unavailable: { border: 'var(--line)',                                       bg: 'var(--surface)',                                      badgeBg: 'var(--bg-2)',                                       badgeColor: 'var(--ink-faint)', badgeKey: 'notAvailable' },
}

function TemplateCard({ template, onConfigure }) {
  const t = useT()
  const tier        = template.tier || (template.can_run ? 'ready' : 'unavailable')
  const ts          = TIER_STYLE[tier] || TIER_STYLE.unavailable
  const matched     = template.matched_labels || []
  const missReq     = template.missing_req_labels || []
  const missOpt     = template.missing_opt_labels || []
  const canConfigure = tier === 'ready' || tier === 'partial'
  // Collapsed by default — Library lists many templates at once, so the
  // header alone (name + tier badge + one-line status) is the right scan
  // level. Tapping anywhere on the card (except Configure) reveals the
  // description and the per-device match list.
  const [expanded, setExpanded] = useState(false)

  const statusLine = tier === 'ready'
    ? t(matched.length === 1 ? 'automations.template.deviceReadyOne' : 'automations.template.devicesReady', { n: matched.length })
    : tier === 'partial'
    ? t('automations.template.partialFound', { matched: matched.length, total: matched.length + missReq.length })
    : t(missReq.length === 1 ? 'automations.template.deviceNeededOne' : 'automations.template.devicesNeeded', { n: missReq.length })

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded(v => !v)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v) } }}
      style={{
        padding: '14px 16px', borderRadius: 12,
        background: ts.bg, border: `0.5px solid ${ts.border}`,
        display: 'flex', alignItems: 'flex-start', gap: 12,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${ts.badgeColor} 10%, var(--surface))`,
        fontSize: 18,
      }}>
        {template.icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em' }} dir="auto">{template.name}</p>
          <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 700, fontFamily: '"IBM Plex Mono", monospace', background: ts.badgeBg, color: ts.badgeColor }}>
            {t(ts.badgeKey === 'ready' ? 'automations.template.ready' : ts.badgeKey === 'incomplete' ? 'automations.template.incomplete' : 'automations.template.notAvailable')}
          </span>
          {template.already_exists && (
            <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, var(--ok) 14%, transparent)`, color: 'var(--ok)' }}>
              {t('automations.template.active')}
            </span>
          )}
        </div>

        {/* One-line status — visible in both states so the card stays scannable. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'inherit' }}>
          <span aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
          {statusLine}
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              style={{ overflow: 'hidden' }}
            >
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '8px 0', lineHeight: 1.4 }} dir="auto">{template.description}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
                {matched.map(m => (
                  <div key={m.cap} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--ok)', fontSize: 11, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-2)' }} dir="auto">{m.label}</span>
                  </div>
                ))}
                {missReq.map(m => (
                  <div key={m.cap} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--warn)', fontSize: 11, flexShrink: 0 }}>✗</span>
                    <span style={{ fontSize: 11, color: 'var(--warn)' }} dir="auto">{m.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--warn)', fontFamily: '"IBM Plex Mono", monospace', opacity: 0.7 }}>{t('automations.template.required')}</span>
                  </div>
                ))}
                {missOpt.map(m => (
                  <div key={m.cap} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--ink-faint)', fontSize: 11, flexShrink: 0 }}>○</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-faint)' }} dir="auto">{m.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{t('automations.template.optional')}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ flexShrink: 0 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onConfigure(template) }}
          disabled={!canConfigure}
          className={tier === 'ready' ? 'z-btn-primary' : 'z-btn-secondary'}
          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 9, whiteSpace: 'nowrap', opacity: canConfigure ? 1 : 0.35 }}
        >
          {tier === 'ready' ? t('automations.template.configure') : tier === 'partial' ? t('automations.template.configure') : t('automations.template.addDevices')}
        </button>
      </div>
    </div>
  )
}

// ── LibraryModal ──────────────────────────────────────────────────────────────
function LibraryModal({ open, onClose, onConfigure }) {
  const t = useT()
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('all')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getAutomationTemplates()
      .then(r => setTemplates(r.templates || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  // Templates the user already created live in the Active tab — hide them here
  // so the Library only shows templates that still represent a "next step".
  const available = templates.filter(t => !t.already_exists)
  const categories = ['all', ...Array.from(new Set(available.map(t => t.category)))]
  const filtered = available.filter(t =>
    (category === 'all' || t.category === category) &&
    (search === '' || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase()))
  )
  const ready       = filtered.filter(t => t.tier === 'ready')
  const partial     = filtered.filter(t => t.tier === 'partial')
  const unavailable = filtered.filter(t => t.tier === 'unavailable')

  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      padding: '0 0 0 0',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 260 }}
        style={{
          width: '100%', maxWidth: 720,
          maxHeight: '85vh', borderRadius: '18px 18px 0 0',
          background: 'var(--bg)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px 12px', borderBottom: '0.5px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p className="z-eyebrow" style={{ marginBottom: 2 }}>{t('automations.libraryEyebrow')}</p>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{t('automations.libraryTitle')}</h2>
            </div>
            <button onClick={onClose} aria-label={t('common.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--ink-mute)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <input
            type="text"
            placeholder={t('automations.libraryRunSearch')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            dir="auto"
            style={{
              width: '100%', height: 36, padding: '0 12px', borderRadius: 9,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => setCategory(cat)} style={{
                padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
                background: category === cat ? 'var(--ink)' : 'var(--surface)',
                color: category === cat ? 'var(--bg)' : 'var(--ink-mute)',
                border: category === cat ? 'none' : '0.5px solid var(--line)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {cat === 'all' ? t('automations.libraryAll') : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 80, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.5 }} />)}
            </div>
          )}
          {!loading && (
            <>
              {ready.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p className="z-eyebrow" style={{ marginBottom: 10, color: 'var(--ok)' }}>{t('automations.libraryReady', { n: ready.length })}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {ready.map(tpl => <TemplateCard key={tpl.id} template={tpl} onConfigure={cfg => { onConfigure(cfg); onClose() }} />)}
                  </div>
                </div>
              )}
              {partial.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p className="z-eyebrow" style={{ marginBottom: 6, color: 'var(--warn)' }}>{t('automations.libraryPartial', { n: partial.length })}</p>
                  <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 10, lineHeight: 1.4 }}>
                    {t('automations.libraryPartialHint')}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {partial.map(tpl => <TemplateCard key={tpl.id} template={tpl} onConfigure={cfg => { onConfigure(cfg); onClose() }} />)}
                  </div>
                </div>
              )}
              {unavailable.length > 0 && (
                <div>
                  <p className="z-eyebrow" style={{ marginBottom: 10, color: 'var(--ink-faint)' }}>{t('automations.libraryUnavailable', { n: unavailable.length })}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {unavailable.map(tpl => <TemplateCard key={tpl.id} template={tpl} onConfigure={cfg => { onConfigure(cfg); onClose() }} />)}
                  </div>
                </div>
              )}
              {filtered.length === 0 && (
                <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: 'var(--ink-faint)' }}>{t('automations.libraryNoMatch')}</p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Suggested tab (embedded from Suggestions.jsx logic) ──────────────────────
function ConfidenceMeter({ value }) {
  const filled = Math.round(value * 5)
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span className="z-mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>{Math.round(value * 100)}%</span>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[0,1,2,3,4].map(i => (
          <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i < filled ? 'var(--ink-2)' : 'var(--line)' }} />
        ))}
      </span>
    </div>
  )
}

function getPatternTypeMeta() {
  return {
    time_based: { label: tStatic('automations.pattern.timePattern'), tint: 'var(--info)' },
    sequence:   { label: tStatic('automations.pattern.routine'),     tint: 'var(--ok)' },
    group:      { label: tStatic('automations.pattern.group'),       tint: 'var(--warn)' },
  }
}
function getSuggestionStatusMeta() {
  return {
    accepted:    { label: tStatic('automations.suggestionStatus.accepted'),    tint: 'var(--ok)' },
    rejected:    { label: tStatic('automations.suggestionStatus.rejected'),    tint: 'var(--err)' },
    snoozed:     { label: tStatic('automations.suggestionStatus.snoozed'),     tint: 'var(--warn)' },
    implemented: { label: tStatic('automations.suggestionStatus.implemented'), tint: 'var(--ok)' },
  }
}

// Canonical suggestion card for the Suggested tab. Configure opens the
// AutomationWizard pre-populated with detected devices and suggestion defaults —
// never auto-deploys. A separate, legacy SuggestionCard lives in pages/Suggestions.jsx
// (the standalone /suggestions page) with an older accept/reject UX; do not edit
// that one for new work.
function SuggestionCard({ suggestion, onConfigure, onReject, onSnooze }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const [acting,   setActing]   = useState(null)
  const isPending = suggestion.status === 'pending'
  const PATTERN_TYPE_META = getPatternTypeMeta()
  const SUGGESTION_STATUS_META = getSuggestionStatusMeta()
  const meta = PATTERN_TYPE_META[suggestion.pattern_type] || PATTERN_TYPE_META.time_based
  const act = async (fn, label) => { setActing(label); try { await fn() } finally { setActing(null) } }

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: isPending ? 1 : 0.65, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18 }}
      style={{ padding: 14, borderRadius: 16, background: 'var(--surface)', border: '0.5px solid var(--line)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <p className="z-eyebrow" style={{ color: meta.tint }}>{meta.label}</p>
        <div style={{ flex: 1 }} />
        <ConfidenceMeter value={suggestion.confidence} />
        {!isPending && (
          <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: `color-mix(in srgb, ${SUGGESTION_STATUS_META[suggestion.status]?.tint || 'var(--info)'} 14%, transparent)`, color: SUGGESTION_STATUS_META[suggestion.status]?.tint || 'var(--info)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {SUGGESTION_STATUS_META[suggestion.status]?.label || suggestion.status}
          </span>
        )}
      </div>
      <p style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'var(--ink)', marginBottom: 8 }} dir="auto">{suggestion.user_message}</p>
      {(suggestion.trigger || suggestion.actions?.length > 0) && (
        <div style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: isPending ? 10 : 0 }}>
          {suggestion.trigger?.type && <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t('automations.suggested.tagWhen', { desc: `${suggestion.trigger.type}${suggestion.trigger.value ? ` · ${suggestion.trigger.value}` : ''}` })}</span>}
          {suggestion.actions?.slice(0, 2).map((a, i) => <span key={i} className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t('automations.suggested.tagDo', { desc: `${a.intent?.replace(/_/g, ' ')}${a.params?.room ? ` · ${a.params.room.replace(/_/g, ' ')}` : ''}` })}</span>)}
        </div>
      )}
      {isPending && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => act(onConfigure, 'configure')} disabled={!!acting} style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontSize: 13, fontWeight: 600, cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.6 : 1, fontFamily: 'inherit' }}>
            {acting === 'configure' ? t('automations.suggested.openingDots') : t('automations.suggested.configure')}
          </button>
          <button onClick={() => act(() => onSnooze(3), 'snooze')} disabled={!!acting} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--ink-2)', border: '0.5px solid var(--line)', fontSize: 13, fontWeight: 500, cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.6 : 1, fontFamily: 'inherit' }}>
            {acting === 'snooze' ? '…' : t('automations.suggested.later')}
          </button>
          <button onClick={() => act(onReject, 'reject')} disabled={!!acting} aria-label={t('common.delete')} style={{ padding: '10px', borderRadius: 10, background: 'transparent', color: 'var(--ink-faint)', border: '0.5px solid var(--line)', fontSize: 13, cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.6 : 1, fontFamily: 'inherit' }}>✕</button>
        </div>
      )}
    </motion.div>
  )
}

// Translate a suggestion (from the pattern engine) into the shape the
// Automation wizard expects. The pattern engine emits actions as
// {intent, params} pairs — we map them to `send_intent` steps so the wizard
// can show them as human-readable strings the user can refine before saving.
function suggestionToWizardData(suggestion) {
  const tr = suggestion.trigger || {}
  let trigger = { type: 'time', time: '08:00' }
  if (tr.type === 'time' && tr.value) trigger = { type: 'time', time: tr.value.slice(0, 5) }
  else if (tr.type === 'sequence')    trigger = { type: 'time', time: '08:00' }   // sequence has no time; let the user choose
  else if (tr.type)                   trigger = { type: tr.type, ...tr }

  const actionToText = (a) => {
    const intent = (a.intent || '').replace(/_/g, ' ')
    const room   = a.params?.room ? tStatic('automations.suggestion.inRoomFmt', { room: a.params.room.replace(/_/g, ' ') }) : ''
    const onOff  = a.params?.turn_on === true ? ' on' : a.params?.turn_on === false ? ' off' : ''
    return `${intent}${onOff}${room}`.trim()
  }
  const actions = (suggestion.actions || []).map(a => ({
    type: 'send_intent',
    text: actionToText(a) || (a.intent || tStatic('automations.suggestion.doSomething')),
  }))

  return {
    name: suggestion.user_message?.slice(0, 60) || tStatic('automations.suggestion.defaultName'),
    description: suggestion.reasoning || suggestion.user_message || '',
    trigger,
    conditions: [],
    actions,
    rooms: [],
  }
}

function SuggestedTab({ suggestions, loading, analyzing, onConfigure, onReject, onSnooze, onAnalyze }) {
  const t = useT()
  const [subtab, setSubtab] = useState('pending')
  const pending = suggestions.filter(s => s.status === 'pending')
  const history = suggestions.filter(s => s.status !== 'pending')
  const displayed = subtab === 'pending' ? pending : history

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ id: 'pending', label: t('automations.suggested.pending'), count: pending.length }, { id: 'history', label: t('automations.suggested.history') }].map(tab => (
            <button key={tab.id} onClick={() => setSubtab(tab.id)} style={{ padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: subtab === tab.id ? 'var(--ink)' : 'var(--surface-2)', color: subtab === tab.id ? 'var(--bg)' : 'var(--ink-mute)', border: subtab === tab.id ? 'none' : '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 5 }}>
              {tab.label}
              {tab.count > 0 && <span style={{ background: subtab === tab.id ? 'rgba(255,255,255,0.25)' : 'var(--accent)', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 999, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 700 }}>{tab.count}</span>}
            </button>
          ))}
        </div>
        <button onClick={onAnalyze} disabled={analyzing} className="z-btn-secondary" style={{ padding: '6px 12px', borderRadius: 9, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: analyzing ? 'spin 1s linear infinite' : 'none' }}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          {analyzing ? t('automations.suggested.analyzing') : t('automations.suggested.analyze')}
        </button>
      </div>

      {loading && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1,2,3].map(i => <div key={i} style={{ height: 100, borderRadius: 14, background: 'var(--surface)', opacity: 0.6 }} />)}</div>}

      {!loading && displayed.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>{subtab === 'pending' ? t('automations.suggested.noPending') : t('automations.suggested.noHistory')}</p>
          {subtab === 'pending' && <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5, maxWidth: 280, margin: '0 auto 16px' }}>{t('automations.suggested.learnsHint')}</p>}
          {subtab === 'pending' && <button onClick={onAnalyze} disabled={analyzing} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>{analyzing ? t('automations.suggested.analyzing') : t('automations.suggested.runAnalysis')}</button>}
        </div>
      )}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {displayed.map(s => (
              <SuggestionCard key={s.id} suggestion={s} onConfigure={() => onConfigure(s)} onReject={() => onReject(s.id)} onSnooze={(days) => onSnooze(s.id, days)} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Automations() {
  const t = useT()
  const { automations, routines, loading, fetchAutomations, fetchRoutines, addAutomation, removeAutomation, toggleAutomation, triggerAutomation, loadAutomationConfig } = useAutomationStore()
  const { suggestions, loading: sugLoading, fetch: fetchSuggestions, setFromFeed: setSuggestionsFromFeed, accept, reject, snooze, runAnalysis, analyzing, pendingCount } = useSuggestionStore()
  const { addToast } = useUIStore()
  // Per-field selectors — pulling the whole deviceStore here would re-render
  // the page (and every automation card under it) on every WS tick.
  const ziggyRooms = useDeviceStore(s => s.ziggyRooms)
  const entities   = useDeviceStore(s => s.entities)

  // Compute the offline-entity set ONCE per page render, share it with every
  // AutomationCard via prop. Each card used to rebuild this set itself on
  // every WS-driven re-render — N × M work for no reason.
  const offlineEntityIds = useMemo(() => {
    const s = new Set()
    for (const e of entities) {
      if (e.state === 'unavailable' || e.state === 'unknown') s.add(e.entity_id)
    }
    return s
  }, [entities])
  const [tab,               setTab]               = useState('active')
  const [showWizard,        setShowWizard]        = useState(false)
  const [editTarget,        setEditTarget]        = useState(null)
  const [viewTarget,        setViewTarget]        = useState(null)
  const [suggestedTemplates, setSuggestedTemplates] = useState(suggestedTemplatesCache || [])
  const [showLibrary,       setShowLibrary]       = useState(false)
  // Circadian bundle wizard — opened by Configure on the Smart Light Schedule
  // template, or by Edit on the grouped Active-tab row. Carries the prefill
  // (defaults.lights, defaults.bedtime) and an _isInstalled flag so the
  // wizard can show "Update" + "Remove" rather than "Activate".
  const [circadianTarget,   setCircadianTarget]   = useState(null)
  // Collapsed by default — the Recommended-by-Ziggy block is helpful but
  // not the user's primary intent when landing on the Suggested tab. They
  // came to review pending suggestions; the templates banner is secondary.
  // Keeping it closed unless explicitly opened keeps the tab compact.
  const [suggestionsOpen,   setSuggestionsOpen]   = useState(false)

  const roomNameMap = Object.fromEntries(ziggyRooms.map(r => [r.id, r.name]))
  const pendingSuggestions = suggestions.filter(s => s.status === 'pending')

  // Group the 4 ziggy_circadian_* automations behind a single "Smart Light
  // Schedule" row on the Active tab. The user sees one toggleable feature,
  // not 4 cryptic clock entries. Member IDs and shared lights/bedtime are
  // derived from the bedtime automation's trigger time and any member's
  // light targets (all 4 share the same light set on save).
  const { circadianGroup, visibleAutomations } = useMemo(() => {
    const members = automations.filter(a => a.id?.startsWith('ziggy_circadian_'))
    if (members.length === 0) return { circadianGroup: null, visibleAutomations: automations }
    const visible = automations.filter(a => !a.id?.startsWith('ziggy_circadian_'))

    const bedtimeAuto = members.find(a => a.id === 'ziggy_circadian_bedtime')
    const bedtime = bedtimeAuto?.trigger?.time?.slice(0, 5) || '22:00'
    const lightSet = new Set()
    members.forEach(m => (m.actions || []).forEach(act => {
      const eid = act.entity_id
      if (typeof eid === 'string' && eid.startsWith('light.')) lightSet.add(eid)
      else if (Array.isArray(eid)) eid.forEach(x => x?.startsWith?.('light.') && lightSet.add(x))
    }))
    const lights = Array.from(lightSet)
    const allEnabled = members.every(m => m.enabled)
    const anyEnabled = members.some(m => m.enabled)

    return {
      circadianGroup: { members, lights, bedtime, allEnabled, anyEnabled, count: members.length },
      visibleAutomations: visible,
    }
  }, [automations])

  // Only fetch what isn't cached. Re-fetching on every revisit toggles the
  // store's `loading` flag, which flashes skeleton placeholders mid-mount and
  // makes navigation feel jumpy. Stores persist within the SPA session, so a
  // cache check is enough; data refreshes on explicit user action elsewhere.
  useEffect(() => {
    if (automations.length === 0)        fetchAutomations()
    if (routines.length === 0)           fetchRoutines()

    // Prefer the unified Suggested-tab feed (one fetch covers both habit
    // suggestions and device-template suggestions). Fall back to the two
    // legacy endpoints if /suggestions/feed errors — that path remains
    // identical to the pre-Gap 4 behaviour so an outage of the new endpoint
    // can't blank the tab.
    const needsHabits    = suggestions.length === 0
    const needsTemplates = suggestedTemplates.length === 0 && !suggestedTemplatesCache
    if (!needsHabits && !needsTemplates) return

    getSuggestionsFeed()
      .then(resp => {
        const items = Array.isArray(resp?.items) ? resp.items : []
        if (needsHabits) {
          setSuggestionsFromFeed(items)
        }
        if (needsTemplates) {
          const templates = items
            .filter(it => it && it.source === 'template')
            .map(it => it.raw)
            .filter(Boolean)
          suggestedTemplatesCache = templates
          setSuggestedTemplates(templates)
        }
      })
      .catch(() => {
        // Fallback path — two separate fetches against the legacy endpoints.
        if (needsHabits) fetchSuggestions()
        if (needsTemplates) {
          getSuggestedTemplates()
            .then(r => {
              const arr = r.suggested || []
              suggestedTemplatesCache = arr
              setSuggestedTemplates(arr)
            })
            .catch(() => {})
        }
      })
  }, [])

  const handleConfigureTemplate = (template) => {
    if (!template.wizard_prefill) return
    // Bundle templates (e.g. Smart Light Schedule) take the wizard schema
    // off the rails — route them to a dedicated wizard instead.
    if (template.wizard_prefill.bundle === 'circadian') {
      setCircadianTarget({ ...template.wizard_prefill, _templateId: template.id, _isInstalled: false })
      return
    }
    setEditTarget({ ...template.wizard_prefill, _isTemplate: true, _templateId: template.id })
    setShowWizard(true)
  }

  // Open the circadian wizard in edit mode for an installed bundle. Called
  // from the grouped Smart Light Schedule row on the Active tab.
  const handleEditCircadianBundle = (group) => {
    setCircadianTarget({
      _isInstalled: true,
      selectedLights: group.lights,
      bedtime: group.bedtime,
      defaults: { lights: group.lights, bedtime: group.bedtime },
    })
  }

  const handleCircadianClose = () => setCircadianTarget(null)
  const handleCircadianSaved = async ({ updated, removed }) => {
    setCircadianTarget(null)
    addToast(
      removed ? t('automations.circadian.deleted')
              : (updated ? t('automations.circadian.updated') : t('automations.circadian.saved')),
      'success',
    )
    try { await fetchAutomations({ force: true }) } catch {}
    try {
      const r = await getSuggestedTemplates()
      const arr = r.suggested || []
      suggestedTemplatesCache = arr
      setSuggestedTemplates(arr)
    } catch {}
  }

  // Accepting a suggestion opens the wizard pre-filled with the suggestion's
  // trigger + actions so the user can review/edit before the automation lands.
  // The suggestion itself is only marked accepted after a successful save —
  // dismissing the wizard leaves the suggestion pending so it stays in the inbox.
  const handleConfigureSuggestion = (suggestion) => {
    setEditTarget({ ...suggestionToWizardData(suggestion), _fromSuggestion: suggestion.id })
    setShowWizard(true)
  }

  const handleSave = async (data) => {
    try {
      await addAutomation({ ...data, id: editTarget?.id })
      addToast(t('automations.saved'), 'success')
      if (editTarget?._fromSuggestion) {
        try { await accept(editTarget._fromSuggestion) } catch {}
      }
      await fetchAutomations()
      // Refresh suggested templates so anything that's now `already_exists`
      // drops out of the Recommended-by-Ziggy banner and the Library.
      try {
        const r = await getSuggestedTemplates()
        const arr = r.suggested || []
        suggestedTemplatesCache = arr
        setSuggestedTemplates(arr)
      } catch {}
    } catch { addToast(t('automations.failedToSave'), 'error') }
  }
  const handleDelete = async (id) => {
    try { await removeAutomation(id); addToast(t('automations.deleted'), 'success') }
    catch { addToast(t('automations.failedToDelete'), 'error') }
  }
  const handleEdit = async (automation) => {
    try { const config = await loadAutomationConfig(automation.id); setEditTarget(config || automation) }
    catch { setEditTarget(automation) }
    setShowWizard(true)
  }
  const handleView = async (automation) => {
    try { const config = await loadAutomationConfig(automation.id); setViewTarget(config || automation) }
    catch { setViewTarget(automation) }
  }
  const handleClose = () => { setShowWizard(false); setEditTarget(null) }
  const enabled = automations.filter(a => a.enabled).length

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('automations.eyebrow')}</p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>{t('automations.title')}</h1>
          <p className="z-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
            {t('automations.countSummary', { enabled, total: automations.length })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setShowLibrary(true)} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            {t('automations.library')}
          </button>
          <button onClick={() => { setEditTarget(null); setShowWizard(true) }} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            {t('automations.headerAdd')}
          </button>
        </div>
      </div>

      {/* Tab switcher — segmented pill style */}
      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 13, marginBottom: 20 }}>
        {[
          { id: 'active',    label: t('automations.tabActive'),    count: automations.filter(a => a.enabled).length },
          { id: 'suggested', label: t('automations.tabSuggested'), count: pendingSuggestions.length },
          { id: 'routines',  label: t('automations.tabRoutines'),  count: routines.length },
        ].map(tabDef => (
          <button key={tabDef.id} onClick={() => setTab(tabDef.id)} style={{
            flex: 1, padding: '8px 0', borderRadius: 10, fontFamily: 'inherit', cursor: 'pointer',
            background: tab === tabDef.id ? 'var(--surface)' : 'transparent',
            border: 'none', fontSize: 13, fontWeight: 600,
            color: tab === tabDef.id ? 'var(--ink)' : 'var(--ink-mute)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: tab === tabDef.id ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            transition: 'background 0.15s',
          }}>
            {tabDef.label}
            {tabDef.count > 0 && <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{tabDef.count}</span>}
          </button>
        ))}
      </div>

      {/* Tab bodies — AnimatePresence with mode="wait" makes switches feel
          intentional instead of jumpy. Old tab fades out before new fades in,
          so the page never reflows mid-transition. Snappy 140ms each way. */}
      <AnimatePresence mode="wait">

      {/* ─── Suggested tab ─── */}
      {tab === 'suggested' && (
        <motion.div
          key="suggested"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >

      {/* ── Recommended by Ziggy — banner at the top of Suggested tab.
            Templates already configured are filtered out (they live in the
            Active tab). Expanded by default so users see suggestions instead
            of having to find them behind a collapsed chip. ─────────────── */}
      {(() => {
        // Hide templates the user has already created — they belong in Active.
        const recommended = suggestedTemplates.filter(tpl => !tpl.already_exists)
        if (recommended.length === 0) return null
        const readyCount = recommended.filter(tpl => tpl.tier === 'ready').length
        const partialCount = recommended.filter(tpl => tpl.tier === 'partial').length
        return (
          <div style={{
            marginBottom: 20,
            borderRadius: 14,
            border: `0.5px solid color-mix(in srgb, var(--info) 35%, var(--line))`,
            background: `linear-gradient(180deg, color-mix(in srgb, var(--info) 6%, var(--surface)) 0%, var(--surface) 100%)`,
            overflow: 'hidden',
          }}>
            <button
              onClick={() => setSuggestionsOpen(v => !v)}
              style={{ width: '100%', background: 'none', border: 'none', padding: '12px 14px', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 18 }}>✨</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                      {t('automations.recommended')}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>
                      {readyCount > 0 && <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{t('automations.recommendedReady', { n: readyCount })}</span>}
                      {readyCount > 0 && partialCount > 0 && <span style={{ color: 'var(--ink-faint)' }}> · </span>}
                      {partialCount > 0 && <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{t('automations.recommendedNeed', { n: partialCount })}</span>}
                      {readyCount === 0 && partialCount === 0 && <span>{t('automations.recommendedSubtitle')}</span>}
                    </p>
                  </div>
                </div>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: suggestionsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}><path d="M6 9l6 6 6-6"/></svg>
              </div>
            </button>
            <AnimatePresence>
              {suggestionsOpen && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '0 12px 12px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {recommended.slice(0, 5).map(tpl => (
                      <TemplateCard key={tpl.id} template={tpl} onConfigure={handleConfigureTemplate} />
                    ))}
                    {recommended.length > 5 && (
                      <button onClick={() => setShowLibrary(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', padding: '8px 0', fontFamily: 'inherit' }}>
                        {t('automations.moreInLibrary', { n: recommended.length - 5 })}
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })()}

      <SuggestedTab
        suggestions={suggestions}
        loading={sugLoading}
        analyzing={analyzing}
        onConfigure={handleConfigureSuggestion}
        onReject={async id => { try { await reject(id); addToast(t('automations.suggested.dismissed'), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
        onSnooze={async (id, days) => { try { await snooze(id, days); addToast(t('automations.suggested.snoozedFor', { n: days }), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
        onAnalyze={async () => { try { const r = await runAnalysis(); addToast(r?.new_count > 0 ? t(r.new_count === 1 ? 'automations.suggested.foundNewOne' : 'automations.suggested.foundNew', { n: r.new_count }) : t('automations.suggested.noNewPatterns'), 'success') } catch { addToast(t('automations.suggested.analysisFailed'), 'error') } }}
      />
        </motion.div>
      )}

      {/* ─── Routines tab ─── */}
      {tab === 'routines' && (
        <motion.div
          key="routines"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >
          <RoutinesListPanel />
        </motion.div>
      )}

      {/* ─── Active tab ─── */}
      {tab === 'active' && (
        <motion.div
          key="active"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >

      {/* ── My Automations ───────────────────────────────────────────────── */}
      {automations.length > 0 && <p className="z-eyebrow" style={{ marginBottom: 10 }}>{t('automations.myAutomations')}</p>}

      {loading && automations.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 82, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {!loading && automations.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>{t('automations.empty')}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>{t('automations.emptyHint')}</p>
          <button onClick={() => setShowWizard(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>{t('automations.createAutomation')}</button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {circadianGroup && (
            <CircadianGroupRow
              group={circadianGroup}
              onToggleAll={async (toEnabled) => {
                try {
                  await Promise.all(circadianGroup.members.map(m => toggleAutomation(m.id, toEnabled)))
                } catch { addToast(t('automations.circadian.failed'), 'error') }
              }}
              onEdit={() => handleEditCircadianBundle(circadianGroup)}
              onDelete={async () => {
                try {
                  await deleteCircadianBundle()
                  addToast(t('automations.circadian.deleted'), 'success')
                  await fetchAutomations({ force: true })
                } catch { addToast(t('automations.circadian.failed'), 'error') }
              }}
            />
          )}
          {visibleAutomations.map(a => (
            <AutomationCard key={a.id} automation={a} offlineEntityIds={offlineEntityIds}
              onToggle={toggleAutomation} onView={handleView} onEdit={handleEdit} onDelete={handleDelete}
              onTrigger={async id => { try { await triggerAutomation(id); addToast(t('automations.triggered'), 'success') } catch { addToast(t('automations.failedToTrigger'), 'error') } }} />
          ))}
        </div>
      </AnimatePresence>
        </motion.div>
      )}

      </AnimatePresence>

      {/* Page-level modals — triggered from multiple tabs (Library/Configure
          flow originates from both Active "Library" button and Suggested
          template cards), so they must render outside any tab gate. */}
      <LibraryModal
        open={showLibrary}
        onClose={() => setShowLibrary(false)}
        onConfigure={handleConfigureTemplate}
      />

      <Modal open={showWizard} onClose={handleClose} title={
        editTarget?._fromSuggestion ? t('automations.reviewTitle', { name: editTarget.name }) :
        editTarget?._isTemplate ? t('automations.configureTitle', { name: editTarget.name }) :
        editTarget ? t('automations.editTitle', { name: editTarget.name }) : t('automations.newCustom')
      }>
        <AutomationWizard key={editTarget?.id || '__new__'} initial={editTarget} onSave={handleSave} onClose={handleClose} />
      </Modal>

      {/* Smart Light Schedule (circadian) wizard — separate modal so its
          dedicated 2-field layout doesn't have to coexist with the
          single-trigger AutomationWizard. */}
      <Modal open={!!circadianTarget} onClose={handleCircadianClose} title={t('automations.circadian.title')}>
        {circadianTarget && (
          <CircadianBundleWizard
            key={circadianTarget._isInstalled ? 'edit' : 'new'}
            initial={circadianTarget}
            onSaved={handleCircadianSaved}
            onClose={handleCircadianClose}
          />
        )}
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={t('automations.detailsTitle')}>
        <AutomationViewModal
          automation={viewTarget}
          roomNameMap={roomNameMap}
          onEdit={(automation) => { setViewTarget(null); handleEdit(automation) }}
          onTrigger={async (id) => { try { await triggerAutomation(id); addToast(t('automations.triggered'), 'success') } catch { addToast(t('automations.failedToTrigger'), 'error') } }}
          onClose={() => setViewTarget(null)}
        />
      </Modal>
    </div>
  )
}
