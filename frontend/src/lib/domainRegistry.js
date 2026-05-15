/**
 * Frontend mirror of services/domain_registry.py.
 *
 * To add support for a new device type:
 *   1. Add an entry to DOMAIN_REGISTRY in services/domain_registry.py (backend).
 *   2. Add the matching entry here.
 *
 * Everything else — icons, grouping, toggleability, active-state detection,
 * GenericControls buttons, CONTROLLABLE_DOMAINS, TOGGLEABLE_DOMAINS — is
 * automatically derived from these entries. No other files need to change.
 */

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const DOMAIN_REGISTRY = {

  // ── Lights ────────────────────────────────────────────────────────────────
  light: {
    label: 'Light', icon: '💡', group: 'lights',
    controllable: true, toggleable: true,
    activeStates: ['on'],
    restoreOnReconnect: true, safetyLevel: 'none',
    actions: {
      turn_on:  { service: 'turn_on',  label: 'Turn On' },
      turn_off: { service: 'turn_off', label: 'Turn Off' },
    },
    stateLabels: { on: 'On', off: 'Off' },
  },

  // ── Switches ──────────────────────────────────────────────────────────────
  switch: {
    label: 'Switch', icon: '🔌', group: 'switches',
    controllable: true, toggleable: true,
    activeStates: ['on'],
    restoreOnReconnect: true, safetyLevel: 'none',
    actions: {
      turn_on:  { service: 'turn_on',  label: 'Turn On' },
      turn_off: { service: 'turn_off', label: 'Turn Off' },
      toggle:   { service: 'toggle',   label: 'Toggle' },
    },
    stateLabels: { on: 'On', off: 'Off' },
  },

  input_boolean: {
    label: 'Toggle', icon: '🔘', group: 'switches',
    controllable: true, toggleable: true,
    activeStates: ['on'],
    restoreOnReconnect: false, safetyLevel: 'none',
    actions: {
      turn_on:  { service: 'turn_on',  label: 'Turn On' },
      turn_off: { service: 'turn_off', label: 'Turn Off' },
      toggle:   { service: 'toggle',   label: 'Toggle' },
    },
    stateLabels: { on: 'On', off: 'Off' },
  },

  // ── Climate ───────────────────────────────────────────────────────────────
  climate: {
    label: 'Climate', icon: '🌡️', group: 'climate',
    controllable: true, toggleable: true,
    activeStates: ['heat', 'cool', 'heat_cool', 'auto', 'fan_only', 'dry'],
    restoreOnReconnect: true, safetyLevel: 'none',
    actions: {
      turn_on:  { service: 'turn_on',  label: 'Turn On' },
      turn_off: { service: 'turn_off', label: 'Turn Off' },
    },
    stateLabels: {
      off: 'Off', heat: 'Heating', cool: 'Cooling',
      heat_cool: 'Heat/Cool', auto: 'Auto', fan_only: 'Fan', dry: 'Dry',
    },
    chips: [
      { attr: 'hvac_modes',   service: 'set_hvac_mode',   param: 'hvac_mode',   currentAttr: 'hvac_mode',   label: 'Mode' },
      { attr: 'fan_modes',    service: 'set_fan_mode',    param: 'fan_mode',    currentAttr: 'fan_mode',    label: 'Fan' },
      { attr: 'preset_modes', service: 'set_preset_mode', param: 'preset_mode', currentAttr: 'preset_mode', label: 'Preset' },
      { attr: 'swing_modes',  service: 'set_swing_mode',  param: 'swing_mode',  currentAttr: 'swing_mode',  label: 'Swing' },
    ],
  },

  fan: {
    label: 'Fan', icon: '💨', group: 'climate',
    controllable: true, toggleable: true,
    activeStates: ['on'],
    restoreOnReconnect: true, safetyLevel: 'none',
    actions: {
      turn_on:  { service: 'turn_on',  label: 'Turn On' },
      turn_off: { service: 'turn_off', label: 'Turn Off' },
      toggle:   { service: 'toggle',   label: 'Toggle' },
    },
    stateLabels: { on: 'On', off: 'Off' },
    chips: [
      { attr: 'preset_modes', service: 'set_preset_mode', param: 'preset_mode', currentAttr: 'preset_mode', label: 'Preset' },
    ],
  },

  humidifier: {
    label: 'Humidifier', icon: '💧', group: 'climate',
    controllable: true, toggleable: true,
    activeStates: ['on'],
    restoreOnReconnect: true, safetyLevel: 'none',
    actions: {
      turn_on:  { service: 'turn_on',  label: 'Turn On' },
      turn_off: { service: 'turn_off', label: 'Turn Off' },
    },
    stateLabels: { on: 'On', off: 'Off' },
    chips: [
      { attr: 'available_modes', service: 'set_mode', param: 'mode', currentAttr: 'mode', label: 'Mode' },
    ],
  },

  water_heater: {
    label: 'Water Heater', icon: '🔥', group: 'water',
    controllable: true, toggleable: false,
    activeStates: ['on', 'heat_pump', 'electric', 'gas', 'performance', 'eco'],
    restoreOnReconnect: false, safetyLevel: 'none',
    actions: {
      turn_on:  { service: 'turn_on',  label: 'Turn On' },
      turn_off: { service: 'turn_off', label: 'Turn Off' },
    },
    stateLabels: { on: 'On', off: 'Off', eco: 'Eco', performance: 'Performance' },
    chips: [
      { attr: 'operation_list', service: 'set_operation_mode', param: 'operation_mode', currentAttr: 'current_operation', label: 'Mode' },
    ],
  },

  // ── Media ─────────────────────────────────────────────────────────────────
  media_player: {
    label: 'Media Player', icon: '📺', group: 'media',
    controllable: true, toggleable: true,
    activeStates: ['on', 'playing', 'paused', 'idle'],
    restoreOnReconnect: false, safetyLevel: 'none',
    actions: {
      turn_on:  { service: 'turn_on',  label: 'Turn On' },
      turn_off: { service: 'turn_off', label: 'Turn Off' },
    },
    stateLabels: { playing: 'Playing', paused: 'Paused', idle: 'Idle', off: 'Off', on: 'On' },
  },

  // ── Security ──────────────────────────────────────────────────────────────
  lock: {
    label: 'Lock', icon: '🔒', group: 'security',
    controllable: true, toggleable: false,
    activeStates: ['locked'],
    restoreOnReconnect: false, safetyLevel: 'confirm',
    actions: {
      lock:   { service: 'lock',   label: 'Lock' },
      unlock: { service: 'unlock', label: 'Unlock', confirm: true },
      // featureBit=1 = LockEntityFeature.OPEN (electric door latch/strike)
      open:   { service: 'open',   label: 'Open Latch', confirm: true, featureBit: 1 },
    },
    stateLabels: {
      locked: 'Locked', unlocked: 'Unlocked',
      locking: 'Locking…', unlocking: 'Unlocking…',
    },
  },

  cover: {
    label: 'Cover', icon: '🪟', group: 'cover',
    controllable: true, toggleable: false,
    activeStates: ['open', 'opening'],
    restoreOnReconnect: false, safetyLevel: 'none',
    // CoverEntityFeature: OPEN=1, CLOSE=2, STOP=8, SET_POSITION=4
    actions: {
      open_cover:  { service: 'open_cover',  label: 'Open',  featureBit: 1 },
      close_cover: { service: 'close_cover', label: 'Close', featureBit: 2 },
      stop_cover:  { service: 'stop_cover',  label: 'Stop',  featureBit: 8 },
    },
    stateLabels: { open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' },
    positionFeatureBit: 4,
  },

  alarm_control_panel: {
    label: 'Alarm', icon: '🚨', group: 'security',
    controllable: true, toggleable: false,
    activeStates: ['armed_away', 'armed_home', 'armed_night', 'armed_vacation', 'triggered'],
    restoreOnReconnect: false, safetyLevel: 'confirm',
    // AlarmControlPanelEntityFeature: ARM_HOME=1, ARM_AWAY=2, ARM_NIGHT=4, ARM_VACATION=8
    actions: {
      alarm_arm_away:    { service: 'alarm_arm_away',    label: 'Arm Away',     confirm: true, featureBit: 2 },
      alarm_arm_home:    { service: 'alarm_arm_home',    label: 'Arm Home',                    featureBit: 1 },
      alarm_arm_night:   { service: 'alarm_arm_night',   label: 'Arm Night',                   featureBit: 4 },
      alarm_arm_vacation:{ service: 'alarm_arm_vacation',label: 'Arm Vacation',                featureBit: 8 },
      alarm_disarm:      { service: 'alarm_disarm',      label: 'Disarm',       confirm: true },
    },
    stateLabels: {
      disarmed: 'Disarmed', arming: 'Arming…',
      armed_away: 'Armed Away', armed_home: 'Armed Home',
      armed_night: 'Armed Night', armed_vacation: 'Armed Vacation', triggered: 'TRIGGERED',
    },
  },

  camera: {
    label: 'Camera', icon: '📷', group: 'security',
    controllable: false, toggleable: false,
    activeStates: [], restoreOnReconnect: false, safetyLevel: 'none',
    actions: {}, stateLabels: {},
  },

  // ── Valve — water shutoff / irrigation ────────────────────────────────────
  valve: {
    label: 'Valve', icon: '🚰', group: 'water',
    controllable: true, toggleable: false,
    activeStates: ['open', 'opening'],
    restoreOnReconnect: false,  // NEVER auto-restore — could flood or cut supply unexpectedly
    safetyLevel: 'confirm',
    // ValveEntityFeature: OPEN=1, CLOSE=2, STOP=8, SET_POSITION=4
    actions: {
      open_valve:  { service: 'open_valve',  label: 'Open',   featureBit: 1 },
      close_valve: { service: 'close_valve', label: 'Close',  confirm: true, featureBit: 2 },
      stop_valve:  { service: 'stop_valve',  label: 'Stop',   featureBit: 8 },
      toggle:      { service: 'toggle',      label: 'Toggle' },
    },
    stateLabels: { open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' },
    positionFeatureBit: 4,
  },

  // ── Sensors ───────────────────────────────────────────────────────────────
  sensor: {
    label: 'Sensor', icon: '📊', group: 'sensors',
    controllable: false, toggleable: false,
    activeStates: [], restoreOnReconnect: false, safetyLevel: 'none',
    actions: {}, stateLabels: {},
  },

  binary_sensor: {
    label: 'Binary Sensor', icon: '🔍', group: 'sensors',
    controllable: false, toggleable: false,
    activeStates: [], restoreOnReconnect: false, safetyLevel: 'none',
    actions: {}, stateLabels: {},
  },

  // ── Appliances ────────────────────────────────────────────────────────────
  vacuum: {
    label: 'Vacuum', icon: '🤖', group: 'other',
    controllable: true, toggleable: false,
    activeStates: ['cleaning', 'returning'],
    restoreOnReconnect: false, safetyLevel: 'none',
    // VacuumEntityFeature: START=8192, PAUSE=4, STOP=8, RETURN_HOME=16, LOCATE=512
    actions: {
      start:          { service: 'start',          label: 'Start',  featureBit: 8192 },
      pause:          { service: 'pause',          label: 'Pause',  featureBit: 4    },
      stop:           { service: 'stop',           label: 'Stop',   featureBit: 8    },
      return_to_base: { service: 'return_to_base', label: 'Dock',   featureBit: 16   },
      locate:         { service: 'locate',         label: 'Locate', featureBit: 512  },
    },
    stateLabels: {
      cleaning: 'Cleaning', docked: 'Docked',
      paused: 'Paused', idle: 'Idle', returning: 'Returning',
    },
    chips: [
      { attr: 'fan_speed_list', service: 'set_fan_speed', param: 'fan_speed', currentAttr: 'fan_speed', label: 'Speed' },
    ],
  },

  lawn_mower: {
    label: 'Lawn Mower', icon: '🌿', group: 'other',
    controllable: true, toggleable: false,
    activeStates: ['mowing', 'returning'],
    restoreOnReconnect: false, safetyLevel: 'none',
    // LawnMowerEntityFeature: START_MOWING=1, PAUSE=2, DOCK=4
    actions: {
      start_mowing: { service: 'start_mowing', label: 'Start', featureBit: 1 },
      pause:        { service: 'pause',        label: 'Pause', featureBit: 2 },
      dock:         { service: 'dock',         label: 'Dock',  featureBit: 4 },
    },
    stateLabels: {
      mowing: 'Mowing', docked: 'Docked',
      paused: 'Paused', returning: 'Returning',
    },
  },
}

// ---------------------------------------------------------------------------
// Derived sets — consumed by deviceStore, DeviceControls, Devices page, utils
// ---------------------------------------------------------------------------

export const CONTROLLABLE_DOMAINS = new Set(
  Object.entries(DOMAIN_REGISTRY)
    .filter(([, m]) => m.controllable)
    .map(([d]) => d)
)

export const TOGGLEABLE_DOMAINS = new Set(
  Object.entries(DOMAIN_REGISTRY)
    .filter(([, m]) => m.toggleable)
    .map(([d]) => d)
)

// ---------------------------------------------------------------------------
// Group helpers
// ---------------------------------------------------------------------------

const GROUP_ORDER = ['lights', 'climate', 'media', 'switches', 'cover', 'security', 'water', 'sensors', 'other']
const GROUP_LABELS = {
  lights:   'Lights',
  climate:  'Climate',
  media:    'Media',
  switches: 'Switches',
  cover:    'Covers & Blinds',
  security: 'Security',
  water:    'Water',
  sensors:  'Sensors',
  other:    'Other',
}

function _buildDomainGroups() {
  const groupMap = {}
  for (const [domain, meta] of Object.entries(DOMAIN_REGISTRY)) {
    const g = meta.group || 'other'
    if (!groupMap[g]) groupMap[g] = []
    groupMap[g].push(domain)
  }
  const groups = GROUP_ORDER
    .filter((g) => groupMap[g]?.length)
    .map((g) => ({ id: g, label: GROUP_LABELS[g] || g, domains: groupMap[g] }))
  // Always include 'other' as catch-all even if no known domains map to it
  if (!groups.find((g) => g.id === 'other')) {
    groups.push({ id: 'other', label: 'Other', domains: [] })
  } else {
    // Ensure it is last
    const idx = groups.findIndex((g) => g.id === 'other')
    groups.push(groups.splice(idx, 1)[0])
  }
  return groups
}

export const DOMAIN_GROUPS = _buildDomainGroups()

// ---------------------------------------------------------------------------
// Icon helper
// ---------------------------------------------------------------------------

const SENSOR_CLASS_ICONS = {
  temperature: '🌡️', humidity: '💧', pressure: '🔵', illuminance: '☀️',
  motion: '🚶', door: '🚪', window: '🪟', smoke: '🚨', moisture: '💦',
  gas: '⚠️', battery: '🔋', power: '⚡', energy: '⚡', voltage: '🔌',
  current: '🔌', co2: '🌫️', co: '🌫️', pm25: '🌫️', pm10: '🌫️',
  sound: '🔊', vibration: '📳', connectivity: '📶', occupancy: '🏠',
  plug: '🔌', lock: '🔒', opening: '🚪', presence: '🏠', timestamp: '🕐',
}

export function domainIcon(domain, deviceClass) {
  if (deviceClass && (domain === 'sensor' || domain === 'binary_sensor')) {
    return SENSOR_CLASS_ICONS[deviceClass] || '📊'
  }
  return DOMAIN_REGISTRY[domain]?.icon || '⚙️'
}

// Returns the group id for an entity.
export function domainGroup(entity) {
  if (entity.domain === 'sensor' && ['temperature', 'humidity'].includes(entity.device_class)) {
    return 'climate'
  }
  return DOMAIN_REGISTRY[entity.domain]?.group || 'other'
}
