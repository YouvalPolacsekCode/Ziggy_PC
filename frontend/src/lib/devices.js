/**
 * Unified device model — the single source of truth that erases the
 * IR ⇄ HA split. Every device-rendering surface (cards, tiles, detail page,
 * remotes) should read from `deviceFacts(entity)` and write via
 * `sendDeviceCommand(entity, command, params)` so the same UI works
 * regardless of whether the backend is an HA entity, a learned IR device,
 * or a hybrid (HA entity with a linked IR codeset).
 *
 *   entity (HA or IR-shaped)  ─►  deviceFacts()  ─►  { kind, isOn, capabilities, ... }
 *   deviceFacts + command name ─►  sendDeviceCommand()  ─►  routes to IR or HA
 *
 * `kind` is the canonical user-facing label ("tv", "ac", "light", "motion") —
 * NOT the HA domain. This is what every renderer should switch on.
 */

import { callHaService, irSend, irSendChannel, irSetAcTemperature, irRunSequence, controlDevice } from './api'
import { DOMAIN_REGISTRY } from './domainRegistry'
import { lightRgb, humanizeSlug } from './utils'
import { t as i18nT } from './i18n'

// ─── Kind taxonomy ──────────────────────────────────────────────────────────
//
// One "kind" per visually-distinct device category. Used by DeviceCard,
// DeviceRemote, icons, and color tinting. This is intentionally coarser than
// HA domains (we treat all media_player as 'tv', all climate as 'ac') because
// users think in product categories, not protocol abstractions.

export const KIND = {
  LIGHT:        'light',
  SWITCH:       'switch',
  PLUG:         'plug',
  TV:           'tv',
  SOUNDBAR:     'soundbar',
  RECEIVER:     'receiver',
  PROJECTOR:    'projector',
  AC:           'ac',
  FAN:          'fan',
  COVER:        'cover',
  LOCK:         'lock',
  ALARM:        'alarm',
  VACUUM:       'vacuum',
  HUMIDIFIER:   'humidifier',
  WATER_HEATER: 'water_heater',
  VALVE:        'valve',
  LAWN_MOWER:   'lawn_mower',
  CAMERA:       'camera',
  SENSOR:       'sensor',
  MOTION:       'motion',
  DOOR:         'door',
  WINDOW:       'window',
  LEAK:         'leak',
  OCCUPANCY:    'occupancy',
  SMOKE:        'smoke',
  TEMPERATURE:  'temperature',
  HUMIDITY:     'humidity',
  POWER_METER:  'power_meter',
  BINARY:       'binary',
  PERSON:       'person',
  UNKNOWN:      'unknown',
}

// Icon design notes (KEEP THIS NEXT TO THE TABLE):
//
//   - Every kind needs an icon that's visually distinct from its neighbours
//     in a dense grid. `switch` and `plug` used to share 🔌 — you couldn't
//     tell a wall switch from a smart plug in a room view. `humidifier`,
//     `leak`, and `humidity` all used water-blue glyphs and merged into a
//     single blob. Cleaned up below.
//
//   - Reserved emoji (don't use here, they collide with app chrome):
//       ⚡  — Routines default + Quick Asks
//       ✦   — Pinned shortcuts default
//       ⚙️  — Settings menu
//       🏠  — Sidebar Home + room photos fallback
//     `power_meter` lost ⚡ because the activity feed mixes routine fires
//     with sensor entries and they read as the same thing.
const KIND_META = {
  light:        { label: 'Light',      tint: 'var(--gold)',   group: 'lights',   toggle: true,  controllable: true,  icon: '💡' },
  switch:       { label: 'Switch',     tint: 'var(--info)',   group: 'switches', toggle: true,  controllable: true,  icon: '🎛️' },
  plug:         { label: 'Plug',       tint: 'var(--info)',   group: 'switches', toggle: true,  controllable: true,  icon: '🔌' },
  tv:           { label: 'TV',         tint: 'var(--accent)', group: 'media',    toggle: true,  controllable: true,  icon: '📺' },
  soundbar:     { label: 'Soundbar',   tint: 'var(--accent)', group: 'media',    toggle: true,  controllable: true,  icon: '🔊' },
  receiver:     { label: 'Receiver',   tint: 'var(--accent)', group: 'media',    toggle: true,  controllable: true,  icon: '🎚️' },
  projector:    { label: 'Projector',  tint: 'var(--accent)', group: 'media',    toggle: true,  controllable: true,  icon: '📽️' },
  ac:           { label: 'AC',         tint: 'var(--info)',   group: 'climate',  toggle: true,  controllable: true,  icon: '❄️' },
  fan:          { label: 'Fan',        tint: 'var(--info)',   group: 'climate',  toggle: true,  controllable: true,  icon: '💨' },
  cover:        { label: 'Blind',      tint: 'var(--ink-mute)', group: 'cover',  toggle: false, controllable: true,  icon: '🪟' },
  lock:         { label: 'Lock',       tint: 'var(--warn)',   group: 'security', toggle: false, controllable: true,  icon: '🔒' },
  alarm:        { label: 'Alarm',      tint: 'var(--err)',    group: 'security', toggle: false, controllable: true,  icon: '🛡️' },
  vacuum:       { label: 'Vacuum',     tint: 'var(--ink-mute)', group: 'other',  toggle: false, controllable: true,  icon: '🤖' },
  humidifier:   { label: 'Humidifier', tint: 'var(--info)',   group: 'climate',  toggle: true,  controllable: true,  icon: '💧' },
  water_heater: { label: 'Heater',     tint: 'var(--err)',    group: 'water',    toggle: true,  controllable: true,  icon: '🔥' },
  valve:        { label: 'Valve',      tint: 'var(--info)',   group: 'water',    toggle: false, controllable: true,  icon: '🚰' },
  lawn_mower:   { label: 'Mower',      tint: 'var(--ok)',     group: 'other',    toggle: false, controllable: true,  icon: '🌿' },
  camera:       { label: 'Camera',     tint: 'var(--info)',   group: 'security', toggle: false, controllable: false, icon: '📷' },
  sensor:       { label: 'Sensor',     tint: 'var(--ink-mute)', group: 'sensors',toggle: false, controllable: false, icon: '📡' },
  motion:       { label: 'Motion',     tint: 'var(--info)',   group: 'sensors',  toggle: false, controllable: false, icon: '🚶' },
  door:         { label: 'Door',       tint: 'var(--ink-mute)', group: 'sensors',toggle: false, controllable: false, icon: '🚪' },
  window:       { label: 'Window',     tint: 'var(--ink-mute)', group: 'sensors',toggle: false, controllable: false, icon: '🪟' },
  leak:         { label: 'Leak',       tint: 'var(--err)',    group: 'sensors',  toggle: false, controllable: false, icon: '🚱' },
  occupancy:    { label: 'Presence',   tint: 'var(--info)',   group: 'sensors',  toggle: false, controllable: false, icon: '👥' },
  smoke:        { label: 'Smoke',      tint: 'var(--err)',    group: 'sensors',  toggle: false, controllable: false, icon: '🚨' },
  temperature:  { label: 'Temp',       tint: 'var(--info)',   group: 'sensors',  toggle: false, controllable: false, icon: '🌡️' },
  humidity:     { label: 'Humidity',   tint: 'var(--info)',   group: 'sensors',  toggle: false, controllable: false, icon: '💧' },
  power_meter:  { label: 'Power',      tint: 'var(--warn)',   group: 'sensors',  toggle: false, controllable: false, icon: '🔋' },
  binary:       { label: 'Binary',     tint: 'var(--ink-mute)', group: 'sensors',toggle: false, controllable: false, icon: '⚪' },
  person:       { label: 'Person',     tint: 'var(--info)',   group: 'other',    toggle: false, controllable: false, icon: '👤' },
  unknown:      { label: 'Device',     tint: 'var(--ink-mute)', group: 'other',  toggle: false, controllable: false, icon: '📦' },
}

export function kindMeta(kind) { return KIND_META[kind] || KIND_META.unknown }

// ─── kind resolution ────────────────────────────────────────────────────────

const IR_TYPE_TO_KIND = {
  tv:        KIND.TV,
  soundbar:  KIND.SOUNDBAR,
  receiver:  KIND.RECEIVER,
  projector: KIND.PROJECTOR,
  ac:        KIND.AC,
  fan:       KIND.FAN,
  custom:    KIND.SWITCH,
}

// Map binary_sensor device_class → kind. Anything not listed falls through
// to KIND.BINARY (a generic on/off indicator) so unknown sensor types still
// render rather than disappear.
const BINARY_CLASS_TO_KIND = {
  motion:      KIND.MOTION,
  occupancy:   KIND.OCCUPANCY,
  presence:    KIND.OCCUPANCY,
  door:        KIND.DOOR,
  window:      KIND.WINDOW,
  moisture:    KIND.LEAK,
  smoke:       KIND.SMOKE,
  gas:         KIND.SMOKE,
  opening:     KIND.DOOR,
}

// Inferred-class fallback for binary_sensors that ship without a
// `device_class`. The Sonoff SNZB-04 Pro (PR2) is the canonical offender —
// ZHA exposes its door-state binary_sensor with `device_class=null`, so
// without this fallback every Pro door sensor reads as a generic on/off
// indicator and Ziggy says "On / Off" instead of "Open / Closed" in
// every surface (Devices page, Rooms page, device detail, voice intents).
//
// Each row is [regex, deviceClass, kind]. Order matters: more specific
// classes first. First match wins. Word-boundary regex prevents `door`
// matching "indoor" or `gas` matching "vegas".
//
// Used in two places:
//   - getKind() — drives icon, color tint, primary-entity picking
//   - inferBinarySensorClass() — used by formatEntityState in lib/utils.js
//     so the Devices list / room sensor strip get the right "Open/Closed"
//     style label without needing to duplicate this table.
const _BINARY_INFERRED_TABLE = [
  [/\b(smoke|fire)\b/,                            'smoke',     KIND.SMOKE],
  [/\bgas\b/,                                     'gas',       KIND.SMOKE],
  [/\b(co|carbon[_\s-]?monoxide)\b/,              'gas',       KIND.SMOKE],
  [/\b(leak|moisture|flood|water[_\s-]?leak)\b/,  'moisture',  KIND.LEAK],
  [/\b(motion)\b/,                                'motion',    KIND.MOTION],
  [/\b(occupancy|presence)\b/,                    'occupancy', KIND.OCCUPANCY],
  [/\b(door|opening|contact)\b/,                  'door',      KIND.DOOR],
  [/\b(window)\b/,                                'window',    KIND.WINDOW],
]

function _binaryInferredMatch(entity) {
  // Search both the entity_id slug (HA-assigned, integration-controlled)
  // and any user-facing name. A user who renamed their entity to "Living
  // room main window" telegraphs the intent even when ZHA didn't.
  const hay = [
    entity?.entity_id || '',
    entity?.friendly_name || '',
    entity?.display_name || '',
    entity?.attributes?.friendly_name || '',
  ].join(' ').toLowerCase()
  if (!hay.trim()) return null
  for (const [re, dc, kind] of _BINARY_INFERRED_TABLE) {
    if (re.test(hay)) return { deviceClass: dc, kind }
  }
  return null
}

function _binaryKindFromText(entity) {
  return _binaryInferredMatch(entity)?.kind || null
}

/**
 * Return the effective `device_class` for a binary_sensor — the real HA
 * value if set, or the keyword-inferred fallback. Exposed so non-deviceFacts
 * call sites (the Devices list's formatEntityState, the room SensorsStrip)
 * can render correct "Open / Closed", "Motion / Clear", etc. labels for
 * sensors whose integration omitted device_class. Returns `null` when no
 * signal is available.
 */
export function inferBinarySensorClass(entity) {
  if (!entity) return null
  if ((entity.domain || (entity.entity_id || '').split('.')[0]) !== 'binary_sensor') {
    return entity.device_class || null
  }
  if (entity.device_class) return entity.device_class
  return _binaryInferredMatch(entity)?.deviceClass || null
}

const SENSOR_CLASS_TO_KIND = {
  temperature: KIND.TEMPERATURE,
  humidity:    KIND.HUMIDITY,
  power:       KIND.POWER_METER,
  energy:      KIND.POWER_METER,
  illuminance: KIND.SENSOR,
}

// Vendor heuristic: Switcher Touch / Heater / V2-V4 boiler models register
// as `switch.*` entities in HA but are functionally boilers with a timer
// affordance. Route them to KIND.WATER_HEATER so BoilerRemote (with timer
// presets) and the 🔥 icon render instead of the generic SwitchRemote + 🔌.
//
// Previously only matched `switch.switcher_touch*` / `switch.switcher_heater*`
// by entity_id prefix — anyone who renamed their entity in HA (or owns a
// boiler-flavoured Switcher model with a different default ID) saw it
// classified as a plain switch, with mismatched icons between the Devices
// list (🔌) and the detail page (🔥).
//
// Now also matches:
//   - other Switcher boiler models by entity_id (v2/v4 water-heater variants)
//   - friendly_name keywords (boiler / water heater / geyser, EN + Hebrew)
// Switcher product names that explicitly mean "boiler/water heater" — used as
// keywords in BOTH entity_id slugs and friendly names. Mini Plug / Power Plug
// / Breeze (AC) / Runner (blinds) are intentionally NOT here.
const _SWITCHER_BOILER_KEYWORDS = [
  'switcher_touch', 'switcher_heater', 'switcher_water',
  'switcher_v2', 'switcher_v4',
  'switcher touch', 'switcher heater', 'switcher water', 'switcher v2', 'switcher v4',
]
const _SWITCHER_NON_BOILER_KEYWORDS = [
  'switcher_mini', 'switcher_power_plug', 'switcher_breeze', 'switcher_runner',
  'switcher mini', 'switcher power plug', 'switcher breeze', 'switcher runner',
]

function _matchesAny(haystack, needles) {
  for (const n of needles) {
    if (haystack.includes(n)) return true
  }
  return false
}

function _isWaterHeaterEntity(entity) {
  const eid  = (entity?.entity_id || '').toLowerCase()
  // Pull every plausible name source — backend enrichment doesn't always
  // populate friendly_name (especially when Ziggy has a custom display name
  // or when HA exposes the entity without a friendly_name attribute).
  const name = [
    entity?.friendly_name,
    entity?.display_name,
    entity?.name,
    entity?.attributes?.friendly_name,
  ].filter(Boolean).join(' ').toLowerCase()

  if (!eid.startsWith('switch.')) return false

  // Combine both signals into one haystack — covers entity_ids that were
  // slugged from the HA device name (where the boiler keyword ends up in
  // the slug) AND entities whose ID is a generic `switch.switcher_kis_*`
  // but whose friendly_name carries the product line.
  const haystack = `${eid} ${name}`

  // Disqualify known non-boiler Switcher models first so a "Switcher Mini"
  // smart plug doesn't get the boiler icon.
  if (_matchesAny(haystack, _SWITCHER_NON_BOILER_KEYWORDS)) return false

  // Positive matches — explicit boiler product lines.
  if (_matchesAny(haystack, _SWITCHER_BOILER_KEYWORDS)) return true

  // Generic keywords (any vendor, any switch entity).
  if (/\b(boiler|water[\s_-]?heater|geyser|water boiler)\b/.test(name)) return true
  // Hebrew (Israeli market — primary Switcher install base). דוד = boiler.
  if (name.includes('דוד') || name.includes('מחמם מים')) return true

  // Last-resort fallback: a generic Switcher entity (`switcher_kis_*` etc.)
  // with no further hints — Switcher's flagship product in the Israeli
  // market IS the boiler, so default to water_heater rather than plain switch.
  // The non-boiler keyword list above already excluded Mini Plug / Power
  // Plug / Breeze AC / Runner.
  if (haystack.includes('switcher')) return true

  return false
}

export function getKind(entity) {
  if (!entity) return KIND.UNKNOWN
  if (entity._ir && entity._irDevice) {
    return IR_TYPE_TO_KIND[entity._irDevice.type] || KIND.SWITCH
  }
  if (_isWaterHeaterEntity(entity)) {
    return KIND.WATER_HEATER
  }
  const eid = entity.entity_id || ''
  const domain = entity.domain || eid.split('.')[0]
  switch (domain) {
    case 'light':               return KIND.LIGHT
    case 'switch':              return KIND.SWITCH
    case 'input_boolean':       return KIND.SWITCH
    case 'climate':             return KIND.AC
    case 'fan':                 return KIND.FAN
    case 'media_player':        return KIND.TV
    case 'cover':               return KIND.COVER
    case 'lock':                return KIND.LOCK
    case 'alarm_control_panel': return KIND.ALARM
    case 'vacuum':              return KIND.VACUUM
    case 'humidifier':          return KIND.HUMIDIFIER
    case 'water_heater':        return KIND.WATER_HEATER
    case 'valve':               return KIND.VALVE
    case 'lawn_mower':          return KIND.LAWN_MOWER
    case 'camera':              return KIND.CAMERA
    case 'person':              return KIND.PERSON
    case 'binary_sensor':
      // device_class is the canonical signal. When it's set, trust it.
      // Many integrations (notably ZHA's SNZB-04 Pro) omit device_class
      // entirely — fall back to a keyword scan of the entity_id + name so
      // an obvious door/window/motion sensor still renders with the right
      // kind, icon, and state label instead of generic "On/Off".
      return BINARY_CLASS_TO_KIND[entity.device_class]
          || _binaryKindFromText(entity)
          || KIND.BINARY
    case 'sensor':
      return SENSOR_CLASS_TO_KIND[entity.device_class] || KIND.SENSOR
    default:                    return KIND.UNKNOWN
  }
}

// ─── On / off / available ───────────────────────────────────────────────────

const MEDIA_ACTIVE = new Set(['on', 'playing', 'paused', 'idle'])

export function isOn(entity) {
  if (!entity) return false
  const domain = entity.domain || entity.entity_id?.split('.')[0]
  const state  = entity._ir ? (entity.assumed_state || entity.state) : entity.state
  if (state === 'unavailable' || state == null) return false
  if (domain === 'media_player') return MEDIA_ACTIVE.has(state)
  if (domain === 'climate')      return state !== 'off' && state !== 'unavailable'
  if (domain === 'cover')        return state === 'open' || state === 'opening'
  if (domain === 'lock')         return state === 'unlocked'
  if (domain === 'alarm_control_panel') return state.startsWith('armed_') || state === 'triggered'
  if (domain === 'vacuum')       return state === 'cleaning' || state === 'returning'
  if (domain === 'binary_sensor') return state === 'on'
  return state === 'on'
}

export function isAvailable(entity) {
  if (!entity) return false
  if (entity._ir) return true                       // IR is always "available" (assumed)
  return entity.state !== 'unavailable' && entity.state != null
}

// ─── Capabilities ───────────────────────────────────────────────────────────
//
// A `capabilities` set tells renderers what controls to expose. This is the
// abstraction that makes IR-AC and HA-climate render the same remote — both
// declare the same logical capabilities, even though the backends differ.

const HA_FEATURE = {
  // Light
  LIGHT_BRIGHTNESS:    1,
  LIGHT_COLOR_TEMP:    2,
  LIGHT_EFFECT:        4,
  LIGHT_FLASH:         8,
  LIGHT_COLOR:        16,
  LIGHT_TRANSITION:   32,
  LIGHT_WHITE_VALUE:  128,
  // Climate
  CLIMATE_TARGET_TEMPERATURE:        1,
  CLIMATE_TARGET_TEMPERATURE_RANGE:  2,
  CLIMATE_TARGET_HUMIDITY:           4,
  CLIMATE_FAN_MODE:                  8,
  CLIMATE_PRESET_MODE:              16,
  CLIMATE_SWING_MODE:               32,
  // Media
  MEDIA_PAUSE:           1,
  MEDIA_SEEK:            2,
  MEDIA_VOLUME_SET:      4,
  MEDIA_VOLUME_MUTE:     8,
  MEDIA_PREVIOUS_TRACK: 16,
  MEDIA_NEXT_TRACK:     32,
  MEDIA_TURN_ON:       128,
  MEDIA_TURN_OFF:      256,
  MEDIA_PLAY_MEDIA:    512,
  MEDIA_VOLUME_STEP: 1024,
  MEDIA_SELECT_SOURCE:    2048,
  MEDIA_STOP:          4096,
  MEDIA_PLAY:        16384,
  MEDIA_SHUFFLE_SET: 32768,
  MEDIA_SELECT_SOUND_MODE: 65536,
  MEDIA_REPEAT_SET: 262144,
  // Cover
  COVER_OPEN:        1,
  COVER_CLOSE:       2,
  COVER_SET_POSITION: 4,
  COVER_STOP:        8,
  // Fan
  FAN_SET_SPEED:        1,
  FAN_OSCILLATE:        2,
  FAN_DIRECTION:        4,
  FAN_PRESET_MODE:      8,
}

function hasFeature(entity, bit) {
  return ((entity.supported_features ?? 0) & bit) === bit
}

function irHasCommand(entity, cmd) {
  if (!entity._ir || !entity._irDevice) return false
  const learned = new Set(entity._irDevice.learned_commands || [])
  return learned.has(cmd)
}

function linkedIrHasCommand(entity, cmd) {
  const ir = entity._linkedIr
  if (!ir) return false
  const learned = new Set(ir.learned_commands || [])
  return learned.has(cmd)
}

/**
 * Strict check — has this exact raw IR command name been learned on this
 * entity (pure-IR OR linked IR)?
 *
 * Different from `commandAvailable`, which resolves a logical command
 * through IR_COMMAND_MAP and accepts any of the candidates as "available".
 * Use this when you need to know whether a specific code is learned —
 * e.g. should the discrete "Turn on" button render alongside the toggle.
 */
export function irLearned(entity, irCommandName) {
  if (!entity || !irCommandName) return false
  if (irHasCommand(entity, irCommandName)) return true
  if (linkedIrHasCommand(entity, irCommandName)) return true
  return false
}

/**
 * Return the user-defined custom commands on a device (or its linked IR),
 * in display order. Used by remotes to render the Extras chip row.
 */
export function customIrCommands(entity) {
  const ir = entity?._irDevice || entity?._linkedIr
  if (!ir) return []
  const list = Array.isArray(ir.custom_commands) ? ir.custom_commands : []
  return list.map((c) => ({
    id: c.id,
    label: c.label || (c.id || '').replace(/_/g, ' ').replace(/^\w/, (s) => s.toUpperCase()),
    learned: (ir.learned_commands || []).includes(c.id),
  }))
}

/**
 * Return the user-defined sequences (macros) on a device, as
 * { name, steps[] } objects. Used by remotes to render macro chips.
 */
export function irSequences(entity) {
  const ir = entity?._irDevice || entity?._linkedIr
  if (!ir || !ir.sequences) return []
  return Object.entries(ir.sequences).map(([name, steps]) => ({
    name,
    label: name.replace(/_/g, ' ').replace(/^\w/, (s) => s.toUpperCase()),
    steps: Array.isArray(steps) ? steps : [],
  }))
}

/**
 * Learned IR commands NOT already represented by a built-in remote control.
 * Pass `consumeSet` — the Set of raw IR command names the remote renders
 * natively (e.g. for ACRemote: power, mode_*, fan_*, swing_*, temp_*).
 * Returned entries use the custom_commands label if defined, else a
 * humanised version of the id. The remote shows these as an Extras chip row.
 */
export function extrasForRemote(entity, consumeSet) {
  const ir = entity?._irDevice || entity?._linkedIr
  if (!ir) return []
  const customLabels = {}
  for (const c of (ir.custom_commands || [])) customLabels[c.id] = c.label || c.id
  return (ir.learned_commands || [])
    .filter((c) => !consumeSet.has(c))
    .map((id) => ({
      id,
      label: customLabels[id] || id.replace(/_/g, ' ').replace(/^\w/, (s) => s.toUpperCase()),
    }))
}

/**
 * Is a logical command dispatchable on this entity right now?
 *
 *   - HA entity:           true if the entity is available (no IR codes needed).
 *   - Pure IR / linked IR: true only if the underlying raw IR command has been
 *                          learned. Used to grey out buttons whose code is missing.
 *
 * For commands whose IR mapping varies by params (set_hvac_mode/cool vs
 * /heat, set_fan_mode/low vs /high…), pass the relevant params so the
 * right raw command is checked.
 */
export function commandAvailable(entity, command, params = {}) {
  if (!entity) return false
  if (entity.state === 'unavailable') return false
  const kind = getKind(entity)
  const isIr = !!entity._ir

  // Toggle expands to power_on / power_off — both use the same IR `power` code
  // in practice, so check that one if learned.
  const probe = command === 'toggle' ? 'power_on' : command

  // HA path: always available unless we've ruled it out above.
  if (!isIr) {
    // If HA can't natively serve it but a linked IR provides the fallback,
    // require the linked IR command to be learned.
    const domain = entity.domain || entity.entity_id?.split('.')[0]
    const haSpec = HA_SERVICE_BY_DOMAIN[domain]?.[probe]
    if (haSpec) return true
    // Special HA computed paths (e.g. temp_up/temp_down on climate) — these
    // always work as long as HA reports a target temp.
    if ((probe === 'temp_up' || probe === 'temp_down') && kind === KIND.AC) return true
    // Fall through to linked-IR check below.
    if (entity._linkedIr) {
      const candidates = resolveIrCommandName(kind, probe, params)
      if (!candidates) return false
      return candidates.some((c) => linkedIrHasCommand(entity, c))
    }
    return false
  }

  // Pure IR path.
  const candidates = resolveIrCommandName(kind, probe, params)
  if (!candidates) return false
  return candidates.some((c) => irHasCommand(entity, c))
}

/**
 * Returns the capability set for an entity. Capabilities are unified across
 * IR and HA — a TV with both an HA media_player and a learned IR codeset
 * declares everything either backend can do.
 */
export function getCapabilities(entity) {
  const caps = new Set()
  if (!entity) return caps
  const kind = getKind(entity)
  const isIr = !!entity._ir

  // Power is universal for anything controllable
  const meta = kindMeta(kind)
  if (meta.controllable) caps.add('power')

  switch (kind) {
    case KIND.LIGHT: {
      caps.add('brightness')
      if (hasFeature(entity, HA_FEATURE.LIGHT_COLOR_TEMP) || entity.color_temp != null) caps.add('color_temp')
      if (hasFeature(entity, HA_FEATURE.LIGHT_COLOR) || (entity.supported_color_modes || []).some(m => ['hs','rgb','xy','rgbw','rgbww'].includes(m))) caps.add('color')
      if (hasFeature(entity, HA_FEATURE.LIGHT_EFFECT) || (entity.effect_list || []).length) caps.add('effects')
      break
    }
    case KIND.AC: {
      if (isIr) {
        // IR AC: capability surface is the learned-command intersection of
        // standard AC commands. Always show core temp + mode if AC type.
        caps.add('temp')
        caps.add('hvac_mode')
        if (irHasCommand(entity, 'fan_low') || irHasCommand(entity, 'fan_medium') || irHasCommand(entity, 'fan_high') || irHasCommand(entity, 'fan_auto')) caps.add('fan_mode')
        if (irHasCommand(entity, 'swing_on') || irHasCommand(entity, 'swing_off')) caps.add('swing')
      } else {
        if (hasFeature(entity, HA_FEATURE.CLIMATE_TARGET_TEMPERATURE)) caps.add('temp')
        if ((entity.hvac_modes || []).length) caps.add('hvac_mode')
        if ((entity.fan_modes || []).length)  caps.add('fan_mode')
        if ((entity.swing_modes || []).length) caps.add('swing')
        if ((entity.preset_modes || []).length) caps.add('preset')
      }
      break
    }
    case KIND.TV:
    case KIND.SOUNDBAR:
    case KIND.PROJECTOR: {
      if (isIr) {
        if (irHasCommand(entity, 'volume_up') || irHasCommand(entity, 'volume_down')) caps.add('volume_step')
        if (irHasCommand(entity, 'mute')) caps.add('mute')
        if (irHasCommand(entity, 'channel_up') || irHasCommand(entity, 'channel_down')) caps.add('channel_step')
        if (irHasCommand(entity, 'nav_ok') || irHasCommand(entity, 'nav_up')) caps.add('dpad')
        const digits = ['digit_0','digit_1','digit_2','digit_3','digit_4','digit_5','digit_6','digit_7','digit_8','digit_9']
        if (digits.every(d => irHasCommand(entity, d))) caps.add('numpad')
        const sourceCmds = ['hdmi_1','hdmi_2','hdmi_3','input','source_tv','source_av','source_pc']
        if (sourceCmds.some(c => irHasCommand(entity, c))) caps.add('sources')
        if (irHasCommand(entity, 'back')) caps.add('back')
        if (irHasCommand(entity, 'home')) caps.add('home')
        if (irHasCommand(entity, 'menu')) caps.add('menu')
        if (irHasCommand(entity, 'play') || irHasCommand(entity, 'pause')) caps.add('play_pause')
      } else {
        if (hasFeature(entity, HA_FEATURE.MEDIA_PLAY) || hasFeature(entity, HA_FEATURE.MEDIA_PAUSE)) caps.add('play_pause')
        if (hasFeature(entity, HA_FEATURE.MEDIA_VOLUME_SET) || hasFeature(entity, HA_FEATURE.MEDIA_VOLUME_STEP)) caps.add('volume')
        if (hasFeature(entity, HA_FEATURE.MEDIA_VOLUME_MUTE)) caps.add('mute')
        if (hasFeature(entity, HA_FEATURE.MEDIA_PREVIOUS_TRACK)) caps.add('prev_track')
        if (hasFeature(entity, HA_FEATURE.MEDIA_NEXT_TRACK))     caps.add('next_track')
        if (hasFeature(entity, HA_FEATURE.MEDIA_SELECT_SOURCE) && (entity.source_list || []).length) caps.add('sources')
        if (hasFeature(entity, HA_FEATURE.MEDIA_SELECT_SOUND_MODE) && (entity.sound_mode_list || []).length) caps.add('sound_mode')
        if (hasFeature(entity, HA_FEATURE.MEDIA_SHUFFLE_SET))   caps.add('shuffle')
        if (hasFeature(entity, HA_FEATURE.MEDIA_REPEAT_SET))    caps.add('repeat')
      }
      // Hybrid: HA covers state, IR fills gaps (e.g. HDMI inputs that HA doesn't expose)
      if (entity._linkedIr) {
        const linked = entity._linkedIr
        const learned = new Set(linked.learned_commands || [])
        if (learned.has('nav_ok') || learned.has('nav_up')) caps.add('dpad')
        const digits = ['digit_0','digit_1','digit_2','digit_3','digit_4','digit_5','digit_6','digit_7','digit_8','digit_9']
        if (digits.every(d => learned.has(d))) caps.add('numpad')
        const sourceCmds = ['hdmi_1','hdmi_2','hdmi_3','input']
        if (sourceCmds.some(c => learned.has(c))) caps.add('sources')
        if (learned.has('back')) caps.add('back')
        if (learned.has('home')) caps.add('home')
        if (learned.has('menu')) caps.add('menu')
        if (learned.has('channel_up') || learned.has('channel_down')) caps.add('channel_step')
      }
      break
    }
    case KIND.FAN: {
      if (isIr) {
        if (irHasCommand(entity, 'speed_low') || irHasCommand(entity, 'speed_medium') || irHasCommand(entity, 'speed_high')) caps.add('speed_step')
      } else {
        if (hasFeature(entity, HA_FEATURE.FAN_SET_SPEED)) caps.add('speed')
        if (hasFeature(entity, HA_FEATURE.FAN_OSCILLATE)) caps.add('oscillate')
        if ((entity.preset_modes || []).length) caps.add('preset')
      }
      break
    }
    case KIND.COVER: {
      if (hasFeature(entity, HA_FEATURE.COVER_OPEN))         caps.add('open')
      if (hasFeature(entity, HA_FEATURE.COVER_CLOSE))        caps.add('close')
      if (hasFeature(entity, HA_FEATURE.COVER_STOP))         caps.add('stop')
      if (hasFeature(entity, HA_FEATURE.COVER_SET_POSITION)) caps.add('position')
      break
    }
    case KIND.LOCK: {
      caps.add('lock_unlock')
      break
    }
    default: break
  }
  return caps
}

// ─── Facts: normalized state for renderers ──────────────────────────────────

const KIND_STATE_LABEL = {
  light:    (e) => isOn(e) ? 'On' : 'Off',
  switch:   (e) => isOn(e) ? 'On' : 'Off',
  plug:     (e) => isOn(e) ? 'On' : 'Off',
  tv:       (e) => {
    const s = e._ir ? (e.assumed_state || 'off') : e.state
    return ({ playing: 'Playing', paused: 'Paused', idle: 'Idle', on: 'On', off: 'Off', standby: 'Standby' })[s] || (s ? s[0].toUpperCase() + s.slice(1) : 'Off')
  },
  soundbar: (e) => isOn(e) ? 'On' : 'Off',
  projector:(e) => isOn(e) ? 'On' : 'Off',
  ac:       (e) => {
    const s = e._ir ? (e.assumed_state || 'off') : e.state
    return ({ off: 'Off', heat: 'Heating', cool: 'Cooling', heat_cool: 'Auto', auto: 'Auto', fan_only: 'Fan', dry: 'Dry' })[s] || (s || 'Off')
  },
  fan:      (e) => isOn(e) ? 'On' : 'Off',
  cover:    (e) => ({ open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' })[e.state] || e.state,
  lock:     (e) => ({ locked: 'Locked', unlocked: 'Unlocked', locking: 'Locking…', unlocking: 'Unlocking…' })[e.state] || e.state,
  vacuum:   (e) => ({ cleaning: 'Cleaning', docked: 'Docked', paused: 'Paused', idle: 'Idle', returning: 'Returning' })[e.state] || e.state,
  motion:   (e) => e.state === 'on' ? 'Motion' : 'Clear',
  door:     (e) => e.state === 'on' ? 'Open' : 'Closed',
  window:   (e) => e.state === 'on' ? 'Open' : 'Closed',
  leak:     (e) => e.state === 'on' ? 'Wet' : 'Dry',
  occupancy:(e) => e.state === 'on' ? 'Present' : 'Empty',
  smoke:    (e) => e.state === 'on' ? 'Detected' : 'Clear',
  temperature: (e) => {
    const v = parseFloat(e.state)
    if (Number.isNaN(v)) return e.state
    const unit = e.unit_of_measurement || '°'
    return `${Math.round(v * 10) / 10}${unit}`
  },
  humidity: (e) => {
    const v = parseFloat(e.state)
    if (Number.isNaN(v)) return e.state
    return `${Math.round(v)}%`
  },
  power_meter: (e) => {
    const v = parseFloat(e.state)
    if (Number.isNaN(v)) return e.state
    const unit = e.unit_of_measurement || 'W'
    return `${Math.round(v * 10) / 10} ${unit}`
  },
  person:   (e) => e.state === 'home' ? 'Home' : 'Away',
  alarm:    (e) => DOMAIN_REGISTRY.alarm_control_panel?.stateLabels[e.state] || e.state,
  binary:   (e) => e.state === 'on' ? 'On' : 'Off',
  sensor:   (e) => {
    if (e.unit_of_measurement) {
      const v = parseFloat(e.state)
      if (!Number.isNaN(v)) return `${v} ${e.unit_of_measurement}`
    }
    return e.state
  },
  camera:   (e) => e.state === 'recording' ? 'Recording' : 'Live',
  humidifier:   (e) => isOn(e) ? 'On' : 'Off',
  water_heater: (e) => DOMAIN_REGISTRY.water_heater?.stateLabels[e.state] || e.state,
  valve:    (e) => ({ open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' })[e.state] || e.state,
  lawn_mower: (e) => DOMAIN_REGISTRY.lawn_mower?.stateLabels[e.state] || e.state,
  unknown:  (e) => e.state || '—',
}

function brightnessPct(entity) {
  if (entity.brightness == null) return null
  return Math.round((entity.brightness / 255) * 100)
}

// Live tint for the device — overrides meta.tint when the entity carries a
// real color (lights with rgb_color or color_temp). Used by tile/row cards so
// the room page reflects the same color the device detail page renders.
function liveTintFor(entity, kind, meta, isOnState) {
  if (kind === KIND.LIGHT && isOnState) {
    const rgb = lightRgb(entity)
    if (rgb) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
  }
  return meta.tint
}

// Resolve a tint string to a raw [r, g, b] when possible. Used so callers
// (DeviceCard tile) can compose tinted backgrounds and pick a readable
// foreground based on luminance. Returns null for CSS variable tints.
function tintToRgb(tint) {
  if (!tint || typeof tint !== 'string') return null
  const m = tint.match(/rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (!m) return null
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
}

// Perceived luminance (sRGB) — used to choose ink/bg as readable foreground.
export function tintLuminance(tint) {
  const rgb = tintToRgb(tint)
  if (!rgb) return null
  const [r, g, b] = rgb.map(v => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * The normalized facts for any device. This is what cards, tiles, and remote
 * components consume. Keeps the IR/HA branching out of every render path.
 */
export function deviceFacts(entity) {
  if (!entity) {
    return { kind: KIND.UNKNOWN, isOn: false, isAvailable: false, capabilities: new Set() }
  }
  const kind = getKind(entity)
  const meta = kindMeta(kind)
  const isIr = !!entity._ir
  const hasIr = isIr || !!entity._linkedIr
  const linkedIr = entity._linkedIr || (isIr ? entity._irDevice : null)
  const labelFn = KIND_STATE_LABEL[kind] || KIND_STATE_LABEL.unknown
  const isOnState = isOn(entity)
  // Single customer-facing label for every non-on/off state. HA splits
  // `unavailable` (lost connection) from `unknown` (never reported) but we
  // collapse both — plus null/empty for malformed payloads — to one
  // "Unavailable" string. Without this, the kind-specific label functions
  // silently mapped `unknown`/`unavailable` into their off-branch ("Closed",
  // "Clear", "Off"), which lied to the user about the device's real state.
  const _rawState = entity._ir ? (entity.assumed_state || entity.state) : entity.state
  const _isUnavailable = _rawState === 'unavailable' || _rawState === 'unknown' || _rawState == null || _rawState === ''
  const _stateLabel = _isUnavailable ? i18nT('common.unavailable') : labelFn(entity)
  return {
    // Reference to the original entity — so downstream components can call
    // commandAvailable(facts.entity, ...) without re-threading the prop.
    entity,
    id:           entity.entity_id,
    irId:         linkedIr?.id || null,
    name:         entity.display_name || entity.friendly_name || humanizeSlug(entity.entity_id) || 'Device',
    domain:       entity.domain || entity.entity_id?.split('.')[0],
    deviceClass:  entity.device_class || null,
    kind,
    meta,
    // Live, kind-aware tint. For lights this is the real bulb color (rgb_color
    // or color-temp-derived) when on; falls back to meta.tint for everything
    // else and for lights that are off.
    tint:         liveTintFor(entity, kind, meta, isOnState),
    isOn:         isOnState,
    isAvailable:  isAvailable(entity),
    isIr,
    hasIr,
    linkedIr,
    state:        entity.state,
    stateLabel:   _stateLabel,
    capabilities: getCapabilities(entity),
    // Light values
    brightness:   brightnessPct(entity),
    colorTemp:    entity.color_temp,
    colorTempKelvin: entity.color_temp_kelvin,
    rgbColor:     entity.rgb_color,
    // Climate values
    targetTemp:   entity.temperature ?? entity.target_temp ?? null,
    currentTemp:  entity.current_temperature ?? null,
    hvacMode:     entity.hvac_mode ?? null,
    hvacModes:    entity.hvac_modes ?? [],
    fanMode:      entity.fan_mode ?? null,
    fanModes:     entity.fan_modes ?? [],
    swingMode:    entity.swing_mode ?? null,
    swingModes:   entity.swing_modes ?? [],
    presetMode:   entity.preset_mode ?? null,
    presetModes:  entity.preset_modes ?? [],
    minTemp:      entity.min_temp ?? 16,
    maxTemp:      entity.max_temp ?? 30,
    tempStep:     entity.target_temp_step ?? 1,
    // Media values
    volume:       entity.volume_level != null ? Math.round(entity.volume_level * 100) : null,
    muted:        entity.is_volume_muted ?? null,
    source:       entity.source ?? null,
    sourceList:   entity.source_list ?? [],
    appList:      entity.app_list ?? [],
    soundMode:    entity.sound_mode ?? null,
    soundModeList:entity.sound_mode_list ?? [],
    shuffle:      entity.shuffle ?? null,
    repeat:       entity.repeat ?? null,
    mediaTitle:   entity.media_title ?? null,
    mediaArtist:  entity.media_artist ?? null,
    // Cover values
    position:     entity.current_position ?? null,
    // Sensor values
    reading:      entity.state,
    unit:         entity.unit_of_measurement ?? null,
    battery:      entity.battery ?? null,
    rssi:         entity.rssi ?? entity.signal_strength ?? null,
    // Diagnostics
    lastChanged:  entity.last_changed ?? null,
    lastUpdated:  entity.last_updated ?? null,
  }
}

// ─── Command dispatch — backend-agnostic ────────────────────────────────────
//
// Pages call `sendDeviceCommand(entity, command, params)`. Routing rules:
//
//  - HA entity (no IR):   call HA service.
//  - IR entity:           map to IR command name, call irSend().
//  - Hybrid (HA+IR):      prefer HA. For IR-only commands (HDMI source,
//                         numeric channel, etc.), fall back to the linked IR.
//
// `command` is one of a small canonical vocabulary. Adding a new command
// here is the only place to wire a new logical action — every UI consumer
// uses the same name.

const HA_SERVICE_BY_DOMAIN = {
  light: {
    power_on:     { service: 'turn_on',  data: (p) => ({}) },
    power_off:    { service: 'turn_off', data: (p) => ({}) },
    set_brightness: { service: 'turn_on',  data: (p) => ({ brightness_pct: p.value }) },
    set_color_temp: { service: 'turn_on',  data: (p) => p.kelvin ? { color_temp_kelvin: p.kelvin } : { color_temp: p.mireds } },
    set_color:      { service: 'turn_on',  data: (p) => ({ rgb_color: p.rgb }) },
    set_effect:     { service: 'turn_on',  data: (p) => ({ effect: p.effect }) },
  },
  switch: {
    power_on:  { service: 'turn_on',  data: () => ({}) },
    power_off: { service: 'turn_off', data: () => ({}) },
    toggle:    { service: 'toggle',   data: () => ({}) },
  },
  input_boolean: {
    power_on:  { service: 'turn_on',  data: () => ({}) },
    power_off: { service: 'turn_off', data: () => ({}) },
    toggle:    { service: 'toggle',   data: () => ({}) },
  },
  climate: {
    power_on:        { service: 'turn_on',  data: () => ({}) },
    power_off:       { service: 'turn_off', data: () => ({}) },
    set_temp:        { service: 'set_temperature', data: (p) => ({ temperature: p.value }) },
    set_hvac_mode:   { service: 'set_hvac_mode',   data: (p) => ({ hvac_mode: p.mode }) },
    set_fan_mode:    { service: 'set_fan_mode',    data: (p) => ({ fan_mode: p.mode }) },
    set_swing_mode:  { service: 'set_swing_mode',  data: (p) => ({ swing_mode: p.mode }) },
    set_preset_mode: { service: 'set_preset_mode', data: (p) => ({ preset_mode: p.mode }) },
  },
  media_player: {
    power_on:       { service: 'turn_on',          data: () => ({}) },
    power_off:      { service: 'turn_off',         data: () => ({}) },
    play_pause:     { service: 'media_play_pause', data: () => ({}) },
    play:           { service: 'media_play',       data: () => ({}) },
    pause:          { service: 'media_pause',      data: () => ({}) },
    stop:           { service: 'media_stop',       data: () => ({}) },
    next_track:     { service: 'media_next_track', data: () => ({}) },
    prev_track:     { service: 'media_previous_track', data: () => ({}) },
    set_volume:     { service: 'volume_set',       data: (p) => ({ volume_level: p.value / 100 }) },
    media_seek:     { service: 'media_seek',       data: (p) => ({ seek_position: p.position }) },
    volume_up:      { service: 'volume_up',        data: () => ({}) },
    volume_down:    { service: 'volume_down',      data: () => ({}) },
    mute_toggle:    { service: 'volume_mute',      data: (p) => ({ is_volume_muted: p.muted }) },
    set_source:     { service: 'select_source',    data: (p) => ({ source: p.source }) },
    set_sound_mode: { service: 'select_sound_mode',data: (p) => ({ sound_mode: p.mode }) },
    set_shuffle:    { service: 'shuffle_set',      data: (p) => ({ shuffle: p.shuffle }) },
    set_repeat:     { service: 'repeat_set',       data: (p) => ({ repeat: p.repeat }) },
  },
  fan: {
    power_on:    { service: 'turn_on',        data: () => ({}) },
    power_off:   { service: 'turn_off',       data: () => ({}) },
    toggle:      { service: 'toggle',         data: () => ({}) },
    set_speed:   { service: 'set_percentage', data: (p) => ({ percentage: p.value }) },
    set_preset:  { service: 'set_preset_mode',data: (p) => ({ preset_mode: p.mode }) },
  },
  cover: {
    open:         { service: 'open_cover',     data: () => ({}) },
    close:        { service: 'close_cover',    data: () => ({}) },
    stop:         { service: 'stop_cover',     data: () => ({}) },
    set_position: { service: 'set_cover_position', data: (p) => ({ position: p.value }) },
  },
  lock: {
    lock:   { service: 'lock',   data: () => ({}) },
    unlock: { service: 'unlock', data: () => ({}) },
    open:   { service: 'open',   data: () => ({}) },
  },
  vacuum: {
    start:  { service: 'start',          data: () => ({}) },
    pause:  { service: 'pause',          data: () => ({}) },
    stop:   { service: 'stop',           data: () => ({}) },
    dock:   { service: 'return_to_base', data: () => ({}) },
    locate: { service: 'locate',         data: () => ({}) },
  },
  alarm_control_panel: {
    arm_away:    { service: 'alarm_arm_away',     data: () => ({}) },
    arm_home:    { service: 'alarm_arm_home',     data: () => ({}) },
    arm_night:   { service: 'alarm_arm_night',    data: () => ({}) },
    arm_vacation:{ service: 'alarm_arm_vacation', data: () => ({}) },
    disarm:      { service: 'alarm_disarm',       data: () => ({}) },
  },
  humidifier: {
    power_on:  { service: 'turn_on',  data: () => ({}) },
    power_off: { service: 'turn_off', data: () => ({}) },
    set_mode:  { service: 'set_mode', data: (p) => ({ mode: p.mode }) },
  },
}

// IR command vocabulary for each kind. Maps logical `command` → list of IR
// command names to try in order. The first one the device has learned wins.
//
// Discrete power_on/power_off list themselves FIRST so a learned discrete
// code wins over the toggle. Falls back to 'power' (toggle) when the
// discrete code isn't learned — handles both common remote types.
const IR_COMMAND_MAP = {
  ac: {
    power_on:  ['power_on', 'power'],
    power_off: ['power_off', 'power'],
    toggle:    ['power'],
    temp_up:   ['temp_up', 'temperature_up'],
    temp_down: ['temp_down', 'temperature_down'],
    set_hvac_mode: {
      cool:     ['mode_cool'],
      heat:     ['mode_heat'],
      fan_only: ['mode_fan'],
      auto:     ['mode_auto'],
      dry:      ['mode_dry'],
    },
    set_fan_mode: {
      low:    ['fan_low'],
      medium: ['fan_medium'],
      high:   ['fan_high'],
      auto:   ['fan_auto'],
      turbo:  ['fan_turbo'],
    },
    set_swing_mode: {
      on:         ['swing_on'],
      off:        ['swing_off'],
      vertical:   ['swing_vertical'],
      horizontal: ['swing_horizontal'],
    },
  },
  tv: {
    power_on:    ['power_on', 'power'],
    power_off:   ['power_off', 'power'],
    toggle:      ['power'],
    volume_up:   ['volume_up'],
    volume_down: ['volume_down'],
    mute_toggle: ['mute'],
    channel_up:  ['channel_up'],
    channel_down:['channel_down'],
    play:        ['play'],
    pause:       ['pause'],
    play_pause:  ['play_pause', 'play'],
    stop:        ['stop'],
    next_track:  ['next', 'next_track'],
    prev_track:  ['previous', 'prev_track'],
    rewind:      ['rewind'],
    fast_forward:['fast_forward'],
    record:      ['record'],
    nav_up:      ['nav_up'],
    nav_down:    ['nav_down'],
    nav_left:    ['nav_left'],
    nav_right:   ['nav_right'],
    nav_ok:      ['nav_ok', 'ok'],
    back:        ['back'],
    home:        ['home'],
    menu:        ['menu'],
    exit:        ['exit'],
    info:        ['info'],
    settings:    ['settings'],
    guide:       ['guide'],
  },
  soundbar: {
    power_on:    ['power_on', 'power'],
    power_off:   ['power_off', 'power'],
    toggle:      ['power'],
    volume_up:   ['volume_up'],
    volume_down: ['volume_down'],
    mute_toggle: ['mute'],
    next_track:  ['next'],
    prev_track:  ['previous'],
  },
  receiver: {
    power_on:    ['power_on', 'power'],
    power_off:   ['power_off', 'power'],
    toggle:      ['power'],
    volume_up:   ['volume_up'],
    volume_down: ['volume_down'],
    mute_toggle: ['mute'],
    nav_up:      ['nav_up'],
    nav_down:    ['nav_down'],
    nav_left:    ['nav_left'],
    nav_right:   ['nav_right'],
    nav_ok:      ['nav_ok'],
    back:        ['back'],
    menu:        ['menu'],
    info:        ['info'],
  },
  projector: {
    power_on:    ['power_on', 'power'],
    power_off:   ['power_off', 'power'],
    toggle:      ['power'],
    nav_up:      ['nav_up'],
    nav_down:    ['nav_down'],
    nav_left:    ['nav_left'],
    nav_right:   ['nav_right'],
    nav_ok:      ['nav_ok'],
    back:        ['back'],
    menu:        ['menu'],
  },
  fan: {
    power_on:    ['power_on', 'power'],
    power_off:   ['power_off', 'power'],
    toggle:      ['power'],
    speed_step:  ['speed_up', 'speed_step'],
    set_speed_preset: {
      low:    ['speed_low'],
      medium: ['speed_medium'],
      high:   ['speed_high'],
    },
  },
  switch: {
    power_on:  ['power_on', 'power'],
    power_off: ['power_off', 'power'],
    toggle:    ['power'],
  },
}

function resolveIrCommandName(kind, command, params) {
  const map = IR_COMMAND_MAP[kind]
  if (!map) return null
  const entry = map[command]
  if (!entry) return null
  if (Array.isArray(entry)) return entry
  // entry is an object keyed by param value (e.g. { cool: ['mode_cool'] })
  const key = params?.mode ?? params?.value ?? null
  if (key && entry[key]) return entry[key]
  return null
}

function pickLearnedIrCommand(irDevice, candidates) {
  if (!irDevice || !candidates) return null
  const learned = new Set(irDevice.learned_commands || [])
  for (const c of candidates) {
    if (learned.has(c)) return c
  }
  return null
}

/**
 * Send a command to a device. Routes to HA or IR (or both for hybrid)
 * based on what the entity supports. Returns the underlying API promise.
 *
 * Examples:
 *   sendDeviceCommand(lightEntity, 'set_brightness', { value: 70 })
 *   sendDeviceCommand(tvEntity, 'volume_up')
 *   sendDeviceCommand(acEntity, 'set_hvac_mode', { mode: 'cool' })
 *   sendDeviceCommand(coverEntity, 'set_position', { value: 50 })
 *   sendDeviceCommand(tvEntity, 'send_channel', { channel: 42 })   // IR-only
 */
export async function sendDeviceCommand(entity, command, params = {}) {
  if (!entity) throw new Error('sendDeviceCommand: no entity')
  const kind   = getKind(entity)
  const isIr   = !!entity._ir
  const linked = entity._linkedIr

  // Special case: numeric channel (IR-only feature)
  if (command === 'send_channel') {
    const ir = isIr ? entity._irDevice : linked
    if (!ir) throw new Error('Channel entry requires an IR device')
    return irSendChannel(ir.id, params.channel)
  }

  // Run a named macro sequence (e.g. "netflix"). IR-only feature.
  if (command === 'run_sequence') {
    const ir = isIr ? entity._irDevice : linked
    if (!ir) throw new Error('Sequences require an IR device')
    return irRunSequence(ir.id, params.name)
  }

  // Fire a specific learned IR code by name. Used by remotes to render the
  // Extras row of custom user-defined commands; bypasses IR_COMMAND_MAP.
  if (command === 'ir_raw') {
    const ir = isIr ? entity._irDevice : linked
    if (!ir) throw new Error('Custom commands require an IR device')
    return irSend(ir.id, params.name)
  }

  // Normalize HA-flavored aliases to Ziggy's canonical command vocabulary so
  // every caller (curated remotes, dynamic UI, automation paths) reaches the
  // same dispatch. Without this, `sendDeviceCommand(entity, 'turn_on')` from
  // any new component throws "HA domain X doesn't support command turn_on"
  // since HA_SERVICE_BY_DOMAIN keys on `power_on`/`power_off` only.
  if (command === 'turn_on')  command = 'power_on'
  if (command === 'turn_off') command = 'power_off'

  // Toggle expands to power_on or power_off based on current state
  if (command === 'toggle') {
    command = isOn(entity) ? 'power_off' : 'power_on'
  }

  // IR AC set_temp — backend picks discrete vs step path based on what the
  // user has learned (temp_<N> vs temp_up/temp_down).
  if (command === 'set_temp' && isIr && kind === KIND.AC) {
    const ir = entity._irDevice
    if (!ir) throw new Error('Temperature requires an IR device')
    return irSetAcTemperature(ir.id, Math.round(params.value), params.mode)
  }

  // HA climate has no native temp_up/temp_down — compute next target from
  // current attributes and call set_temperature, clamped to min/max.
  if ((command === 'temp_up' || command === 'temp_down') && !isIr && kind === KIND.AC) {
    const step = entity.target_temp_step || 1
    const cur  = entity.temperature ?? entity.target_temp ?? entity.current_temperature ?? 22
    const min  = entity.min_temp ?? 16
    const max  = entity.max_temp ?? 30
    const next = command === 'temp_up' ? cur + step : cur - step
    return callHaService('climate', 'set_temperature', {
      entity_id: entity.entity_id,
      temperature: Math.max(min, Math.min(max, next)),
    })
  }

  // HA media_player has no "next input" service — rotate through source_list.
  // IR devices typically have a learned 'input' command (single press cycles).
  if (command === 'next_source') {
    if (!isIr) {
      const list = entity.source_list || []
      if (list.length === 0) {
        // Fall back to IR 'input' if linked
        if (linked) {
          const learned = new Set(linked.learned_commands || [])
          if (learned.has('input')) return irSend(linked.id, 'input')
        }
        throw new Error('No source list available')
      }
      const idx = Math.max(0, list.indexOf(entity.source))
      const nextSource = list[(idx + 1) % list.length]
      return callHaService('media_player', 'select_source', {
        entity_id: entity.entity_id,
        source: nextSource,
      })
    }
    // IR-only: fire 'input' if learned
    const ir = entity._irDevice
    const learned = new Set(ir?.learned_commands || [])
    if (learned.has('input')) return irSend(ir.id, 'input')
    throw new Error('Device has no learned "input" command')
  }

  // Try HA first if available
  if (!isIr) {
    const domain = entity.domain || entity.entity_id?.split('.')[0]
    const map    = HA_SERVICE_BY_DOMAIN[domain]
    const spec   = map?.[command]
    if (spec) {
      // Power on/off → use controlDevice. That endpoint is fire-and-forget
      // + optimistic WS broadcast, so the store updates immediately and
      // every device card / remote across the app reflects the new state
      // without waiting for HA's 1-3s ack on Wi-Fi devices (Switcher etc.).
      // Pattern logging happens in the background task on the backend.
      if (command === 'power_on' || command === 'power_off') {
        return controlDevice(entity.entity_id, command === 'power_on' ? 'turn_on' : 'turn_off', 'ui')
      }
      const data = { entity_id: entity.entity_id, ...spec.data(params) }
      return callHaService(domain, spec.service, data)
    }

    // HA doesn't expose this command — fall back to linked IR if available
    if (linked) {
      const candidates = resolveIrCommandName(kind, command, params)
      const cmd = pickLearnedIrCommand(linked, candidates)
      if (cmd) return irSend(linked.id, cmd)
    }

    throw new Error(`HA domain ${domain} doesn't support command ${command}`)
  }

  // Pure IR path
  const candidates = resolveIrCommandName(kind, command, params)
  if (!candidates) throw new Error(`IR kind ${kind} doesn't support command ${command}`)
  const ir = entity._irDevice
  const cmd = pickLearnedIrCommand(ir, candidates)
  if (!cmd) throw new Error(`IR device hasn't learned: ${candidates.join('/')}`)
  return irSend(ir.id, cmd)
}

// ─── Grouping & sorting ─────────────────────────────────────────────────────

const KIND_PRIORITY = {
  light: 1, switch: 2, plug: 2,
  tv: 3, soundbar: 3, projector: 3,
  ac: 4, fan: 4, humidifier: 4,
  cover: 5, lock: 6, alarm: 6,
  vacuum: 7, lawn_mower: 7,
  camera: 8,
  temperature: 9, humidity: 9, power_meter: 9,
  motion: 10, occupancy: 10, door: 10, window: 10, leak: 10, smoke: 10,
  sensor: 11, binary: 11,
  person: 12, unknown: 99,
}

export function kindSortKey(kind) { return KIND_PRIORITY[kind] || 99 }

// ─── Room sensor lookup ─────────────────────────────────────────────────────
//
// Find a sensor reading (by device_class) within a room's device list.
// Falls back to a sibling reading absorbed into a multi-entity device's
// `_group.metrics` — without this, a multi-sensor node (Roni Room Sensor:
// temp + humidity + battery) loses its humidity chip on the room tile
// because grouping collapsed humidity into a metric pill on the temperature
// primary. The return shape is compatible with the existing callers that
// read `.state`, `.unit_of_measurement`, or `.attributes.unit_of_measurement`.
const _BAD_SENSOR_STATES = new Set(['unavailable', 'unknown', null, undefined])
export function findRoomMetric(roomDevices, deviceClass, entityMap) {
  if (!Array.isArray(roomDevices)) return null
  // 1. A full entity in the room whose own device_class matches.
  for (const d of roomDevices) {
    const e = entityMap?.[d.entity_id]
    if (e && e.device_class === deviceClass && !_BAD_SENSOR_STATES.has(e.state)) {
      return e
    }
    // Some surfaces pass spread-shape rows (entity_id, state, domain, device_class,
    // …) without going through entityMap. Fall back to the row itself.
    if (!e && d.device_class === deviceClass && !_BAD_SENSOR_STATES.has(d.state)) {
      return d
    }
  }
  // 2. A metric pill on any group in the room — sibling that grouping absorbed.
  for (const d of roomDevices) {
    const m = (d._group?.metrics || []).find((p) => p.device_class === deviceClass)
    if (m && !_BAD_SENSOR_STATES.has(m.state)) {
      return { state: m.state, unit_of_measurement: m.unit, device_class: deviceClass }
    }
  }
  return null
}

// Sort an entity list by kind, then by name within kind.
export function sortByKind(entities) {
  return [...entities].sort((a, b) => {
    const ka = kindSortKey(getKind(a))
    const kb = kindSortKey(getKind(b))
    if (ka !== kb) return ka - kb
    return (a.friendly_name || a.entity_id || '').localeCompare(b.friendly_name || b.entity_id || '')
  })
}
