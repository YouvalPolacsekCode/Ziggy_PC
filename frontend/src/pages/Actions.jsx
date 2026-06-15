import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Modal } from '../components/ui/Modal'
import { useAutomationStore } from '../stores/automationStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useUIStore } from '../stores/uiStore'
import { useDeviceStore } from '../stores/deviceStore'
import { getSuggestedTemplates, getSuggestionsFeed, deleteCircadianBundle } from '../lib/api'
import { RoutinesListPanel } from './Routines'
import QuickAsks from './QuickAsks'
import { useT } from '../lib/i18n'
import AutomationWizard from '../components/automations/wizard/AutomationWizard'
import AutomationViewModal from '../components/automations/AutomationViewModal'
import AutomationCard from '../components/automations/AutomationCard'
import CircadianBundleWizard from '../components/automations/CircadianBundleWizard'
import CircadianGroupRow from '../components/automations/CircadianGroupRow'
import TemplateCard from '../components/automations/templates/TemplateCard'
import LibraryModal from '../components/automations/templates/LibraryModal'
import SuggestedTab, { suggestionToWizardData } from '../components/automations/templates/SuggestedTab'

// Module-level cache so the Recommended-by-Ziggy block doesn't re-flash empty
// every time the user navigates away and back. SuggestedTemplates lives in
// local component state (no store), so its cache must live outside the render.
let suggestedTemplatesCache = null

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
  const [suggestedTemplates, setSuggestedTemplates] = useState(suggestedTemplatesCache || [])
  const [showLibrary,       setShowLibrary]       = useState(false)
  // Circadian bundle wizard — opened by Configure on the Smart Light Schedule
  // template, or by Edit on the grouped row in the Your-Automations section.
  // Carries the prefill (defaults.lights, defaults.bedtime) and an
  // _isInstalled flag so the wizard can show "Update" + "Remove" rather than
  // "Activate".
  const [circadianTarget,   setCircadianTarget]   = useState(null)
  // Recommended section sits at the top of the Automations tab but is
  // COLLAPSED by default — users come here for their own automations, not to
  // be sold templates. The header strip is enough of a discoverability hint;
  // clicking it expands the template cards.
  const [recommendedOpen,   setRecommendedOpen]   = useState(false)

  const roomNameMap = Object.fromEntries(ziggyRooms.map(r => [r.id, r.name]))
  const pendingSuggestions = suggestions.filter(s => s.status === 'pending')
  // Templates the user hasn't already configured. Used by the Recommended
  // section in the Automations tab and to decide whether to skip the
  // 0-automations empty state (when there are templates to try, the empty
  // state would just be noise above them).
  const recommendedTemplates = suggestedTemplates.filter(tpl => !tpl.already_exists)

  // Group the 4 ziggy_circadian_* automations behind a single "Smart Light
  // Schedule" row in the Your-Automations section. The user sees one
  // toggleable feature, not 4 cryptic clock entries. Member IDs and shared
  // lights/bedtime are derived from the bedtime automation's trigger time
  // and any member's light targets (all 4 share the same light set on save).
  const { circadianGroup, visibleAutomations } = useMemo(() => {
    const members = automations.filter(a => a.id?.startsWith('ziggy_circadian_'))
    if (members.length === 0) return { circadianGroup: null, visibleAutomations: automations }
    const visible = automations.filter(a => !a.id?.startsWith('ziggy_circadian_'))

    const bedtimeAuto = members.find(a => a.id === 'ziggy_circadian_bedtime')
    const bedtime = bedtimeAuto?.trigger?.time?.slice(0, 5) || '22:00'
    const lightSet = new Set()
    members.forEach(m => (m.actions || []).forEach(act => {
      const eid = act.entity_id
      if (typeof eid === 'string' && eid.startsWith('light.')) lightSet.add(eid)
      else if (Array.isArray(eid)) eid.forEach(x => x?.startsWith?.('light.') && lightSet.add(x))
    }))
    const lights = Array.from(lightSet)
    const allEnabled = members.every(m => m.enabled)
    const anyEnabled = members.some(m => m.enabled)

    return {
      circadianGroup: { members, lights, bedtime, allEnabled, anyEnabled, count: members.length },
      visibleAutomations: visible,
    }
  }, [automations])

  // Only fetch what isn't cached. Re-fetching on every revisit toggles the
  // store's `loading` flag, which flashes skeleton placeholders mid-mount and
  // makes navigation feel jumpy. Stores persist within the SPA session, so a
  // cache check is enough; data refreshes on explicit user action elsewhere.
  useEffect(() => {
    if (automations.length === 0)        fetchAutomations()
    if (routines.length === 0)           fetchRoutines()

    // Prefer the unified Suggested-tab feed (one fetch covers both habit
    // suggestions and device-template suggestions). Fall back to the two
    // legacy endpoints if /suggestions/feed errors — that path remains
    // identical to the pre-Gap 4 behaviour so an outage of the new endpoint
    // can't blank the tab.
    const needsHabits    = suggestions.length === 0
    const needsTemplates = suggestedTemplates.length === 0 && !suggestedTemplatesCache
    if (!needsHabits && !needsTemplates) return

    getSuggestionsFeed()
      .then(resp => {
        const items = Array.isArray(resp?.items) ? resp.items : []
        if (needsHabits) {
          setSuggestionsFromFeed(items)
        }
        if (needsTemplates) {
          const templates = items
            .filter(it => it && it.source === 'template')
            .map(it => it.raw)
            .filter(Boolean)
          suggestedTemplatesCache = templates
          setSuggestedTemplates(templates)
        }
      })
      .catch(() => {
        // Fallback path — two separate fetches against the legacy endpoints.
        if (needsHabits) fetchSuggestions()
        if (needsTemplates) {
          getSuggestedTemplates()
            .then(r => {
              const arr = r.suggested || []
              suggestedTemplatesCache = arr
              setSuggestedTemplates(arr)
            })
            .catch(() => {})
        }
      })
  }, [])

  const handleConfigureTemplate = (template) => {
    if (!template.wizard_prefill) return
    // Bundle templates (e.g. Smart Light Schedule) take the wizard schema
    // off the rails — route them to a dedicated wizard instead.
    if (template.wizard_prefill.bundle === 'circadian') {
      setCircadianTarget({ ...template.wizard_prefill, _templateId: template.id, _isInstalled: false })
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
      defaults: { lights: group.lights, bedtime: group.bedtime },
    })
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
    try {
      const r = await getSuggestedTemplates()
      const arr = r.suggested || []
      suggestedTemplatesCache = arr
      setSuggestedTemplates(arr)
    } catch {}
  }

  // Accepting a suggestion opens the wizard pre-filled with the suggestion's
  // trigger + actions so the user can review/edit before the automation lands.
  // The suggestion itself is only marked accepted after a successful save —
  // dismissing the wizard leaves the suggestion pending so it stays in the inbox.
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
      // Refresh suggested templates so anything that's now `already_exists`
      // drops out of the Recommended-by-Ziggy banner and the Library.
      try {
        const r = await getSuggestedTemplates()
        const arr = r.suggested || []
        suggestedTemplatesCache = arr
        setSuggestedTemplates(arr)
      } catch {}
    } catch { addToast(t('automations.failedToSave'), 'error') }
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
          <button onClick={() => setShowLibrary(true)} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            {t('automations.library')}
          </button>
          <button onClick={() => { setEditTarget(null); setShowWizard(true) }} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            {t('automations.headerAdd')}
          </button>
        </div>
      </div>

      {/* Tab switcher — segmented pill style. Three tabs: the umbrella's
          three concepts (automations / routines / quick-asks). Suggested
          and Recommended-by-Ziggy live as sections INSIDE the Automations
          tab so users don't have to bounce between tabs to see what Ziggy
          thinks they should set up. */}
      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 13, marginBottom: 20 }}>
        {[
          { id: 'automations', label: t('automations.tabActive'),     count: automations.filter(a => a.enabled).length },
          { id: 'routines',    label: t('automations.tabRoutines'),   count: routines.length },
          { id: 'quick-asks',  label: t('automations.tabQuickAsks'),  count: 0 },
        ].map(tabDef => (
          <button key={tabDef.id} onClick={() => setTab(tabDef.id)} style={{
            flex: 1, padding: '8px 0', borderRadius: 10, fontFamily: 'inherit', cursor: 'pointer',
            background: tab === tabDef.id ? 'var(--surface)' : 'transparent',
            border: 'none', fontSize: 13, fontWeight: 600,
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

      {/* Tab bodies — AnimatePresence with mode="wait" makes switches feel
          intentional instead of jumpy. Old tab fades out before new fades in,
          so the page never reflows mid-transition. Snappy 140ms each way. */}
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

      {/* Loading skeleton — only the first paint. Once any data has loaded
          (even an empty list), the real sections take over so we don't flash
          skeletons on every WS reconnect. */}
      {loading && automations.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 82, borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty state — only when there's *nothing* to show. If recommended
          templates exist, we skip the empty state since the Recommended
          section below acts as the gentle onboarding nudge. */}
      {!loading && automations.length === 0 && recommendedTemplates.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>{t('automations.empty')}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>{t('automations.emptyHint')}</p>
          <button onClick={() => setShowWizard(true)} className="z-btn-secondary" style={{ padding: '8px 14px', borderRadius: 9, fontFamily: 'inherit' }}>{t('automations.createAutomation')}</button>
        </div>
      )}

      {/* ── Section: Recommended templates (OOTB, device-matched) ─────────
            Top of the Automations tab — collapsed by default. The clickable
            eyebrow + count + chevron acts as a peek; expanding reveals the
            first 5 templates plus a link to the full Library. */}
      {recommendedTemplates.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => setRecommendedOpen(v => !v)}
            aria-expanded={recommendedOpen}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
              fontFamily: 'inherit',
            }}
          >
            <p className="z-eyebrow" style={{ margin: 0 }}>{t('automations.recommended')}</p>
            <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{recommendedTemplates.length}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: recommendedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <AnimatePresence>
            {recommendedOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {recommendedTemplates.slice(0, 5).map(tpl => (
                    <TemplateCard key={tpl.id} template={tpl} onConfigure={handleConfigureTemplate} />
                  ))}
                  {recommendedTemplates.length > 5 && (
                    <button onClick={() => setShowLibrary(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', padding: '8px 0', fontFamily: 'inherit' }}>
                      {t('automations.moreInLibrary', { n: recommendedTemplates.length - 5 })}
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
              {visibleAutomations.map(a => (
                <AutomationCard key={a.id} automation={a} offlineEntityIds={offlineEntityIds}
                  onToggle={toggleAutomation} onView={handleView} onEdit={handleEdit} onDelete={handleDelete}
                  onTrigger={async id => { try { await triggerAutomation(id); addToast(t('automations.triggered'), 'success') } catch { addToast(t('automations.failedToTrigger'), 'error') } }} />
              ))}
            </div>
          </AnimatePresence>
        </div>
      )}

      {/* ── Section: Suggested by Ziggy (habit-based) ───────────────────── */}
      {pendingSuggestions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p className="z-eyebrow" style={{ marginBottom: 10 }}>{t('automations.tabSuggested')}</p>
          <SuggestedTab
            suggestions={suggestions}
            loading={sugLoading}
            analyzing={analyzing}
            onConfigure={handleConfigureSuggestion}
            onReject={async id => { try { await reject(id); addToast(t('automations.suggested.dismissed'), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
            onSnooze={async (id, days) => { try { await snooze(id, days); addToast(t('automations.suggested.snoozedFor', { n: days }), 'success') } catch { addToast(t('automations.suggested.failed'), 'error') } }}
            onAnalyze={async () => { try { const r = await runAnalysis(); addToast(r?.new_count > 0 ? t(r.new_count === 1 ? 'automations.suggested.foundNewOne' : 'automations.suggested.foundNew', { n: r.new_count }) : t('automations.suggested.noNewPatterns'), 'success') } catch { addToast(t('automations.suggested.analysisFailed'), 'error') } }}
          />
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

      {/* Page-level modals — triggered from multiple tabs (Library/Configure
          flow originates from both Active "Library" button and Suggested
          template cards), so they must render outside any tab gate. */}
      <LibraryModal
        open={showLibrary}
        onClose={() => setShowLibrary(false)}
        onConfigure={handleConfigureTemplate}
      />

      <Modal open={showWizard} onClose={handleClose} title={
        editTarget?._fromSuggestion ? t('automations.reviewTitle', { name: editTarget.name }) :
        editTarget?._isTemplate ? t('automations.configureTitle', { name: editTarget.name }) :
        editTarget ? t('automations.editTitle', { name: editTarget.name }) : t('automations.newCustom')
      }>
        <AutomationWizard key={editTarget?.id || '__new__'} initial={editTarget} onSave={handleSave} onClose={handleClose} />
      </Modal>

      {/* Smart Light Schedule (circadian) wizard — separate modal so its
          dedicated 2-field layout doesn't have to coexist with the
          single-trigger AutomationWizard. */}
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
