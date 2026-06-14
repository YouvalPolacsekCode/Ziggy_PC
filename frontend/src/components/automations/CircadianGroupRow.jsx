import React from 'react'
import { motion } from 'framer-motion'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'

// ── CircadianGroupRow ─────────────────────────────────────────────────────────
// Renders the 4 ziggy_circadian_* HA automations as a single feature row on the
// Active tab. The user never sees the underlying 4 entries — they see "Smart
// Light Schedule" as one thing they can toggle, edit, or remove.
function CircadianGroupRow({ group, onToggleAll, onEdit, onDelete }) {
  const t = useT()
  const { lights, bedtime, allEnabled, count } = group
  const tint = allEnabled ? 'var(--gold)' : 'var(--ink-faint)'

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${tint} 14%, var(--surface-2))`, fontSize: 18 }}>
          🌅
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em' }} dir="auto">
            {t('automations.circadian.installedBadge')}
          </p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }} dir="auto">
            {t('automations.circadian.subtitle')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, ${tint} 12%, transparent)`, color: tint }}>
              {t('automations.circadian.fourPhases')}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
              {t('automations.circadian.bedtime')}: {bedtime}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
              {lights.length}× {lights.length === 1 ? 'light' : 'lights'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Toggle checked={allEnabled} onCheckedChange={() => onToggleAll(!allEnabled)} />
          <div style={{ display: 'flex', gap: 2 }}>
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
