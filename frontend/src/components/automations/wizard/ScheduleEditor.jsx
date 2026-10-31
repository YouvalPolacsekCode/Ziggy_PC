import React from 'react'
import { Plus, X } from 'lucide-react'
import { Input } from '../../ui/Input'
import { useT, getLang } from '../../../lib/i18n'
import { chipStyle, fieldLabelStyle } from '../../../lib/automations/styles'
import {
  WEEK, WORKWEEK, WEEKEND, scheduleSlots, scheduleDays, daysPreset,
  withSlots, withDays, dayShortName,
} from '../../../lib/automations/schedule'

// "On a schedule": which days, and one or more times on each of them
// ("3 times a day, 4 days a week"). Stored on the `time` trigger — see
// lib/automations/schedule.js. A rule with no days runs every day.
const MAX_TIMES = 12

export default function ScheduleEditor({ trigger, onChange }) {
  const t = useT()
  const lang = getLang()
  const slots = scheduleSlots(trigger)
  const days = scheduleDays(trigger)
  const preset = daysPreset(days)
  const picked = days ?? WEEK

  const setSlot = (i, v) => onChange(withSlots(trigger, slots.map((s, j) => (j === i ? v : s))))
  const addSlot = () => onChange(withSlots(trigger, [...slots, '']))
  const removeSlot = (i) => onChange(withSlots(trigger, slots.filter((_, j) => j !== i)))
  const toggleDay = (code) => {
    const next = picked.includes(code) ? picked.filter(c => c !== code) : [...picked, code]
    // Keep an empty pick as [] (not "every day") so the wizard can say "pick a day".
    onChange(next.length === 0 ? { ...withDays(trigger, WEEK), days: [] } : withDays(trigger, next))
  }

  const presets = [
    { id: 'every',    label: t('automations.schedule.everyDay'), days: null },
    { id: 'workweek', label: t('automations.schedule.workweek'), days: WORKWEEK },
    { id: 'weekend',  label: t('automations.schedule.weekend'),  days: WEEKEND },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <span style={fieldLabelStyle}>{t('automations.schedule.days')}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {presets.map(p => (
            <button key={p.id} type="button" aria-pressed={preset === p.id}
              style={chipStyle(preset === p.id)} onClick={() => onChange(withDays(trigger, p.days))}>
              {p.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t('automations.schedule.days')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {WEEK.map(code => {
            const on = picked.includes(code)
            return (
              <button key={code} type="button" aria-pressed={on}
                style={{ ...chipStyle(on), minWidth: 44, padding: '8px 12px', justifyContent: 'center' }}
                onClick={() => toggleDay(code)}>
                {dayShortName(code, lang)}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <span style={fieldLabelStyle}>{t('automations.schedule.times')}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {slots.map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Input type="time" value={v} aria-label={t('automations.editor.timeLabel')}
                  onChange={e => setSlot(i, e.target.value)} />
              </div>
              {slots.length > 1 && (
                <button type="button" onClick={() => removeSlot(i)}
                  aria-label={t('automations.schedule.removeTime')}
                  style={{ minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)' }}>
                  <X size={18} strokeWidth={1.75} />
                </button>
              )}
            </div>
          ))}
        </div>
        {slots.length < MAX_TIMES && (
          <button type="button" onClick={addSlot} style={{ ...chipStyle(false), marginTop: 8 }}>
            <Plus size={16} strokeWidth={1.75} /> {t('automations.schedule.addTime')}
          </button>
        )}
      </div>
    </div>
  )
}
