import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Toggle } from '../ui/Toggle'
import { useT, useTranslatedName } from '../../lib/i18n'
import { getTriggerTypes } from '../../lib/automations/types'
import { behaviorSummary } from '../../lib/automations/summaries'
import { T_ENTER } from '../../lib/motion'

// ── AutomationCard ────────────────────────────────────────────────────────────
// One row = glyph · name · one footnote line · switch · actions.
//
// What changed in the HIG pass and why:
//   - the 19px emoji is gone; the trigger type draws a 22px line glyph so the
//     icon matches the text weight and renders the same on every OS.
//   - name is Headline (17/600), the summary is Subhead (15), and the
//     trigger/time/rooms metadata is ONE Footnote line (13) with no tint —
//     the blue "At a specific time" chip made every card shout.
//   - action buttons are 44×44 targets; delete is --err-text, not the
//     brand accent (one colour, one meaning).
//
// React.memo'd so a state_changed WS bump that doesn't touch this card's
// action entities can't drag it through a re-render. With 100+ automations
// on the page that was the dominant cost on every device toggle.
const AutomationCard = React.memo(function AutomationCard({
  automation, offlineEntityIds, onToggle, onView, onEdit, onDelete, onTrigger,
  // Deep-link focus (/actions?focus=<id> from a chat card): accent ring for a
  // moment so the eye lands on the right card after the scroll.
  highlighted = false,
}) {
  const t = useT()
  const automationName = useTranslatedName(automation.name)
  // Human one-liner: prefer the hand-written description, else derive from what
  // the automation actually does — never leave it as a bare "N steps".
  const rawSummary = automation.description || behaviorSummary(automation)
  const automationDesc = useTranslatedName(rawSummary)
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

  const triggerType = automation.trigger?.type || 'time'
  const iconMap = {
    time: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    sunrise: <><circle cx="12" cy="13" r="3"/><path d="M12 4v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20"/></>,
    sunset: <><circle cx="12" cy="13" r="3"/><path d="M12 3v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20M12 19v3"/></>,
    zone: <><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></>,
    state: <><path d="M4 12l5 5L20 6"/></>,
    webhook: <><circle cx="12" cy="12" r="3"/><path d="M12 9V5a2 2 0 0 0-4 0M9 12H5a2 2 0 0 0 0 4M12 15v4a2 2 0 0 0 4 0M15 12h4a2 2 0 0 0 0-4"/></>,
    manual: <><path d="M8 13V5a2 2 0 1 1 4 0v6"/><path d="M12 11V9a2 2 0 1 1 4 0v3"/><path d="M16 12a2 2 0 1 1 4 0v3a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L4 15a2 2 0 1 1 3.4-2.1L8 14"/></>,
  }

  const meta = [
    triggerLabel,
    automation.trigger?.time,
    (automation.rooms || []).length > 0 ? t('automations.card.roomsCount', { n: automation.rooms.length }) : null,
  ].filter(Boolean).join(' · ')

  const actions = [
    { onClick: () => onTrigger(automation.id), color: 'var(--ink-mute)', title: t('automations.view.runNow'), path: <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none"/> },
    { onClick: () => onView(automation),       color: 'var(--ink-mute)', title: t('automations.card.view'),  path: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> },
    { onClick: () => onDelete(automation.id),  color: 'var(--err-text)', title: t('common.delete'),          path: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></> },
  ]

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={T_ENTER} data-automation-id={automation.id}>
      <div style={{
        padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)',
        border: `0.5px solid ${hasOfflineDep ? 'color-mix(in srgb, var(--warn) 40%, var(--line))' : 'var(--line)'}`,
        boxShadow: highlighted ? '0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent)' : 'none',
        transition: 'box-shadow var(--dur-state) var(--ease-standard)',
        display: 'flex', alignItems: 'flex-start', gap: 16,
      }}>
        <div aria-hidden="true" style={{
          width: 40, height: 40, borderRadius: 'var(--r-ctl)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface-2)', color: automation.enabled ? 'var(--ink-2)' : 'var(--ink-faint)',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            {iconMap[triggerType] || iconMap.state}
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="z-headline" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{automationName}</p>
          <p className="z-subhead" style={{ margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
            {automationDesc || t('automations.card.notConfigured')}
          </p>
          {meta && (
            <p className="z-footnote z-mono" style={{ margin: '4px 0 0', color: 'var(--ink-faint)' }} dir="auto">{meta}</p>
          )}
          {hasOfflineDep && (
            <p className="z-footnote" style={{ margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warn-text)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {t(offlineEntities.length === 1 ? 'automations.suggested.offlineDepsOne' : 'automations.suggested.offlineDeps', { n: offlineEntities.length })}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, margin: '-4px -8px -8px 0' }}>
          <div style={{ padding: '8px 8px 0' }}>
            <Toggle checked={automation.enabled} onCheckedChange={() => onToggle(automation.id)} aria-label={automationName} />
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            {actions.map(({ onClick, color, title, path }) => (
              <button
                key={title} onClick={onClick} title={title} aria-label={title}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color, width: 40, height: 40, padding: 0, borderRadius: 'var(--r-ctl)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
})

export default AutomationCard
