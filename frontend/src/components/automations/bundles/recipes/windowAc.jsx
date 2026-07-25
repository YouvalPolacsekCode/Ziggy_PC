import { createAutomation, deleteAutomation } from '../../../../lib/api'
import { pickedIds, pickFrom } from '../engine/context'

// ── Window Open — AC Off recipe ───────────────────────────────────────────────
// Two modes: "Just tell me" (actionable push with a one-tap off button) or
// "Turn it off" (auto-pause, optionally resume when every watched window is
// closed again). Works with a smart (HA) AC OR an IR AC. A grace delay avoids
// nagging on a quick open/close.

const WINDOW_AC_ID = 'ziggy_window_ac_off'
const RESUME_TIMEOUT_S = 6 * 60 * 60   // give up waiting for "all closed" after 6h

const acItems = (ctx) => ctx.entities
  .filter((e) => e.domain === 'climate' || String(e.entity_id).startsWith('ir.'))
  .map((e) => ({ ...ctx.asItem(e), icon: '❄️' }))
const winItems = (ctx) => ctx.entities
  .filter((e) => e.domain === 'binary_sensor' && ['window', 'door', 'opening', 'garage_door'].includes(e.device_class))
  .map(ctx.asItem)

const isIr = (acId) => String(acId || '').startsWith('ir.')
const offAction = (acId) => isIr(acId)
  ? { type: 'ir_command', ir_device_id: acId.slice(3), ir_command: 'turn_off' }
  : { type: 'call_service', entity_id: acId, service: 'climate.turn_off', service_value: 'turn_off' }
const onAction = (acId) => isIr(acId)
  ? { type: 'ir_command', ir_device_id: acId.slice(3), ir_command: 'turn_on' }
  : { type: 'call_service', entity_id: acId, service: 'climate.turn_on', service_value: 'turn_on' }

export default {
  id: 'window_ac',
  titleKey: 'automations.windowAc.title',
  subtitleKey: 'automations.windowAc.subtitle',
  icon: '🪟',
  failedKey: 'automations.windowAc.failed',

  derive: (initial, ctx) => {
    const isUpdate = !!initial?._isInstalled
    const acts = initial?.actions || []
    const trig = initial?.trigger || {}
    // AC id: from an ir_command, a climate call_service, or the notify button.
    let acId = ''
    for (const a of acts) {
      if (a.type === 'ir_command') { acId = `ir.${a.ir_device_id}`; break }
      if (a.type === 'call_service' && String(a.entity_id).startsWith('climate')) { acId = a.entity_id; break }
      if (a.type === 'notify_actionable') {
        const btn = (a.actions || [])[0]?.action
        if (btn?.type === 'ir_command') { acId = `ir.${btn.ir_device_id}`; break }
        if (btn?.entity_id) { acId = btn.entity_id; break }
      }
    }
    const mode = acts.some((a) => a.type === 'notify_actionable') ? 'notify' : 'auto'
    const chosenWin = Array.isArray(trig.entity_id) ? trig.entity_id : (trig.entity_id ? [trig.entity_id] : [])
    return {
      acId,
      mode: isUpdate ? mode : 'notify',
      windows: pickFrom(chosenWin, winItems(ctx).length, isUpdate),
      resume: isUpdate ? acts.some((a) => a.type === 'wait_for_state') : true,
      graceMin: trig.for_minutes ?? 1,
      alsoNotify: isUpdate ? (mode === 'notify' || acts.some((a) => a.type === 'notify')) : true,
    }
  },

  autoDefaults: (v, ctx) => {
    if (!v.acId && acItems(ctx)[0]) return { acId: acItems(ctx)[0].id }
    return {}
  },

  steps: [
    {
      key: 'ac', titleKey: 'automations.windowAc.acLabel', icon: '❄️',
      validate: (v) => !!v.acId,
      fields: [
        { key: 'acId', type: 'pickOne', icon: '❄️', items: acItems, emptyKey: 'automations.windowAc.noAc' },
      ],
    },
    {
      key: 'windows', titleKey: 'automations.windowAc.windowsLabel', icon: '🪟',
      validate: (v, ctx) => pickedIds(v.windows, winItems(ctx)).length > 0,
      fields: [
        { key: 'windows', type: 'pickMany', icon: '🪟', items: winItems,
          allKey: 'automations.windowAc.winAll', chooseKey: 'automations.windowAc.winChoose',
          emptyKey: 'automations.windowAc.noWindows' },
      ],
    },
    {
      key: 'mode', titleKey: 'automations.windowAc.modeLabel', icon: '⚡',
      fields: [
        { key: 'mode', type: 'choice', options: [
          { value: 'notify', icon: '🔔', labelKey: 'automations.windowAc.mode.notify', descKey: 'automations.windowAc.mode.notifyDesc' },
          { value: 'auto', icon: '⚡', labelKey: 'automations.windowAc.mode.auto', descKey: 'automations.windowAc.mode.autoDesc' },
        ] },
        { key: 'graceMin', type: 'number', labelKey: 'automations.windowAc.grace',
          min: 0, max: 60, suffixKey: 'automations.windowAc.minutes', width: 56 },
        { key: 'resume', type: 'toggle', icon: '🔁', labelKey: 'automations.windowAc.resume',
          subKey: 'automations.windowAc.resumeSub', visibleWhen: (v) => v.mode === 'auto' },
        { key: 'alsoNotify', type: 'toggle', icon: '🔔', labelKey: 'automations.windowAc.alsoNotify',
          visibleWhen: (v) => v.mode === 'auto' },
      ],
    },
  ],

  canSave: (v, ctx) => !!v.acId && pickedIds(v.windows, winItems(ctx)).length > 0,

  save: async (v, ctx, initial) => {
    const t = ctx.t
    const winIds = pickedIds(v.windows, winItems(ctx))
    const trigger = { type: 'state', entity_id: winIds, state: 'on' }
    if (Number(v.graceMin) > 0) trigger.for_minutes = Number(v.graceMin)
    // Condition: the AC is actually running (else opening a window is a no-op).
    const conditions = [isIr(v.acId)
      ? { type: 'ir_device_state', ir_device_id: v.acId.slice(3), operator: 'is', value: 'on' }
      : { entity_id: v.acId, operator: 'is_not', value: 'off' }]
    const actions = []
    if (v.mode === 'notify') {
      actions.push({
        type: 'notify_actionable',
        title: t('automations.windowAc.title'),
        message: t('automations.windowAc.notifyMsg'),
        actions: [{ label: t('automations.windowAc.offBtn'), action: offAction(v.acId) }],
      })
    } else {
      actions.push(offAction(v.acId))
      if (v.alsoNotify) actions.push({ type: 'notify', title: t('automations.windowAc.title'), message: t('automations.windowAc.autoMsg') })
      if (v.resume) {
        // Resume once EVERY watched window is closed (chained waits — each
        // passes immediately if already shut), then turn the AC back on.
        winIds.forEach((id) => actions.push({ type: 'wait_for_state', entity_id: id, state: 'off', timeout_seconds: RESUME_TIMEOUT_S, on_timeout: 'continue' }))
        actions.push(onAction(v.acId))
      }
    }
    await createAutomation({
      id: initial?.id || WINDOW_AC_ID, name: 'Window Open — AC Off',
      description: t('automations.windowAc.desc'), trigger, conditions, actions, rooms: [],
    })
  },

  remove: async (ctx, initial) => {
    await deleteAutomation(initial?.id || WINDOW_AC_ID)
  },
}
