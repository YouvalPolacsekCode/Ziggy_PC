import React from 'react'
import { useT } from '../../lib/i18n'
import { Toggle } from '../ui/Toggle'

// ── SmartRoomViewModal ────────────────────────────────────────────────────────
// One modal for both View AND Edit of a Smart Room. Lists the room's actual
// automations ("steps") — Day / Night / Off — each with an enable toggle and an
// Edit button that opens the standard automation editor. Replaces the old
// static behavior table AND the "re-run the whole creation wizard on edit" flow.
//
// Props: group { room, roomName, members }.
//   onEditMember(member)   — open the standard editor for one automation
//   onToggleMember(member, enabled)
//   onDelete()             — remove the whole Smart Room

// Derive a friendly icon from the member's part (day/night/off).
function partIcon(m) {
  const id = (m.id || '').toLowerCase()
  if (id.endsWith('_day'))   return '☀️'
  if (id.endsWith('_night')) return '🌙'
  if (id.endsWith('_off'))   return '🚪'
  return '⚙️'
}

export default function SmartRoomViewModal({ group, onEditMember, onToggleMember, onDelete }) {
  const t = useT()
  if (!group) return null
  const { roomName, members = [] } = group

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} dir="auto">
      <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.45 }} dir="auto">
        {t('automations.smartRoom.stepsIntro')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {members.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-faint)' }} dir="auto">{t('automations.smartRoom.noSteps')}</p>
        )}
        {members.map((m) => (
          <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)' }}>
            <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>{partIcon(m)}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.4, flex: 1, minWidth: 0 }} dir="auto">
              {m.name}
            </span>
            {onToggleMember && (
              <Toggle checked={!!m.enabled} onCheckedChange={(v) => onToggleMember(m, v)} />
            )}
            {onEditMember && (
              <button type="button" onClick={() => onEditMember(m)} title={t('common.edit')} aria-label={t('common.edit')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {onDelete && (
        <button type="button" onClick={onDelete} className="z-btn-secondary"
          style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 10, fontSize: 12.5, color: 'var(--accent)' }}>
          {t('automations.smartRoom.deleteRoom', { room: roomName })}
        </button>
      )}
    </div>
  )
}
