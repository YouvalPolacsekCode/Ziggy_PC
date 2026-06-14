// Option lists, domain constants, and state-table lookups used by the
// trigger / condition / action editors. Centralised so the wizard pieces
// stay slim and so future code (suggested templates, AI flows) can reuse
// the same vocabularies.
import { t as tStatic } from '../i18n'

export function getTriggerTypes() {
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

export function getTrackerTriggerStates() {
  return [
    { value: 'home',     label: tStatic('automations.trackerArrives') },
    { value: 'not_home', label: tStatic('automations.trackerLeaves') },
  ]
}

// `ziggy_intent` (Ziggy capabilities) is intentionally omitted here — it'll
// come back behind a feature flag as part of the broader capabilities project.
export function getActionTypes(opts = {}) {
  return [
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
}

// Per-locale template phrases for the "send intent" quick-pick. The strings
// are what the user inserts into the textarea AND what the NLU receives, so
// they intentionally come from the i18n table — Hebrew users get Hebrew
// templates, English users get English. The translator function is passed in
// so groups resolve under the active locale at render time.
export const getSendIntentGroups = (t) => [
  { key: 'gLights',  items: [
    t('automations.sendIntent.tpl.lights.turnOffAll'),
    t('automations.sendIntent.tpl.lights.turnOnRoom'),
    t('automations.sendIntent.tpl.lights.setBrightness'),
    t('automations.sendIntent.tpl.lights.setWarmWhite'),
  ]},
  { key: 'gClimate', items: [
    t('automations.sendIntent.tpl.climate.set22'),
    t('automations.sendIntent.tpl.climate.turnOn'),
    t('automations.sendIntent.tpl.climate.turnOff'),
    t('automations.sendIntent.tpl.climate.modeCool'),
  ]},
  { key: 'gTvMedia', items: [
    t('automations.sendIntent.tpl.tv.turnOn'),
    t('automations.sendIntent.tpl.tv.turnOff'),
    t('automations.sendIntent.tpl.tv.setVolume'),
  ]},
  { key: 'gCovers',  items: [
    t('automations.sendIntent.tpl.covers.open'),
    t('automations.sendIntent.tpl.covers.close'),
  ]},
  { key: 'gGeneral', items: [
    t('automations.sendIntent.tpl.general.allOff'),
    t('automations.sendIntent.tpl.general.goodnight'),
    t('automations.sendIntent.tpl.general.morning'),
  ]},
]

export const SENSOR_DOMAINS  = new Set(['sensor', 'binary_sensor'])
export const TRACKER_DOMAINS = new Set(['person', 'device_tracker'])

export function getBinarySensorTriggerStates() {
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

export function getBinarySensorConditionStates() {
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

export function getDefaultBinaryTrigger() {
  return [{ value: 'on', label: tStatic('automations.bin.turnsOn') }, { value: 'off', label: tStatic('automations.bin.turnsOff') }]
}

export function getDefaultBinaryCondition() {
  return [{ value: 'on', label: tStatic('automations.bin.on') }, { value: 'off', label: tStatic('automations.bin.off') }]
}

export function getConditionTypes() {
  return [
    { value: 'entity', label: tStatic('automations.cond.entityType') },
    { value: 'time',   label: tStatic('automations.cond.timeType') },
  ]
}

// State options for "controllable" non-binary entities (lights, switches, TVs, etc.)
// when used as a condition. Kept short — most users want simple is/is-not on/off.
export function getControllableConditionStates() {
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
