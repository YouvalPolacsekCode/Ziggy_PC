import React from 'react'
import { createAutomation, deleteAutomation, getEntities } from '../../../../lib/api'
import { pickedIds, pickFrom } from '../engine/context'
import { instanceBaseOf, instanceMemberIds, freshInstanceBase, stageId } from './motionLightIds'

// ── Motion Light recipe ───────────────────────────────────────────────────────
// ROOM-AWARE: each selected sensor drives only the lights in ITS OWN room. When
// more than one room is involved it's saved as a paired automation (one stage
// per room); a single room stays a single automation. Falls back to "any → all"
// only when there's no room info to pair on. The off-path uses
// wait_for_state(motion → off) + a linger so continued movement holds the light.

const BASE_ID = 'ziggy_motion_light'
const WAIT_TIMEOUT_S = 60 * 60
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'room'

const motionItems = (ctx) => ctx.entities
  .filter((e) => e.domain === 'binary_sensor' && ['motion', 'occupancy', 'presence'].includes(e.device_class))
  .map(ctx.asItem)
const lightItems = (ctx) => (ctx.allLights || ctx.entities.filter((e) => e.domain === 'light')).map(ctx.asItem)

// How the current selection pairs sensor-rooms to light-rooms.
function pairGroups(values, ctx) {
  const mIds = pickedIds(values.motion, motionItems(ctx))
  const lIds = pickedIds(values.lights, lightItems(ctx))
  const sBy = {}, lBy = {}
  mIds.forEach((id) => { const r = ctx.roomOf(id); (sBy[r] = sBy[r] || []).push(id) })
  lIds.forEach((id) => { const r = ctx.roomOf(id); (lBy[r] = lBy[r] || []).push(id) })
  return Object.keys(sBy).filter((r) => (lBy[r] || []).length)
    .map((r) => ({ room: r, sensors: sBy[r], lights: lBy[r] }))
}

function PairPreview({ values, ctx, t }) {
  const groups = pairGroups(values, ctx)
  if (groups.length <= 1) return null
  const roomLabel = (r) => (r === ctx.NO_ROOM ? t('automations.motionLight.otherRoom') : r)
  return (
    <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, background: 'var(--surface)', padding: '10px 12px' }}>
      <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', margin: '0 0 6px' }} dir="auto">{t('automations.motionLight.pairsBy')}</p>
      {groups.map((g) => (
        <p key={g.room} style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '2px 0' }} dir="auto">
          🚶 {roomLabel(g.room)} → 💡 {t('automations.motionLight.nLights', { n: g.lights.length })}
        </p>
      ))}
    </div>
  )
}

export default {
  id: 'motion_light',
  titleKey: 'automations.motionLight.title',
  subtitleKey: 'automations.motionLight.subtitle',
  icon: '🚶',
  failedKey: 'automations.motionLight.failed',

  loadData: async (ctx) => {
    // Lights fetched UNFILTERED — the grouped device store can absorb some.
    try {
      const r = await getEntities('light', { all: true })
      const list = (r?.entities || []).map((e) => ({ ...e, domain: e.domain || 'light' }))
      if (list.length) return { allLights: list }
    } catch { /* store fallback */ }
    return {}
  },

  derive: (initial, ctx) => {
    const isUpdate = !!initial?._isInstalled
    // Edit: reconstruct sensors + lights across the stages of THIS instance only
    // — a second Motion Light must not inherit the first instance's devices.
    const base = isUpdate && initial?.id ? instanceBaseOf(initial.id) : null
    const memberSet = base ? new Set(instanceMemberIds(base, (ctx.automations || []).map((a) => a.id))) : null
    const mine = memberSet ? (ctx.automations || []).filter((a) => memberSet.has(a.id)) : []
    const src = mine.length ? mine : (initial && isUpdate ? [initial] : [])
    const mSet = new Set(), lSet = new Set()
    let bright = 60, linger = 120, timeCond = null
    for (const a of src) {
      const trig = a.trigger || {}
      const tids = Array.isArray(trig.entity_id) ? trig.entity_id : (trig.entity_id ? [trig.entity_id] : [])
      tids.forEach((id) => mSet.add(id))
      for (const act of (a.actions || [])) {
        if (act.type === 'call_service' && act.service === 'light.turn_on') {
          lSet.add(act.entity_id)
          if (act.service_data?.brightness_pct != null) bright = act.service_data.brightness_pct
        }
        if (act.type === 'delay' && act.seconds != null) linger = act.seconds
      }
      const tc = (a.conditions || []).find((c) => c.type === 'time')
      if (tc) timeCond = tc
    }
    return {
      motion: pickFrom([...mSet], motionItems(ctx).length, isUpdate),
      lights: pickFrom([...lSet], lightItems(ctx).length, isUpdate),
      brightness: bright,
      lingerMin: Math.max(1, Math.round((linger || 120) / 60)),
      nightOnly: isUpdate ? !!timeCond : true,
      after: timeCond?.after || '21:00',
      before: timeCond?.before || '07:00',
    }
  },

  steps: [
    {
      key: 'motion', titleKey: 'automations.motionLight.motionLabel', icon: '🚶',
      validate: (v, ctx) => pickedIds(v.motion, motionItems(ctx)).length > 0,
      fields: [
        { key: 'motion', type: 'pickMany', icon: '🚶', items: motionItems,
          allKey: 'automations.motionLight.all', chooseKey: 'automations.motionLight.choose',
          emptyKey: 'automations.motionLight.noMotion' },
      ],
    },
    {
      key: 'lights', titleKey: 'automations.motionLight.lightsLabel', icon: '💡',
      validate: (v, ctx) => pickedIds(v.lights, lightItems(ctx)).length > 0,
      fields: [
        { key: 'lights', type: 'pickMany', icon: '💡', items: lightItems,
          allKey: 'automations.motionLight.all', chooseKey: 'automations.motionLight.choose',
          emptyKey: 'automations.motionLight.noLights' },
        { key: '_pairs', type: 'custom', render: (p) => <PairPreview {...p} /> },
      ],
    },
    {
      key: 'settings', titleKey: 'automations.bundles.settings', icon: '⚙️',
      fields: [
        { key: 'brightness', type: 'number', icon: '💡', labelKey: 'automations.motionLight.brightness',
          min: 1, max: 100, suffix: '%' },
        { key: 'lingerMin', type: 'number', icon: '⏱', labelKey: 'automations.motionLight.offAfter',
          min: 1, max: 120, suffixKey: 'automations.motionLight.minutes', width: 56 },
        { key: 'nightOnly', type: 'toggle', icon: '🌙', labelKey: 'automations.motionLight.nightOnly',
          subKey: 'automations.motionLight.nightOnlySub' },
        { key: '_window', type: 'timeWindow', keys: ['after', 'before'],
          fromKey: 'automations.motionLight.from', toKey: 'automations.motionLight.to',
          visibleWhen: (v) => !!v.nightOnly },
      ],
    },
  ],

  canSave: (v, ctx) =>
    pickedIds(v.motion, motionItems(ctx)).length > 0 && pickedIds(v.lights, lightItems(ctx)).length > 0,

  save: async (v, ctx, initial) => {
    const t = ctx.t
    const B = Math.max(1, Math.min(100, Number(v.brightness) || 60))
    const conditions = v.nightOnly ? [{ type: 'time', after: v.after, before: v.before }] : []
    const stageActions = (sensors, lights) => ([
      ...lights.map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_on', service_value: 'turn_on', service_data: { brightness_pct: B } })),
      ...sensors.map((id) => ({ type: 'wait_for_state', entity_id: id, state: 'off', timeout_seconds: WAIT_TIMEOUT_S, on_timeout: 'continue' })),
      { type: 'delay', seconds: Math.max(5, (Number(v.lingerMin) || 2) * 60) },
      ...lights.map((id) => ({ type: 'call_service', entity_id: id, service: 'light.turn_off', service_value: 'turn_off' })),
    ])
    const roomLabel = (r) => (r === ctx.NO_ROOM ? t('automations.motionLight.otherRoom') : r)
    const groups = pairGroups(v, ctx)
    // Editing keeps this instance's base; adding mints a fresh, non-colliding
    // base so "Add" creates a NEW Motion Light instead of overwriting the first.
    const allIds = (ctx.automations || []).map((a) => a.id)
    const base = initial?._isInstalled && initial?.id ? instanceBaseOf(initial.id) : freshInstanceBase(allIds)
    let payload, ids
    if (groups.length <= 1) {
      const g = groups[0] || {
        sensors: pickedIds(v.motion, motionItems(ctx)),
        lights: pickedIds(v.lights, lightItems(ctx)),
      }
      payload = { id: base, name: 'Motion Light', description: t('automations.motionLight.desc'),
        trigger: { type: 'state', entity_id: g.sensors, state: 'on' }, conditions, actions: stageActions(g.sensors, g.lights), rooms: [] }
      ids = [base]
    } else {
      const stages = groups.map((g, i) => ({
        key: slug(g.room === ctx.NO_ROOM ? 'other' : g.room),
        name: i === 0 ? 'Motion Light' : `Motion Light — ${roomLabel(g.room)}`,
        description: t('automations.motionLight.desc'),
        trigger: { type: 'state', entity_id: g.sensors, state: 'on' },
        conditions, actions: stageActions(g.sensors, g.lights), rooms: [],
      }))
      ids = stages.map((s, i) => (i === 0 ? base : stageId(base, s.key)))
      payload = { id: base, base_id: base, name: 'Motion Light', description: t('automations.motionLight.desc'),
        paired: true, stages, trigger: stages[0].trigger, conditions: stages[0].conditions, actions: stages[0].actions, rooms: [] }
    }
    await createAutomation(payload)
    // Drop any stage of THIS instance that's no longer part of the setup — never
    // touch the other instances.
    for (const id of instanceMemberIds(base, allIds)) if (!ids.includes(id)) { try { await deleteAutomation(id) } catch { /* stale */ } }
  },

  remove: async (ctx, initial) => {
    const base = initial?.id ? instanceBaseOf(initial.id) : BASE_ID
    const members = instanceMemberIds(base, (ctx.automations || []).map((a) => a.id))
    const ids = members.length ? members : [initial?.id || base]
    for (const id of ids) { try { await deleteAutomation(id) } catch { /* already gone */ } }
  },
}
