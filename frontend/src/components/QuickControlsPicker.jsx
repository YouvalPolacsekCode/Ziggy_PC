/**
 * QuickControlsPicker — modal for selecting up to 4 entities to pin in the
 * Dashboard's Quick Controls row. Persists via deviceStore.setQuickControlIds.
 *
 * UX:
 *   - Four ordered slots (1..4)
 *   - Each slot shows the chosen entity (or "Empty") with reorder + clear
 *   - Tap an empty slot or "Change" → opens EntitySelect filtered to the
 *     toggleable controllable domains (no sensors)
 *   - Save persists; Cancel reverts
 */

import { useState, useEffect, useMemo } from 'react'
import { ArrowUp, ArrowDown, X, Plus, ChevronRight } from 'lucide-react'
import { Modal } from './ui/Modal'
import { EntitySelect } from './ui/EntitySelect'
import { useDeviceStore, QUICK_CONTROLS_MAX } from '../stores/deviceStore'
import { deviceFacts } from '../lib/devices'
import { useT } from '../lib/i18n'

// Domains worth pinning as "quick controls". Sensors are filtered out — they
// have nothing to tap.
const ALLOWED_DOMAINS = new Set([
  'light', 'switch', 'input_boolean',
  'climate', 'fan',
  'media_player',
  'cover', 'lock', 'vacuum',
  'humidifier', 'water_heater',
])

export function QuickControlsPicker({ open, onClose }) {
  const t = useT()
  // Slice the store so the picker only re-renders when entities or the saved
  // quick-control ids change — destructuring the whole store re-renders on
  // every unrelated device tick.
  const entities = useDeviceStore(s => s.entities)
  const quickControlIds = useDeviceStore(s => s.quickControlIds)
  const setQuickControlIds = useDeviceStore(s => s.setQuickControlIds)
  const [draft, setDraft] = useState(quickControlIds)
  const [editingSlot, setEditingSlot] = useState(null)  // index or null

  // Reset draft when the modal opens
  useEffect(() => { if (open) { setDraft(quickControlIds); setEditingSlot(null) } }, [open])

  const entityMap = useMemo(
    () => Object.fromEntries(entities.map(e => [e.entity_id, e])),
    [entities],
  )

  const setSlot = (idx, entityId) => {
    const next = [...draft]
    // Prevent duplicates — if the entity is already in another slot, remove it first
    for (let i = 0; i < next.length; i++) {
      if (next[i] === entityId && i !== idx) next[i] = null
    }
    next[idx] = entityId
    setDraft(next.filter(Boolean))
    setEditingSlot(null)
  }

  const clearSlot = (idx) => {
    const next = [...draft]
    next.splice(idx, 1)
    setDraft(next)
  }

  const moveSlot = (idx, dir) => {
    const next = [...draft]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setDraft(next)
  }

  const handleSave = () => {
    setQuickControlIds(draft)
    onClose()
  }

  const handleResetAuto = () => {
    setQuickControlIds([])
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={t('quickControls.editTitle')}>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 14, lineHeight: 1.5 }}>
        {t('quickControls.help', { n: QUICK_CONTROLS_MAX })}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: QUICK_CONTROLS_MAX }).map((_, idx) => {
          const id     = draft[idx] || null
          const entity = id ? entityMap[id] : null
          const facts  = entity ? deviceFacts(entity) : null
          const isEditing = editingSlot === idx

          if (isEditing) {
            return (
              <div key={idx} style={slotStyle}>
                <span className="z-eyebrow" style={{ minWidth: 16 }}>{idx + 1}</span>
                <div style={{ flex: 1 }}>
                  <EntitySelect
                    value={id || ''}
                    onChange={(v) => setSlot(idx, v)}
                    allowedDomains={ALLOWED_DOMAINS}
                    placeholder={t('quickControls.pickPlaceholder')}
                  />
                </div>
                <button onClick={() => setEditingSlot(null)} style={iconBtn} aria-label={t('common.cancel')}>
                  <X size={14} />
                </button>
              </div>
            )
          }

          if (!entity) {
            return (
              <button
                key={idx}
                onClick={() => setEditingSlot(idx)}
                style={{
                  ...slotStyle,
                  cursor: 'pointer',
                  background: 'var(--surface-2)',
                  border: '0.5px dashed var(--line-2)',
                  color: 'var(--ink-mute)',
                  fontFamily: 'inherit',
                }}
              >
                <span className="z-eyebrow" style={{ minWidth: 16 }}>{idx + 1}</span>
                <Plus size={14} />
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t('quickControls.addDevice')}</span>
              </button>
            )
          }

          return (
            <div key={idx} style={slotStyle}>
              <span className="z-eyebrow" style={{ minWidth: 16 }}>{idx + 1}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 16 }}>{facts.meta.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {facts.name}
                  </div>
                  <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
                    {facts.meta.label} · {facts.stateLabel}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                <button onClick={() => moveSlot(idx, -1)} disabled={idx === 0} style={iconBtn} aria-label={t('quickControls.moveUp')}>
                  <ArrowUp size={13} />
                </button>
                <button onClick={() => moveSlot(idx, 1)} disabled={idx === draft.length - 1} style={iconBtn} aria-label={t('quickControls.moveDown')}>
                  <ArrowDown size={13} />
                </button>
                <button onClick={() => setEditingSlot(idx)} style={iconBtn} aria-label={t('quickControls.change')}>
                  <ChevronRight size={13} />
                </button>
                <button onClick={() => clearSlot(idx)} style={iconBtn} aria-label={t('common.remove')}>
                  <X size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={handleResetAuto} className="z-btn-secondary" style={{ flex: 1 }}>
          {t('quickControls.autoPick')}
        </button>
        <button onClick={handleSave} className="z-btn-primary" style={{ flex: 1 }}>
          {t('common.save')}
        </button>
      </div>
    </Modal>
  )
}

const slotStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 12px', borderRadius: 12,
  background: 'var(--surface)', border: '0.5px solid var(--line)',
}

const iconBtn = {
  width: 28, height: 28, borderRadius: 8,
  background: 'var(--surface-2)', border: '0.5px solid var(--line)',
  color: 'var(--ink-2)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit',
}

export default QuickControlsPicker
