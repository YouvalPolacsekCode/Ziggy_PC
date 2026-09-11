import React from 'react'
import { motion } from 'framer-motion'
import { Sunrise, Play, Eye, Trash2 } from 'lucide-react'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'
import { T_ENTER } from '../../lib/motion'
import { cardIconBtn } from '../../lib/automations/styles'

// ── CircadianGroupRow ─────────────────────────────────────────────────────────
// The Smart Light Schedule as one feature row on the Automatic tab, sourced from
// the continuous-ramp engine config (services/circadian_engine). Shows the live
// ramp point and offers Sync-now, View, Delete + an enable/disable toggle. The
// user never sees the underlying engine — just "one thing".
//
// Same anatomy as AutomationCard: 44px line glyph · Headline · one Subhead ·
// one Footnote/chip · switch · 44px actions. The gold tint is gone.
function CircadianGroupRow({ status, onToggle, onSync, onView, onEdit, onDelete }) {
  const t = useT()
  const enabled = !!status?.enabled
  const cur = status?.current || {}
  const lightCount = (status?.lights || []).length
  const manualCount = (status?.manual_lights || []).length
  const title = t('automations.circadian.installedBadge')

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={T_ENTER}>
      <div style={{ padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <button onClick={onView} title={t('automations.circadian.view')} aria-label={t('automations.circadian.view')}
          style={{ ...cardIconBtn(enabled ? 'var(--ink-2)' : 'var(--ink-faint)'), background: 'var(--surface-2)' }}>
          <Sunrise size={22} strokeWidth={1.75} />
        </button>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onView}>
          <p className="z-headline" style={{ margin: 0 }} dir="auto">{title}</p>
          <p className="z-subhead z-mono" style={{ margin: '2px 0 0' }} dir="auto">
            {enabled ? t('automations.circadian.nowValue', { k: cur.kelvin, p: cur.pct }) : t('automations.circadian.paused')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <span className="z-footnote z-mono" style={{ color: 'var(--ink-faint)' }}>
              {t('automations.circadian.lightCount', { n: lightCount })}
            </span>
            {manualCount > 0 && (
              <span className="z-chip" style={{ color: 'var(--warn-text)' }}>
                {t('automations.circadian.nManual', { n: manualCount })}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, margin: '-4px -8px -8px 0' }}>
          <div style={{ padding: '8px 8px 0' }}>
            <Toggle checked={enabled} onCheckedChange={() => onToggle(!enabled)} aria-label={title} />
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            <button onClick={onSync} title={t('automations.circadian.syncNow')} aria-label={t('automations.circadian.syncNow')} disabled={!enabled}
              style={{ ...cardIconBtn(enabled ? 'var(--ink-mute)' : 'var(--ink-faint)'), cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5 }}>
              <Play size={18} strokeWidth={1.75} fill="currentColor" />
            </button>
            <button onClick={onView} title={t('common.view')} aria-label={t('common.view')} style={cardIconBtn()}>
              <Eye size={18} strokeWidth={1.75} />
            </button>
            <button onClick={onDelete} title={t('common.delete')} aria-label={t('common.delete')} style={cardIconBtn('var(--err-text)')}>
              <Trash2 size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default CircadianGroupRow
