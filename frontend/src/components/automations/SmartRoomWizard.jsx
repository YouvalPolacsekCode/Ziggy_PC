import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useT, useLangStore } from '../../lib/i18n'
import { getRooms, designAutomationBundle } from '../../lib/api'
import BundlePreviewCard from './BundlePreviewCard'

// ── SmartRoomWizard ───────────────────────────────────────────────────────────
// Tab-surface twin of the chat "build me a smart room" flow. Opened from the
// Smart Room template's Configure (Actions.jsx reads wizard_prefill.bundle ===
// 'smart_room'). One tap: pick a room → the orchestra designer builds a bundle
// (POST /api/automations/bundles/design) → the SAME BundlePreviewCard the chat
// uses renders it for review / edit / accept (which POSTs /apply) / undo.
//
// No new backend — reuses designAutomationBundle + BundlePreviewCard entirely.
//
// Props:
//   onSaved — called after the user accepts + taps Done (parent closes + toasts)
//   onClose — called to dismiss without creating anything
// ──────────────────────────────────────────────────────────────────────────────

function actionableCount(bundle) {
  const a = bundle?.artifacts || {}
  return (a.occupancy_sensors?.length || 0)
       + (a.kv_state?.length || 0)
       + (a.automations?.length || 0)
}

export default function SmartRoomWizard({ onSaved, onClose }) {
  const t = useT()
  const lang = useLangStore((s) => s.lang)

  const [rooms, setRooms]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [step, setStep]         = useState('pick')   // pick | designing | preview | decline | error
  const [bundle, setBundle]     = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)
  const [roomName, setRoomName] = useState('')

  useEffect(() => {
    let alive = true
    getRooms()
      .then((r) => { if (alive) { setRooms(r?.rooms || []); setLoading(false) } })
      .catch(() => { if (alive) { setRooms([]); setLoading(false) } })
    return () => { alive = false }
  }, [])

  const pickRoom = async (room) => {
    const name = room.name || room.id || ''
    setRoomName(name)
    setStep('designing')
    setErrorMsg(null)
    const outcome = lang === 'he'
      ? `תהפוך את ${name} לחדר חכם`
      : `Make the ${name} a smart room`
    try {
      const res = await designAutomationBundle(outcome, lang)
      const b = res?.bundle
      if (!b) throw new Error('no bundle')
      setBundle(b)
      setStep(actionableCount(b) > 0 ? 'preview' : 'decline')
    } catch (e) {
      // The design endpoint 400s with { detail: { bundle, error } } when the
      // LLM produced something unusable — surface a friendly message.
      setErrorMsg(e?.userMessage || e?.message || t('automations.smartRoom.designFailed'))
      setStep('error')
    }
  }

  const backToPick = () => { setStep('pick'); setBundle(null); setErrorMsg(null) }

  // ── Room picker ─────────────────────────────────────────────────────────────
  if (step === 'pick') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.45 }} dir="auto">
          {t('automations.smartRoom.pickPrompt')}
        </p>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ height: 48, borderRadius: 10, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />
            ))}
          </div>
        ) : rooms.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', margin: 0 }} dir="auto">
            {t('automations.smartRoom.noRooms')}
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {rooms.map((room) => (
              <button
                key={room.id || room.name}
                type="button"
                onClick={() => pickRoom(room)}
                className="z-btn-secondary"
                style={{
                  padding: '12px 14px', borderRadius: 11, textAlign: 'start',
                  fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                }}
                dir="auto"
              >
                {room.name || room.id}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Designing (spinner) ─────────────────────────────────────────────────────
  if (step === 'designing') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 12px' }}>
        <motion.span
          style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', display: 'inline-block' }}
          animate={{ rotate: 360 }}
          transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
        />
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0, textAlign: 'center' }} dir="auto">
          {t('automations.smartRoom.designing', { room: roomName })}
        </p>
      </div>
    )
  }

  // ── Preview — reuse the exact same card as chat ─────────────────────────────
  if (step === 'preview' && bundle) {
    return (
      <BundlePreviewCard
        bundle={bundle}
        onAccept={() => onSaved?.()}
        onDiscard={() => onClose?.()}
      />
    )
  }

  // ── Decline / nothing to build ──────────────────────────────────────────────
  if (step === 'decline') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
        <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, lineHeight: 1.5 }} dir="auto">
          {bundle?.decline || t('automations.smartRoom.nothingToBuild', { room: roomName })}
        </p>
        <button type="button" onClick={backToPick} className="z-btn-secondary" style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 9 }}>
          {t('automations.smartRoom.chooseAnother')}
        </button>
      </div>
    )
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
      <p style={{ fontSize: 13, color: 'var(--err)', margin: 0, lineHeight: 1.5 }} dir="auto">
        {errorMsg || t('automations.smartRoom.designFailed')}
      </p>
      <button type="button" onClick={backToPick} className="z-btn-secondary" style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 9 }}>
        {t('automations.smartRoom.tryAgain')}
      </button>
    </div>
  )
}
