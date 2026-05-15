/**
 * Param descriptors for every intent listed in INTENT_OPTIONS.
 * Each entry tells IntentParamForm how to render and validate params.
 *
 * Param types:
 *   boolean_select  — two-chip toggle (Turn On / Turn Off or custom labels)
 *   select          — static options; ≤4 → chip group, >4 → dropdown
 *   dynamic_select  — dropdown populated at runtime from a live source
 *   number          — range slider + badge; min/max/step/unit
 *   text            — free-text input
 *
 * Dynamic sources:
 *   "rooms"              — fetched from GET /api/rooms
 *   "entities_in_room"   — entities filtered by dependsOn room + domainFilter
 */

const ROOM_PARAM = {
  key: 'room',
  label: 'Room',
  type: 'dynamic_select',
  source: 'rooms',
  required: true,
}

const ROOM_OPTIONAL = {
  key: 'room',
  label: 'Room',
  type: 'dynamic_select',
  source: 'rooms',
  required: false,
  placeholder: 'All rooms',
}

const LIGHT_DEVICE_PARAM = {
  key: 'entity_id',
  label: 'Specific light',
  type: 'dynamic_select',
  source: 'entities_in_room',
  domainFilter: 'light',
  dependsOn: 'room',
  required: false,
  placeholder: 'All lights in room',
}

const TURN_ON_PARAM = {
  key: 'turn_on',
  label: 'Action',
  type: 'boolean_select',
  options: [
    { value: true,  label: 'Turn On' },
    { value: false, label: 'Turn Off' },
  ],
  required: true,
}

export const INTENT_PARAM_SCHEMA = {

  // ── Lights — global ────────────────────────────────────────────────────────
  turn_off_all_lights: { params: [] },
  turn_off_everything: { params: [] },

  // ── Lights — room ──────────────────────────────────────────────────────────
  toggle_all_lights_in_room: {
    params: [ROOM_PARAM, TURN_ON_PARAM],
  },

  toggle_light: {
    params: [ROOM_PARAM, LIGHT_DEVICE_PARAM, TURN_ON_PARAM],
  },

  set_light_brightness: {
    params: [
      ROOM_PARAM,
      LIGHT_DEVICE_PARAM,
      { key: 'brightness', label: 'Brightness', type: 'number', min: 0, max: 100, step: 5, unit: '%', required: true },
    ],
  },

  set_light_color_temp: {
    params: [
      ROOM_PARAM,
      LIGHT_DEVICE_PARAM,
      {
        key: 'color_temp',
        label: 'Color Temperature',
        type: 'select',
        options: [
          { value: 'warm',    label: 'Warm  2700K' },
          { value: 'neutral', label: 'Neutral  4000K' },
          { value: 'cool',    label: 'Cool  6500K' },
        ],
        required: true,
      },
    ],
  },

  set_light_color: {
    params: [
      ROOM_PARAM,
      LIGHT_DEVICE_PARAM,
      {
        key: 'color',
        label: 'Color',
        type: 'select',
        options: [
          { value: 'white',      label: 'White' },
          { value: 'warm white', label: 'Warm White' },
          { value: 'blue',       label: 'Blue' },
          { value: 'red',        label: 'Red' },
          { value: 'green',      label: 'Green' },
          { value: 'yellow',     label: 'Yellow' },
          { value: 'purple',     label: 'Purple' },
          { value: 'orange',     label: 'Orange' },
          { value: 'pink',       label: 'Pink' },
        ],
        required: true,
      },
    ],
  },

  set_light_effect: {
    params: [
      ROOM_PARAM,
      LIGHT_DEVICE_PARAM,
      { key: 'effect', label: 'Effect', type: 'text', placeholder: 'e.g. Rainbow, Pulse, Strobe', required: true },
    ],
  },

  // ── Climate / AC ───────────────────────────────────────────────────────────
  report_all_temperatures: { params: [] },

  get_temperature: { params: [ROOM_PARAM] },
  get_humidity:    { params: [ROOM_PARAM] },

  control_ac: {
    params: [
      ROOM_PARAM,
      {
        key: 'turn_on',
        label: 'Action',
        type: 'boolean_select',
        options: [
          { value: true,  label: 'Turn On' },
          { value: false, label: 'Turn Off' },
        ],
        required: true,
      },
    ],
  },

  set_ac_temperature: {
    params: [
      ROOM_PARAM,
      { key: 'temperature', label: 'Temperature', type: 'number', min: 16, max: 30, step: 1, unit: '°C', required: true },
    ],
  },

  set_ac_mode: {
    params: [
      ROOM_PARAM,
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'cool', label: 'Cool' },
          { value: 'heat', label: 'Heat' },
          { value: 'fan',  label: 'Fan Only' },
          { value: 'auto', label: 'Auto' },
          { value: 'dry',  label: 'Dry' },
        ],
        required: true,
      },
    ],
  },

  set_climate_fan_mode: {
    params: [
      ROOM_PARAM,
      {
        key: 'fan_mode',
        label: 'Fan Speed',
        type: 'select',
        options: [
          { value: 'auto',   label: 'Auto' },
          { value: 'low',    label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high',   label: 'High' },
        ],
        required: true,
      },
    ],
  },

  set_climate_preset: {
    params: [
      ROOM_PARAM,
      {
        key: 'preset',
        label: 'Preset',
        type: 'select',
        options: [
          { value: 'eco',      label: 'Eco' },
          { value: 'comfort',  label: 'Comfort' },
          { value: 'away',     label: 'Away' },
          { value: 'boost',    label: 'Boost' },
          { value: 'sleep',    label: 'Sleep' },
          { value: 'activity', label: 'Activity' },
        ],
        required: true,
      },
    ],
  },

  // ── Media & TV ─────────────────────────────────────────────────────────────
  control_tv: {
    params: [
      {
        key: 'turn_on',
        label: 'Action',
        type: 'boolean_select',
        options: [
          { value: true,  label: 'Turn On' },
          { value: false, label: 'Turn Off' },
        ],
        required: true,
      },
    ],
  },

  set_tv_volume: {
    params: [
      { key: 'volume', label: 'Volume', type: 'number', min: 0, max: 100, step: 5, unit: '%', required: true },
    ],
  },

  tv_select_source: {
    params: [
      {
        key: 'source',
        label: 'Source / App',
        type: 'select',
        options: [
          { value: 'HDMI 1',      label: 'HDMI 1' },
          { value: 'HDMI 2',      label: 'HDMI 2' },
          { value: 'HDMI 3',      label: 'HDMI 3' },
          { value: 'Netflix',     label: 'Netflix' },
          { value: 'YouTube',     label: 'YouTube' },
          { value: 'Prime Video', label: 'Prime Video' },
          { value: 'Disney+',     label: 'Disney+' },
        ],
        required: true,
      },
    ],
  },

  media_play:  { params: [] },
  media_pause: { params: [] },

  // ── Covers & Blinds ────────────────────────────────────────────────────────
  open_cover:  { params: [ROOM_OPTIONAL] },
  close_cover: { params: [ROOM_OPTIONAL] },

  set_cover_position: {
    params: [
      ROOM_OPTIONAL,
      { key: 'position', label: 'Position', type: 'number', min: 0, max: 100, step: 10, unit: '%', required: true },
    ],
  },

  // ── Presence & Status ──────────────────────────────────────────────────────
  is_someone_home: {
    params: [
      { key: 'name', label: 'Person', type: 'text', required: false, placeholder: 'Leave blank to check everyone' },
    ],
  },

  list_active_devices: { params: [] },
  get_system_status:   { params: [] },
  get_sun_times:       { params: [] },

  // ── Tasks & Lists ──────────────────────────────────────────────────────────
  task_summary:     { params: [] },
  list_tasks:       { params: [] },
  get_shopping_list:{ params: [] },

  // ── Info & Web ─────────────────────────────────────────────────────────────
  get_weather: {
    params: [
      { key: 'city', label: 'City', type: 'text', required: true, placeholder: 'e.g. Tel Aviv, London' },
    ],
  },

  web_news_brief: { params: [] },
  get_time:       { params: [] },
  list_events:    { params: [] },
}
