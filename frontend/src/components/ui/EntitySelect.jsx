import { useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { Search, ChevronDown } from 'lucide-react'
import { getEntities, getRooms } from '../../lib/api'
import { domainIcon, slugToTitle } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { useT, t as _t } from '../../lib/i18n'

// Resolve an action's display label. Prefers labelKey (i18n) and falls back to
// the static English label so existing non-React consumers stay valid.
export function getActionLabel(action, translator) {
  if (!action) return ''
  const tr = translator || _t
  return action.labelKey ? tr(action.labelKey) : action.label
}

/**
 * Actions available per HA domain.
 *
 * Each action has:
 *   value       — unique key used as the <select> option value and for UI round-tripping
 *   label       — human-readable label shown in the dropdown
 *   haService   — the actual HA service name called (e.g. 'turn_on', 'set_hvac_mode')
 *   serviceData — optional payload merged into the HA service call data
 *
 * The automation builder stores { service_value, service: `domain.haService`, service_data }
 * in each action step, which ha_automations._action_to_ha() translates correctly to HA.
 */
// `label` stays in English as a non-React fallback (used by `t()` outside
// components and by `actionSummary`-style helpers). `labelKey` resolves to a
// localised string at render time via `getActionLabel`.
//
// Input prompts (needsInput[].label / placeholder) likewise carry *Key fields.
export const DOMAIN_ACTIONS = {
  light: [
    { value: 'turn_on',       labelKey: 'entitySelect.action.turnOn',           label: 'Turn On',           haService: 'turn_on' },
    { value: 'turn_off',      labelKey: 'entitySelect.action.turnOff',          label: 'Turn Off',          haService: 'turn_off' },
    { value: 'toggle',        labelKey: 'entitySelect.action.toggle',           label: 'Toggle',            haService: 'toggle' },
    { value: 'brightness_10', labelKey: 'entitySelect.action.brightness_10',    label: 'Brightness 10%',    haService: 'turn_on', serviceData: { brightness_pct: 10 } },
    { value: 'brightness_25', labelKey: 'entitySelect.action.brightness_25',    label: 'Brightness 25%',    haService: 'turn_on', serviceData: { brightness_pct: 25 } },
    { value: 'brightness_50', labelKey: 'entitySelect.action.brightness_50',    label: 'Brightness 50%',    haService: 'turn_on', serviceData: { brightness_pct: 50 } },
    { value: 'brightness_75', labelKey: 'entitySelect.action.brightness_75',    label: 'Brightness 75%',    haService: 'turn_on', serviceData: { brightness_pct: 75 } },
    { value: 'brightness_100',labelKey: 'entitySelect.action.brightness_100',   label: 'Brightness 100%',   haService: 'turn_on', serviceData: { brightness_pct: 100 } },
    { value: 'brightness_custom', labelKey: 'entitySelect.action.brightness_custom', label: 'Set Brightness…', haService: 'turn_on',
      needsInput: [{ key: 'brightness_pct', labelKey: 'entitySelect.input.brightnessPct', label: 'Brightness (1–100 %)', placeholder: '75', isNumber: true }] },
    { value: 'set_effect',       labelKey: 'entitySelect.action.set_effect',    label: 'Set Effect',        haService: 'turn_on',
      needsInput: [{ key: 'effect', labelKey: 'entitySelect.input.effect', label: 'Effect', fetchKey: 'effect_list', placeholderKey: 'entitySelect.input.selectFirst', placeholder: 'Select an entity first' }] },
    { value: 'color_warm',    labelKey: 'entitySelect.action.color_warm',       label: 'Color: Warm White', haService: 'turn_on', serviceData: { color_temp_kelvin: 2700 } },
    { value: 'color_neutral', labelKey: 'entitySelect.action.color_neutral',    label: 'Color: Neutral',    haService: 'turn_on', serviceData: { color_temp_kelvin: 4000 } },
    { value: 'color_cool',    labelKey: 'entitySelect.action.color_cool',       label: 'Color: Cool White', haService: 'turn_on', serviceData: { color_temp_kelvin: 6500 } },
    { value: 'color_red',     labelKey: 'entitySelect.action.color_red',        label: 'Color: Red',        haService: 'turn_on', serviceData: { rgb_color: [255, 30, 0] } },
    { value: 'color_green',   labelKey: 'entitySelect.action.color_green',      label: 'Color: Green',      haService: 'turn_on', serviceData: { rgb_color: [0, 200, 0] } },
    { value: 'color_blue',    labelKey: 'entitySelect.action.color_blue',       label: 'Color: Blue',       haService: 'turn_on', serviceData: { rgb_color: [0, 60, 255] } },
    { value: 'color_purple',  labelKey: 'entitySelect.action.color_purple',     label: 'Color: Purple',     haService: 'turn_on', serviceData: { rgb_color: [160, 0, 255] } },
  ],
  switch: [
    { value: 'turn_on',  labelKey: 'entitySelect.action.turnOn',  label: 'Turn On',  haService: 'turn_on' },
    { value: 'turn_off', labelKey: 'entitySelect.action.turnOff', label: 'Turn Off', haService: 'turn_off' },
    { value: 'toggle',   labelKey: 'entitySelect.action.toggle',  label: 'Toggle',   haService: 'toggle' },
  ],
  climate: [
    { value: 'turn_on',            labelKey: 'entitySelect.action.turnOn',            label: 'Turn On',          haService: 'turn_on' },
    { value: 'turn_off',           labelKey: 'entitySelect.action.turnOff',           label: 'Turn Off',         haService: 'turn_off' },
    { value: 'set_temp_custom',    labelKey: 'entitySelect.action.set_temp_custom',   label: 'Set Temperature…', haService: 'set_temperature',
      needsInput: [{ key: 'temperature', labelKey: 'entitySelect.input.temperatureC', label: 'Temperature (°C)', placeholder: '22', isNumber: true }] },
    { value: 'set_hvac_mode_dyn', labelKey: 'entitySelect.action.set_hvac_mode_dyn',  label: 'Set Mode',         haService: 'set_hvac_mode',
      needsInput: [{ key: 'hvac_mode', labelKey: 'entitySelect.input.hvacMode', label: 'HVAC mode', fetchKey: 'hvac_modes', placeholderKey: 'entitySelect.input.selectFirst', placeholder: 'Select an entity first' }] },
    { value: 'set_fan_mode_dyn',  labelKey: 'entitySelect.action.set_fan_mode_dyn',   label: 'Set Fan Mode',     haService: 'set_fan_mode',
      needsInput: [{ key: 'fan_mode', labelKey: 'entitySelect.input.fanMode', label: 'Fan mode', fetchKey: 'fan_modes', placeholderKey: 'entitySelect.input.selectFirst', placeholder: 'Select an entity first' }] },
    { value: 'set_preset_dyn',    labelKey: 'entitySelect.action.set_preset_dyn',    label: 'Set Preset',       haService: 'set_preset_mode',
      needsInput: [{ key: 'preset_mode', labelKey: 'entitySelect.input.preset', label: 'Preset', fetchKey: 'preset_modes', placeholderKey: 'entitySelect.input.selectFirst', placeholder: 'Select an entity first' }] },
    { value: 'hvac_cool',          labelKey: 'entitySelect.action.hvac_cool',         label: 'Mode: Cool',       haService: 'set_hvac_mode', serviceData: { hvac_mode: 'cool' } },
    { value: 'hvac_heat',          labelKey: 'entitySelect.action.hvac_heat',         label: 'Mode: Heat',       haService: 'set_hvac_mode', serviceData: { hvac_mode: 'heat' } },
    { value: 'hvac_auto',          labelKey: 'entitySelect.action.hvac_auto',         label: 'Mode: Auto',       haService: 'set_hvac_mode', serviceData: { hvac_mode: 'auto' } },
    { value: 'hvac_fan',           labelKey: 'entitySelect.action.hvac_fan',          label: 'Mode: Fan Only',   haService: 'set_hvac_mode', serviceData: { hvac_mode: 'fan_only' } },
    { value: 'hvac_dry',           labelKey: 'entitySelect.action.hvac_dry',          label: 'Mode: Dry',        haService: 'set_hvac_mode', serviceData: { hvac_mode: 'dry' } },
    { value: 'temp_18',            labelKey: 'entitySelect.action.temp_18',           label: 'Temperature 18°',  haService: 'set_temperature', serviceData: { temperature: 18 } },
    { value: 'temp_20',            labelKey: 'entitySelect.action.temp_20',           label: 'Temperature 20°',  haService: 'set_temperature', serviceData: { temperature: 20 } },
    { value: 'temp_22',            labelKey: 'entitySelect.action.temp_22',           label: 'Temperature 22°',  haService: 'set_temperature', serviceData: { temperature: 22 } },
    { value: 'temp_24',            labelKey: 'entitySelect.action.temp_24',           label: 'Temperature 24°',  haService: 'set_temperature', serviceData: { temperature: 24 } },
    { value: 'temp_26',            labelKey: 'entitySelect.action.temp_26',           label: 'Temperature 26°',  haService: 'set_temperature', serviceData: { temperature: 26 } },
    { value: 'fan_auto',           labelKey: 'entitySelect.action.fan_auto',          label: 'Fan: Auto',        haService: 'set_fan_mode', serviceData: { fan_mode: 'auto' } },
    { value: 'fan_low',            labelKey: 'entitySelect.action.fan_low',           label: 'Fan: Low',         haService: 'set_fan_mode', serviceData: { fan_mode: 'low' } },
    { value: 'fan_medium',         labelKey: 'entitySelect.action.fan_medium',        label: 'Fan: Medium',      haService: 'set_fan_mode', serviceData: { fan_mode: 'medium' } },
    { value: 'fan_high',           labelKey: 'entitySelect.action.fan_high',          label: 'Fan: High',        haService: 'set_fan_mode', serviceData: { fan_mode: 'high' } },
    { value: 'preset_eco',         labelKey: 'entitySelect.action.preset_eco',        label: 'Preset: Eco',      haService: 'set_preset_mode', serviceData: { preset_mode: 'eco' } },
    { value: 'preset_comfort',     labelKey: 'entitySelect.action.preset_comfort',    label: 'Preset: Comfort',  haService: 'set_preset_mode', serviceData: { preset_mode: 'comfort' } },
    { value: 'preset_away',        labelKey: 'entitySelect.action.preset_away',       label: 'Preset: Away',     haService: 'set_preset_mode', serviceData: { preset_mode: 'away' } },
    { value: 'preset_boost',       labelKey: 'entitySelect.action.preset_boost',      label: 'Preset: Boost',    haService: 'set_preset_mode', serviceData: { preset_mode: 'boost' } },
  ],
  cover: [
    { value: 'open_cover',        labelKey: 'entitySelect.action.open_cover',        label: 'Open',            haService: 'open_cover' },
    { value: 'close_cover',       labelKey: 'entitySelect.action.close_cover',       label: 'Close',           haService: 'close_cover' },
    { value: 'stop_cover',        labelKey: 'entitySelect.action.stop_cover',        label: 'Stop',            haService: 'stop_cover' },
    { value: 'toggle',            labelKey: 'entitySelect.action.toggle',            label: 'Toggle',          haService: 'toggle' },
    { value: 'position_custom',   labelKey: 'entitySelect.action.position_custom',   label: 'Set Position…',   haService: 'set_cover_position',
      needsInput: [{ key: 'position', labelKey: 'entitySelect.input.positionPct', label: 'Position %', placeholder: '50', isNumber: true }] },
    { value: 'position_0',        labelKey: 'entitySelect.action.position_0',        label: 'Position: 0%',    haService: 'set_cover_position', serviceData: { position: 0 } },
    { value: 'position_25',       labelKey: 'entitySelect.action.position_25',       label: 'Position: 25%',   haService: 'set_cover_position', serviceData: { position: 25 } },
    { value: 'position_50',       labelKey: 'entitySelect.action.position_50',       label: 'Position: 50%',   haService: 'set_cover_position', serviceData: { position: 50 } },
    { value: 'position_75',       labelKey: 'entitySelect.action.position_75',       label: 'Position: 75%',   haService: 'set_cover_position', serviceData: { position: 75 } },
    { value: 'position_100',      labelKey: 'entitySelect.action.position_100',      label: 'Position: 100%',  haService: 'set_cover_position', serviceData: { position: 100 } },
  ],
  media_player: [
    { value: 'turn_on',             labelKey: 'entitySelect.action.turnOn',                label: 'Turn On',           haService: 'turn_on' },
    { value: 'turn_off',            labelKey: 'entitySelect.action.turnOff',               label: 'Turn Off',          haService: 'turn_off' },
    { value: 'media_play',          labelKey: 'entitySelect.action.media_play',            label: 'Play',              haService: 'media_play' },
    { value: 'media_pause',         labelKey: 'entitySelect.action.media_pause',           label: 'Pause',             haService: 'media_pause' },
    { value: 'media_stop',          labelKey: 'entitySelect.action.media_stop',            label: 'Stop',              haService: 'media_stop' },
    { value: 'media_next_track',    labelKey: 'entitySelect.action.media_next_track',      label: 'Next Track',        haService: 'media_next_track' },
    { value: 'media_previous_track',labelKey: 'entitySelect.action.media_previous_track',  label: 'Previous Track',    haService: 'media_previous_track' },
    { value: 'volume_up',           labelKey: 'entitySelect.action.volume_up',             label: 'Volume Up',         haService: 'volume_up' },
    { value: 'volume_down',         labelKey: 'entitySelect.action.volume_down',           label: 'Volume Down',       haService: 'volume_down' },
    { value: 'volume_10',           labelKey: 'entitySelect.action.volume_10',             label: 'Volume 10%',        haService: 'volume_set', serviceData: { volume_level: 0.10 } },
    { value: 'volume_20',           labelKey: 'entitySelect.action.volume_20',             label: 'Volume 20%',        haService: 'volume_set', serviceData: { volume_level: 0.20 } },
    { value: 'volume_30',           labelKey: 'entitySelect.action.volume_30',             label: 'Volume 30%',        haService: 'volume_set', serviceData: { volume_level: 0.30 } },
    { value: 'volume_50',           labelKey: 'entitySelect.action.volume_50',             label: 'Volume 50%',        haService: 'volume_set', serviceData: { volume_level: 0.50 } },
    { value: 'volume_70',           labelKey: 'entitySelect.action.volume_70',             label: 'Volume 70%',        haService: 'volume_set', serviceData: { volume_level: 0.70 } },
    { value: 'mute_on',             labelKey: 'entitySelect.action.mute_on',               label: 'Mute',              haService: 'volume_mute', serviceData: { is_volume_muted: true } },
    { value: 'mute_off',            labelKey: 'entitySelect.action.mute_off',              label: 'Unmute',            haService: 'volume_mute', serviceData: { is_volume_muted: false } },
    { value: 'select_source',       labelKey: 'entitySelect.action.select_source',         label: 'Select Source',     haService: 'select_source',
      needsInput: [{ key: 'source', labelKey: 'entitySelect.input.sourceApp', label: 'Source / app', fetchKey: 'source_list', placeholderKey: 'entitySelect.input.selectFirst', placeholder: 'Select an entity first' }] },
    { value: 'shuffle_on',          labelKey: 'entitySelect.action.shuffle_on',            label: 'Shuffle On',        haService: 'shuffle_set', serviceData: { shuffle: true } },
    { value: 'shuffle_off',         labelKey: 'entitySelect.action.shuffle_off',           label: 'Shuffle Off',       haService: 'shuffle_set', serviceData: { shuffle: false } },
    { value: 'repeat_off',          labelKey: 'entitySelect.action.repeat_off',            label: 'Repeat: Off',       haService: 'repeat_set', serviceData: { repeat: 'off' } },
    { value: 'repeat_all',          labelKey: 'entitySelect.action.repeat_all',            label: 'Repeat: All',       haService: 'repeat_set', serviceData: { repeat: 'all' } },
    { value: 'repeat_one',          labelKey: 'entitySelect.action.repeat_one',            label: 'Repeat: One',       haService: 'repeat_set', serviceData: { repeat: 'one' } },
  ],
  lock: [
    { value: 'lock',   labelKey: 'entitySelect.action.lock',   label: 'Lock',   haService: 'lock' },
    { value: 'unlock', labelKey: 'entitySelect.action.unlock', label: 'Unlock', haService: 'unlock' },
  ],
  fan: [
    { value: 'turn_on',       labelKey: 'entitySelect.action.turnOn',        label: 'Turn On',      haService: 'turn_on' },
    { value: 'turn_off',      labelKey: 'entitySelect.action.turnOff',       label: 'Turn Off',     haService: 'turn_off' },
    { value: 'toggle',        labelKey: 'entitySelect.action.toggle',        label: 'Toggle',       haService: 'toggle' },
    { value: 'speed_low',     labelKey: 'entitySelect.action.speed_low',     label: 'Speed: Low',   haService: 'set_percentage', serviceData: { percentage: 33 } },
    { value: 'speed_medium',  labelKey: 'entitySelect.action.speed_medium',  label: 'Speed: Medium',haService: 'set_percentage', serviceData: { percentage: 66 } },
    { value: 'speed_high',    labelKey: 'entitySelect.action.speed_high',    label: 'Speed: High',  haService: 'set_percentage', serviceData: { percentage: 100 } },
    { value: 'oscillate_on',  labelKey: 'entitySelect.action.oscillate_on',  label: 'Oscillate On', haService: 'oscillate', serviceData: { oscillating: true } },
    { value: 'oscillate_off', labelKey: 'entitySelect.action.oscillate_off', label: 'Oscillate Off',haService: 'oscillate', serviceData: { oscillating: false } },
  ],
  script: [
    { value: 'turn_on', labelKey: 'entitySelect.action.run_script', label: 'Run Script', haService: 'turn_on' },
  ],
  input_boolean: [
    { value: 'turn_on',  labelKey: 'entitySelect.action.turnOn',  label: 'Turn On',  haService: 'turn_on' },
    { value: 'turn_off', labelKey: 'entitySelect.action.turnOff', label: 'Turn Off', haService: 'turn_off' },
    { value: 'toggle',   labelKey: 'entitySelect.action.toggle',  label: 'Toggle',   haService: 'toggle' },
  ],
}

const _DEFAULT_ACTIONS = [
  { value: 'turn_on',  labelKey: 'entitySelect.action.turnOn',  label: 'Turn On',  haService: 'turn_on' },
  { value: 'turn_off', labelKey: 'entitySelect.action.turnOff', label: 'Turn Off', haService: 'turn_off' },
  { value: 'toggle',   labelKey: 'entitySelect.action.toggle',  label: 'Toggle',   haService: 'toggle' },
]

export function getActionsForDomain(domain) {
  return DOMAIN_ACTIONS[domain] || _DEFAULT_ACTIONS
}

export function EntitySelect({ value, onChange, label, placeholder, domain: filterDomain, allowedDomains }) {
  const t = useT()
  const resolvedPlaceholder = placeholder ?? t('entitySelect.searchPlaceholder')
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: undefined, bottom: undefined, left: 0, width: 0 })
  const [search, setSearch] = useState('')
  const [entities, setEntities] = useState([])
  const [haRooms, setHaRooms] = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const searchInputRef = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Anchor the popover to the trigger BUTTON, not the outer wrapper.
  // The wrapper is a flex column that can be wider than the button when the
  // parent layout (e.g. a 2-col row in the automation/routine editor) lets
  // it stretch. Using the wrapper's rect made the popover render at the
  // wrapper's left edge while the button sat further right inside it.
  //
  // Keyboard handling on Android Chrome: autoFocus on the input fires
  // during React's commit, which on Android can fall just outside the
  // user-gesture window the browser requires to open the on-screen
  // keyboard. flushSync forces React to commit the open=true state
  // synchronously inside this click handler, so when we then call focus()
  // on the input ref, the call is still inside the click's task and the
  // gesture token is alive. The input has no autoFocus prop — we focus it
  // ourselves here.
  const handleOpen = () => {
    const anchor = triggerRef.current || ref.current
    if (anchor) {
      const rect = anchor.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      setDropdownPos({
        top: spaceBelow >= 280 ? rect.bottom + 4 : undefined,
        bottom: spaceBelow < 280 ? window.innerHeight - rect.top + 4 : undefined,
        left: rect.left,
        width: rect.width,
      })
    }
    if (open) {
      setOpen(false)
    } else {
      flushSync(() => setOpen(true))
      searchInputRef.current?.focus()
    }
  }

  // Keep the popover anchored to the trigger while it's open. The position
  // is computed once in handleOpen, but on Android the on-screen keyboard
  // shrinks the visual viewport and the Modal re-lays-out — the trigger
  // moves, our position:fixed popover doesn't, and they visually drift
  // apart until the keyboard closes. Re-anchor on scroll/resize and on
  // visualViewport changes so the popover follows the trigger live.
  useEffect(() => {
    if (!open) return
    const recalc = () => {
      const anchor = triggerRef.current || ref.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const vh = window.visualViewport?.height ?? window.innerHeight
      const spaceBelow = vh - rect.bottom
      setDropdownPos({
        top: spaceBelow >= 280 ? rect.bottom + 4 : undefined,
        bottom: spaceBelow < 280 ? vh - rect.top + 4 : undefined,
        left: rect.left,
        width: rect.width,
      })
    }
    window.addEventListener('scroll', recalc, true)
    window.addEventListener('resize', recalc)
    window.visualViewport?.addEventListener('resize', recalc)
    window.visualViewport?.addEventListener('scroll', recalc)
    return () => {
      window.removeEventListener('scroll', recalc, true)
      window.removeEventListener('resize', recalc)
      window.visualViewport?.removeEventListener('resize', recalc)
      window.visualViewport?.removeEventListener('scroll', recalc)
    }
  }, [open])

  useEffect(() => {
    if (!open || entities.length > 0) return
    const load = async () => {
      setLoading(true)
      try {
        const [entRes, roomsRes] = await Promise.all([
          getEntities(filterDomain || null),
          getRooms(),
        ])
        setEntities(entRes.entities || [])
        setHaRooms(roomsRes.rooms || [])
      } catch {}
      setLoading(false)
    }
    load()
  }, [open])

  // Build entity_id → room name map from HA areas
  const roomEntityMap = {}
  haRooms.forEach((area) => {
    (area.entities || []).forEach((eid) => {
      if (eid) roomEntityMap[eid] = area.name
    })
  })

  // Group entities by room
  const filteredEntities = entities.filter((e) => {
    if (allowedDomains && !allowedDomains.has(e.domain)) return false
    const q = search.toLowerCase()
    if (!q) return true
    // Match against entity_id and EVERY name source so a search for the
    // user's renamed label finds the device — earlier we only checked
    // friendly_name, which meant Ziggy renames (stored in display_name)
    // weren't searchable until HA's registry caught up.
    return e.entity_id.toLowerCase().includes(q)
        || (e.display_name || '').toLowerCase().includes(q)
        || (e.friendly_name || '').toLowerCase().includes(q)
  })

  const grouped = {}
  filteredEntities.forEach((e) => {
    const room = roomEntityMap[e.entity_id] || 'Other'
    if (!grouped[room]) grouped[room] = []
    grouped[room].push(e)
  })

  // Put rooms first, Other last
  const OTHER = 'Other'
  const roomOrder = [
    ...Object.keys(grouped).filter((r) => r !== OTHER).sort(),
    ...(grouped[OTHER] ? [OTHER] : []),
  ]

  const selectedEntity = entities.find((e) => e.entity_id === value)

  return (
    <div ref={ref} className="relative flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-ink-2">{label}</label>
      )}
      <button
        type="button"
        ref={triggerRef}
        onClick={handleOpen}
        className={cn(
          'h-10 rounded-xl px-3 text-sm text-left flex items-center gap-2',
          'bg-surface-2',
          'border border-line',
          'text-ink',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-accent'
        )}
      >
        {selectedEntity ? (
          <>
            <span>{domainIcon(selectedEntity.domain)}</span>
            <span className="flex-1 truncate text-sm">{selectedEntity.friendly_name || t('entitySelect.unnamedDevice')}</span>
          </>
        ) : value ? (
          <span className="flex-1 truncate text-ink-mute text-sm">{t('entitySelect.unknownDevice')}</span>
        ) : (
          <span className="text-ink-mute text-sm">{resolvedPlaceholder}</span>
        )}
        <ChevronDown size={14} className={cn('ml-auto text-ink-mute shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            bottom: dropdownPos.bottom,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9999,
          }}
          className="bg-surface rounded-xl shadow-2xl border border-line overflow-hidden"
        >
          <div className="p-2 border-b border-line flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('entitySelect.search')}
                className="w-full h-8 pl-7 pr-3 text-xs rounded-lg bg-surface-2 border-0 focus:outline-none text-ink placeholder:text-ink-mute"
              />
            </div>
            <button
              className="text-[10px] text-ink-mute hover:text-accent px-2 whitespace-nowrap transition-colors"
              onClick={() => {
                const v = window.prompt(t('entitySelect.manualPrompt'), value || '')
                if (v !== null) { onChange(v); setOpen(false) }
              }}
            >
              {t('entitySelect.manual')}
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {loading && (
              <div className="text-center py-4 text-xs text-ink-mute">{t('entitySelect.loading')}</div>
            )}
            {!loading && filteredEntities.length === 0 && (
              <div className="text-center py-4 text-xs text-ink-mute">{t('entitySelect.noEntities')}</div>
            )}

            {roomOrder.map((room) => (
              <div key={room}>
                <div className="px-3 pt-2.5 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                    {room === OTHER ? t('entitySelect.other') : room}
                  </span>
                </div>
                {grouped[room].map((e) => (
                  <button
                    key={e.entity_id}
                    onClick={() => { onChange(e.entity_id); setOpen(false); setSearch('') }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                      'hover:bg-surface-2',
                      value === e.entity_id && 'bg-accent-soft'
                    )}
                  >
                    <span className="text-base shrink-0">{domainIcon(e.domain)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-ink truncate">
                        {e.friendly_name || t('entitySelect.unnamedDevice')}
                      </p>
                    </div>
                    {e.state === 'on' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-ok-soft text-ok">
                        {t('entitySelect.stateOn')}
                      </span>
                    )}
                    {(e.state === 'unavailable' || e.state === 'unknown') && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-surface-2 text-ink-mute">
                        {t('entitySelect.stateOffline')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
