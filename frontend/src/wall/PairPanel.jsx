// Tablet pairing, from the tablet's side.
//
// An unpaired tablet still renders the whole wall — it just can't persist a
// layout, because layouts are keyed by tablet_id. So this is a dismissible
// banner rather than a blocking gate: a wall panel that refuses to show the
// house until someone finds an admin is worse than one that works and nags.

import { memo, useCallback, useState } from 'react'
import { claimWallPairCode } from '../lib/api'
import { setTabletId } from '../lib/hubTablet'
import { useT } from '../lib/i18n'

export const PairBanner = memo(function PairBanner({ onOpen, onDismiss }) {
  const t = useT()
  return (
    <div style={{
      flex: 'none', display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px clamp(14px,2vw,30px)',
      background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
      color: 'var(--ink)', fontSize: 12.5,
    }}>
      <span style={{ flex: 1 }}>{t('wall.notPaired')}</span>
      <button className="zw-btn is-on" onClick={onOpen}>{t('wall.pairTablet')}</button>
      <button className="zw-btn zw-btn-icon" onClick={onDismiss} aria-label={t('common.close')}>✕</button>
    </div>
  )
})

export const PairDialog = memo(function PairDialog({ open, onClose, onPaired }) {
  const t = useT()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [room, setRoom] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code from Settings → Tablets.'); return }
    if (!name.trim()) { setError('Give this tablet a name, e.g. "Kitchen".'); return }
    setBusy(true)
    try {
      const res = await claimWallPairCode(code.trim(), name.trim(), room.trim() || null)
      setTabletId(res.tablet_id)
      onPaired?.(res)
    } catch (err) {
      setError(err?.userMessage || 'Pairing failed. Generate a fresh code and try again.')
    } finally { setBusy(false) }
  }, [code, name, room, onPaired])

  if (!open) return null

  const field = {
    padding: '11px 13px', borderRadius: 10, border: '0.5px solid var(--line)',
    background: 'var(--bg)', color: 'var(--ink)', fontSize: 14, font: 'inherit',
    WebkitUserSelect: 'text', userSelect: 'text',
  }

  return (
    <div className="zw-scrim" onClick={onClose}>
      <form
        className="zw-modal"
        style={{ width: 'min(400px, 92vw)', padding: 22, gap: 14 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div>
          <div className="zw-eyebrow">{t('wall.pairTablet')}</div>
          <div className="zw-modal-title" style={{ marginTop: 4 }}>Enter the 6-digit code</div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 6 }}>
            An admin generates it in Settings → Tablets. Codes expire after 5 minutes.
          </div>
        </div>
        <input
          inputMode="numeric" autoFocus maxLength={6} placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          style={{ ...field, fontSize: 28, letterSpacing: 8, textAlign: 'center' }}
        />
        <input placeholder="Tablet name (e.g. Kitchen)" value={name}
               onChange={(e) => setName(e.target.value)} style={field} />
        <input placeholder="Room (optional)" value={room}
               onChange={(e) => setRoom(e.target.value)} style={field} />
        {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="zw-btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="zw-btn is-on" disabled={busy}>
            {busy ? '…' : t('wall.pairTablet')}
          </button>
        </div>
      </form>
    </div>
  )
})
