import React from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Eye, Trash2 } from 'lucide-react'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'
import { T_ENTER } from '../../lib/motion'
import { cardIconBtn } from '../../lib/automations/styles'

// ── SmartRoomGroupRow ─────────────────────────────────────────────────────────
// Renders a room's 3 ziggy_smart_room_<room>_* automations as a SINGLE feature
// card (mirrors CircadianGroupRow). The user sees "Smart Room — <room>" as one
// thing they can toggle / view / edit / remove — never the underlying rules.
//
// Props: group { room, roomName, members, allEnabled, count }, onToggleAll,
//        onView, onEdit, onDelete.
function SmartRoomGroupRow({ group, onToggleAll, onView, onEdit, onDelete }) {
  const t = useT()
  const { roomName, allEnabled } = group
  const title = t('automations.smartRoom.cardTitle', { room: roomName })

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={T_ENTER}>
      <div style={{ padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <button onClick={onView} title={t('common.view')} aria-label={t('common.view')}
          style={{ ...cardIconBtn(allEnabled ? 'var(--ink-2)' : 'var(--ink-faint)'), background: 'var(--surface-2)' }}>
          <Sparkles size={22} strokeWidth={1.75} />
        </button>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onView}>
          <p className="z-headline" style={{ margin: 0 }} dir="auto">{title}</p>
          <p className="z-subhead" style={{ margin: '2px 0 0' }} dir="auto">
            {t('automations.smartRoom.cardSubtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, margin: '-4px -8px -8px 0' }}>
          <div style={{ padding: '8px 8px 0' }}>
            <Toggle checked={allEnabled} onCheckedChange={() => onToggleAll(!allEnabled)} aria-label={title} />
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
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

export default SmartRoomGroupRow
