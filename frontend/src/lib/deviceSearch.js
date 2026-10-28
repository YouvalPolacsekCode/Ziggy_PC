/**
 * Device search — one matcher for every surface that filters devices by text.
 *
 * Names alone are not enough. A user looking for their smart plug types
 * "plug", but the plug is called whatever was plugged into it ("Living room
 * light") and its HA domain is `switch`. So besides the names we also match:
 *
 *   - the device's kind (getKind) and its label, in English AND Hebrew, so a
 *     Hebrew UI still answers an English query and vice versa;
 *   - everyday synonyms for that kind ("outlet", "socket", "שקע" → plug);
 *   - its HA domain and device_class;
 *   - its physical device group: the group's card_kind, and a switch that
 *     meters power/energy counts as a plug — that is what a metered switch
 *     almost always is, and it is the only signal HA gives us.
 *
 * A multi-word query matches when every word matches somewhere, so
 * "living plug" finds the plug above.
 */

import { getKind, kindMeta } from './devices'
import { translateName } from './i18n'

// Extra words per kind, beyond its own label. English + Hebrew.
const KIND_SYNONYMS = {
  light:        ['lights', 'bulb', 'lighting', 'אור', 'תאורה', 'נורה', 'מנורה'],
  lamp:         ['light', 'bulb', 'מנורה', 'אור', 'תאורה'],
  led_strip:    ['light', 'strip', 'led', 'רצועת לד', 'תאורה'],
  switch:       ['relay', 'wall switch', 'מתג', 'ממסר'],
  plug:         ['smart plug', 'outlet', 'socket', 'power', 'שקע', 'תקע', 'שקע חכם'],
  tv:           ['television', 'media', 'טלוויזיה', 'טלויזיה'],
  soundbar:     ['speaker', 'audio', 'רמקול'],
  receiver:     ['amplifier', 'audio', 'רסיבר', 'מגבר'],
  projector:    ['מקרן'],
  monitor:      ['screen', 'display', 'מסך'],
  ac:           ['air conditioner', 'air conditioning', 'aircon', 'climate', 'thermostat', 'מזגן', 'מיזוג'],
  fan:          ['ventilator', 'מאוורר'],
  kettle:       ['קומקום'],
  coffee:       ['coffee machine', 'espresso', 'מכונת קפה', 'קפה'],
  cover:        ['blinds', 'shutter', 'curtain', 'cover', 'תריס', 'וילון'],
  lock:         ['door lock', 'מנעול'],
  alarm:        ['security', 'אזעקה'],
  vacuum:       ['robot', 'שואב', 'שואב אבק'],
  humidifier:   ['מכשיר אדים', 'מאדה'],
  water_heater: ['boiler', 'water heater', 'דוד', 'בוילר'],
  valve:        ['water', 'irrigation', 'tap', 'ברז', 'השקיה', 'מים'],
  lawn_mower:   ['mower', 'מכסחת'],
  camera:       ['cam', 'מצלמה'],
  sensor:       ['חיישן'],
  motion:       ['motion sensor', 'pir', 'sensor', 'תנועה', 'חיישן תנועה', 'חיישן'],
  door:         ['contact', 'door sensor', 'sensor', 'דלת', 'חיישן דלת', 'חיישן'],
  window:       ['contact', 'window sensor', 'sensor', 'חלון', 'חיישן חלון', 'חיישן'],
  leak:         ['water leak', 'flood', 'sensor', 'נזילה', 'הצפה', 'חיישן'],
  occupancy:    ['presence', 'occupancy', 'mmwave', 'sensor', 'נוכחות', 'חיישן נוכחות', 'חיישן'],
  smoke:        ['smoke detector', 'fire', 'gas', 'sensor', 'עשן', 'גלאי עשן', 'חיישן'],
  temperature:  ['temperature', 'thermometer', 'sensor', 'טמפרטורה', 'חיישן'],
  humidity:     ['humidity sensor', 'sensor', 'לחות', 'חיישן'],
  power_meter:  ['power', 'energy', 'meter', 'consumption', 'צריכה', 'חשמל'],
  controller:   ['remote', 'button', 'scene button', 'שלט', 'כפתור'],
  person:       ['people', 'אדם'],
}

const METER_CLASSES = new Set(['power', 'energy', 'current'])

const norm = (s) => String(s || '').toLowerCase().replace(/_/g, ' ')

function kindWords(kind) {
  const label = kindMeta(kind).label
  return [kind, label, translateName(label, 'he'), ...(KIND_SYNONYMS[kind] || [])]
}

/**
 * Everything a search can match for one device, lowercased into one string.
 * `group` is the device's physical group from /api/devices/grouped (optional —
 * pickers that only have flat entities still get names + kind + synonyms).
 */
export function deviceSearchText(entity, group = null) {
  if (!entity) return ''
  const kind = getKind(entity)
  const parts = [
    entity.display_name, entity.friendly_name, entity.entity_id,
    entity.domain || (entity.entity_id || '').split('.')[0],
    entity.device_class, entity.attributes?.device_class,
    ...kindWords(kind),
  ]
  if (group) {
    parts.push(group.name)
    if (group.card_kind) parts.push(...kindWords(group.card_kind))
    const ents = group.entities || []
    for (const sib of ents) parts.push(sib.device_class)
    const primaryDomain = group.primary_domain || (group.primary_entity_id || '').split('.')[0]
    if (primaryDomain === 'switch' && ents.some((s) => METER_CLASSES.has(s.device_class))) {
      parts.push(...kindWords('plug'))
    }
  }
  return parts.filter(Boolean).map(norm).join(' | ')
}

/** True when every word of `query` appears in the device's search text. */
export function matchesDeviceSearch(entity, query, group = null) {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = deviceSearchText(entity, group)
  return words.every((w) => text.includes(w))
}
