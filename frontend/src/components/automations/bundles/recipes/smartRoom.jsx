import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { designSmartRoom, applyAutomationBundle, deleteSmartRoom, toggleAutomation } from '../../../../lib/api'
import { entityDisplayName } from '../../../../lib/utils'
import { Toggle } from '../../../ui/Toggle'
import { Eyebrow, WarnBox, RadioRow, listBox } from '../engine/fields'
import OccupancySensorForm from '../../OccupancySensorForm'

// ── Smart Room recipe ─────────────────────────────────────────────────────────
// The deterministic sleeping-wife orchestra: Day-on / Night-on(guarded) / Off
// rules on the room's ONE presence sensor. The backend designer
// (designSmartRoom) owns rule synthesis; the wizard collects room + sensor +
// the few numbers, then applies the returned bundle. This is the recipe that
// leans hardest on `custom` steps — room resolution is an async round-trip and
// sensor creation embeds the existing OccupancySensorForm.

const SR_OCC_TYPE = { motion: 'motion', presence: 'presence', occupancy: 'presence' }
const SMART_ROOM_RE = /^ziggy_smart_room_(.+)_(day|night|off)$/

const DEFAULT_OPTS = {
  day_brightness: 100, night_brightness: 30, night_kelvin: 2700,
  night_start: '19:00', night_end: '06:30', off_delay_minutes: 5,
}

// Presence-source candidates for the chosen room: the room's raw
// motion/presence/occupancy sensors + any existing merged sensor.
function presenceCandidates(ctx, room, t) {
  if (!room) return []
  const area = (ctx.rooms || []).find((r) => String(r.id) === String(room.id) || r.name === room.name)
  const fusedIds = new Set((ctx.occupancySensors || []).map((s) => s.entity_id))
  const out = []
  for (const id of (area?.entities || [])) {
    const e = ctx.entityMap[id]
    if (e && e.domain === 'binary_sensor' && SR_OCC_TYPE[e.device_class] && !fusedIds.has(id)) {
      out.push({ id, name: entityDisplayName(e) || id, kind: SR_OCC_TYPE[e.device_class] })
    }
  }
  const rn = (room.name || '').toLowerCase(), rid = String(room.id).toLowerCase()
  for (const s of (ctx.occupancySensors || [])) {
    const sr = String(s.room || '').toLowerCase()
    if (sr === rid || sr === rn || sr.replace(/_/g, ' ') === rn) {
      // A room can hold several named smart sensors (main + zones like an
      // en-suite) — show each by its own name so the user picks the right one.
      out.push({ id: s.entity_id, name: s.name || t('automations.smartRoom.wiz.mergedSensor'),
                 kind: 'merged', zoneKey: s.key || s.room })
    }
  }
  return out
}

// The rule-set key for this Smart Room instance: the chosen presence sensor's
// key ({room} for the main sensor, {room}_N for zones like an en-suite). Raw
// sensors and unknowns fall back to the room slug — exactly today's behavior.
function zoneSlugOf(ctx, values) {
  const rec = (ctx.occupancySensors || []).find((s) => s.entity_id === values.occEntity)
  return (rec && (rec.key || rec.room)) || String(values.room?.id || '')
}

// The room's lights, for the per-instance light picker.
function roomLights(ctx, room) {
  if (!room) return []
  const area = (ctx.rooms || []).find((r) => String(r.id) === String(room.id) || r.name === room.name)
  return (area?.entities || [])
    .map((id) => ctx.entityMap[id])
    .filter((e) => e && e.domain === 'light')
    .map((e) => ({ id: e.entity_id, name: entityDisplayName(e) || e.entity_id }))
}

// Door/opening sensors in the room that aren't already inside a smart sensor —
// if any exist and the room has no smart sensor yet, the wizard nudges the
// user to create one (a raw door sensor alone is a WRONG occupancy trigger:
// "open" would read as "occupied", so we never list it as a pick).
function unfusedDoorSensors(ctx, room) {
  if (!room) return []
  const area = (ctx.rooms || []).find((r) => String(r.id) === String(room.id) || r.name === room.name)
  const fusedSources = new Set((ctx.occupancySensors || []).flatMap((s) => s.sensors || []))
  return (area?.entities || []).filter((id) => {
    const e = ctx.entityMap[id]
    return e && e.domain === 'binary_sensor'
      && (e.device_class === 'door' || e.device_class === 'opening')
      && !fusedSources.has(id)
  })
}

// ── Step 1: pick the room (async designer round-trip on select) ──────────────
function RoomPickField({ values, setValue, ctx, t }) {
  const [resolving, setResolving] = useState(false)
  const pick = async (r) => {
    const room = { id: r.id, name: r.name }
    setValue('room', room)
    setValue('_decline', null)
    setValue('_resolving', true)
    setResolving(true)
    try {
      const res = await designSmartRoom(room.id || room.name, undefined, ctx.lang)
      if (res?.needs_occupancy) { setValue('_needsSensor', true); setValue('occEntity', null) }
      else if (res?.bundle?.decline) setValue('_decline', res.bundle.decline)
      else { setValue('_needsSensor', false); setValue('occEntity', res?.bundle?.occupancy_entity || null) }
    } catch (e) {
      setValue('_decline', e?.userMessage || e?.message || t('automations.smartRoom.designFailed'))
    }
    setValue('_resolving', false)
    setResolving(false)
  }
  const rooms = ctx.rooms || []
  if (rooms.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--ink-faint)' }} dir="auto">{t('automations.smartRoom.noRooms')}</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }} dir="auto">{t('automations.smartRoom.pickPrompt')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {rooms.map((r) => {
          const sel = values.room && String(values.room.id) === String(r.id)
          return (
            <button key={r.id || r.name} type="button" onClick={() => pick(r)}
              className="z-btn-secondary"
              style={{ padding: '12px 14px', borderRadius: 11, textAlign: 'start', fontSize: 13.5, fontWeight: 600,
                border: sel ? '1px solid var(--ok)' : undefined,
                background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : undefined }} dir="auto">
              {r.name || r.id}
            </button>
          )
        })}
      </div>
      {resolving && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <motion.span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent' }}
            animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">
            {t('automations.smartRoom.designing', { room: values.room?.name || '' })}
          </span>
        </div>
      )}
      {values._decline && <WarnBox>{values._decline}</WarnBox>}
    </div>
  )
}

// ── Step 2: presence source (reuse existing sensor or create a merged one) ───
function PresenceField({ values, setValue, ctx, t }) {
  const room = values.room
  const candidates = useMemo(() => presenceCandidates(ctx, room, t), [ctx, room, t])
  const [creating, setCreating] = useState(false)
  if (values._needsSensor || creating || candidates.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, lineHeight: 1.5 }} dir="auto">
          {t('automations.smartRoom.needPresence', { room: room?.name || '' })}
        </p>
        <OccupancySensorForm initialRoom={room?.name || ''}
          onCreated={(res) => { setValue('occEntity', res?.entity_id || null); setValue('_needsSensor', false); setCreating(false) }}
          onClose={() => setCreating(false)} />
      </div>
    )
  }
  const doorsUnfused = unfusedDoorSensors(ctx, room)
  const hasMerged = candidates.some((c) => c.kind === 'merged')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.5 }} dir="auto">{t('automations.smartRoom.wiz.pickSensor')}</p>
      {doorsUnfused.length > 0 && !hasMerged && (
        <p style={{ fontSize: 12.5, color: 'var(--ink)', margin: 0, lineHeight: 1.55, padding: '9px 11px',
          borderRadius: 10, background: 'color-mix(in srgb, var(--ok) 8%, transparent)' }} dir="auto">
          {t('automations.smartRoom.wiz.doorNudge')}
        </p>
      )}
      <div style={listBox}>
        {candidates.map((c) => (
          <RadioRow key={c.id} sel={c.id === values.occEntity}
            label={c.name}
            sub={c.kind === 'merged' ? t('automations.smartRoom.wiz.mergedType') : t(`automations.smartSensor.type.${c.kind}`)}
            onClick={() => setValue('occEntity', c.id)} />
        ))}
      </div>
      <button type="button" onClick={() => setCreating(true)}
        style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--line)', borderRadius: 10,
          padding: '9px 14px', fontSize: 12.5, color: 'var(--ink-mute)', cursor: 'pointer', fontFamily: 'inherit' }} dir="auto">
        + {t('automations.smartRoom.wiz.createMerged')}
      </button>
    </div>
  )
}

// ── Step: which lights this Smart Room controls ──────────────────────────────
// values.lights === null means "all of the room's lights" (default). A zone
// Smart Room (e.g. en-suite) picks just its own light here.
function LightsField({ values, setValue, ctx, t }) {
  const all = roomLights(ctx, values.room)
  const selected = values.lights == null ? new Set(all.map((l) => l.id)) : new Set(values.lights)
  const toggle = (id) => {
    const n = new Set(selected)
    if (n.has(id)) n.delete(id); else n.add(id)
    setValue('lights', Array.from(n))
  }
  if (all.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--ink-faint)' }} dir="auto">{t('automations.smartRoom.wiz.noLights')}</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.5 }} dir="auto">
        {t('automations.smartRoom.wiz.pickLights')}
      </p>
      <div style={listBox}>
        {all.map((l) => (
          <RadioRow key={l.id} sel={selected.has(l.id)} label={l.name} onClick={() => toggle(l.id)} />
        ))}
      </div>
      {selected.size === 0 && <WarnBox>{t('automations.smartRoom.wiz.needLight')}</WarnBox>}
    </div>
  )
}

// ── Installed helpers: read + round-trip the room's live rules ───────────────
function partIcon(m) {
  const id = (m.id || '').toLowerCase()
  if (id.endsWith('_day')) return '☀️'
  if (id.endsWith('_night')) return '🌙'
  if (id.endsWith('_off')) return '🚪'
  return '⚙️'
}

const membersOf = (ctx, roomSlug) => (ctx.automations || []).filter((a) => {
  const m = (a.id || '').match(SMART_ROOM_RE)
  return m && m[1] === roomSlug
})

// Reconstruct the wizard opts from the installed rules (the shapes
// build_smart_room_bundle writes): day/night share the occ trigger; the day
// rule's time window IS the day boundary; brightness/kelvin live in the
// turn_on service_data (skipping schedule-owned lights, whose data is empty).
function deriveInstalledOpts(ctx, roomSlug) {
  const members = membersOf(ctx, roomSlug)
  const day = members.find((m) => (m.id || '').endsWith('_day'))
  const night = members.find((m) => (m.id || '').endsWith('_night'))
  const off = members.find((m) => (m.id || '').endsWith('_off'))
  const firstData = (rule, key) => {
    for (const a of (rule?.actions || [])) {
      const v = a?.service_data?.[key]
      if (v != null) return v
    }
    return null
  }
  const dayWin = (day?.conditions || []).find((c) => c.type === 'time')
  const trig = (day || night)?.trigger || {}
  const occ = Array.isArray(trig.entity_id) ? trig.entity_id[0] : trig.entity_id
  // The exact lights this instance controls, straight from its actions.
  const lightsSet = new Set()
  for (const rule of [day, night, off]) {
    for (const a of (rule?.actions || [])) {
      if (a?.entity_id && String(a.entity_id).startsWith('light.')) lightsSet.add(a.entity_id)
    }
  }
  return {
    occEntity: occ || null,
    lights: lightsSet.size ? Array.from(lightsSet) : null,
    night_end: dayWin?.after || DEFAULT_OPTS.night_end,
    night_start: dayWin?.before || DEFAULT_OPTS.night_start,
    day_brightness: firstData(day, 'brightness_pct') ?? DEFAULT_OPTS.day_brightness,
    night_brightness: firstData(night, 'brightness_pct') ?? DEFAULT_OPTS.night_brightness,
    night_kelvin: firstData(night, 'color_temp_kelvin') ?? DEFAULT_OPTS.night_kelvin,
    off_delay_minutes: off?.trigger?.for_minutes ?? DEFAULT_OPTS.off_delay_minutes,
  }
}

// Slim per-rule enable strip — kept from the old members view, minus the
// per-rule editor (the fields below now edit everything directly).
function MembersField({ values, ctx, t }) {
  // Read members LIVE from the automations list so toggles reflect immediately.
  const members = membersOf(ctx, zoneSlugOf(ctx, values))
  const { onToggleMember } = ctx.hostActions || {}
  if (members.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--ink-faint)' }} dir="auto">{t('automations.smartRoom.noSteps')}</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.45 }} dir="auto">
        {t('automations.smartRoom.stepsIntro')}
      </p>
      {members.map((m) => (
        <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px',
          borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
          <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>{partIcon(m)}</span>
          <span style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.4, flex: 1, minWidth: 0 }} dir="auto">{m.name}</span>
          {onToggleMember && <Toggle checked={!!m.enabled} onCheckedChange={(v) => onToggleMember(m, v)} />}
        </div>
      ))}
    </div>
  )
}

export default {
  id: 'smart_room',
  titleKey: 'automations.smartRoom.title',
  subtitleKey: null,
  icon: '🛋',
  failedKey: 'automations.smartRoom.designFailed',
  deleteLabel: (values, ctx, t) => values.room?.name || t('automations.smartRoom.title'),

  derive: (initial, ctx) => {
    const base = {
      room: initial?.room ? { id: initial.room, name: initial.roomName || initial.room } : null,
      occEntity: null,
      lights: null,           // null = all of the room's lights
      _needsSensor: false,
      _decline: null,
      _resolving: false,
      ...DEFAULT_OPTS,
    }
    // Installed: reconstruct the numbers from the live rules so the editor is
    // the SAME flat surface as every other bundle — view IS edit here too.
    if (initial?._isInstalled && initial?.room) {
      // A ZONE card's `room` is the rule-set key (its sensor's key, e.g.
      // bedroom_2) — remap to the sensor's real room so room-scoped pickers
      // (presence candidates, lights) resolve correctly.
      const zone = (ctx.occupancySensors || []).find(
        (s) => (s.key || s.room) === initial.room && (s.key || s.room) !== s.room)
      const room = zone
        ? { id: zone.room, name: (ctx.rooms || []).find((r) => String(r.id) === String(zone.room))?.name || zone.room }
        : base.room
      return { ...base, room, ...deriveInstalledOpts(ctx, initial.room) }
    }
    return base
  },

  steps: (values, ctx) => {
    if (values._installed) {
      return [
        {
          key: 'members', titleKey: 'automations.smartRoom.wiz.rulesTitle', icon: '🗂',
          fields: [{ key: '_members', type: 'custom', render: (p) => <MembersField {...p} />,
            summary: (t, v, c) => {
              const members = membersOf(c, zoneSlugOf(c, v))
              const on = members.filter((m) => m.enabled).length
              return `${on}/${members.length}`
            } }],
        },
        {
          key: 'presence', titleKey: 'automations.smartRoom.wiz.presenceTitle', icon: '🧍',
          fields: [{ key: '_presence', type: 'custom', render: (p) => <PresenceField {...p} />,
            summary: (t, v, c) => {
              const cand = presenceCandidates(c, v.room, t).find((x) => x.id === v.occEntity)
              if (cand) return cand.name
              const e = c.entityMap[v.occEntity]
              return e ? (entityDisplayName(e) || v.occEntity) : (v.occEntity || '—')
            } }],
        },
        {
          key: 'lights', titleKey: 'automations.smartRoom.wiz.lightsTitle', icon: '💡',
          validate: (v) => v.lights == null || v.lights.length > 0,
          fields: [{ key: '_lights', type: 'custom', render: (p) => <LightsField {...p} />,
            summary: (t, v, c) => {
              const all = roomLights(c, v.room)
              const n = v.lights == null ? all.length : v.lights.length
              return t('automations.smartRoom.wiz.lightsCount', { n })
            } }],
        },
        {
          key: 'day', titleKey: 'automations.smartRoom.wiz.dayTitle', icon: '☀️',
          fields: [
            { key: '_dayWindow', type: 'timeWindow', keys: ['night_end', 'night_start'] },
            { key: 'day_brightness', type: 'slider', min: 10, max: 100, step: 5, suffix: '%',
              labelKey: 'automations.smartRoom.wiz.brightness' },
          ],
        },
        {
          key: 'night', titleKey: 'automations.smartRoom.wiz.nightTitle', icon: '🌙',
          fields: [
            { key: 'night_brightness', type: 'slider', min: 5, max: 100, step: 5, suffix: '%',
              labelKey: 'automations.smartRoom.wiz.brightness' },
            { key: 'night_kelvin', type: 'slider', min: 2000, max: 4000, step: 100, suffix: 'K',
              labelKey: 'automations.smartRoom.wiz.warmth' },
            { key: '_guard', type: 'note', text: (t) => `😴 ${t('automations.smartRoom.wiz.guardWhy')}` },
          ],
        },
        {
          key: 'off', titleKey: 'automations.smartRoom.wiz.offTitle', icon: '🚪',
          fields: [
            { key: 'off_delay_minutes', type: 'number', icon: '🚪',
              labelKey: 'automations.smartRoom.wiz.offAfter', min: 1, max: 120, width: 56,
              suffixKey: 'automations.smartRoom.wiz.min' },
          ],
        },
      ]
    }
    return [
      {
        key: 'room', titleKey: 'automations.smartRoom.wiz.roomTitle', icon: '🏠',
        validate: (v) => !!v.room && !v._resolving && !v._decline,
        fields: [{ key: '_room', type: 'custom', render: (p) => <RoomPickField {...p} /> }],
      },
      {
        key: 'presence', titleKey: 'automations.smartRoom.wiz.presenceTitle', icon: '🧍',
        validate: (v) => !!v.occEntity,
        fields: [{ key: '_presence', type: 'custom', render: (p) => <PresenceField {...p} /> }],
      },
      {
        key: 'lights', titleKey: 'automations.smartRoom.wiz.lightsTitle', icon: '💡',
        validate: (v) => v.lights == null || v.lights.length > 0,
        fields: [{ key: '_lights', type: 'custom', render: (p) => <LightsField {...p} /> }],
      },
      {
        key: 'day', titleKey: 'automations.smartRoom.wiz.dayTitle', icon: '☀️',
        fields: [
          { key: '_dayNote', type: 'note',
            text: (t, v) => t('automations.smartRoom.wiz.dayWhen', { from: v.night_end, to: v.night_start }) },
          { key: '_dayWindow', type: 'timeWindow', keys: ['night_end', 'night_start'] },
          { key: 'day_brightness', type: 'slider', min: 10, max: 100, step: 5, suffix: '%',
            labelKey: 'automations.smartRoom.wiz.brightness' },
        ],
      },
      {
        key: 'night', titleKey: 'automations.smartRoom.wiz.nightTitle', icon: '🌙',
        fields: [
          { key: '_nightNote', type: 'note',
            text: (t, v) => t('automations.smartRoom.wiz.nightWhen', { from: v.night_start, to: v.night_end }) },
          { key: 'night_brightness', type: 'slider', min: 5, max: 100, step: 5, suffix: '%',
            labelKey: 'automations.smartRoom.wiz.brightness' },
          { key: 'night_kelvin', type: 'slider', min: 2000, max: 4000, step: 100, suffix: 'K',
            labelKey: 'automations.smartRoom.wiz.warmth' },
          { key: '_guard', type: 'note', text: (t) => `😴 ${t('automations.smartRoom.wiz.guardWhy')}` },
        ],
      },
      {
        key: 'off', titleKey: 'automations.smartRoom.wiz.offTitle', icon: '🚪',
        fields: [
          { key: '_offNote', type: 'note',
            text: (t, v) => t('automations.smartRoom.wiz.offWhen', { n: v.off_delay_minutes }) },
          { key: 'off_delay_minutes', type: 'number', icon: '🚪',
            labelKey: 'automations.smartRoom.wiz.offAfter', min: 1, max: 120, width: 56,
            suffixKey: 'automations.smartRoom.wiz.min' },
        ],
      },
    ]
  },

  canSave: (v) => !!v.room && !!v.occEntity && !v._resolving,

  save: async (v, ctx) => {
    const opts = {
      day_brightness: v.day_brightness, night_brightness: v.night_brightness,
      night_kelvin: v.night_kelvin, night_start: v.night_start, night_end: v.night_end,
      off_delay_minutes: v.off_delay_minutes, guard_hold_seconds: 30,
      ...(v.lights && v.lights.length ? { lights: v.lights } : {}),
    }
    // Remember which rules the user has switched off — re-applying the bundle
    // recreates them enabled, and Save must not silently re-arm a paused rule.
    const disabled = v._installed
      ? membersOf(ctx, zoneSlugOf(ctx, v)).filter((m) => !m.enabled).map((m) => m.id)
      : []
    const res = await designSmartRoom(v.room.id || v.room.name, v.occEntity || undefined, ctx.lang, opts)
    const b = res?.bundle
    if (!b || res?.needs_occupancy) throw new Error(ctx.t('automations.smartRoom.designFailed'))
    const applied = await applyAutomationBundle(b)
    if (applied?.ok === false && (applied?.created || []).length === 0) throw new Error(ctx.t('automations.smartRoom.designFailed'))
    for (const id of disabled) { try { await toggleAutomation(id, false) } catch { /* stays enabled */ } }
  },

  remove: async (ctx, initial, values) => {
    // Delete THIS instance's rule set — never a sibling's. For installed
    // cards the card's `room` IS the rule-set key (zone or main), which is
    // exact even if the presence sensor was deleted meanwhile.
    const slug = initial?._isInstalled ? initial.room : zoneSlugOf(ctx, values)
    await deleteSmartRoom(slug || values.room?.id)
  },
}
