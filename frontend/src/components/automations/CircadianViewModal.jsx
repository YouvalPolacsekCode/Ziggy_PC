import React from 'react'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { entityDisplayName } from '../../lib/utils'

// ── CircadianViewModal ────────────────────────────────────────────────────────
// Read-only "what is the Smart Light Schedule doing right now?" surface, opened
// from the schedule card. Distinct from Edit. Shows the live ramp point, the two
// anchors, timing, and the lights (flagging any the user has taken over by hand).
function warmthWord(t, k) {
  if (k <= 2400) return t('automations.circadian.warmthAmber')
  if (k <= 3200) return t('automations.circadian.warmthWarm')
  if (k <= 4500) return t('automations.circadian.warmthNeutral')
  return t('automations.circadian.warmthCool')
}

function CircadianViewModal({ status, onSync, onEdit }) {
  const t = useT()
  const { entities } = useDeviceStore()
  if (!status) return null
  const cur = status.current || {}
  const manual = new Set(status.manual_lights || [])
  const labelFor = (eid) => entityDisplayName(entities?.find(e => e.entity_id === eid)) || eid

  const Row = ({ icon, label, value }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '0.5px solid var(--line)' }}>
      <span style={{ fontSize: 16, width: 22, textAlign: 'center' }} aria-hidden="true">{icon}</span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-mute)', flex: 1 }} dir="auto">{label}</span>
      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }} dir="auto">{value}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px' }}>
      {/* Live "right now" banner */}
      <div style={{ borderRadius: 14, padding: '14px 16px', marginBottom: 8,
        background: 'color-mix(in srgb, var(--ok) 7%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--ok) 22%, var(--line))' }}>
        <p className="z-eyebrow" style={{ margin: '0 0 4px' }}>{t('automations.circadian.rightNow')}</p>
        <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: 0 }} dir="auto">
          {cur.kelvin}K · {cur.pct}%
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '2px 0 0' }} dir="auto">{warmthWord(t, cur.kelvin || 3000)}</p>
      </div>

      <Row icon="☀️" label={t('automations.circadian.dayPeak')}    value={`${status.peak?.kelvin}K · ${status.peak?.pct}%`} />
      <Row icon="🌙" label={t('automations.circadian.nightFloor')} value={`${status.floor?.kelvin}K · ${status.floor?.pct}%`} />
      <Row icon="⏰" label={t('automations.circadian.wake')}       value={status.wake} />
      <Row icon="🛏️" label={t('automations.circadian.bedtime')}    value={status.bedtime} />

      {/* Lights */}
      <p className="z-eyebrow" style={{ margin: '14px 0 6px' }}>{t('automations.circadian.onSchedule', { n: (status.lights || []).length })}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(status.lights || []).map(eid => (
          <div key={eid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: 'var(--surface)' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{labelFor(eid)}</span>
            {manual.has(eid) && (
              <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, fontWeight: 600, background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>
                {t('automations.circadian.handControlled')}
              </span>
            )}
          </div>
        ))}
      </div>
      {manual.size > 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '8px 0 0', lineHeight: 1.45 }} dir="auto">
          {t('automations.circadian.handControlledHint')}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onSync} className="z-btn-primary" style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          {t('automations.circadian.syncNow')}
        </button>
        <button onClick={onEdit} className="z-btn-secondary" style={{ padding: '10px 16px', borderRadius: 10, fontSize: 13 }}>
          {t('automations.circadian.edit')}
        </button>
      </div>
    </div>
  )
}

export default CircadianViewModal
