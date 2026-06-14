import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { useT } from '../../../lib/i18n'
import { useDeviceStore } from '../../../stores/deviceStore'
import { getIrDevices } from '../../../lib/api'
import { FieldHint } from './Atoms'

// ── FakeOccupancyEditor ───────────────────────────────────────────────────────
// Editor for the `fake_occupancy_start` step. Lets the user pick which rooms
// (their dimmable lights) to cycle, the active window, brightness, an optional
// TV blaster, and how many days to run. The saved step shape mirrors what
// services.fake_occupancy_scheduler.start() expects:
//   { type: 'fake_occupancy_start', window_start, window_end, duration_days,
//     rooms: [{id, entity_id}], tv_ir_device_id, brightness_pct }
function FakeOccupancyEditor({ action, onChange }) {
  const t = useT()
  const { entities, ziggyRooms } = useDeviceStore()
  const [irDevices, setIrDevices] = useState([])
  const [loadingIr, setLoadingIr] = useState(true)

  useEffect(() => {
    getIrDevices()
      .then(arr => setIrDevices((arr || []).filter(d => (d.type || '').toLowerCase() === 'tv')))
      .catch(() => setIrDevices([]))
      .finally(() => setLoadingIr(false))
  }, [])

  // Build the (room → first dimmable light) candidate list. ziggyRooms carries
  // each room's devices; dimmable lights expose a `brightness` attribute.
  const candidates = useMemo(() => {
    const out = []
    const seen = new Set()
    for (const room of ziggyRooms || []) {
      for (const dev of room.devices || []) {
        const eid = dev.entity_id
        if (!eid || !eid.startsWith('light.')) continue
        const ent = entities.find(e => e.entity_id === eid)
        const attrs = ent?.attributes || {}
        if (!('brightness' in attrs)) continue
        if (seen.has(room.id)) continue
        seen.add(room.id)
        out.push({ id: room.id, name: room.name, entity_id: eid })
        break
      }
    }
    return out
  }, [ziggyRooms, entities])

  const selectedRoomIds = new Set((action.rooms || []).map(r => r.id))

  const toggleRoom = (room) => {
    const next = selectedRoomIds.has(room.id)
      ? (action.rooms || []).filter(r => r.id !== room.id)
      : [...(action.rooms || []), { id: room.id, entity_id: room.entity_id }]
    onChange({ ...action, rooms: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        padding: '10px 12px', borderRadius: 10,
        background: `color-mix(in srgb, var(--info) 6%, var(--surface))`,
        border: `0.5px solid color-mix(in srgb, var(--info) 25%, var(--line))`,
      }}>
        <p style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
          {t('automations.fakeOccupancy.intro')}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          label={t('automations.fakeOccupancy.windowStart')}
          type="time"
          value={(action.window_start || '19:00').slice(0, 5)}
          onChange={e => onChange({ ...action, window_start: e.target.value })}
        />
        <Input
          label={t('automations.fakeOccupancy.windowEnd')}
          type="time"
          value={(action.window_end || '23:00').slice(0, 5)}
          onChange={e => onChange({ ...action, window_end: e.target.value })}
        />
      </div>

      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
          {t('automations.fakeOccupancy.roomsLabel')}
        </p>
        {candidates.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
            {t('automations.fakeOccupancy.noRooms')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {candidates.map(c => {
              const sel = selectedRoomIds.has(c.id)
              return (
                <button key={c.id} type="button" onClick={() => toggleRoom(c)} style={{
                  padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                  background: sel ? 'var(--ink)' : 'var(--surface)',
                  color: sel ? 'var(--bg)' : 'var(--ink-mute)',
                  border: sel ? 'none' : '0.5px solid var(--line)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>{c.name}</button>
              )
            })}
          </div>
        )}
        <FieldHint>{t('automations.fakeOccupancy.roomsHint')}</FieldHint>
      </div>

      <Input
        label={t('automations.fakeOccupancy.durationDays')}
        type="number"
        min={1}
        max={60}
        value={action.duration_days ?? 7}
        onChange={e => onChange({ ...action, duration_days: Math.max(1, parseInt(e.target.value || '1')) })}
      />

      <Input
        label={t('automations.fakeOccupancy.brightnessPct')}
        type="number"
        min={10}
        max={100}
        value={action.brightness_pct ?? 70}
        onChange={e => onChange({ ...action, brightness_pct: Math.max(10, Math.min(100, parseInt(e.target.value || '70'))) })}
      />

      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
          {t('automations.fakeOccupancy.tvLabel')}
        </p>
        {loadingIr ? (
          <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('irDeviceSelect.loading')}</p>
        ) : irDevices.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
            {t('automations.fakeOccupancy.noTV')}
          </p>
        ) : (
          <Select
            options={[
              { value: '', label: t('automations.fakeOccupancy.tvNone') },
              ...irDevices.map(d => ({ value: d.id, label: `${d.name}${d.room ? ` (${d.room.replace(/_/g, ' ')})` : ''}` })),
            ]}
            value={action.tv_ir_device_id || ''}
            onChange={e => onChange({ ...action, tv_ir_device_id: e.target.value || null })}
          />
        )}
        <FieldHint>{t('automations.fakeOccupancy.tvHint')}</FieldHint>
      </div>
    </div>
  )
}

export default FakeOccupancyEditor
