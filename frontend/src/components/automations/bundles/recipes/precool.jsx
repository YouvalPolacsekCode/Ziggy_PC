import {
  createAutomation, deleteAutomation, getPresencePersons,
  getPresenceZone, listPresenceZones, createPresenceZone, updatePresenceZone,
} from '../../../../lib/api'

// ── Pre-cool on Arrival recipe ────────────────────────────────────────────────
// HEAD START: start the AC while you're still on your way. Trigger is Ziggy's
// native `zone_entered` on a wide "Near Home" ring the wizard owns (it creates/
// resizes the geofence centred on your Home zone at the chosen radius).
// Presence comes from Ziggy's OWN engine — it only works once you're tracked.
// Actions run natively (climate.turn_on + set_temperature, or IR power-on).

const PRECOOL_ID = 'ziggy_precool_arrival'
const NEAR_HOME_NAME = 'Near Home'
const DEFAULT_TEMP = 24     // Israeli AC default
const DEFAULT_RADIUS_KM = 2

const acItems = (ctx) => ctx.entities
  .filter((e) => e.domain === 'climate' || String(e.entity_id).startsWith('ir.'))
  .map((e) => ({ ...ctx.asItem(e), icon: '❄️' }))
const tempEnts = (ctx) => ctx.entities.filter((e) => e.domain === 'sensor' && e.device_class === 'temperature')
const isIr = (acId) => String(acId || '').startsWith('ir.')
const presenceOn = (ctx) => (ctx.persons || []).length > 0

export default {
  id: 'precool',
  titleKey: 'automations.precool.title',
  subtitleKey: 'automations.precool.subtitle',
  icon: '🚗',
  failedKey: 'automations.precool.failed',

  loadData: async () => {
    const out = { persons: [], homeZone: null, zones: [] }
    try { out.persons = (await getPresencePersons())?.persons || [] } catch { /* untracked */ }
    try {
      const z = await getPresenceZone()
      out.homeZone = (z && z.configured !== false && z.lat != null) ? z : null
    } catch { /* unset */ }
    try { out.zones = (await listPresenceZones())?.zones || [] } catch { /* none */ }
    return out
  },

  derive: (initial, ctx) => {
    const isUpdate = !!initial?._isInstalled
    const acts = initial?.actions || []
    const setTemp = acts.find((a) => a.type === 'call_service' && a.service === 'climate.set_temperature')
    const conds = initial?.conditions || []
    const hot = conds.find((c) => c.operator === 'above' && c.entity_id)
    const acAct = acts.find((a) => (a.type === 'call_service' && String(a.entity_id).startsWith('climate')) || a.type === 'ir_command')
    const nearZone = (ctx.zones || []).find((z) => (z.name || '').toLowerCase() === NEAR_HOME_NAME.toLowerCase())
    return {
      acId: acAct?.type === 'ir_command' ? `ir.${acAct.ir_device_id}` : (acAct?.entity_id || ''),
      temp: setTemp?.service_data?.temperature ?? DEFAULT_TEMP,
      radiusKm: nearZone ? Math.round((nearZone.radius_m / 1000) * 10) / 10 : DEFAULT_RADIUS_KM,
      onlyHot: isUpdate ? !!hot : true,
      hotEntity: hot?.entity_id || '',
      hotThreshold: hot ? Number(hot.value) : DEFAULT_TEMP,
      notify: isUpdate ? acts.some((a) => a.type === 'notify') : true,
    }
  },

  autoDefaults: (v, ctx) => {
    const patch = {}
    if (!v.acId && acItems(ctx)[0]) patch.acId = acItems(ctx)[0].id
    if (!v.hotEntity && tempEnts(ctx)[0]) patch.hotEntity = tempEnts(ctx)[0].entity_id
    return patch
  },

  steps: [
    {
      key: 'headStart', titleKey: 'automations.precool.headStartLabel', icon: '📍',
      validate: (v, ctx) => presenceOn(ctx) && !!ctx.homeZone,
      fields: [
        { key: '_needPresence', type: 'warnIf', when: (v, ctx) => !presenceOn(ctx),
          textKey: 'automations.precool.needPresence' },
        { key: '_needHome', type: 'warnIf', when: (v, ctx) => presenceOn(ctx) && !ctx.homeZone,
          textKey: 'automations.precool.needHomeZone' },
        { key: 'radiusKm', type: 'number', labelKey: 'automations.precool.withinKm',
          min: 0.3, max: 20, step: 0.5, suffixKey: 'automations.precool.km', width: 74 },
        { key: '_hsHint', type: 'note', textKey: 'automations.precool.headStartHint' },
      ],
    },
    {
      key: 'ac', titleKey: 'automations.precool.acLabel', icon: '❄️',
      validate: (v) => !!v.acId,
      fields: [
        { key: 'acId', type: 'pickOne', icon: '❄️', items: acItems, emptyKey: 'automations.precool.noAc' },
        // Target temp — smart AC only (IR power-on can't set a setpoint).
        { key: 'temp', type: 'number', labelKey: 'automations.precool.coolTo',
          min: 16, max: 30, suffix: '°C', width: 64,
          visibleWhen: (v) => !!v.acId && !isIr(v.acId) },
      ],
    },
    {
      key: 'options', titleKey: 'automations.bundles.settings', icon: '⚙️',
      fields: [
        { key: 'onlyHot', type: 'toggle', icon: '🌡️', labelKey: 'automations.precool.onlyHot',
          sub: (t, v) => (v.onlyHot ? t('automations.precool.onlyHotSub', { n: v.hotThreshold }) : undefined),
          visibleWhen: (v, ctx) => tempEnts(ctx).length > 0 },
        { key: 'hotThreshold', type: 'number', labelKey: 'automations.precool.warmerThan',
          min: 16, max: 35, suffix: '°C', width: 60,
          visibleWhen: (v, ctx) => v.onlyHot && tempEnts(ctx).length > 0 },
        { key: 'notify', type: 'toggle', icon: '🔔', labelKey: 'automations.precool.notify' },
      ],
    },
  ],

  canSave: (v, ctx) => presenceOn(ctx) && !!ctx.homeZone && !!v.acId,

  save: async (v, ctx, initial) => {
    const t = ctx.t
    // Ensure the "Near Home" geofence exists at the chosen radius, centred on Home.
    const radius_m = Math.max(300, Math.round((Number(v.radiusKm) || DEFAULT_RADIUS_KM) * 1000))
    const nearZone = (ctx.zones || []).find((z) => (z.name || '').toLowerCase() === NEAR_HOME_NAME.toLowerCase())
    if (nearZone) {
      if (Math.abs((nearZone.radius_m || 0) - radius_m) > 1) await updatePresenceZone(nearZone.id, { radius_m })
    } else {
      await createPresenceZone({ name: NEAR_HOME_NAME, lat: ctx.homeZone.lat, lon: ctx.homeZone.lon, radius_m })
    }

    const actions = isIr(v.acId)
      // IR AC: power on to cool (temp over IR is device-specific — power-on is
      // the reliable move).
      ? [{ type: 'ir_command', ir_device_id: v.acId.slice(3), ir_command: 'power_on' }]
      : [
        { type: 'call_service', entity_id: v.acId, service: 'climate.turn_on', service_value: 'turn_on' },
        { type: 'call_service', entity_id: v.acId, service: 'climate.set_temperature', service_value: 'set_temperature', service_data: { temperature: Number(v.temp) || DEFAULT_TEMP } },
      ]
    if (v.notify) actions.push({ type: 'notify', title: 'Pre-cool on Arrival', message: t('automations.precool.notifyMsg') })

    const conditions = []
    if (v.onlyHot && v.hotEntity) conditions.push({ entity_id: v.hotEntity, operator: 'above', value: String(Number(v.hotThreshold) || DEFAULT_TEMP) })

    await createAutomation({
      id: initial?.id || PRECOOL_ID, name: 'Pre-cool on Arrival',
      description: t('automations.precool.desc'),
      trigger: { type: 'zone_entered', zone: NEAR_HOME_NAME, person: '*' },
      conditions, actions, rooms: [],
    })
  },

  remove: async (ctx, initial) => {
    await deleteAutomation(initial?.id || PRECOOL_ID)
  },
}
