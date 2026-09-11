import React from 'react'
import { motion } from 'framer-motion'
import { Thermometer, Play, Eye, Trash2 } from 'lucide-react'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'
import { T_ENTER } from '../../lib/motion'
import { cardIconBtn } from '../../lib/automations/styles'

// ── ClimateGroupRow ───────────────────────────────────────────────────────────
// One Smart Climate room as a feature row on the Automatic tab, sourced from the
// thermostat engine config (services/smart_climate_engine). Shows the room's live
// temperature and whether Ziggy is cooling/heating it right now, with Sync,
// View, Delete + an enable/disable toggle. The user sees "one thing".
function ClimateGroupRow({ status, onToggle, onSync, onView, onEdit, onDelete }) {
  const t = useT()
  const enabled = !!status?.enabled
  const cur = status?.current || {}
  const temp = cur.temp
  const roomName = status?.roomName || t('automations.smartClimate.installedBadge')
  const title = t('automations.smartClimate.cardTitle', { room: roomName })

  // What Ziggy believes it's doing right now.
  const activeChip = cur.cooling_state === 'on'
    ? { label: t('automations.smartClimate.coolingNow'), color: 'var(--ok-text)' }
    : cur.heating_state === 'on'
      ? { label: t('automations.smartClimate.heatingNow'), color: 'var(--warn-text)' }
      : null

  const secondary = !enabled
    ? t('automations.smartClimate.paused')
    : temp != null ? t('automations.smartClimate.nowTemp', { temp }) : t('automations.smartClimate.noReadingShort')

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={T_ENTER}>
      <div style={{ padding: 16, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <button onClick={onView} title={t('automations.smartClimate.view')} aria-label={t('automations.smartClimate.view')}
          style={{ ...cardIconBtn(enabled ? 'var(--ink-2)' : 'var(--ink-faint)'), background: 'var(--surface-2)' }}>
          <Thermometer size={22} strokeWidth={1.75} />
        </button>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onView}>
          <p className="z-headline" style={{ margin: 0 }} dir="auto">{title}</p>
          <p className="z-subhead z-mono" style={{ margin: '2px 0 0' }} dir="auto">{secondary}</p>
          {enabled && activeChip && (
            <div style={{ marginTop: 4 }}>
              <span className="z-chip" style={{ color: activeChip.color }}>{activeChip.label}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, margin: '-4px -8px -8px 0' }}>
          <div style={{ padding: '8px 8px 0' }}>
            <Toggle checked={enabled} onCheckedChange={() => onToggle(!enabled)} aria-label={title} />
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            <button onClick={onSync} title={t('automations.smartClimate.syncNow')} aria-label={t('automations.smartClimate.syncNow')} disabled={!enabled}
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

export default ClimateGroupRow
