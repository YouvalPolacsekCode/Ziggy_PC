import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { designSmartRoom, applyAutomationBundle, deleteSmartRoom } from '../../../../lib/api'
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
      out.push({ id: s.entity_id, name: t('automations.smartRoom.wiz.mergedSensor'), kind: 'merged' })
    }
  }
  return out
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.5 }} dir="auto">{t('automations.smartRoom.wiz.pickSensor')}</p>
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

// ── Installed editor: the room's live rules as toggleable, editable steps ────
function partIcon(m) {
  const id = (m.id || '').toLowerCase()
  if (id.endsWith('_day')) return '☀️'
  if (id.endsWith('_night')) return '🌙'
  if (id.endsWith('_off')) return '🚪'
  return '⚙️'
}

function MembersField({ values, ctx, t }) {
  // Read members LIVE from the automations list so toggles reflect immediately.
  const members = (ctx.automations || []).filter((a) => {
    const m = (a.id || '').match(SMART_ROOM_RE)
    return m && m[1] === values.room?.id
  })
  const { onToggleMember, onEditMember } = ctx.hostActions || {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.45 }} dir="auto">
        {t('automations.smartRoom.stepsIntro')}
      </p>
      {members.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-faint)' }} dir="auto">{t('automations.smartRoom.noSteps')}</p>
      )}
      {members.map((m) => (
        <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px',
          borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
          <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>{partIcon(m)}</span>
          <span style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.4, flex: 1, minWidth: 0 }} dir="auto">{m.name}</span>
          {onToggleMember && <Toggle checked={!!m.enabled} onCheckedChange={(v) => onToggleMember(m, v)} />}
          {onEditMember && (
            <button type="button" onClick={() => onEditMember(m)} title={t('common.edit')} aria-label={t('common.edit')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
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
  saveHidden: (values) => !!values._installed,

  derive: (initial) => ({
    room: initial?.room ? { id: initial.room, name: initial.roomName || initial.room } : null,
    occEntity: null,
    _needsSensor: false,
    _decline: null,
    _resolving: false,
    ...DEFAULT_OPTS,
  }),

  steps: (values, ctx) => {
    if (values._installed) {
      return [{
        key: 'members',
        fields: [{ key: '_members', type: 'custom', render: (p) => <MembersField {...p} /> }],
      }]
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

  canSave: (v) => !!v._installed || (!!v.room && !!v.occEntity && !v._resolving),

  save: async (v, ctx) => {
    if (v._installed) return
    const opts = {
      day_brightness: v.day_brightness, night_brightness: v.night_brightness,
      night_kelvin: v.night_kelvin, night_start: v.night_start, night_end: v.night_end,
      off_delay_minutes: v.off_delay_minutes, guard_hold_seconds: 30,
    }
    const res = await designSmartRoom(v.room.id || v.room.name, v.occEntity || undefined, ctx.lang, opts)
    const b = res?.bundle
    if (!b || res?.needs_occupancy) throw new Error(ctx.t('automations.smartRoom.designFailed'))
    const applied = await applyAutomationBundle(b)
    if (applied?.ok === false && (applied?.created || []).length === 0) throw new Error(ctx.t('automations.smartRoom.designFailed'))
  },

  remove: async (ctx, initial, values) => {
    await deleteSmartRoom(values.room?.id || initial?.room)
  },
}
