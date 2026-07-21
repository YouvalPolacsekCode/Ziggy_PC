import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { useAutomationStore } from '../stores/automationStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { getSuggestionsFeed, getCircadian, saveCircadian, syncCircadian, deleteCircadian, deleteSmartRoom, getClimate, toggleClimate, syncClimate, deleteClimate } from '../lib/api'
import { RoutinesListPanel, RoutineWizard } from './Routines'
import { useT } from '../lib/i18n'
import AutomationWizard from '../components/automations/wizard/AutomationWizard'
import AutomationViewModal from '../components/automations/AutomationViewModal'
import AutomationCard from '../components/automations/AutomationCard'
import CircadianBundleWizard from '../components/automations/CircadianBundleWizard'
import SmartRoomWizard from '../components/automations/SmartRoomWizard'
import CircadianGroupRow from '../components/automations/CircadianGroupRow'
import CircadianViewModal from '../components/automations/CircadianViewModal'
import SmartRoomGroupRow from '../components/automations/SmartRoomGroupRow'
import SmartRoomViewModal from '../components/automations/SmartRoomViewModal'
import ClimateBundleWizard from '../components/automations/ClimateBundleWizard'
import ClimateGroupRow from '../components/automations/ClimateGroupRow'
import ClimateViewModal from '../components/automations/ClimateViewModal'
import LeaveHomeWizard from '../components/automations/LeaveHomeWizard'
import BlueprintsModal from '../components/automations/templates/BlueprintsModal'
import TemplatesTab from '../components/automations/templates/TemplatesTab'
import SuggestedTab, { suggestionToWizardData, SuggestionNudgeStrip } from '../components/automations/templates/SuggestedTab'

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Automations() {
  const t = useT()
  const { automations, routines, loading, fetchAutomations, fetchRoutines, addAutomation, removeAutomation, toggleAutomation, triggerAutomation, loadAutomationConfig, saveRoutine } = useAutomationStore()
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
  // Library (OOTB templates + community blueprints) and Suggested (habit feed)
  // are no longer tabs — they open as modals from the Automations tab.
  const [showLibrary,       setShowLibrary]       = useState(false)
  const [showSuggestions,   setShowSuggestions]   = useState(false)
  // Header ➕ chooser: custom-create asks Automatic vs On-demand, then opens
  // the matching blank wizard.
  const [showCreateChooser, setShowCreateChooser] = useState(false)
  const [showWizard,        setShowWizard]        = useState(false)
  // On-demand Library items open RoutineWizard prefilled (parallel to
  // editTarget+showWizard for the automation wizard).
  const [routineTarget,     setRoutineTarget]     = useState(null)
  const [editTarget,        setEditTarget]        = useState(null)
  const [viewTarget,        setViewTarget]        = useState(null)
  // Community-template deep link: holds the blueprint_id whose input form the
  // BlueprintsModal should open directly (set from the Templates tab).
  const [communityTarget,   setCommunityTarget]   = useState(null)
  // Circadian bundle wizard — opened by Configure on the Smart Light Schedule
  // template, or by Edit on the grouped row in the Your-Automations section.
  const [circadianTarget,   setCircadianTarget]   = useState(null)
  // Smart Light Schedule is now sourced from the ramp-engine config endpoint,
  // not from HA automations (they're migrated away). Status drives the card + view.
  const [circadianStatus,   setCircadianStatus]   = useState(null)
  const [showCircadianView, setShowCircadianView] = useState(false)
  // Smart Climate Control — per-room thermostat engine. Status is {rooms:{room:{…}}}.
  // climateTarget opens the wizard (create/edit); climateView holds the room slice
  // being viewed read-only. All sourced from the /smart_climate config endpoint.
  const [climateStatus,     setClimateStatus]     = useState(null)
  const [climateTarget,     setClimateTarget]     = useState(null)
  const [climateView,       setClimateView]       = useState(null)   // {room, slice}
  // Leave Home — dedicated wizard (create from Library / edit the ziggy_leave_home automation).
  const [leaveHomeTarget,   setLeaveHomeTarget]   = useState(null)
  // Smart Room template — opens the pick-room → designer → BundlePreviewCard flow.
  const [smartRoomTarget,   setSmartRoomTarget]   = useState(null)   // create flow
  const [smartRoomView,     setSmartRoomView]     = useState(null)   // room slug being viewed/edited (one modal)

  const roomNameMap = Object.fromEntries(ziggyRooms.map(r => [r.id, r.name]))

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
      !a.id?.startsWith(CIRCADIAN_PREFIX) && !SMART_ROOM_RE.test(a.id || '')
      // The away-alert is managed inside the Leave Home wizard, not its own card.
      && a.id !== 'ziggy_leave_home_alert')

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
    getCircadian().then(setCircadianStatus).catch(() => {})
    getClimate().then(setClimateStatus).catch(() => {})

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
    // Smart Climate bundle — pick a room → a temp reading → a device to switch.
    if (template.wizard_prefill.bundle === 'climate') {
      setClimateTarget({ _isInstalled: false })
      return
    }
    // Leave Home — dedicated plain-language wizard (auto-detects the trigger).
    if (template.wizard_prefill.bundle === 'leave_home') {
      setLeaveHomeTarget({ _isInstalled: false, ...template.wizard_prefill })
      return
    }
    setEditTarget({ ...template.wizard_prefill, _isTemplate: true, _templateId: template.id })
    setShowWizard(true)
  }

  const refetchCircadian = () => getCircadian().then(setCircadianStatus).catch(() => {})

  // Open the wizard in edit mode from the live engine config.
  const handleEditCircadian = () => {
    if (!circadianStatus) return
    setShowCircadianView(false)
    setCircadianTarget({
      _isInstalled: true,
      lights:  circadianStatus.lights,
      peak:    circadianStatus.peak,
      floor:   circadianStatus.floor,
      wake:    circadianStatus.wake,
      bedtime: circadianStatus.bedtime,
    })
  }
  const handleCircadianSync = async () => {
    try { await syncCircadian(); addToast(t('automations.circadian.synced'), 'success'); await refetchCircadian() }
    catch { addToast(t('automations.circadian.failed'), 'error') }
  }
  const handleCircadianToggle = async (enabled) => {
    try {
      await saveCircadian({ ...circadianStatus, enabled })
      addToast(enabled ? t('automations.circadian.resumed') : t('automations.circadian.pausedToast'), 'success')
      await refetchCircadian()
    } catch { addToast(t('automations.circadian.failed'), 'error') }
  }
  const handleCircadianDelete = async () => {
    try { await deleteCircadian(); addToast(t('automations.circadian.deleted'), 'success'); await refetchCircadian() }
    catch { addToast(t('automations.circadian.failed'), 'error') }
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
    try { await refetchCircadian() } catch {}
  }

  // ── Smart Climate handlers (per-room) ────────────────────────────────────
  const refetchClimate = () => getClimate().then(setClimateStatus).catch(() => {})
  const handleEditClimate = (room, slice) => {
    setClimateView(null)
    setClimateTarget({
      _isInstalled: true,
      room,
      sensor:  slice.sensor,
      cooling: slice.cooling,
      heating: slice.heating,
    })
  }
  const handleClimateSync = async (room) => {
    try { await syncClimate(room); addToast(t('automations.smartClimate.synced'), 'success'); await refetchClimate() }
    catch { addToast(t('automations.smartClimate.failed'), 'error') }
  }
  const handleClimateToggle = async (room, enabled) => {
    try {
      await toggleClimate(room, enabled)
      addToast(enabled ? t('automations.smartClimate.resumed') : t('automations.smartClimate.pausedToast'), 'success')
      await refetchClimate()
    } catch { addToast(t('automations.smartClimate.failed'), 'error') }
  }
  const handleClimateDelete = async (room) => {
    try { await deleteClimate(room); addToast(t('automations.smartClimate.deleted'), 'success'); await refetchClimate() }
    catch { addToast(t('automations.smartClimate.failed'), 'error') }
  }
  const handleClimateClose = () => setClimateTarget(null)
  const handleClimateSaved = async ({ updated, removed }) => {
    setClimateTarget(null)
    addToast(
      removed ? t('automations.smartClimate.deleted')
              : (updated ? t('automations.smartClimate.updated') : t('automations.smartClimate.saved')),
      'success',
    )
    try { await refetchClimate() } catch {}
  }

  // On-demand Library item → RoutineWizard prefilled with the template's
  // steps. Saving lands it as a routine and jumps to the On-demand tab.
  const handleConfigureRoutine = (template) => {
    if (!template?.wizard_prefill) return
    setRoutineTarget(template.wizard_prefill)
  }
  const handleRoutineSave = async (data) => {
    try {
      await saveRoutine(data)
      addToast(t('routines.saved'), 'success')
      setRoutineTarget(null)
      setTab('routines')
      await fetchRoutines({ force: true })
    } catch { addToast(t('automations.failedToSave'), 'error') }
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
  // Leave Home has its own dedicated modal — route both edit and view to it.
  const isLeaveHome = (a) => a?.id === 'ziggy_leave_home' || a?.id === 'leave_home' || (a?.name || '').toLowerCase() === 'leave home'
  const openLeaveHome = async (automation) => {
    const securityAlert = automations.some(a => a.id === 'ziggy_leave_home_alert')
    try { const config = await loadAutomationConfig(automation.id); setLeaveHomeTarget({ _isInstalled: true, securityAlert, ...(config || automation) }) }
    catch { setLeaveHomeTarget({ _isInstalled: true, securityAlert, ...automation }) }
  }
  const handleEdit = async (automation) => {
    if (isLeaveHome(automation)) return openLeaveHome(automation)
    try { const config = await loadAutomationConfig(automation.id); setEditTarget(config || automation) }
    catch { setEditTarget(automation) }
    setShowWizard(true)
  }
  const handleView = async (automation) => {
    if (isLeaveHome(automation)) return openLeaveHome(automation)
    try { const config = await loadAutomationConfig(automation.id); setViewTarget(config || automation) }
    catch { setViewTarget(automation) }
  }
  const handleLeaveHomeSaved = async ({ updated, removed }) => {
    setLeaveHomeTarget(null)
    addToast(removed ? t('automations.leaveHome.deleted')
             : (updated ? t('automations.leaveHome.updated') : t('automations.leaveHome.saved')), 'success')
    await fetchAutomations({ force: true })
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
        {/* Library is page-level (serves both tabs); the ➕ is the custom-create
            path — it asks Automatic vs On-demand, then opens the blank wizard. */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          <button onClick={() => setShowLibrary(true)} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>
            {t('automations.library')}
          </button>
          <button
            onClick={() => setShowCreateChooser(true)}
            className="z-btn-primary"
            aria-label={t('automations.createChooserTitle')}
            style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>

      {/* Tab switcher — two tabs on one conceptual line: what runs
          automatically (Automations) vs what you trigger (Routines). Library
          and Suggested moved into the Automations tab as a modal + inline
          nudges; Quick-asks split out to Chat/Dashboard chips. */}
      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 13, marginBottom: 20, overflowX: 'auto' }}>
        {[
          { id: 'automations', label: t('automations.tabAutomatic'),  count: enabled },
          { id: 'routines',    label: t('automations.tabOnDemand'),   count: routines.length },
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

      {/* Habit-learned suggestions — inline nudges here, full list in the
          Suggestions inbox modal. "Later" snoozes (stays in the inbox), ✕
          rejects. Self-hides when nothing is pending. */}
      <SuggestionNudgeStrip
        suggestions={suggestions}
        onConfigure={handleConfigureSuggestion}
        onReject={async id => { try { await reject(id); addToast(t('automations.suggested.dismissed'), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
        onSnooze={async (id, days) => { try { await snooze(id, days); addToast(t('automations.suggested.snoozedFor', { n: days }), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
        onOpenInbox={() => setShowSuggestions(true)}
      />

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
            <button onClick={() => setShowLibrary(true)} className="z-btn-primary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>{t('automations.library')}</button>
          </div>
        </div>
      )}

      {/* ── Section: Your automations ───────────────────────────────────── */}
      {automations.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p className="z-eyebrow" style={{ marginBottom: 10 }}>{t('automations.myAutomations')}</p>
          <AnimatePresence mode="popLayout">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {circadianStatus && (circadianStatus.lights || []).length > 0 && (
                <CircadianGroupRow
                  status={circadianStatus}
                  onToggle={handleCircadianToggle}
                  onSync={handleCircadianSync}
                  onView={() => setShowCircadianView(true)}
                  onEdit={handleEditCircadian}
                  onDelete={handleCircadianDelete}
                />
              )}
              {Object.entries(climateStatus?.rooms || {}).map(([room, slice]) => (
                <ClimateGroupRow
                  key={`climate-${room}`}
                  status={slice}
                  onToggle={(enabled) => handleClimateToggle(room, enabled)}
                  onSync={() => handleClimateSync(room)}
                  onView={() => setClimateView({ room, slice })}
                  onEdit={() => handleEditClimate(room, slice)}
                  onDelete={() => handleClimateDelete(room)}
                />
              ))}
              {smartRoomGroups.map(group => (
                <SmartRoomGroupRow
                  key={group.room}
                  group={group}
                  onToggleAll={(toEnabled) => handleSmartRoomToggleAll(group, toEnabled)}
                  onView={() => setSmartRoomView(group.room)}
                  onEdit={() => setSmartRoomView(group.room)}
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

      {/* ─── Routines tab ─── */}
      {tab === 'routines' && (
        <motion.div
          key="routines"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >
          <RoutinesListPanel embedded />
        </motion.div>
      )}

      </AnimatePresence>

      {/* Library — OOTB curated templates + community blueprints. Relocated
          from the old Templates tab into a modal so the Automations tab stays a
          clean "what's running" list. Configuring one closes the library and
          hands off to the matching wizard. */}
      <Modal open={showLibrary} onClose={() => setShowLibrary(false)} title={t('automations.libraryTitle')} maxWidth={620}>
        <TemplatesTab
          onConfigureNative={(tpl) => { setShowLibrary(false); handleConfigureTemplate(tpl) }}
          onConfigureCommunity={(blueprintId) => { setShowLibrary(false); setCommunityTarget(blueprintId) }}
          onConfigureRoutine={(tpl) => { setShowLibrary(false); handleConfigureRoutine(tpl) }}
          onSensorCreated={() => addToast(t('automations.smartSensor.created'), 'success')}
        />
      </Modal>

      {/* Header ➕ chooser — the one custom-create entry point for both kinds. */}
      <Modal open={showCreateChooser} onClose={() => setShowCreateChooser(false)} title={t('automations.createChooserTitle')} maxWidth={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { icon: '⚡', label: t('automations.tabAutomatic'), desc: t('automations.createAutomaticDesc'),
              onPick: () => { setShowCreateChooser(false); setEditTarget(null); setShowWizard(true) } },
            { icon: '👆', label: t('automations.tabOnDemand'), desc: t('automations.createOnDemandDesc'),
              onPick: () => { setShowCreateChooser(false); setRoutineTarget({ name: '', description: '', icon: '⚡', steps: [] }) } },
          ].map(opt => (
            <button key={opt.label} onClick={opt.onPick} style={{
              display: 'flex', alignItems: 'center', gap: 14, textAlign: 'start', cursor: 'pointer',
              padding: '16px 18px', borderRadius: 14, fontFamily: 'inherit',
              background: 'var(--surface-2)', border: '0.5px solid var(--line)',
            }} dir="auto">
              <span style={{ fontSize: 24, flexShrink: 0 }} aria-hidden="true">{opt.icon}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{opt.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Modal>

      {/* On-demand — Library item prefilled OR blank custom create */}
      <Modal open={!!routineTarget} onClose={() => setRoutineTarget(null)}
             title={routineTarget?.name ? t('automations.configureTitle', { name: routineTarget.name }) : t('routines.create')}>
        {routineTarget && (
          <RoutineWizard initial={routineTarget} onSave={handleRoutineSave} onClose={() => setRoutineTarget(null)} />
        )}
      </Modal>

      {/* Suggestions inbox — the full pending/history habit feed. "Later"
          snoozes (item stays here), ✕ rejects. This is where a nudge the user
          waved off inline can be re-found and added later. */}
      <Modal open={showSuggestions} onClose={() => setShowSuggestions(false)} title={t('automations.tabSuggested')} maxWidth={560}>
        <SuggestedTab
          suggestions={suggestions}
          loading={sugLoading}
          analyzing={analyzing}
          onConfigure={(s) => { setShowSuggestions(false); handleConfigureSuggestion(s) }}
          onReject={async id => { try { await reject(id); addToast(t('automations.suggested.dismissed'), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
          onSnooze={async (id, days) => { try { await snooze(id, days); addToast(t('automations.suggested.snoozedFor', { n: days }), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
          onAnalyze={async () => { try { const r = await runAnalysis(); addToast(r?.new_count > 0 ? t(r.new_count === 1 ? 'automations.suggested.foundNewOne' : 'automations.suggested.foundNew', { n: r.new_count }) : t('automations.suggested.noNewPatterns'), 'success') } catch { addToast(t('automations.suggested.analysisFailed'), 'error') } }}
        />
      </Modal>

      {/* Community templates modal — deep-linked from the Library to a single
          template's input form. Creates the automation through the standard
          save_automation path; after success we refresh the list. */}
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

      {/* Smart Light Schedule — read-only View (what it's doing right now). */}
      <Modal open={showCircadianView} onClose={() => setShowCircadianView(false)} title={t('automations.circadian.installedBadge')}>
        <CircadianViewModal
          status={circadianStatus}
          onSync={async () => { await handleCircadianSync() }}
          onEdit={handleEditCircadian}
        />
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

      {/* Smart Climate — read-only View (what it's doing in this room now). */}
      <Modal open={!!climateView} onClose={() => setClimateView(null)}
             title={climateView ? t('automations.smartClimate.cardTitle', { room: climateView.slice?.roomName || climateView.room }) : ''}>
        {climateView && (
          <ClimateViewModal
            status={climateView.slice}
            onSync={async () => { await handleClimateSync(climateView.room) }}
            onEdit={() => handleEditClimate(climateView.room, climateView.slice)}
          />
        )}
      </Modal>

      {/* Smart Climate Control wizard — pick room → reading → device band. */}
      <Modal open={!!climateTarget} onClose={handleClimateClose} title={t('automations.smartClimate.title')}>
        {climateTarget && (
          <ClimateBundleWizard
            key={climateTarget._isInstalled ? `edit-${climateTarget.room}` : 'new'}
            initial={climateTarget}
            onSaved={handleClimateSaved}
            onClose={handleClimateClose}
          />
        )}
      </Modal>

      {/* Leave Home — dedicated plain-language view/edit (one modal). */}
      <Modal open={!!leaveHomeTarget} onClose={() => setLeaveHomeTarget(null)} title={t('automations.leaveHome.title')}>
        {leaveHomeTarget && (
          <LeaveHomeWizard
            key={leaveHomeTarget._isInstalled ? 'edit' : 'new'}
            initial={leaveHomeTarget}
            onSaved={handleLeaveHomeSaved}
            onClose={() => setLeaveHomeTarget(null)}
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

      {/* Smart Room — one modal for View AND Edit: the room's automations as
          editable steps. Edit opens the standard editor per member (overwrites
          in place by id); no more full re-wizard on edit. Members derived live
          so toggles/edits reflect immediately. */}
      {(() => {
        const srGroup = smartRoomGroups.find(g => g.room === smartRoomView) || null
        return (
          <Modal open={!!smartRoomView} onClose={() => setSmartRoomView(null)}
                 title={srGroup ? t('automations.smartRoom.cardTitle', { room: srGroup.roomName }) : ''}>
            {srGroup && (
              <SmartRoomViewModal
                group={srGroup}
                onEditMember={(m) => { setSmartRoomView(null); handleEdit(m) }}
                onToggleMember={async (m, en) => {
                  try { await toggleAutomation(m.id, en); await fetchAutomations({ force: true }) }
                  catch { addToast(t('automations.failedToTrigger'), 'error') }
                }}
                onDelete={async () => { setSmartRoomView(null); await handleSmartRoomDelete(srGroup) }}
              />
            )}
          </Modal>
        )
      })()}

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
