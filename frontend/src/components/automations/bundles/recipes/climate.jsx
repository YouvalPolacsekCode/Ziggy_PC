import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../../../ui/Input'
import { saveClimate, deleteClimate, getIrDevices } from '../../../../lib/api'
import { entityDisplayName } from '../../../../lib/utils'
import { Eyebrow, WarnBox, RadioRow, listBox } from '../engine/fields'

// ── Smart Climate Control recipe ──────────────────────────────────────────────
// Ziggy as a thermostat (services/smart_climate_engine). Save target is the
// engine CONFIG, not an HA automation. Pick a room → a temperature reading → a
// device to switch on/off around a band. Cooling first (Israeli default);
// heating is opt-in. No setpoint is ever sent — Ziggy owns the cutoff.

const COOL_DEF = { on: 25, off: 24 }   // room ≥25 → cool on; ≤24 → off
const HEAT_DEF = { on: 19, off: 20 }   // room ≤19 → heat on; ≥20 → off
const IR_CLIMATE_TYPES = new Set(['ac', 'air_conditioner', 'split', 'heater'])

// Zigbee/Z2M config toggles exposed as switch.* sub-entities are NOT actuators.
const SWITCH_CONFIG_DENY = /_(do_not_disturb|child_lock|permit_join|led|led_disabled|led_disabled_night|indicator|ai_[a-z_]+|sensitivity|interference|selfidentification|power_outage_memory|power_on_behavior|auto_update|update|calibration|identify)$|_ai_|permit_join/i
const isRealSwitch = (e) => !(e.entity_category === 'config' || e.entity_category === 'diagnostic') && !SWITCH_CONFIG_DENY.test(e.entity_id || '')

const roomOfValues = (ctx, v) => (ctx.rooms || []).find((r) => String(r.id) === String(v.roomId) || r.name === v.roomId) || null

const tempSensorsOf = (ctx, room) => (room?.entities || [])
  .map((id) => ctx.entityMap[id])
  .filter((e) => e && e.domain === 'sensor' && (e.device_class === 'temperature' || /temp/i.test(e.entity_id || '')))

const hasDevice = (edge) => !!edge?.device

function deviceHow(t, kind) {
  return {
    climate: t('automations.smartClimate.viaSmart'),
    ir_ac: t('automations.smartClimate.viaIr'),
    fan: t('automations.smartClimate.viaFan'),
    switch: t('automations.smartClimate.viaPlug'),
  }[kind] || ''
}

// ── Custom fields ────────────────────────────────────────────────────────────

// Temperature reading: single sensor OR the live mean of all the room's sensors.
function ReadingField({ values, setValue, ctx, t }) {
  const room = roomOfValues(ctx, values)
  const sensors = tempSensorsOf(ctx, room)
  const avgValue = useMemo(() => {
    const vals = sensors.map((e) => parseFloat(e.state)).filter((x) => !Number.isNaN(x))
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null
  }, [sensors])
  if (sensors.length === 0) return <WarnBox>{t('automations.smartClimate.noSensor')}</WarnBox>
  return (
    <div style={listBox}>
      {sensors.length >= 2 && (
        <RadioRow sel={!!values.useAvg}
          label={`${t('automations.smartClimate.avgOption', { n: sensors.length })}${avgValue != null ? ` · ${avgValue}°` : ''}`}
          onClick={() => setValue('useAvg', true)} />
      )}
      {sensors.map((e) => (
        <RadioRow key={e.entity_id} sel={!values.useAvg && e.entity_id === values.sensor}
          label={`${entityDisplayName(e) || e.entity_id}${e.state != null && e.state !== '' ? ` · ${e.state}°` : ''}`}
          onClick={() => { setValue('useAvg', false); setValue('sensor', e.entity_id) }} />
      ))}
    </div>
  )
}

// One edge (cool | heat): a device + its on/off temperatures. IR ACs for the
// room are fetched here — they only exist once a room is chosen.
function EdgeField({ dir, values, setValue, ctx, t }) {
  const room = roomOfValues(ctx, values)
  const [irDevices, setIrDevices] = useState([])
  useEffect(() => {
    if (!room) { setIrDevices([]); return }
    let alive = true
    getIrDevices(room.name).then((d) => { if (alive) setIrDevices(Array.isArray(d) ? d : []) })
      .catch(() => { if (alive) setIrDevices([]) })
    return () => { alive = false }
  }, [room?.id, room?.name])

  const devices = useMemo(() => {
    const out = []
    for (const id of (room?.entities || [])) {
      const e = ctx.entityMap[id]
      if (!e) continue
      const name = entityDisplayName(e) || e.entity_id
      if (e.domain === 'climate') out.push({ kind: 'climate', id: e.entity_id, name, room: room.name })
      else if (e.domain === 'fan') out.push({ kind: 'fan', id: e.entity_id, name, room: room.name })
      else if (e.domain === 'switch' && isRealSwitch(e)) out.push({ kind: 'switch', id: e.entity_id, name, room: room.name })
    }
    for (const ir of irDevices) {
      const ty = (ir.type || ir.device_type || '').toLowerCase()
      if (IR_CLIMATE_TYPES.has(ty)) out.push({ kind: 'ir_ac', id: ir.id, name: ir.name, room: ir.room || room?.name || '' })
    }
    const rank = { climate: 0, fan: 1, switch: 2, ir_ac: 3 }
    return out.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9))
  }, [room, irDevices, ctx.entityMap])

  const key = dir === 'cool' ? 'cooling' : 'heating'
  const def = dir === 'cool' ? COOL_DEF : HEAT_DEF
  const edge = values[key] || null
  const onTemp = edge?.on ?? def.on
  const offTemp = edge?.off ?? def.off
  const patch = (p) => setValue(key, { device: edge?.device || null, on: onTemp, off: offTemp, ...edge, ...p })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {devices.length === 0 ? (
        <WarnBox>{t('automations.smartClimate.noDevice')}</WarnBox>
      ) : (
        <div style={listBox}>
          {devices.map((d) => (
            <RadioRow key={`${d.kind}:${d.id}`} sel={edge?.device?.kind === d.kind && edge?.device?.id === d.id}
              label={d.name} sub={deviceHow(t, d.kind)} onClick={() => patch({ device: d })} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <Eyebrow>{t(dir === 'cool' ? 'automations.smartClimate.coolOn' : 'automations.smartClimate.heatOn')} (°C)</Eyebrow>
          <Input type="number" inputMode="numeric" min={10} max={35} value={onTemp}
            onChange={(e) => patch({ on: Number(e.target.value) })} />
        </div>
        <div style={{ flex: 1 }}>
          <Eyebrow>{t(dir === 'cool' ? 'automations.smartClimate.coolOff' : 'automations.smartClimate.heatOff')} (°C)</Eyebrow>
          <Input type="number" inputMode="numeric" min={10} max={35} value={offTemp}
            onChange={(e) => patch({ off: Number(e.target.value) })} />
        </div>
      </div>
    </div>
  )
}

function HeatingToggle({ values, setValue, t }) {
  if (values.showHeating) {
    return (
      <button type="button" onClick={() => { setValue('showHeating', false); setValue('heating', null) }}
        className="z-btn-secondary" style={{ alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 9, fontSize: 12 }}>
        {t('automations.smartClimate.removeHeating')}
      </button>
    )
  }
  return (
    <button type="button" onClick={() => setValue('showHeating', true)}
      style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--line)', borderRadius: 10,
        padding: '9px 14px', fontSize: 12.5, color: 'var(--ink-mute)', cursor: 'pointer', fontFamily: 'inherit' }} dir="auto">
      + {t('automations.smartClimate.addHeating')}
    </button>
  )
}

// Live "what is it doing right now" banner for installed rooms.
function RightNow({ values, t }) {
  const cur = values._status?.current
  if (!cur) return null
  return (
    <div style={{ borderRadius: 14, padding: '14px 16px',
      background: 'color-mix(in srgb, var(--ok) 7%, var(--surface))',
      border: '0.5px solid color-mix(in srgb, var(--ok) 22%, var(--line))' }}>
      <p className="z-eyebrow" style={{ margin: '0 0 4px' }}>{t('automations.smartClimate.rightNow')}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }} dir="auto">
        {cur.temp != null ? `${cur.temp}°C` : t('automations.smartClimate.noReadingShort')}
      </p>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '2px 0 0' }} dir="auto">{values._status?.roomName || ''}</p>
    </div>
  )
}

const readingOk = (v, ctx) => {
  const room = roomOfValues(ctx, v)
  return v.useAvg ? tempSensorsOf(ctx, room).length > 0 : !!v.sensor
}

export default {
  id: 'climate',
  titleKey: 'automations.smartClimate.title',
  subtitleKey: 'automations.smartClimate.subtitle',
  icon: '🌡️',
  failedKey: 'automations.smartClimate.failed',
  deleteLabel: (values, ctx, t) => roomOfValues(ctx, values)?.name || t('automations.smartClimate.title'),

  derive: (initial, ctx) => ({
    _status: initial?._status || null,
    roomId: initial?.room || '',
    sensor: initial?.sensor || '',
    useAvg: !!(initial?.sensors && initial.sensors.length),
    cooling: initial?.cooling || null,
    heating: initial?.heating || null,
    showHeating: !!initial?.heating,
  }),

  // Default the reading to the room's first temp sensor once entities land.
  autoDefaults: (v, ctx) => {
    const room = roomOfValues(ctx, v)
    if (!room) return {}
    const sensors = tempSensorsOf(ctx, room)
    if (!v.useAvg && !sensors.find((s) => s.entity_id === v.sensor) && sensors[0]) {
      return { sensor: sensors[0].entity_id }
    }
    return {}
  },

  steps: (values, ctx) => [
    {
      key: 'now', visibleWhen: (v) => !!v._installed && !!v._status,
      fields: [{ key: '_now', type: 'custom', render: (p) => <RightNow {...p} /> }],
    },
    {
      key: 'room', titleKey: 'automations.smartClimate.room', icon: '🏠',
      validate: (v, c) => !!roomOfValues(c, v),
      fields: [
        { key: 'roomId', type: 'pickOne', collapseSingle: false,
          items: (c) => (c.rooms || []).map((r) => ({ id: String(r.id), label: r.name })),
          afterSet: () => ({ cooling: null, heating: null, showHeating: false }),
          emptyKey: 'automations.smartClimate.noRooms',
          locked: (v) => !!v._installed,
          lockedLabel: (t, v, c) => `🏠 ${roomOfValues(c, v)?.name || v.roomId}` },
      ],
    },
    {
      key: 'reading', titleKey: 'automations.smartClimate.reading', icon: '🌡️',
      validate: (v, c) => readingOk(v, c),
      fields: [{ key: '_reading', type: 'custom', render: (p) => <ReadingField {...p} /> }],
    },
    {
      key: 'cooling', titleKey: 'automations.smartClimate.cooling', icon: '❄️',
      fields: [
        { key: '_coolHint', type: 'note', textKey: 'automations.smartClimate.coolingHint' },
        { key: '_cool', type: 'custom', render: (p) => <EdgeField dir="cool" {...p} /> },
        { key: '_heatToggle', type: 'custom', render: (p) => <HeatingToggle {...p} />,
          visibleWhen: (v) => !v.showHeating },
      ],
    },
    {
      key: 'heating', titleKey: 'automations.smartClimate.heating', icon: '🔥',
      visibleWhen: (v) => !!v.showHeating,
      fields: [
        { key: '_heatHint', type: 'note', textKey: 'automations.smartClimate.heatingHint' },
        { key: '_heat', type: 'custom', render: (p) => <EdgeField dir="heat" {...p} /> },
        { key: '_heatToggleOff', type: 'custom', render: (p) => <HeatingToggle {...p} /> },
      ],
    },
  ],

  canSave: (v, ctx) => {
    const room = roomOfValues(ctx, v)
    return !!room && readingOk(v, ctx) && (hasDevice(v.cooling) || (v.showHeating && hasDevice(v.heating)))
  },

  save: async (v, ctx) => {
    const room = roomOfValues(ctx, v)
    const sensors = tempSensorsOf(ctx, room)
    await saveClimate({
      room: String(room.id),
      roomName: room.name,
      sensor: v.useAvg ? '' : v.sensor,
      sensors: v.useAvg ? sensors.map((e) => e.entity_id) : null,
      cooling: hasDevice(v.cooling) ? v.cooling : null,
      heating: (v.showHeating && hasDevice(v.heating)) ? v.heating : null,
      enabled: true,
    })
  },

  remove: async (ctx, initial, values) => {
    const room = roomOfValues(ctx, values)
    await deleteClimate(String(room?.id || values.roomId))
  },
}
