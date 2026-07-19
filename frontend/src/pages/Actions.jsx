import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { useAutomationStore } from '../stores/automationStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { getSuggestionsFeed, deleteCircadianBundle, deleteSmartRoom } from '../lib/api'
import { RoutinesListPanel } from './Routines'
import QuickAsks from './QuickAsks'
import { useT } from '../lib/i18n'
import AutomationWizard from '../components/automations/wizard/AutomationWizard'
import AutomationViewModal from '../components/automations/AutomationViewModal'
import AutomationCard from '../components/automations/AutomationCard'
import CircadianBundleWizard from '../components/automations/CircadianBundleWizard'
import SmartRoomWizard from '../components/automations/SmartRoomWizard'
import CircadianGroupRow from '../components/automations/CircadianGroupRow'
import SmartRoomGroupRow from '../components/automations/SmartRoomGroupRow'
import SmartRoomViewModal from '../components/automations/SmartRoomViewModal'
import BlueprintsModal from '../components/automations/templates/BlueprintsModal'
import TemplatesTab from '../components/automations/templates/TemplatesTab'
import SuggestedTab, { suggestionToWizardData } from '../components/automations/templates/SuggestedTab'

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Automations() {
  const t = useT()
  const { automations, routines, loading, fetchAutomations, fetchRoutines, addAutomation, removeAutomation, toggleAutomation, triggerAutomation, loadAutomationConfig } = useAutomationStore()
  const { suggestions, loading: sugLoading, fetch: fetchSuggestions, setFromFeed: setSuggestionsFromFeed, accept, reject, snooze, runAnalysis, analyzing, pendingCount } = useSuggestionStore()
  const { addToast } = useUIStore()
  // Per-field selectors — pulling the whole deviceStore here would re-render
  // the page (and every automation card under it) on every WS tick.
  const ziggyRooms = useDeviceStore(s => s.ziggyRooms)
  const entities   = useDeviceStore(s => s.entities)

  // Compute the offline-entity set ONCE per page render, share it with every
  // AutomationCard via prop. Each card used to rebuild this set itself on
  // every WS-driven re-render — N × M work for no reason.
  const offlineEntityIds = useMemo(() => {
    const s = new Set()
    for (const e of entities) {
      if (e.state === 'unavailable' || e.state === 'unknown') s.add(e.entity_id)
    }
    return s
  }, [entities])
  const [tab,               setTab]               = useState('automations')
  const [showWizard,        setShowWizard]        = useState(false)
  const [editTarget,        setEditTarget]        = useState(null)
  const [viewTarget,        setViewTarget]        = useState(null)
  // Community-template deep link: holds the blueprint_id whose input form the
  // BlueprintsModal should open directly (set from the Templates tab).
  const [communityTarget,   setCommunityTarget]   = useState(null)
  // Circadian bundle wizard — opened by Configure on the Smart Light Schedule
  // template, or by Edit on the grouped row in the Your-Automations section.
  const [circadianTarget,   setCircadianTarget]   = useState(null)
  // Smart Room template — opens the pick-room → designer → BundlePreviewCard flow.
  const [smartRoomTarget,   setSmartRoomTarget]   = useState(null)   // create flow
  const [smartRoomView,     setSmartRoomView]     = useState(null)   // group being viewed
  const [smartRoomEdit,     setSmartRoomEdit]     = useState(null)   // {room, roomName} being edited

  const roomNameMap = Object.fromEntries(ziggyRooms.map(r => [r.id, r.name]))
  const pendingSuggestions = suggestions.filter(s => s.status === 'pending')

  // Group the 4 ziggy_circadian_* automations behind a single "Smart Light
  // Schedule" row in the Your-Automations section. The user sees one
  // toggleable feature, not 4 cryptic clock entries.
  const { circadianGroup, smartRoomGroups, visibleAutomations } = useMemo(() => {
    // Group by the ENTITY object-id prefix (HA derives it from the alias),
    // NOT the config-id prefix `ziggy_circadian_` — the two differ.
    const CIRCADIAN_PREFIX = 'ziggy_smart_light_schedule_'
    const SMART_ROOM_RE = /^ziggy_smart_room_(.+)_(day|night|off)$/

    // ── Smart Room groups: one card per room from its ziggy_smart_room_<room>_* rules ──
    const srMap = {}
    automations.forEach(a => {
      const m = (a.id || '').match(SMART_ROOM_RE)
      if (m) (srMap[m[1]] = srMap[m[1]] || []).push(a)
    })
    const smartRoomGroups = Object.entries(srMap).map(([room, members]) => ({
      room,
      roomName: roomNameMap[room] || room.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      members,
      count: members.length,
      allEnabled: members.every(m => m.enabled),
      anyEnabled: members.some(m => m.enabled),
    }))

    const circMembers = automations.filter(a => a.id?.startsWith(CIRCADIAN_PREFIX))
    const visible = automations.filter(a =>
      !a.id?.startsWith(CIRCADIAN_PREFIX) && !SMART_ROOM_RE.test(a.id || ''))

    let circadianGroup = null
    if (circMembers.length > 0) {
      const bedtimeAuto = circMembers.find(a => a.id === `${CIRCADIAN_PREFIX}bedtime`)
      const bedtime = bedtimeAuto?.trigger?.time?.slice(0, 5) || '22:00'
      const lightSet = new Set()
      circMembers.forEach(m => (m.actions || []).forEach(act => {
        const eid = act.entity_id
        if (typeof eid === 'string' && eid.startsWith('light.')) lightSet.add(eid)
        else if (Array.isArray(eid)) eid.forEach(x => x?.startsWith?.('light.') && lightSet.add(x))
      }))
      circadianGroup = {
        members: circMembers, lights: Array.from(lightSet), bedtime,
        autoOn: circMembers.find(m => m.auto_on != null)?.auto_on ?? true,
        allEnabled: circMembers.every(m => m.enabled),
        anyEnabled: circMembers.some(m => m.enabled),
        count: circMembers.length,
      }
    }

    return { circadianGroup, smartRoomGroups, visibleAutomations: visible }
  }, [automations, roomNameMap])

  // Only fetch what isn't cached. Re-fetching on every revisit toggles the
  // store's `loading` flag, which flashes skeleton placeholders mid-mount.
  useEffect(() => {
    if (automations.length === 0)        fetchAutomations()
    if (routines.length === 0)           fetchRoutines()

    // Habit suggestions for the Suggested tab. Prefer the unified feed (one
    // fetch), fall back to the legacy endpoint if it errors so an outage of
    // the new endpoint can't blank the tab.
    if (suggestions.length > 0) return
    getSuggestionsFeed()
      .then(resp => {
        const items = Array.isArray(resp?.items) ? resp.items : []
        setSuggestionsFromFeed(items)
      })
      .catch(() => { fetchSuggestions() })
  }, [])

  const handleConfigureTemplate = (template) => {
    if (!template.wizard_prefill) return
    // Bundle templates (e.g. Smart Light Schedule) take the wizard schema
    // off the rails — route them to a dedicated wizard instead.
    if (template.wizard_prefill.bundle === 'circadian') {
      setCircadianTarget({ ...template.wizard_prefill, _templateId: template.id, _isInstalled: false })
      return
    }
    // Smart Room bundle — pick a room, then the designer + BundlePreviewCard.
    if (template.wizard_prefill.bundle === 'smart_room') {
      setSmartRoomTarget({ _templateId: template.id })
      return
    }
    setEditTarget({ ...template.wizard_prefill, _isTemplate: true, _templateId: template.id })
    setShowWizard(true)
  }

  // Open the circadian wizard in edit mode for an installed bundle. Called
  // from the grouped Smart Light Schedule row in the Your-Automations section.
  const handleEditCircadianBundle = (group) => {
    setCircadianTarget({
      _isInstalled: true,
      selectedLights: group.lights,
      bedtime: group.bedtime,
      autoOn: group.autoOn,
      defaults: { lights: group.lights, bedtime: group.bedtime, autoOn: group.autoOn },
    })
  }

  const handleSmartRoomClose = () => setSmartRoomTarget(null)
  const handleSmartRoomSaved = async () => {
    setSmartRoomTarget(null)
    addToast(t('automations.smartRoom.created'), 'success')
    await fetchAutomations({ force: true })
  }

  // ── Smart Room grouped-card handlers ─────────────────────────────────────
  const handleSmartRoomToggleAll = async (group, toEnabled) => {
    try {
      await Promise.all(group.members.map(m => toggleAutomation(m.id, toEnabled)))
      await fetchAutomations({ force: true })
    } catch { addToast(t('automations.failedToTrigger'), 'error') }
  }
  const handleSmartRoomEditSaved = async () => {
    setSmartRoomEdit(null)
    addToast(t('automations.smartRoom.created'), 'success')
    await fetchAutomations({ force: true })
  }
  const handleSmartRoomDelete = async (group) => {
    try {
      await deleteSmartRoom(group.room)
      addToast(t('automations.smartRoom.deleted'), 'success')
      await fetchAutomations({ force: true })
    } catch { addToast(t('automations.failedToTrigger'), 'error') }
  }

  const handleCircadianClose = () => setCircadianTarget(null)
  const handleCircadianSaved = async ({ updated, removed }) => {
    setCircadianTarget(null)
    addToast(
      removed ? t('automations.circadian.deleted')
              : (updated ? t('automations.circadian.updated') : t('automations.circadian.saved')),
      'success',
    )
    try { await fetchAutomations({ force: true }) } catch {}
  }

  // Accepting a suggestion opens the wizard pre-filled with the suggestion's
  // trigger + actions so the user can review/edit before the automation lands.
  const handleConfigureSuggestion = (suggestion) => {
    setEditTarget({ ...suggestionToWizardData(suggestion), _fromSuggestion: suggestion.id })
    setShowWizard(true)
  }

  const handleSave = async (data) => {
    try {
      await addAutomation({ ...data, id: editTarget?.id })
      addToast(t('automations.saved'), 'success')
      if (editTarget?._fromSuggestion) {
        try { await accept(editTarget._fromSuggestion) } catch {}
      }
      await fetchAutomations()
    } catch (e) {
      // 422 = a user-fixable validation error (e.g. the trigger points at a
      // sensor that doesn't exist yet). Show the specific reason, not "failed".
      const msg = e?.status === 422
        ? t('automations.triggerEntityMissing')
        : t('automations.failedToSave')
      addToast(msg, 'error')
    }
  }
  const handleDelete = async (id) => {
    try { await removeAutomation(id); addToast(t('automations.deleted'), 'success') }
    catch { addToast(t('automations.failedToDelete'), 'error') }
  }
  const handleEdit = async (automation) => {
    try { const config = await loadAutomationConfig(automation.id); setEditTarget(config || automation) }
    catch { setEditTarget(automation) }
    setShowWizard(true)
  }
  const handleView = async (automation) => {
    try { const config = await loadAutomationConfig(automation.id); setViewTarget(config || automation) }
    catch { setViewTarget(automation) }
  }
  const handleClose = () => { setShowWizard(false); setEditTarget(null) }
  const enabled = automations.filter(a => a.enabled).length

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('automations.eyebrow')}</p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>{t('automations.title')}</h1>
          <p className="z-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
            {t('automations.countSummary', { enabled, total: automations.length })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => { setEditTarget(null); setShowWizard(true) }} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            {t('automations.headerAdd')}
          </button>
        </div>
      </div>

      {/* Tab switcher — segmented pill style. Templates (merged Library +
          Community + Recommended) and Suggested (habit-learned proactive feed)
          are their own tabs. Scrolls horizontally on narrow screens. */}
      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 13, marginBottom: 20, overflowX: 'auto' }}>
        {[
          { id: 'automations', label: t('automations.tabActive'),     count: enabled },
          { id: 'templates',   label: t('automations.tabTemplates'),  count: 0 },
          { id: 'suggested',   label: t('automations.tabSuggested'),  count: pendingSuggestions.length },
          { id: 'routines',    label: t('automations.tabRoutines'),   count: routines.length },
          { id: 'quick-asks',  label: t('automations.tabQuickAsks'),  count: 0 },
        ].map(tabDef => (
          <button key={tabDef.id} onClick={() => setTab(tabDef.id)} style={{
            flex: '1 0 auto', padding: '8px 12px', borderRadius: 10, fontFamily: 'inherit', cursor: 'pointer',
            background: tab === tabDef.id ? 'var(--surface)' : 'transparent',
            border: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            color: tab === tabDef.id ? 'var(--ink)' : 'var(--ink-mute)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: tab === tabDef.id ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            transition: 'background 0.15s',
          }}>
            {tabDef.label}
            {tabDef.count > 0 && <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{tabDef.count}</span>}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

      {/* ─── Automations tab ─── */}
      {tab === 'automations' && (
        <motion.div
          key="automations"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >

      {loading && automations.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 82, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty state — nudge toward the Templates tab for a first automation. */}
      {!loading && automations.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>{t('automations.empty')}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>{t('automations.emptyHint')}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => setShowWizard(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>{t('automations.createAutomation')}</button>
            <button onClick={() => setTab('templates')} className="z-btn-primary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>{t('automations.tabTemplates')}</button>
          </div>
        </div>
      )}

      {/* ── Section: Your automations ───────────────────────────────────── */}
      {automations.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p className="z-eyebrow" style={{ marginBottom: 10 }}>{t('automations.myAutomations')}</p>
          <AnimatePresence mode="popLayout">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {circadianGroup && (
                <CircadianGroupRow
                  group={circadianGroup}
                  onToggleAll={async (toEnabled) => {
                    try {
                      await Promise.all(circadianGroup.members.map(m => toggleAutomation(m.id, toEnabled)))
                    } catch { addToast(t('automations.circadian.failed'), 'error') }
                  }}
                  onEdit={() => handleEditCircadianBundle(circadianGroup)}
                  onDelete={async () => {
                    try {
                      await deleteCircadianBundle()
                      addToast(t('automations.circadian.deleted'), 'success')
                      await fetchAutomations({ force: true })
                    } catch { addToast(t('automations.circadian.failed'), 'error') }
                  }}
                />
              )}
              {smartRoomGroups.map(group => (
                <SmartRoomGroupRow
                  key={group.room}
                  group={group}
                  onToggleAll={(toEnabled) => handleSmartRoomToggleAll(group, toEnabled)}
                  onView={() => setSmartRoomView(group)}
                  onEdit={() => setSmartRoomEdit({ room: group.room, roomName: group.roomName })}
                  onDelete={() => handleSmartRoomDelete(group)}
                />
              ))}
              {visibleAutomations.map(a => (
                <AutomationCard key={a.id} automation={a} offlineEntityIds={offlineEntityIds}
                  onToggle={toggleAutomation} onView={handleView} onEdit={handleEdit} onDelete={handleDelete}
                  onTrigger={async id => { try { await triggerAutomation(id); addToast(t('automations.triggered'), 'success') } catch { addToast(t('automations.failedToTrigger'), 'error') } }} />
              ))}
            </div>
          </AnimatePresence>
        </div>
      )}

        </motion.div>
      )}

      {/* ─── Templates tab (merged Library + Community + Recommended) ─── */}
      {tab === 'templates' && (
        <motion.div
          key="templates"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >
          <TemplatesTab
            onConfigureNative={handleConfigureTemplate}
            onConfigureCommunity={(blueprintId) => setCommunityTarget(blueprintId)}
            onSensorCreated={() => addToast(t('automations.smartSensor.created'), 'success')}
          />
        </motion.div>
      )}

      {/* ─── Suggested tab (habit-learned proactive feed) ─── */}
      {tab === 'suggested' && (
        <motion.div
          key="suggested"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >
          <SuggestedTab
            suggestions={suggestions}
            loading={sugLoading}
            analyzing={analyzing}
            onConfigure={handleConfigureSuggestion}
            onReject={async id => { try { await reject(id); addToast(t('automations.suggested.dismissed'), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
            onSnooze={async (id, days) => { try { await snooze(id, days); addToast(t('automations.suggested.snoozedFor', { n: days }), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
            onAnalyze={async () => { try { const r = await runAnalysis(); addToast(r?.new_count > 0 ? t(r.new_count === 1 ? 'automations.suggested.foundNewOne' : 'automations.suggested.foundNew', { n: r.new_count }) : t('automations.suggested.noNewPatterns'), 'success') } catch { addToast(t('automations.suggested.analysisFailed'), 'error') } }}
          />
        </motion.div>
      )}

      {/* ─── Routines tab ─── */}
      {tab === 'routines' && (
        <motion.div
          key="routines"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >
          <RoutinesListPanel />
        </motion.div>
      )}

      {/* ─── Quick Asks tab ─── */}
      {tab === 'quick-asks' && (
        <motion.div
          key="quick-asks"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >
          <QuickAsks embedded />
        </motion.div>
      )}

      </AnimatePresence>

      {/* Community templates modal — deep-linked from the Templates tab to a
          single template's input form. Creates the automation through the
          standard save_automation path; after success we refresh the list. */}
      <BlueprintsModal
        open={!!communityTarget}
        initialBlueprintId={communityTarget}
        onClose={() => setCommunityTarget(null)}
        onCreated={async () => {
          addToast(t('automations.saved'), 'success')
          try { await fetchAutomations({ force: true }) } catch {}
        }}
      />

      <Modal open={showWizard} onClose={handleClose} title={
        editTarget?._fromSuggestion ? t('automations.reviewTitle', { name: editTarget.name }) :
        editTarget?._isTemplate ? t('automations.configureTitle', { name: editTarget.name }) :
        editTarget ? t('automations.editTitle', { name: editTarget.name }) : t('automations.newCustom')
      }>
        <AutomationWizard key={editTarget?.id || '__new__'} initial={editTarget} onSave={handleSave} onClose={handleClose} />
      </Modal>

      {/* Smart Light Schedule (circadian) wizard — separate modal. */}
      <Modal open={!!circadianTarget} onClose={handleCircadianClose} title={t('automations.circadian.title')}>
        {circadianTarget && (
          <CircadianBundleWizard
            key={circadianTarget._isInstalled ? 'edit' : 'new'}
            initial={circadianTarget}
            onSaved={handleCircadianSaved}
            onClose={handleCircadianClose}
          />
        )}
      </Modal>

      {/* Smart Room bundle — pick a room → designer → BundlePreviewCard */}
      <Modal open={!!smartRoomTarget} onClose={handleSmartRoomClose} title={t('automations.smartRoom.title')}>
        {smartRoomTarget && (
          <SmartRoomWizard
            onSaved={handleSmartRoomSaved}
            onClose={handleSmartRoomClose}
          />
        )}
      </Modal>

      {/* Smart Room — dedicated View (behavior in one place) */}
      <Modal open={!!smartRoomView} onClose={() => setSmartRoomView(null)}
             title={smartRoomView ? t('automations.smartRoom.cardTitle', { room: smartRoomView.roomName }) : ''}>
        {smartRoomView && <SmartRoomViewModal group={smartRoomView} />}
      </Modal>

      {/* Smart Room — Edit re-opens the recipe flow for that room (overwrites in place) */}
      <Modal open={!!smartRoomEdit} onClose={() => setSmartRoomEdit(null)} title={t('automations.smartRoom.title')}>
        {smartRoomEdit && (
          <SmartRoomWizard
            initialRoom={smartRoomEdit.room}
            initialRoomName={smartRoomEdit.roomName}
            onSaved={handleSmartRoomEditSaved}
            onClose={() => setSmartRoomEdit(null)}
          />
        )}
      </Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={t('automations.detailsTitle')}>
        <AutomationViewModal
          automation={viewTarget}
          roomNameMap={roomNameMap}
          onEdit={(automation) => { setViewTarget(null); handleEdit(automation) }}
          onTrigger={async (id) => { try { await triggerAutomation(id); addToast(t('automations.triggered'), 'success') } catch { addToast(t('automations.failedToTrigger'), 'error') } }}
          onClose={() => setViewTarget(null)}
        />
      </Modal>
    </div>
  )
}
