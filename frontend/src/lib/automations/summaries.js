// Pure formatting helpers for automation summaries (trigger / action /
// condition descriptions, relative timestamps, friendly entity names).
//
// These resolve translation keys via the static t() reader so they can run
// outside React render contexts (e.g. when building a card preview from a
// memo, where useT() isn't available).
import { t as tStatic } from '../i18n'
import { entityDisplayName } from '../utils'
import { useDeviceStore } from '../../stores/deviceStore'

export function formatRelativeTime(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return tStatic('automations.time.justNow')
  if (mins < 60) return tStatic('automations.time.mAgo', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return tStatic('automations.time.hAgo', { n: hrs })
  return tStatic('automations.time.dAgo', { n: Math.floor(hrs / 24) })
}

export function triggerSummary(trigger) {
  if (!trigger?.type) return tStatic('automations.summary.noTrigger')
  switch (trigger.type) {
    case 'time':    return trigger.time
      ? tStatic('automations.summary.everyDayAt', { time: trigger.time.slice(0, 5) })
      : tStatic('automations.summary.timeNoTime')
    case 'state': {
      let s = tStatic('automations.summary.whenBecomes', { entity: friendlyEntityName(trigger.entity_id) || tStatic('automations.summary.unknownDevice'), state: trigger.state || 'on/off' })
      if (trigger.for_minutes) s += ' ' + tStatic('automations.summary.forMinutes', { n: trigger.for_minutes })
      return s
    }
    case 'numeric_state': {
      const ent = friendlyEntityName(trigger.entity_id) || 'sensor'
      if (trigger.above !== undefined && trigger.above !== '') return tStatic('automations.summary.risesAbove', { entity: ent, value: trigger.above })
      if (trigger.below !== undefined && trigger.below !== '') return tStatic('automations.summary.dropsBelow', { entity: ent, value: trigger.below })
      return tStatic('automations.summary.crossesThreshold', { entity: ent })
    }
    case 'zone': {
      const who  = friendlyEntityName(trigger.entity_id) || 'person'
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

// Resolve an entity_id to its real device name (never leak an id/hex object-id
// to the user). Reads the always-loaded device store; falls back to a stripped
// slug only when the entity is genuinely unknown (e.g. deleted).
export function friendlyEntityName(entityId) {
  if (!entityId) return ''
  try {
    const ents = useDeviceStore.getState()?.entities || []
    const e = ents.find((x) => x.entity_id === entityId)
    if (e) return entityDisplayName(e) || e.friendly_name || _stripEntityId(entityId)
  } catch { /* store not ready — fall through */ }
  return _stripEntityId(entityId)
}

function _stripEntityId(entityId) {
  const tail = entityId.includes('.') ? entityId.split('.').slice(1).join('.') : entityId
  return tail.replace(/_/g, ' ')
}

export function actionSummary(action) {
  const unk = tStatic('automations.summary.unknownDevice')
  switch (action.type) {
    case 'call_service': {
      const verb = (action.service_value || action.service?.split('.')[1] || tStatic('automations.summary.control')).replace(/_/g, ' ')
      return `${verb} ${action.entity_id ? friendlyEntityName(action.entity_id) : unk}`
    }
    case 'device_command': {
      const svc = (action.command_id || '').split('.').slice(-1)[0] || tStatic('automations.summary.command')
      return `${svc.replace(/_/g, ' ')} ${action.entity_id ? friendlyEntityName(action.entity_id) : unk}`
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

export function conditionSummary(c) {
  if (c.type === 'time') {
    const parts = []
    if (c.after)  parts.push(tStatic('automations.summary.after',  { time: c.after  }))
    if (c.before) parts.push(tStatic('automations.summary.before', { time: c.before }))
    return parts.length
      ? tStatic('automations.summary.timeWindowParts', { parts: parts.join(' ' + tStatic('automations.summary.andJoin') + ' ') })
      : tStatic('automations.summary.timeWindow')
  }
  if (!c.entity_id) return tStatic('automations.summary.incomplete')
  const name = friendlyEntityName(c.entity_id)
  const val = c.value || 'on'
  switch (c.operator) {
    case 'is':     return tStatic('automations.summary.cond.is',    { name, value: val })
    case 'is_not': return tStatic('automations.summary.cond.isNot', { name, value: val })
    case 'above':  return tStatic('automations.summary.cond.above', { name, value: c.value })
    case 'below':  return tStatic('automations.summary.cond.below', { name, value: c.value })
    default:       return name
  }
}

export const ACTION_TYPE_ICON = { call_service: '⚙', device_command: '✨', ir_command: '📡', send_intent: '💬', delay: '⏱', notify: '📣', fake_occupancy_start: '🌙', media_play: '🎵' }
