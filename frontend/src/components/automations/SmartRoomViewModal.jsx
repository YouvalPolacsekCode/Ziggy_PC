import React from 'react'
import { useT } from '../../lib/i18n'

// ── SmartRoomViewModal ────────────────────────────────────────────────────────
// Read-only "everything the Smart Room does, in one place" — the dedicated view
// for a SmartRoomGroupRow (the grouped-card equivalent of the generic
// AutomationViewModal, which can't render the recipe shape). Shows the behavior
// table in plain language + how many rules are active.
//
// Props: group { roomName, members, allEnabled, count }.
export default function SmartRoomViewModal({ group }) {
  const t = useT()
  if (!group) return null
  const { roomName, members = [] } = group
  const activeCount = members.filter((m) => m.enabled).length

  const rows = [
    { icon: '☀️', text: t('automations.smartRoom.behaviorDay') },
    { icon: '🌙', text: t('automations.smartRoom.behaviorNight') },
    { icon: '😴', text: t('automations.smartRoom.behaviorGuard') },
    { icon: '🚪', text: t('automations.smartRoom.behaviorEmpty') },
    { icon: '🗣️', text: t('automations.smartRoom.behaviorVoice') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} dir="auto">
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('automations.smartRoom.cardTitle', { room: roomName })}</p>
        <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.45 }}>
          {t('automations.smartRoom.viewIntro')}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
            <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>{r.icon}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.4 }}>{r.text}</span>
          </div>
        ))}
      </div>

    </div>
  )
}
