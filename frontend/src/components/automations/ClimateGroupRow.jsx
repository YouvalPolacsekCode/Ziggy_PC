import React from 'react'
import { motion } from 'framer-motion'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'

// ── ClimateGroupRow ───────────────────────────────────────────────────────────
// One Smart Climate room as a feature row on the Automatic tab, sourced from the
// thermostat engine config (services/smart_climate_engine). Shows the room's live
// temperature and whether Ziggy is cooling/heating it right now, with Sync (▶),
// View, Edit, Delete + an enable/disable toggle. The user sees "one thing".
function ClimateGroupRow({ status, onToggle, onSync, onView, onEdit, onDelete }) {
  const t = useT()
  const enabled = !!status?.enabled
  const cur = status?.current || {}
  const temp = cur.temp
  const roomName = status?.roomName || t('automations.smartClimate.installedBadge')
  const tint = enabled ? 'var(--gold)' : 'var(--ink-faint)'

  // What Ziggy believes it's doing right now.
  const activeChip = cur.cooling_state === 'on'
    ? { label: t('automations.smartClimate.coolingNow'), color: 'var(--ok)' }
    : cur.heating_state === 'on'
      ? { label: t('automations.smartClimate.heatingNow'), color: 'var(--warn)' }
      : null

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <button onClick={onView} title={t('automations.smartClimate.view')}
          style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${tint} 14%, var(--surface-2))`, fontSize: 18, border: 'none', cursor: 'pointer' }}>
          🌡️
        </button>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onView}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em', margin: 0 }} dir="auto">
            {t('automations.smartClimate.cardTitle', { room: roomName })}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
            {enabled ? (
              temp != null ? (
                <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace' }}>
                  {t('automations.smartClimate.nowTemp', { temp })}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('automations.smartClimate.noReadingShort')}</span>
              )
            ) : (
              <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('automations.smartClimate.paused')}</span>
            )}
            {enabled && activeChip && (
              <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600, background: `color-mix(in srgb, ${activeChip.color} 14%, transparent)`, color: activeChip.color }}>
                {activeChip.label}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Toggle checked={enabled} onCheckedChange={() => onToggle(!enabled)} />
          <div style={{ display: 'flex', gap: 2 }}>
            <button onClick={onSync} title={t('automations.smartClimate.syncNow')} aria-label={t('automations.smartClimate.syncNow')} disabled={!enabled}
              style={{ background: 'none', border: 'none', cursor: enabled ? 'pointer' : 'default', color: enabled ? 'var(--ok)' : 'var(--ink-faint)', opacity: enabled ? 1 : 0.4, padding: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <button onClick={onEdit} title={t('common.edit')} aria-label={t('common.edit')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button onClick={onDelete} title={t('common.delete')} aria-label={t('common.delete')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default ClimateGroupRow
