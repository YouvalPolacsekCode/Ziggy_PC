import { createAutomation, deleteAutomation, getPresencePersons } from '../../../../lib/api'
import { pickedIds } from '../engine/context'

// ── Leave Home recipe ─────────────────────────────────────────────────────────
// Trigger sources can be COMBINED with AND ("everyone's phone left" AND "no
// movement for N min" AND "door closed"). One source becomes the trigger event,
// the rest become conditions — priority no-movement → door → phone. Phone uses
// Ziggy's OWN presence engine (persons.json), so it only appears once at least
// one person is actually tracked. Optional security alert = a 2nd automation.

const LEAVE_HOME_ID = 'ziggy_leave_home'
const ALERT_ID = 'ziggy_leave_home_alert'

const motionEnts = (ctx) => ctx.entities.filter((e) => e.domain === 'binary_sensor' && (e.device_class === 'motion' || e.device_class === 'occupancy'))
const doorEnts = (ctx) => ctx.entities.filter((e) => e.domain === 'binary_sensor' && (e.device_class === 'door' || e.device_class === 'opening'))
const lightItems = (ctx) => ctx.entities.filter((e) => e.domain === 'light').map(ctx.asItem)
const acEntity = (ctx) => ctx.entities.find((e) => e.domain === 'climate')

// Available trigger sources (any subset can be combined with AND).
const sourceItems = (ctx) => {
  const t = ctx.t
  const persons = ctx.persons || []
  const out = []
  const mk = (k, icon, cnt) => ({
    id: k, icon,
    label: `${icon} ${t(`automations.leaveHome.source.${k}`)}`,
    sub: `${t(`automations.leaveHome.source.${k}Desc`)}${(k === 'phone' || k === 'motion') && cnt > 1 ? ` · ${t('automations.leaveHome.allN', { n: cnt })}` : ''}`,
  })
  if (persons.length > 0) out.push(mk('phone', '📍', persons.length))
  if (motionEnts(ctx).length) out.push(mk('motion', '🚶', motionEnts(ctx).length))
  if (doorEnts(ctx).length) out.push(mk('door', '🚪', doorEnts(ctx).length))
  return out
}

const has = (v, k) => (v.sources?.ids || []).includes(k)
const lightsOk = (v, ctx) => v.lights?.mode === 'all' || pickedIds(v.lights, lightItems(ctx)).length > 0

export default {
  id: 'leave_home',
  titleKey: 'automations.leaveHome.title',
  subtitleKey: 'automations.leaveHome.subtitle',
  icon: '🚶',
  failedKey: 'automations.leaveHome.failed',

  loadData: async () => {
    try { const r = await getPresencePersons(); return { persons: r?.persons || [] } }
    catch { return { persons: [] } }
  },

  derive: (initial, ctx) => {
    const isUpdate = !!initial?._isInstalled
    const trig = initial?.trigger || {}
    const conds = initial?.conditions || []
    const sel = new Set()
    let door = doorEnts(ctx)[0]?.entity_id || '', min = 30
    // Primary trigger → which source it represents.
    if (trig.type === 'all_persons_left') sel.add('phone')
    else if (trig.state === 'off' && trig.for_minutes) { sel.add('motion'); min = trig.for_minutes }
    else if (trig.state === 'off') { sel.add('door'); const e = trig.entity_id; door = Array.isArray(e) ? e[0] : (e || door) }
    // Extra sources encoded as conditions.
    let motionMinFromTrigger = sel.has('motion')
    for (const c of conds) {
      if (c.type === 'presence') sel.add('phone')
      else if (String(c.entity_id || '').includes('door')) { sel.add('door'); door = c.entity_id }
      else if (String(c.value) === 'off') {
        sel.add('motion')
        // When motion is only a secondary source there is no trigger duration to
        // read, so the window lives on the conditions. Recover it, or editing an
        // installed setup silently resets it to the default and re-saves a
        // weaker guard than the user configured.
        if (!motionMinFromTrigger && c.for_minutes) min = c.for_minutes
      }
    }
    const acts = initial?.actions || []
    const chosen = acts.filter((a) => a.type === 'call_service' && (a.entity_id || '').startsWith('light.')).map((a) => a.entity_id)
    return {
      sources: { mode: 'choose', ids: [...sel] },
      doorEntity: door,
      motionMin: min,
      lights: { mode: chosen.length ? 'choose' : 'all', ids: chosen },
      acOff: isUpdate ? acts.some((a) => (a.type === 'call_service' && (a.entity_id || '').startsWith('climate')) || a.type === 'ir_command') : true,
      notify: isUpdate ? acts.some((a) => a.type === 'notify') : true,
      alert: !!initial?.securityAlert,
    }
  },

  // Default to the first available source once candidates load (create flow).
  autoDefaults: (v, ctx) => {
    const patch = {}
    const avail = sourceItems(ctx)
    if ((v.sources?.ids || []).length === 0 && avail.length) patch.sources = { mode: 'choose', ids: [avail[0].id] }
    if (!v.doorEntity && doorEnts(ctx)[0]) patch.doorEntity = doorEnts(ctx)[0].entity_id
    return patch
  },

  steps: [
    {
      key: 'triggers',
      titleKey: 'automations.leaveHome.triggerLabel', icon: '📍',
      validate: (v) => (v.sources?.ids || []).length > 0,
      fields: [
        { key: 'sources', type: 'pickMany', allToggle: false, items: sourceItems,
          andConnector: true, andKey: 'automations.leaveHome.and',
          emptyKey: 'automations.leaveHome.noSource' },
        { key: '_andHint', type: 'note', textKey: 'automations.leaveHome.andHint',
          visibleWhen: (v) => (v.sources?.ids || []).length > 1 },
        { key: 'motionMin', type: 'number', labelKey: 'automations.leaveHome.afterNoMotion',
          min: 1, max: 240, suffixKey: 'automations.leaveHome.minutes', width: 70, standalone: false,
          visibleWhen: (v) => has(v, 'motion') },
        { key: 'doorEntity', type: 'pickOne', icon: '🚪',
          items: (ctx) => doorEnts(ctx).map(ctx.asItem), collapseSingle: true,
          visibleWhen: (v, ctx) => has(v, 'door') && doorEnts(ctx).length > 1 },
      ],
    },
    {
      key: 'lights', titleKey: 'automations.leaveHome.turnOffLabel', icon: '💡',
      validate: (v, ctx) => lightsOk(v, ctx),
      fields: [
        { key: 'lights', type: 'pickMany', icon: '💡', items: lightItems,
          allKey: 'automations.leaveHome.lightsAll', chooseKey: 'automations.leaveHome.lightsChoose',
          emptyKey: 'automations.leaveHome.noLights' },
      ],
    },
    {
      key: 'extras', titleKey: 'automations.bundles.alsoDo', icon: '✨',
      fields: [
        { key: 'acOff', type: 'toggle', icon: '❄️', labelKey: 'automations.leaveHome.ac',
          visibleWhen: (v, ctx) => !!acEntity(ctx) },
        { key: 'notify', type: 'toggle', icon: '🔔', labelKey: 'automations.leaveHome.notify' },
        { key: 'alert', type: 'toggle', icon: '🚨', labelKey: 'automations.leaveHome.alertLabel',
          subKey: 'automations.leaveHome.alertSub',
          visibleWhen: (v, ctx) => (ctx.persons || []).length > 0 && motionEnts(ctx).length > 0 },
      ],
    },
  ],

  canSave: (v, ctx) => (v.sources?.ids || []).length > 0 && lightsOk(v, ctx),

  save: async (v, ctx, initial) => {
    const t = ctx.t
    const motionIds = motionEnts(ctx).map((e) => e.entity_id)
    // How long the house must have been still to count as empty. Used by BOTH
    // the trigger and the per-sensor conditions so the two can't disagree.
    const quietMin = Number(v.motionMin) || 30
    // Trigger event: no-movement → door → phone. The rest become AND conditions.
    const primary = has(v, 'motion') ? 'motion' : has(v, 'door') ? 'door' : 'phone'
    const trigger =
      primary === 'motion' ? { type: 'state', entity_id: motionIds, state: 'off', for_minutes: quietMin }
      : primary === 'door' ? { type: 'state', entity_id: v.doorEntity, state: 'off' }
      : { type: 'all_persons_left' }
    const conditions = []
    // Motion: a list-trigger fires when ANY sensor goes off, so require EVERY
    // one off (whole house quiet) — as conditions, primary or not.
    //
    // Each carries the SAME window as the trigger. Without it these are instant
    // samples, and a PIR in an occupied room is 'off' most of the time — it
    // reports motion, then drops back after its ~60-90s cooldown. One idle room
    // (a guest bathroom) hitting the trigger while the living-room PIR sat in a
    // routine blink-gap read as "house empty" and killed the lights and AC on
    // someone sitting right there. "Quiet" is a duration, not an instant.
    if (has(v, 'motion')) {
      motionIds.forEach((id) => conditions.push(
        { entity_id: id, operator: 'is', value: 'off', for_minutes: quietMin }))
    }
    if (has(v, 'door') && primary !== 'door') conditions.push({ entity_id: v.doorEntity, operator: 'is', value: 'off' })
    if (has(v, 'phone') && primary !== 'phone') conditions.push({ type: 'presence', value: 'all_away' })

    const actions = v.lights?.mode === 'all'
      ? [{ type: 'turn_off_all_lights' }]
      : pickedIds(v.lights, lightItems(ctx)).map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_off', service_value: 'turn_off' }))
    const ac = acEntity(ctx)
    if (v.acOff && ac) {
      actions.push(ac.entity_id.startsWith('ir.')
        ? { type: 'ir_command', ir_device_id: ac.entity_id.slice(3), ir_command: 'power_off' }
        : { type: 'call_service', entity_id: ac.entity_id, service: 'climate.turn_off', service_value: 'turn_off' })
    }
    if (v.notify) actions.push({ type: 'notify', title: 'Leave Home', message: t('automations.leaveHome.notifyMsg') })

    await createAutomation({
      id: initial?.id || LEAVE_HOME_ID, name: 'Leave Home',
      description: t('automations.leaveHome.desc'), trigger, conditions, actions, rooms: [],
    })
    // Security alert: any sensor sees movement WHILE everyone is away → notify.
    const alertAvailable = (ctx.persons || []).length > 0 && motionIds.length > 0
    if (v.alert && alertAvailable) {
      await createAutomation({
        id: ALERT_ID, name: 'Leave Home — Away Alert', description: t('automations.leaveHome.alertDesc'),
        trigger: { type: 'state', entity_id: motionIds, state: 'on' },
        conditions: [{ type: 'presence', value: 'all_away' }],
        actions: [{ type: 'notify', title: 'Ziggy', message: t('automations.leaveHome.alertMsg') }],
        rooms: [],
      })
    } else {
      try { await deleteAutomation(ALERT_ID) } catch { /* removed / never on */ }
    }
  },

  remove: async (ctx, initial) => {
    await deleteAutomation(initial?.id || LEAVE_HOME_ID)
    try { await deleteAutomation(ALERT_ID) } catch { /* gone */ }
  },
}
