// Hub — the tablet-only Dynamic Hub Dashboard.
//
// Mounted at /hub, OUTSIDE AppShell. The existing Dashboard (/), Rooms,
// Devices, and every other page are untouched: this is an additive new
// surface for paired wall tablets. Phones and web users never navigate
// here unless they manually open the URL.
//
// Edit mode (slice 2): paired tablets get an Edit button in the status
// strip. Editing shows ↑/↓/size/× overlays per section and a floating "+"
// to add new ones. Cancel discards; Done saves to the server with
// optimistic update + rollback in hubStore.

import { useEffect, useState } from 'react'
import { useHubStore } from '../stores/hubStore'
import { getTabletId, setTabletId } from '../lib/hubTablet'
import { hubTabletHeartbeat, claimHubPairCode } from '../lib/api'
import LayoutRenderer from '../components/hub/LayoutRenderer'
import { SectionPickerModal } from '../components/hub/EditOverlay'
import { SectionConfigSheet } from '../components/hub/SectionConfigSheet'
import { useT } from '../lib/i18n'
import { Plus } from 'lucide-react'
import { Input } from '../components/ui/Input'
import '../components/hub/Hub.css'

function PairDialog({ onClose, onPaired }) {
  const t = useT()
  const [code,    setCode]    = useState('')
  const [name,    setName]    = useState('')
  const [room,    setRoom]    = useState('')
  const [error,   setError]   = useState('')
  const [busy,    setBusy]    = useState(false)

  const submit = async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!/^\d{6}$/.test(code.trim())) { setError(t('hub.pair.errCode')); return }
    if (!name.trim())                  { setError(t('hub.pair.errName')); return }
    setBusy(true)
    try {
      const res = await claimHubPairCode(code.trim(), name.trim(), room.trim() || null)
      setTabletId(res.tablet_id)
      onPaired(res)
    } catch (err) {
      setError(err?.userMessage || t('hub.pair.errFailed'))
    } finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'var(--backdrop)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      padding: 20,
    }}>
      <form onSubmit={submit} style={{
        width: '100%', maxWidth: 400, background: 'var(--surface)',
        border: '0.5px solid var(--line)', borderRadius: 'var(--r-sheet)', padding: 24,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div>
          <p className="z-eyebrow" style={{ margin: 0 }}>{t('hub.pair.eyebrow')}</p>
          <h2 className="z-title" style={{ margin: '4px 0 0' }}>{t('hub.pair.title')}</h2>
          <p className="z-subhead" style={{ margin: '8px 0 0' }}>
            {t('hub.pair.help')}
          </p>
        </div>
        <input
          inputMode="numeric" autoFocus maxLength={6}
          placeholder="000000"
          aria-label={t('hub.pair.codeLabel')}
          className="z-code"
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          style={{ fontSize: 34, fontWeight: 700, lineHeight: '41px', letterSpacing: '0.2em', textAlign: 'center',
                   padding: '12px 16px', minHeight: 44, borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)',
                   background: 'var(--surface)', color: 'var(--ink)', outline: 'none', width: '100%', boxSizing: 'border-box' }}
        />
        <Input
          label={t('hub.pair.nameLabel')}
          placeholder={t('hub.pair.namePlaceholder')}
          value={name} onChange={e => setName(e.target.value)}
        />
        <Input
          label={t('hub.pair.roomLabel')}
          placeholder={t('hub.pair.roomPlaceholder')}
          value={room} onChange={e => setRoom(e.target.value)}
        />
        {error && <div role="alert" style={{ color: 'var(--err-text)', fontSize: 15, lineHeight: '20px' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy} className="z-btn-secondary z-button">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy} className="z-btn-primary z-button">
            {busy ? t('hub.pair.pairing') : t('hub.pair.pair')}
          </button>
        </div>
      </form>
    </div>
  )
}

function PairBanner({ onOpen }) {
  const t = useT()
  return (
    <div className="z-hub-banner">
      <div className="z-hub-banner-text">
        {t('hub.pair.bannerText')}
      </div>
      <button onClick={onOpen} className="z-btn-secondary z-button">{t('hub.pair.bannerAction')}</button>
    </div>
  )
}

// ─── Status strip ────────────────────────────────────────────────────────────

// Hub.css styles `.z-hub-strip button` (capsule, 13px, accent primary) with
// higher specificity than the shared button classes, so the strip's buttons
// carry their tokens inline: secondary = surface + hairline, the one primary
// (Done) = ink on bg. 36px tall on the strip; the page rule lifts to 44 on touch.
const stripBtn = {
  background: 'var(--surface)', color: 'var(--ink)', border: '0.5px solid var(--line)',
  borderRadius: 'var(--r-ctl)', padding: '8px 16px', minHeight: 36,
  fontSize: 15, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
}
const stripBtnPrimary = { ...stripBtn, background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontWeight: 600 }

function StatusStrip({ layoutName, error, onRetry, tabletId, editing, onEdit, onCancel, onDone }) {
  const t = useT()
  return (
    <div className="z-hub-strip">
      <div className="z-hub-strip-left">
        <div>
          <div className="z-hub-strip-sub" style={{ fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--ink-mute)' }}>{t('hub.strip.brand')}</div>
          <div className="z-hub-strip-title" style={{ fontSize: 17, lineHeight: '22px' }}>{editing ? t('hub.strip.editing') : (layoutName || t('common.loading'))}</div>
        </div>
      </div>
      <div className="z-hub-strip-right">
        {error && !editing && (
          <button onClick={onRetry} title={error} style={stripBtn}>{t('common.retry')}</button>
        )}
        {editing ? (
          <>
            <button onClick={onCancel} style={stripBtn}>{t('common.cancel')}</button>
            <button onClick={onDone} style={stripBtnPrimary}>{t('common.done')}</button>
          </>
        ) : (
          tabletId && <button onClick={onEdit} style={stripBtn}>{t('common.edit')}</button>
        )}
      </div>
    </div>
  )
}

export default function Hub() {
  const t = useT()
  const layout      = useHubStore(s => s.layout)
  const draft       = useHubStore(s => s.draft)
  const loading     = useHubStore(s => s.loading)
  const error       = useHubStore(s => s.error)
  const editing     = useHubStore(s => s.editing)
  const fetchLayout = useHubStore(s => s.fetchLayout)
  const startEdit   = useHubStore(s => s.startEdit)
  const cancelEdit  = useHubStore(s => s.cancelEdit)
  const commitEdit  = useHubStore(s => s.commitEdit)
  const clearError  = useHubStore(s => s.clearError)
  const configuringSectionId = useHubStore(s => s.configuringSectionId)
  const closeConfig          = useHubStore(s => s.closeConfig)
  // Drag-reorder — Hub owns the global pointer listeners so the dragged
  // section can roam the entire page without each section needing handlers.
  const dragId    = useHubStore(s => s.dragId)
  const hoverDrag = useHubStore(s => s.hoverDrag)
  const endDrag   = useHubStore(s => s.endDrag)

  // Track paired/unpaired status reactively — Settings can pair while the Hub
  // is open in another tab; we want the banner to vanish without a refresh.
  const [tabletId, setLocalTabletId] = useState(getTabletId())
  const [pairOpen, setPairOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    fetchLayout()
    // Heartbeat so the Settings tablets list shows accurate last-seen.
    const id = getTabletId()
    if (id) hubTabletHeartbeat(id).catch(() => {})
    const beat = id ? setInterval(() => hubTabletHeartbeat(id).catch(() => {}), 60_000) : null
    // Re-check tablet_id on visibility — pairing flow flips localStorage.
    const onVis = () => setLocalTabletId(getTabletId())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      if (beat) clearInterval(beat)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [fetchLayout])

  const onRetry  = () => { clearError(); fetchLayout() }
  const onPaired = () => { setLocalTabletId(getTabletId()); setPairOpen(false); fetchLayout() }

  // Global drag listeners — only active while a section is being dragged.
  // pointermove hit-tests via document.elementFromPoint → closest section,
  // and hoverDrag handles the swap (no-op if hover target is unchanged).
  // pointerup / pointercancel both end the drag so a finger lift outside any
  // section or a system-cancel (e.g. iOS notification banner) doesn't leave
  // the UI stuck in dragging state.
  useEffect(() => {
    if (!dragId) return
    const findSection = (x, y) => {
      const el = document.elementFromPoint(x, y)
      const node = el?.closest?.('[data-section-id]')
      return node?.getAttribute?.('data-section-id') || null
    }
    const onMove = (e) => {
      const id = findSection(e.clientX, e.clientY)
      if (id) hoverDrag(id)
    }
    const onUp = () => endDrag()
    window.addEventListener('pointermove',  onMove,  { passive: true })
    window.addEventListener('pointerup',    onUp,    { passive: true })
    window.addEventListener('pointercancel', onUp,   { passive: true })
    return () => {
      window.removeEventListener('pointermove',  onMove)
      window.removeEventListener('pointerup',    onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragId, hoverDrag, endDrag])

  return (
    <div className={`z-hub-page${editing ? ' is-editing' : ''}`}
         dir={document?.documentElement?.dir || 'ltr'}>
      <StatusStrip
        layoutName={layout?.name}
        error={error}
        onRetry={onRetry}
        tabletId={tabletId}
        editing={editing}
        onEdit={startEdit}
        onCancel={cancelEdit}
        onDone={commitEdit}
      />
      {!tabletId && !editing && <PairBanner onOpen={() => setPairOpen(true)} />}
      {loading && !layout ? (
        <p className="z-subhead" style={{ padding: 24 }}>{t('common.loading')}</p>
      ) : (
        <div className="z-hub-grid">
          <LayoutRenderer />
        </div>
      )}
      {editing && (
        <button className="z-hub-add-fab" onClick={() => setPickerOpen(true)} aria-label={t('hub.addSection')}>
          <Plus size={24} strokeWidth={2} />
        </button>
      )}
      <SectionPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} />
      {editing && configuringSectionId && (
        <SectionConfigSheet
          section={(draft?.sections || []).find(s => s.id === configuringSectionId)}
          onClose={closeConfig}
        />
      )}
      {pairOpen && <PairDialog onClose={() => setPairOpen(false)} onPaired={onPaired} />}
    </div>
  )
}
