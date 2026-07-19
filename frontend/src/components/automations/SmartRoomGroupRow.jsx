import React from 'react'
import { motion } from 'framer-motion'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'

// ── SmartRoomGroupRow ─────────────────────────────────────────────────────────
// Renders a room's 3 ziggy_smart_room_<room>_* automations as a SINGLE feature
// card (mirrors CircadianGroupRow). The user sees "Smart Room — <room>" as one
// thing they can toggle / view / edit / remove — never the underlying rules.
//
// Props: group { room, roomName, members, allEnabled, count }, onToggleAll,
//        onView, onEdit, onDelete.
function SmartRoomGroupRow({ group, onToggleAll, onView, onEdit, onDelete }) {
  const t = useT()
  const { roomName, allEnabled, count } = group
  const tint = allEnabled ? 'var(--gold)' : 'var(--ink-faint)'

  const iconBtn = (onClick, title, path, color = 'var(--ink-mute)') => (
    <button onClick={onClick} title={title} aria-label={title}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 4 }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
    </button>
  )

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${tint} 14%, var(--surface-2))`, fontSize: 18 }}>
          🪄
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em' }} dir="auto">
            {t('automations.smartRoom.cardTitle', { room: roomName })}
          </p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }} dir="auto">
            {t('automations.smartRoom.cardSubtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Toggle checked={allEnabled} onCheckedChange={() => onToggleAll(!allEnabled)} />
          <div style={{ display: 'flex', gap: 2 }}>
            {iconBtn(onView, t('common.view'),
              <><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/></>)}
            {iconBtn(onEdit, t('common.edit'),
              <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>)}
            {iconBtn(onDelete, t('common.delete'),
              <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></>, 'var(--accent)')}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default SmartRoomGroupRow
