import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Toggle } from '../ui/Toggle'
import { useT, useTranslatedName } from '../../lib/i18n'
import { getTriggerTypes } from '../../lib/automations/types'

// ── AutomationCard ────────────────────────────────────────────────────────────
// React.memo'd so a state_changed WS bump that doesn't touch this card's
// action entities can't drag it through a re-render. With 100+ automations
// on the page that was the dominant cost on every device toggle.
const AutomationCard = React.memo(function AutomationCard({
  automation, offlineEntityIds, onToggle, onView, onEdit, onDelete, onTrigger,
}) {
  const t = useT()
  const automationName = useTranslatedName(automation.name)
  const automationDesc = useTranslatedName(automation.description)
  const triggerLabel = getTriggerTypes().find(tt => tt.value === automation.trigger?.type)?.label

  // Check if any action entity is currently unavailable. offlineEntityIds is
  // built once at the page level and shared across rows — used to be rebuilt
  // here per card per render (N cards × M entities every WS tick).
  const offlineEntities = useMemo(() => {
    if (!offlineEntityIds || offlineEntityIds.size === 0) return []
    return (automation.actions || [])
      .filter(a => a.entity_id && offlineEntityIds.has(a.entity_id))
      .map(a => a.entity_id)
  }, [automation.actions, offlineEntityIds])
  const hasOfflineDep = automation.enabled && offlineEntities.length > 0

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: `0.5px solid ${hasOfflineDep ? 'color-mix(in srgb, var(--warn) 40%, var(--line))' : 'var(--line)'}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {(() => {
          const triggerType = automation.trigger?.type || 'time'
          const tintMap = { time: 'var(--info)', state: 'var(--ok)', zone: 'var(--accent)', sunrise: 'var(--gold)', sunset: 'var(--accent)', webhook: 'var(--warn)', manual: 'var(--ink-mute)' }
          const tint = automation.enabled ? (tintMap[triggerType] || 'var(--info)') : 'var(--ink-faint)'
          const iconMap = {
            time: <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>,
            sunrise: <><circle cx="12" cy="13" r="3"/><path d="M12 4v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20"/></>,
            sunset: <><circle cx="12" cy="13" r="3"/><path d="M12 3v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20M12 19v3"/></>,
            zone: <><path d="M12 2L4 14h7l-1 8 9-12h-7l1-8z"/></>,
            state: <><path d="M4 12l5 5L20 6"/></>,
            webhook: <><circle cx="12" cy="12" r="3"/><path d="M12 9V5a2 2 0 0 0-4 0M9 12H5a2 2 0 0 0 0 4M12 15v4a2 2 0 0 0 4 0M15 12h4a2 2 0 0 0 0-4"/></>,
          }
          return (
            <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${tint} 12%, var(--surface-2))` }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={automation.enabled ? tint : 'var(--ink-faint)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {iconMap[triggerType] || <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>}
              </svg>
            </div>
          )
        })()}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{automationName}</p>
          {automation.description && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{automationDesc}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {triggerLabel && (
              <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', background: `color-mix(in srgb, ${automation.enabled ? 'var(--info)' : 'var(--ink-mute)'} 12%, transparent)`, color: automation.enabled ? 'var(--info)' : 'var(--ink-faint)' }}>
                {triggerLabel}
              </span>
            )}
            {automation.trigger?.time && <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{automation.trigger.time}</span>}
            <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{t('automations.card.stepsCount', { n: automation.actions?.length || 0 })}</span>
            {(automation.rooms || []).length > 0 && <span style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>{t('automations.card.roomsCount', { n: (automation.rooms || []).length })}</span>}
          </div>
          {hasOfflineDep && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--warn)', fontFamily: '"IBM Plex Mono", monospace' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {t(offlineEntities.length === 1 ? 'automations.suggested.offlineDepsOne' : 'automations.suggested.offlineDeps', { n: offlineEntities.length })}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Toggle checked={automation.enabled} onCheckedChange={() => onToggle(automation.id)} />
          <div style={{ display: 'flex', gap: 2 }}>
            {[
              { onClick: () => onTrigger(automation.id), color: 'var(--ok)', title: t('automations.view.runNow'), path: <path d="M5 3l14 9-14 9V3z" fill="currentColor" stroke="none"/> },
              { onClick: () => onView(automation),       color: 'var(--ink-mute)', title: t('automations.card.view'), path: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> },
              { onClick: () => onEdit(automation),       color: 'var(--ink-mute)', title: t('common.edit'),    path: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></> },
              { onClick: () => onDelete(automation.id),  color: 'var(--accent)',   title: t('common.delete'),  path: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></> },
            ].map(({ onClick, color, title, path }) => (
              <button key={title} onClick={onClick} title={title} aria-label={title} style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 4 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
})

export default AutomationCard
