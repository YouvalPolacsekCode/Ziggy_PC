/**
 * Vendor-specific WiFi command adapters for media_player entities.
 *
 * Background
 * ----------
 * HA's generic `media_player` domain has services for play/pause/volume/
 * select_source, but NO native back/home/menu/d-pad. Those are remote-app
 * concepts each TV brand exposes through its own integration:
 *
 *   - LG webOS:  `webostv.button`  (BACK / HOME / MENU / UP / DOWN / ENTER…)
 *   - Roku:      paired `remote.send_command`
 *   - Apple TV:  paired `remote.send_command`
 *   - Android TV: `androidtv.adb_command`  (also pairs `remote.*`)
 *   - Samsung:   `samsungtv_smart.send_key` (community add-on) or paired `remote.*`
 *
 * TVRemote.jsx already has a `remote.*`-paired fallback (matches by basename).
 * This module adds the vendor-service path so brands like LG webOS — which
 * don't pair a `remote.*` entity — still get working nav over WiFi.
 *
 * Detection is best-effort by attribute heuristics; if no adapter matches,
 * the caller falls back to IR-only (or no nav at all).
 */

// Each adapter:
//   detect(entity)       → boolean (does this entity belong to this vendor)
//   commands             → { ziggyCmd: { domain, service, dataFor(entity) } }
//
// `dataFor` returns the HA service-call payload (must include `entity_id`).
// It's a function so we can vary the payload per-entity if needed
// (LG's `webostv.button` wants the human button name in `button`, not
// `command`, so the shape isn't uniform across vendors).

const _attrsOf = (entity) => entity?.attributes || entity || {}

// Small helper to declare a button-table adapter without copy-pasting the
// `dataFor` shape for every command. Most vendors map their nav buttons
// 1:1 to a single service call with a constant param shape.
function _buttonAdapter({ name, detect, domain, service, paramName, buttons }) {
  const commands = {}
  for (const [ziggyCmd, vendorValue] of Object.entries(buttons)) {
    commands[ziggyCmd] = {
      domain,
      service,
      dataFor: (e) => ({ entity_id: e.entity_id, [paramName]: vendorValue }),
    }
  }
  return { name, detect, commands }
}

const ADAPTERS = [

  // ─── LG webOS ────────────────────────────────────────────────────────────
  // Detection: LG webOS exposes `sound_output` (rare elsewhere) and often
  // lists LG-branded sources. Service: `webostv.button` (HA core).
  _buttonAdapter({
    name: 'webostv',
    detect: (entity) => {
      const a = _attrsOf(entity)
      if (a.sound_output != null) return true
      const sources = a.source_list || []
      return sources.some(s => /\bLG\b/i.test(String(s || '')))
    },
    domain: 'webostv',
    service: 'button',
    paramName: 'button',
    // webOS button enum (case-sensitive) — from HA core's webostv/const.py.
    buttons: {
      back: 'BACK', home: 'HOME', menu: 'MENU', exit: 'EXIT', info: 'INFO',
      nav_up: 'UP', nav_down: 'DOWN', nav_left: 'LEFT', nav_right: 'RIGHT',
      nav_ok: 'ENTER',
      channel_up: 'CHANNELUP', channel_down: 'CHANNELDOWN',
      digit_0: '0', digit_1: '1', digit_2: '2', digit_3: '3', digit_4: '4',
      digit_5: '5', digit_6: '6', digit_7: '7', digit_8: '8', digit_9: '9',
    },
  }),

  // ─── Samsung Tizen (HA core `samsungtv` integration) ─────────────────────
  // Detection: source_list often has Samsung apps, or the entity_id pattern.
  // Service: `samsungtv.send_key` for older API, modern integration uses
  // paired `remote.*` (covered by TVRemote's basename match).
  // Newer Samsungs paired automatically via Smart View — those go through
  // the remote.* fallback so they don't hit this adapter.
  _buttonAdapter({
    name: 'samsungtv',
    detect: (entity) => {
      const a = _attrsOf(entity)
      const sources = a.source_list || []
      // Heuristic: Samsung Smart Hub apps in source_list, or entity ID hint.
      if (/^media_player\.(samsung|tizen)/i.test(entity?.entity_id || '')) return true
      return sources.some(s => /\bsamsung\b/i.test(String(s || '')))
    },
    domain: 'samsungtv',
    service: 'send_key',
    paramName: 'key',
    // Samsung KEY_* enum — see Samsung Smart Remote API.
    buttons: {
      back: 'KEY_RETURN', home: 'KEY_HOME', menu: 'KEY_MENU',
      exit: 'KEY_EXIT', info: 'KEY_INFO',
      nav_up: 'KEY_UP', nav_down: 'KEY_DOWN',
      nav_left: 'KEY_LEFT', nav_right: 'KEY_RIGHT',
      nav_ok: 'KEY_ENTER',
      channel_up: 'KEY_CHUP', channel_down: 'KEY_CHDOWN',
      digit_0: 'KEY_0', digit_1: 'KEY_1', digit_2: 'KEY_2', digit_3: 'KEY_3',
      digit_4: 'KEY_4', digit_5: 'KEY_5', digit_6: 'KEY_6', digit_7: 'KEY_7',
      digit_8: 'KEY_8', digit_9: 'KEY_9',
    },
  }),

  // ─── Sony Bravia (older `braviatv` integration) ──────────────────────────
  // Modern `bravia` integration ships a paired `remote.*` (covered by
  // TVRemote's basename match). This adapter handles the legacy
  // `braviatv.send_command` path.
  _buttonAdapter({
    name: 'braviatv',
    detect: (entity) => {
      const eid = (entity?.entity_id || '').toLowerCase()
      if (eid.includes('bravia') || eid.includes('sony')) return true
      const sources = _attrsOf(entity).source_list || []
      return sources.some(s => /\bbravia\b|\bsony\b/i.test(String(s || '')))
    },
    domain: 'braviatv',
    service: 'send_command',
    paramName: 'command',
    // Sony IRCC command names — see HA core braviatv/const.py.
    buttons: {
      back: 'Return', home: 'Home', menu: 'Options', exit: 'Exit', info: 'DisplayInfo',
      nav_up: 'Up', nav_down: 'Down', nav_left: 'Left', nav_right: 'Right',
      nav_ok: 'Confirm',
      channel_up: 'ChannelUp', channel_down: 'ChannelDown',
      digit_0: 'Num0', digit_1: 'Num1', digit_2: 'Num2', digit_3: 'Num3',
      digit_4: 'Num4', digit_5: 'Num5', digit_6: 'Num6', digit_7: 'Num7',
      digit_8: 'Num8', digit_9: 'Num9',
    },
  }),

  // ─── Future / community adapters ─────────────────────────────────────────
  // - Roku: paired `remote.send_command` — handled by TVRemote's basename
  //   fallback; no adapter needed.
  // - Apple TV (`appletv`): paired `remote.*` — same.
  // - Android TV / Google TV (`androidtv_remote`): paired `remote.*` — same.
  // - Fire TV (`firetv`): paired `remote.*` — same.
  // - Onkyo / Denon receivers: vendor-specific services; add when needed.
  // - Vizio SmartCast: `vizio.command`; add when needed.
  // - Panasonic Viera: `panasonic_viera.send_key`; add when needed.
]

/**
 * Pick the first adapter whose `detect()` matches this entity. Returns
 * null when no vendor recognises it (caller should fall back to IR / hide).
 */
export function findVendorAdapter(entity) {
  if (!entity) return null
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.detect(entity)) return adapter
    } catch {
      // Defensive — a buggy detector shouldn't break the remote.
    }
  }
  return null
}

/**
 * True iff this entity has a WiFi path for `ziggyCmd` via any vendor
 * adapter. Cheap — used in the `commandAvailable`-style enabled checks.
 */
export function vendorSupports(entity, ziggyCmd) {
  const adapter = findVendorAdapter(entity)
  return !!(adapter && adapter.commands[ziggyCmd])
}

/**
 * Fire a Ziggy nav command over the entity's vendor WiFi path.
 * Returns the underlying callHaService promise so the caller can await.
 * Throws when the entity has no matching adapter or the adapter has no
 * mapping for that command — guard with `vendorSupports` first.
 */
export async function fireViaVendor(entity, ziggyCmd, callHaService) {
  const adapter = findVendorAdapter(entity)
  if (!adapter) throw new Error(`No vendor adapter for ${entity?.entity_id}`)
  const spec = adapter.commands[ziggyCmd]
  if (!spec) throw new Error(`${adapter.name} adapter doesn't support ${ziggyCmd}`)
  return callHaService(spec.domain, spec.service, spec.dataFor(entity))
}
