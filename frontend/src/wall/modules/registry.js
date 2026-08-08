// Wall module registry — manifests only.
//
// This file holds PURE DATA and imports nothing from the module components.
// That matters: `wallStore` needs manifests to size and place modules, and the
// components need the store. Keeping manifests component-free breaks what would
// otherwise be an import cycle (store → registry → component → store).
//
// Component lookup lives in ./components.js, which the renderer imports.
//
// To add a module: add a manifest here, add its component to ./components.js,
// and add its two i18n strings. Nothing else in the codebase needs to know.

/**
 * @typedef {Object} Manifest
 * @property {string}  type         stable key, persisted in the layout
 * @property {string}  titleKey     i18n key for the module's display name
 * @property {string}  descKey      i18n key for the picker's one-line description
 * @property {number}  minW,minH    smallest the user may drag it. Kept LOW (2x1
 *                                  for most cards): people shrink a card to
 *                                  glance-size on purpose, and a floor of 3
 *                                  columns made half the board un-shrinkable.
 * @property {number}  defaultW,defaultH  size when added from the picker
 * @property {number}  maxW,maxH    largest the user may drag it
 * @property {?string} capability   gates visibility + actions; null = always allowed
 * @property {boolean} multiple     may appear more than once on a board
 * @property {Object}  configSchema per-instance config the config sheet renders
 */

/** @type {Record<string, Manifest>} */
export const MANIFESTS = {
  ziggy: {
    type: 'ziggy', titleKey: 'wall.mod.ziggy', descKey: 'wall.mod.ziggyDesc',
    minW: 2, minH: 1, defaultW: 8, defaultH: 2, maxW: 12, maxH: 8,
    capability: null, multiple: false, configSchema: {},
  },
  agenda: {
    type: 'agenda', titleKey: 'wall.mod.agenda', descKey: 'wall.mod.agendaDesc',
    minW: 2, minH: 2, defaultW: 4, defaultH: 5, maxW: 12, maxH: 16,
    capability: 'lists', multiple: false,
    configSchema: { days: { kind: 'number', default: 1, min: 1, max: 7 } },
  },
  shopping: {
    type: 'shopping', titleKey: 'wall.mod.shopping', descKey: 'wall.mod.shoppingDesc',
    minW: 2, minH: 2, defaultW: 4, defaultH: 5, maxW: 12, maxH: 16,
    capability: 'lists', multiple: true,
    configSchema: { list_id: { kind: 'list', default: 'default' } },
  },
  scenes: {
    type: 'scenes', titleKey: 'wall.mod.scenes', descKey: 'wall.mod.scenesDesc',
    minW: 2, minH: 1, defaultW: 4, defaultH: 3, maxW: 12, maxH: 12,
    capability: 'scenes', multiple: true,
    configSchema: { ids: { kind: 'actionIds', default: [] } },
  },
  pinned: {
    type: 'pinned', titleKey: 'wall.mod.pinned', descKey: 'wall.mod.pinnedDesc',
    minW: 2, minH: 1, defaultW: 4, defaultH: 3, maxW: 12, maxH: 12,
    capability: null, multiple: false, configSchema: {},
  },
  room: {
    type: 'room', titleKey: 'wall.mod.room', descKey: 'wall.mod.roomDesc',
    minW: 2, minH: 2, defaultW: 3, defaultH: 4, maxW: 12, maxH: 16,
    capability: null, multiple: true,
    configSchema: { room_id: { kind: 'room', default: null } },
  },
  cameras: {
    type: 'cameras', titleKey: 'wall.mod.cameras', descKey: 'wall.mod.camerasDesc',
    minW: 2, minH: 2, defaultW: 4, defaultH: 4, maxW: 12, maxH: 12,
    capability: 'cameras', multiple: true,
    configSchema: { entity_id: { kind: 'camera', default: null } },
  },
  weather: {
    type: 'weather', titleKey: 'wall.mod.weather', descKey: 'wall.mod.weatherDesc',
    minW: 2, minH: 1, defaultW: 4, defaultH: 2, maxW: 12, maxH: 8,
    capability: null, multiple: false, configSchema: {},
  },
  tasks: {
    type: 'tasks', titleKey: 'wall.mod.tasks', descKey: 'wall.mod.tasksDesc',
    minW: 2, minH: 2, defaultW: 4, defaultH: 4, maxW: 12, maxH: 16,
    capability: 'lists', multiple: false,
    configSchema: { limit: { kind: 'number', default: 6, min: 3, max: 20 } },
  },
  alerts: {
    type: 'alerts', titleKey: 'wall.mod.alerts', descKey: 'wall.mod.alertsDesc',
    minW: 2, minH: 1, defaultW: 4, defaultH: 4, maxW: 12, maxH: 16,
    capability: null, multiple: false,
    configSchema: { limit: { kind: 'number', default: 5, min: 3, max: 20 } },
  },
  media: {
    type: 'media', titleKey: 'wall.mod.media', descKey: 'wall.mod.mediaDesc',
    minW: 2, minH: 1, defaultW: 4, defaultH: 3, maxW: 12, maxH: 10,
    capability: 'media', multiple: true,
    configSchema: { entity_id: { kind: 'mediaPlayer', default: null } },
  },
  modes: {
    type: 'modes', titleKey: 'wall.mod.modes', descKey: 'wall.mod.modesDesc',
    minW: 2, minH: 1, defaultW: 4, defaultH: 2, maxW: 12, maxH: 8,
    capability: 'scenes', multiple: false, configSchema: {},
  },
  clock: {
    type: 'clock', titleKey: 'wall.mod.clock', descKey: 'wall.mod.clockDesc',
    minW: 2, minH: 1, defaultW: 3, defaultH: 2, maxW: 12, maxH: 8,
    capability: null, multiple: true, configSchema: {},
  },
}

/** Manifest for a type, or undefined when the type is unknown. */
export function getManifest(type) {
  return MANIFESTS[type]
}

/** Every manifest, in picker display order. */
export const MODULE_ORDER = [
  'ziggy', 'agenda', 'shopping', 'scenes', 'pinned', 'room',
  'cameras', 'media', 'weather', 'tasks', 'alerts', 'modes', 'clock',
]

export function allManifests() {
  return MODULE_ORDER.map((t) => MANIFESTS[t]).filter(Boolean)
}

/**
 * Which module types this tablet may show, given its capability policy.
 * A module whose capability is denied is not merely hidden on the board — it
 * never appears in the picker either, so nobody can add a control they are
 * not permitted to use.
 */
export function availableManifests(capabilities) {
  if (!capabilities) return allManifests()
  return allManifests().filter((m) => !m.capability || capabilities[m.capability] !== false)
}
