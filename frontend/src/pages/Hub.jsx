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
import '../components/hub/Hub.css'

function PairDialog({ onClose, onPaired }) {
  const [code,    setCode]    = useState('')
  const [name,    setName]    = useState('')
  const [room,    setRoom]    = useState('')
  const [error,   setError]   = useState('')
  const [busy,    setBusy]    = useState(false)

  const submit = async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code from Settings.'); return }
    if (!name.trim())                  { setError('Give this tablet a name (e.g. "Kitchen Tablet").'); return }
    setBusy(true)
    try {
      const res = await claimHubPairCode(code.trim(), name.trim(), room.trim() || null)
      setTabletId(res.tablet_id)
      onPaired(res)
    } catch (err) {
      setError(err?.userMessage || 'Pairing failed. Generate a fresh code and try again.')
    } finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      padding: 20,
    }}>
      <form onSubmit={submit} style={{
        width: '100%', maxWidth: 380, background: 'var(--surface)',
        border: '0.5px solid var(--line)', borderRadius: 16, padding: 22,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div>
          <p className="z-eyebrow" style={{ margin: 0 }}>Pair this tablet</p>
          <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 600 }}>Enter the 6-digit code</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-faint)' }}>
            An admin generates the code in Settings → Tablets. Codes expire after 5 minutes.
          </p>
        </div>
        <input
          inputMode="numeric" autoFocus maxLength={6}
          placeholder="000000"
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center',
                   padding: '12px 14px', borderRadius: 10, border: '0.5px solid var(--line)',
                   background: 'var(--bg)', color: 'var(--ink)' }}
        />
        <input
          placeholder="Tablet name (e.g. Kitchen Tablet)"
          value={name} onChange={e => setName(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)',
                   background: 'var(--bg)', color: 'var(--ink)', fontSize: 14 }}
        />
        <input
          placeholder="Room (optional)"
          value={room} onChange={e => setRoom(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--line)',
                   background: 'var(--bg)', color: 'var(--ink)', fontSize: 14 }}
        />
        {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}
                  style={{ background: 'transparent', border: '0.5px solid var(--line)',
                           borderRadius: 999, padding: '10px 18px', cursor: 'pointer',
                           color: 'var(--ink)' }}>Cancel</button>
          <button type="submit" disabled={busy}
                  style={{ background: 'var(--accent, #4f46e5)', border: 'none',
                           borderRadius: 999, padding: '10px 22px', cursor: 'pointer',
                           color: 'white', fontWeight: 600 }}>
            {busy ? 'Pairing…' : 'Pair'}
          </button>
        </div>
      </form>
    </div>
  )
}

function PairBanner({ onOpen }) {
  return (
    <div className="z-hub-banner">
      <div className="z-hub-banner-text">
        This device isn't paired as a tablet yet — editing is disabled.
      </div>
      <button onClick={onOpen}>Pair tablet</button>
    </div>
  )
}

// ─── Status strip ────────────────────────────────────────────────────────────

function StatusStrip({ layoutName, error, onRetry, tabletId, editing, onEdit, onCancel, onDone }) {
  return (
    <div className="z-hub-strip">
      <div className="z-hub-strip-left">
        <div>
          <div className="z-hub-strip-sub">Ziggy Hub</div>
          <div className="z-hub-strip-title">{editing ? 'Editing layout' : (layoutName || 'Loading…')}</div>
        </div>
      </div>
      <div className="z-hub-strip-right">
        {error && !editing && (
          <button onClick={onRetry} title={error}>Retry</button>
        )}
        {editing ? (
          <>
            <button onClick={onCancel}>Cancel</button>
            <button onClick={onDone} className="primary">Done</button>
          </>
        ) : (
          tabletId && <button onClick={onEdit}>Edit</button>
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
        <p style={{ padding: 24, color: 'var(--ink-faint)', fontSize: 13 }}>Loading…</p>
      ) : (
        <div className="z-hub-grid">
          <LayoutRenderer />
        </div>
      )}
      {editing && (
        <button className="z-hub-add-fab" onClick={() => setPickerOpen(true)} aria-label={t('hub.addSection')}>+</button>
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
