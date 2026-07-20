import React from 'react'
import { useT } from '../../lib/i18n'

// ── ClimateViewModal ──────────────────────────────────────────────────────────
// Read-only "what is Smart Climate doing in this room right now?" surface, opened
// from the room's card. Distinct from Edit. Shows the live reading, the cooling
// and heating bands with the device on each, and the state Ziggy believes it's in.
function ClimateViewModal({ status, onSync, onEdit }) {
  const t = useT()
  if (!status) return null
  const cur = status.current || {}
  const temp = cur.temp

  const EdgeCard = ({ icon, title, edge, active, activeColor, lineKey }) => {
    if (!edge || !edge.device) return null
    return (
      <div style={{ borderRadius: 12, padding: '12px 14px', background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15 }} aria-hidden="true">{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }} dir="auto">{title}</span>
          {active && (
            <span style={{ marginInlineStart: 'auto', fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600, background: `color-mix(in srgb, ${activeColor} 14%, transparent)`, color: activeColor }}>
              {t('automations.smartClimate.onNow')}
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '8px 0 2px' }} dir="auto">
          {t(lineKey, { on: edge.on, off: edge.off })}
        </p>
        <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: 0 }} dir="auto">
          {t('automations.smartClimate.deviceLine', { name: edge.device.name || edge.device.id })}
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '2px' }}>
      {/* Live "right now" banner */}
      <div style={{ borderRadius: 14, padding: '14px 16px',
        background: 'color-mix(in srgb, var(--ok) 7%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--ok) 22%, var(--line))' }}>
        <p className="z-eyebrow" style={{ margin: '0 0 4px' }}>{t('automations.smartClimate.rightNow')}</p>
        <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }} dir="auto">
          {temp != null ? `${temp}°C` : t('automations.smartClimate.noReadingShort')}
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '2px 0 0' }} dir="auto">
          {status.roomName || ''}
        </p>
      </div>

      <EdgeCard icon="❄️" title={t('automations.smartClimate.cooling')} edge={status.cooling}
        active={cur.cooling_state === 'on'} activeColor="var(--ok)"
        lineKey="automations.smartClimate.bandLineCool" />
      <EdgeCard icon="🔥" title={t('automations.smartClimate.heating')} edge={status.heating}
        active={cur.heating_state === 'on'} activeColor="var(--warn)"
        lineKey="automations.smartClimate.bandLineHeat" />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button onClick={onSync} className="z-btn-primary" style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          {t('automations.smartClimate.syncNow')}
        </button>
        <button onClick={onEdit} className="z-btn-secondary" style={{ padding: '10px 16px', borderRadius: 10, fontSize: 13 }}>
          {t('automations.smartClimate.edit')}
        </button>
      </div>
    </div>
  )
}

export default ClimateViewModal
