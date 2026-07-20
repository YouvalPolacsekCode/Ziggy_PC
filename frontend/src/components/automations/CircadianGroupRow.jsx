import React from 'react'
import { motion } from 'framer-motion'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'

// ── CircadianGroupRow ─────────────────────────────────────────────────────────
// The Smart Light Schedule as one feature row on the Automatic tab, sourced from
// the continuous-ramp engine config (services/circadian_engine). Shows the live
// ramp point and offers Sync-now (▶), View, Edit, Delete + an enable/disable
// toggle. The user never sees the underlying engine — just "one thing".
function CircadianGroupRow({ status, onToggle, onSync, onView, onEdit, onDelete }) {
  const t = useT()
  const enabled = !!status?.enabled
  const cur = status?.current || {}
  const lightCount = (status?.lights || []).length
  const manualCount = (status?.manual_lights || []).length
  const tint = enabled ? 'var(--gold)' : 'var(--ink-faint)'

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <button onClick={onView} title={t('automations.circadian.view')}
          style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${tint} 14%, var(--surface-2))`, fontSize: 18, border: 'none', cursor: 'pointer' }}>
          🌅
        </button>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onView}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em', margin: 0 }} dir="auto">
            {t('automations.circadian.installedBadge')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
            {enabled ? (
              <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace' }}>
                {t('automations.circadian.nowValue', { k: cur.kelvin, p: cur.pct })}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('automations.circadian.paused')}</span>
            )}
            <span style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
              {t('automations.circadian.lightCount', { n: lightCount })}
            </span>
            {manualCount > 0 && (
              <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600, background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>
                {t('automations.circadian.nManual', { n: manualCount })}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Toggle checked={enabled} onCheckedChange={() => onToggle(!enabled)} />
          <div style={{ display: 'flex', gap: 2 }}>
            <button onClick={onSync} title={t('automations.circadian.syncNow')} aria-label={t('automations.circadian.syncNow')} disabled={!enabled}
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

export default CircadianGroupRow
