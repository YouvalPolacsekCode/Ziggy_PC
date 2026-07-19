import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useT, useLangStore } from '../../lib/i18n'
import { getRooms, designSmartRoom } from '../../lib/api'
import BundlePreviewCard from './BundlePreviewCard'
import OccupancySensorForm from './OccupancySensorForm'

// ── SmartRoomWizard ───────────────────────────────────────────────────────────
// Dedicated flow for the Smart Room template (Actions.jsx routes here on
// wizard_prefill.bundle === 'smart_room'). One tap:
//   pick room → design the deterministic Smart Room RECIPE
//     (sleeping-wife orchestra: presence-aware, day/night, off-when-empty)
//   → if the room has no fused presence sensor yet, open the EXISTING
//     OccupancySensorForm to create one, then retry with its entity_id
//   → preview in the SAME BundlePreviewCard → Accept (applies) / Undo.
//
// Reuses designSmartRoom (recipe endpoint) + OccupancySensorForm +
// BundlePreviewCard. No new backend beyond the recipe endpoint.
//
// Props: onSaved (accepted+done), onClose (dismiss).
// ──────────────────────────────────────────────────────────────────────────────

function actionableCount(bundle) {
  const a = bundle?.artifacts || {}
  return (a.occupancy_sensors?.length || 0)
       + (a.kv_state?.length || 0)
       + (a.automations?.length || 0)
}

export default function SmartRoomWizard({ onSaved, onClose, initialRoom = null, initialRoomName = '' }) {
  const t = useT()
  const lang = useLangStore((s) => s.lang)

  const [rooms, setRooms]       = useState([])
  const [loading, setLoading]   = useState(true)
  // Edit mode (initialRoom) skips the picker and designs that room immediately.
  const [step, setStep]         = useState(initialRoom ? 'designing' : 'pick')
  const [bundle, setBundle]     = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)
  const [room, setRoom]         = useState(initialRoom ? { id: initialRoom, name: initialRoomName || initialRoom } : null)

  useEffect(() => {
    let alive = true
    getRooms()
      .then((r) => { if (alive) { setRooms(r?.rooms || []); setLoading(false) } })
      .catch(() => { if (alive) { setRooms([]); setLoading(false) } })
    // In edit mode, design the target room straight away.
    if (initialRoom) design({ id: initialRoom, name: initialRoomName || initialRoom })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Design the recipe for a room, optionally with a just-created occupancy entity.
  const design = async (roomObj, occupancyEntity) => {
    setRoom(roomObj)
    setStep('designing')
    setErrorMsg(null)
    try {
      const res = await designSmartRoom(roomObj.id || roomObj.name, occupancyEntity, lang)
      if (res?.needs_occupancy) { setStep('needOccupancy'); return }
      const b = res?.bundle
      if (!b) throw new Error('no bundle')
      if (b.decline || actionableCount(b) === 0) { setBundle(b); setStep('decline'); return }
      setBundle(b)
      setStep('preview')
    } catch (e) {
      setErrorMsg(e?.userMessage || e?.message || t('automations.smartRoom.designFailed'))
      setStep('error')
    }
  }

  const backToPick = () => { setStep('pick'); setBundle(null); setErrorMsg(null); setRoom(null) }

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
            {rooms.map((r) => (
              <button
                key={r.id || r.name}
                type="button"
                onClick={() => design(r)}
                className="z-btn-secondary"
                style={{ padding: '12px 14px', borderRadius: 11, textAlign: 'start', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                dir="auto"
              >
                {r.name || r.id}
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
          {t('automations.smartRoom.designing', { room: room?.name || '' })}
        </p>
      </div>
    )
  }

  // ── Needs a fused presence sensor first — reuse the EXISTING creator ─────────
  if (step === 'needOccupancy' && room) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, lineHeight: 1.5 }} dir="auto">
          {t('automations.smartRoom.needPresence', { room: room.name })}
        </p>
        <OccupancySensorForm
          initialRoom={room.name}
          onCreated={(res) => { design(room, res?.entity_id) }}
          onClose={() => {}}
        />
      </div>
    )
  }

  // ── Preview — same card as chat ─────────────────────────────────────────────
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
          {bundle?.decline || t('automations.smartRoom.nothingToBuild', { room: room?.name || '' })}
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
