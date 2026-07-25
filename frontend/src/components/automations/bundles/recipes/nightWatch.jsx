import { createAutomation, deleteAutomation, getEntities } from '../../../../lib/api'
import { pickedIds, pickFrom } from '../engine/context'

// ── Night Watch recipe ────────────────────────────────────────────────────────
// A paired 3-stage night routine:
//   1. Activate: at your set time OR once you're in bed, dim the lights + ARM.
//   2. Alert:    a quiet push if the living-room sensor stirs (armed only).
//   3. Disarm:   at sunrise, disable the alert + restore the lights.
// The alert stage is named so its HA entity slug == its config id
// (ziggy_night_watch_alert), so the disarm condition targets a real entity.

const BASE_ID = 'ziggy_night_watch'
const ALERT_ID = `${BASE_ID}_alert`

const presenceItems = (ctx) => ctx.entities
  .filter((e) => e.domain === 'binary_sensor' && ['presence', 'occupancy', 'motion'].includes(e.device_class))
  .map(ctx.asItem)

// Living candidates: not the bedroom sensor, and not in the bedroom's room.
const livingItems = (ctx, values) => {
  const bedroomRoom = values.bedroom ? ctx.roomOf(values.bedroom) : null
  return presenceItems(ctx).filter((i) =>
    i.id !== values.bedroom && !(bedroomRoom !== ctx.NO_ROOM && bedroomRoom && ctx.roomOf(i.id) === bedroomRoom))
}

const lightItems = (ctx) => (ctx.allLights || ctx.entities.filter((e) => e.domain === 'light')).map(ctx.asItem)

const livingIds = (v, ctx) => (v.living?.ids || []).filter((id) => livingItems(ctx, v).some((i) => i.id === id))

export default {
  id: 'night_watch',
  titleKey: 'automations.nightWatch.title',
  subtitleKey: 'automations.nightWatch.subtitle',
  icon: '🌙',
  failedKey: 'automations.nightWatch.failed',

  loadData: async () => {
    try {
      const r = await getEntities('light', { all: true })
      const list = (r?.entities || []).map((e) => ({ ...e, domain: e.domain || 'light' }))
      if (list.length) return { allLights: list }
    } catch { /* store fallback */ }
    return {}
  },

  derive: (initial, ctx) => {
    const isUpdate = !!initial?._isInstalled
    const trig = initial?.trigger || {}
    const conds = initial?.conditions || []
    const acts = initial?.actions || []
    const dimAct = acts.find((a) => a.type === 'call_service' && a.service === 'light.turn_on')
    const savedIds = acts.find((a) => a.type === 'save_entity_states')?.entity_ids || []
    const alertStage = (initial?.stages || []).find((s) => (s.key || '') === 'alert')
    const alertTrig = alertStage?.trigger || {}
    const living = Array.isArray(alertTrig.entity_id) ? alertTrig.entity_id : (alertTrig.entity_id ? [alertTrig.entity_id] : [])
    const presenceArm = trig.type === 'state'
    return {
      armMode: presenceArm ? 'presence' : 'time',
      armTime: (trig.time || '23:30').slice(0, 5),
      bedroom: presenceArm ? (Array.isArray(trig.entity_id) ? trig.entity_id[0] : trig.entity_id) : (conds.find((c) => c.entity_id)?.entity_id || ''),
      living: { mode: 'choose', ids: living },
      dimLevel: dimAct?.service_data?.brightness_pct ?? 10,
      lights: pickFrom(savedIds, lightItems(ctx).length, isUpdate),
    }
  },

  // Smart defaults once candidates load: bedroom → a sensor whose room/name
  // reads "bedroom" (prefer presence-class); living → one in a different room.
  autoDefaults: (v, ctx) => {
    const patch = {}
    const pres = presenceItems(ctx)
    if (!v.bedroom && pres.length) {
      const bed = pres.find((i) => /bed|שינה/i.test(i.label))
        || pres.find((i) => i._entity?.device_class === 'presence') || pres[0]
      patch.bedroom = bed?.id || ''
    }
    if ((v.living?.ids || []).length === 0) {
      const cands = livingItems(ctx, { ...v, ...patch })
      if (cands.length) {
        const lv = cands.find((i) => /living|salon|סלון/i.test(i.label)) || cands[0]
        patch.living = { mode: 'choose', ids: [lv.id] }
      }
    }
    return patch
  },

  steps: [
    {
      key: 'arm', titleKey: 'automations.nightWatch.armLabel', icon: '🌙',
      fields: [
        { key: '_needTwo', type: 'warnIf', when: (v, ctx) => presenceItems(ctx).length < 2,
          textKey: 'automations.nightWatch.needTwo' },
        { key: 'armMode', type: 'choice', options: [
          { value: 'time', icon: '🕛', labelKey: 'automations.nightWatch.arm.time', descKey: 'automations.nightWatch.arm.timeHint' },
          { value: 'presence', icon: '🛏', labelKey: 'automations.nightWatch.arm.presence', descKey: 'automations.nightWatch.arm.presenceHint' },
        ] },
        { key: 'armTime', type: 'time', icon: '🕛', labelKey: 'automations.nightWatch.armLabel',
          visibleWhen: (v) => v.armMode === 'time' },
      ],
    },
    {
      key: 'bedroom', titleKey: 'automations.nightWatch.bedroomLabel', icon: '🛏',
      validate: (v) => !!v.bedroom,
      fields: [
        { key: 'bedroom', type: 'pickOne', items: presenceItems, collapseSingle: false,
          emptyKey: 'automations.nightWatch.noSensors' },
      ],
    },
    {
      key: 'living', titleKey: 'automations.nightWatch.livingLabel', icon: '🛋',
      validate: (v, ctx) => livingIds(v, ctx).length > 0,
      fields: [
        { key: 'living', type: 'pickMany', allToggle: false, items: livingItems,
          emptyKey: 'automations.nightWatch.noOther' },
      ],
    },
    {
      key: 'lights', titleKey: 'automations.nightWatch.lightsLabel', icon: '💡',
      validate: (v, ctx) => pickedIds(v.lights, lightItems(ctx)).length > 0,
      fields: [
        { key: 'lights', type: 'pickMany', icon: '💡', items: lightItems,
          allKey: 'automations.nightWatch.allLights', chooseKey: 'automations.nightWatch.chooseLights',
          emptyKey: 'automations.motionLight.noLights' },
        { key: 'dimLevel', type: 'number', icon: '🌙', labelKey: 'automations.nightWatch.dimTo',
          min: 1, max: 100, suffix: '%', width: 56 },
      ],
    },
  ],

  canSave: (v, ctx) =>
    !!v.bedroom && livingIds(v, ctx).length > 0 && pickedIds(v.lights, lightItems(ctx)).length > 0,

  save: async (v, ctx, initial) => {
    const t = ctx.t
    const D = Math.max(1, Math.min(100, Number(v.dimLevel) || 10))
    const lightIds = pickedIds(v.lights, lightItems(ctx))
    const living = livingIds(v, ctx)
    const activate = {
      key: 'activate', name: 'Night Watch', description: t('automations.nightWatch.stageActivate'),
      trigger: v.armMode === 'presence'
        ? { type: 'state', entity_id: v.bedroom, state: 'on', for_minutes: 10 }
        : { type: 'time', time: v.armTime },
      conditions: v.armMode === 'presence' ? [] : [{ entity_id: v.bedroom, operator: 'is', value: 'on' }],
      actions: [
        { type: 'save_entity_states', namespace: 'night_watch', state_key: 'saved_lights', entity_ids: lightIds },
        ...lightIds.map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_on', service_value: 'turn_on', service_data: { brightness_pct: D } })),
        { type: 'automation', automation_id: ALERT_ID, mode: 'enable' },
      ],
      rooms: [],
    }
    const alert = {
      key: 'alert', name: 'Ziggy Night Watch alert',   // slug == config id, for the disarm gate
      description: t('automations.nightWatch.stageAlert'),
      trigger: { type: 'state', entity_id: living, state: 'on' },
      conditions: [],
      actions: [{ type: 'notify', title: 'Ziggy', message: t('automations.nightWatch.alertMsg') }],
      rooms: [], _initial_enabled: false,
    }
    const disarm = {
      key: 'disarm', name: 'Ziggy Night Watch disarm', description: t('automations.nightWatch.stageDisarm'),
      trigger: { type: 'sunrise', offset: '' },
      conditions: [{ entity_id: `automation.${ALERT_ID}`, operator: 'is', value: 'on' }],
      actions: [
        { type: 'automation', automation_id: ALERT_ID, mode: 'disable' },
        { type: 'restore_entity_states', namespace: 'night_watch', state_key: 'saved_lights' },
      ],
      rooms: [],
    }
    await createAutomation({
      id: initial?.id || BASE_ID, base_id: BASE_ID, name: 'Night Watch',
      description: t('automations.nightWatch.desc'),
      paired: true, stages: [activate, alert, disarm],
      trigger: activate.trigger, conditions: activate.conditions, actions: activate.actions, rooms: [],
    })
  },

  remove: async (ctx, initial) => {
    await deleteAutomation(initial?.id || BASE_ID)
    try { await deleteAutomation(ALERT_ID) } catch { /* gone */ }
    try { await deleteAutomation(`${BASE_ID}_disarm`) } catch { /* gone */ }
  },
}
