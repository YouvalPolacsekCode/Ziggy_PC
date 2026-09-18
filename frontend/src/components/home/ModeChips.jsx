import { useEffect, useState } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { useUIStore } from '../../stores/uiStore'
import { useT } from '../../lib/i18n'
import { Modal } from '../ui/Modal'

// ─────────────────────────────────────────────────────────────────────────────
// ModeChips — the five fixed home modes as a chip row.
//
// One surface for a concept that used to be three unrelated things (a
// side-effect-free "house mode", flags the chat designer invented that
// nothing read, and a per-light power-cut memory). A chip is filled when its
// mode is on and shows "until HH:MM" for the timed ones. Tapping Movie or
// Cleaning while off asks for a duration; everything else flips at once.
// Reads/writes deviceStore.modes, which the `mode_changed` WS event keeps
// live across every screen and device.
// ─────────────────────────────────────────────────────────────────────────────

const ORDER = ['sleep', 'movie', 'cleaning', 'guest', 'vacation']
const TIMED = new Set(['movie', 'cleaning'])

function fmtUntil(until) {
  if (!until) return ''
  return new Date(until * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function ModeChips({ dense = false }) {
  const t = useT()
  const modes        = useDeviceStore(s => s.modes)
  const fetchModes   = useDeviceStore(s => s.fetchModes)
  const setModeState = useDeviceStore(s => s.setModeState)
  const addToast     = useUIStore(s => s.addToast)
  const [picker, setPicker] = useState(null)   // the mode awaiting a duration
  const [busy, setBusy]     = useState(null)

  useEffect(() => { fetchModes() }, [])

  const list = ORDER.map(id => modes.find(m => m.id === id)).filter(Boolean)
  if (list.length === 0) return null

  const flip = async (m, on, hours = null) => {
    setBusy(m.id)
    try { await setModeState(m.id, on, hours) }
    catch { addToast(t('modes.failed'), 'error') }
    finally { setBusy(null) }
  }
  const onTap = (m) => {
    if (busy) return
    if (m.on) return flip(m, false)
    if (TIMED.has(m.id)) return setPicker(m)
    return flip(m, true)
  }

  return (
    <>
      <div role="group" aria-label={t('modes.title')}
        style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBlock: 2, scrollbarWidth: 'none' }}>
        {list.map(m => {
          const on = !!m.on
          return (
            <button key={m.id} type="button" aria-pressed={on} onClick={() => onTap(m)}
              disabled={busy === m.id} title={t(`modes.effect.${m.id}`)}
              style={{
                minHeight: dense ? 36 : 40, padding: dense ? '0 12px' : '0 14px', borderRadius: 999,
                whiteSpace: 'nowrap', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: on ? 'var(--accent, var(--info))' : 'var(--surface-2, var(--bg))',
                color: on ? 'white' : 'var(--ink)',
                border: `0.5px solid ${on ? 'transparent' : 'var(--line)'}`,
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                opacity: busy === m.id ? 0.7 : 1,
              }}>
              <span>{t(`modes.${m.id}`)}</span>
              {on && m.until && (
                <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>
                  {t('modes.until', { t: fmtUntil(m.until) })}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <Modal open={!!picker} onClose={() => setPicker(null)}
        title={picker ? t('modes.pickDuration', { mode: t(`modes.${picker.id}`) }) : ''}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[[1, 'modes.hours1'], [2, 'modes.hours2'], [3, 'modes.hours3'], [null, 'modes.untilOff']].map(([h, k]) => (
            <button key={k} type="button" className="z-btn-secondary" style={{ minHeight: 44 }}
              onClick={() => { const m = picker; setPicker(null); flip(m, true, h) }}>
              {t(k)}
            </button>
          ))}
        </div>
      </Modal>
    </>
  )
}
