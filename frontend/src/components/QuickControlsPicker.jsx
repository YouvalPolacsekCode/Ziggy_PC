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
import { DeviceIcon } from '../lib/deviceIcons'
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
      <p style={{ fontSize: 15, color: 'var(--ink-mute)', margin: '0 0 16px', lineHeight: 1.4 }}>
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
                <span className="z-eyebrow" style={{ minWidth: 16, margin: 0 }}>{idx + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <EntitySelect
                    value={id || ''}
                    onChange={(v) => setSlot(idx, v)}
                    allowedDomains={ALLOWED_DOMAINS}
                    placeholder={t('quickControls.pickPlaceholder')}
                  />
                </div>
                <button onClick={() => setEditingSlot(null)} className="z-icon-btn" aria-label={t('common.cancel')}>
                  <X size={18} strokeWidth={1.75} />
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
                <span className="z-eyebrow" style={{ minWidth: 16, margin: 0 }}>{idx + 1}</span>
                <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
                <span style={{ fontSize: 15, fontWeight: 500 }}>{t('quickControls.addDevice')}</span>
              </button>
            )
          }

          return (
            <div key={idx} style={slotStyle}>
              <span className="z-eyebrow" style={{ minWidth: 16, margin: 0 }}>{idx + 1}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <span style={iconBox} aria-hidden="true">
                  <DeviceIcon kind={facts.kind} size={22} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {facts.name}
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--ink-mute)', marginTop: 4,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {facts.meta.label} · {facts.stateLabel}
                  </div>
                </div>
              </div>
              {/* Four 44px controls: reorder up/down, change, remove. */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button onClick={() => moveSlot(idx, -1)} disabled={idx === 0} className="z-icon-btn" style={iconBtnDisabled(idx === 0)} aria-label={t('quickControls.moveUp')}>
                  <ArrowUp size={18} strokeWidth={1.75} />
                </button>
                <button onClick={() => moveSlot(idx, 1)} disabled={idx === draft.length - 1} className="z-icon-btn" style={iconBtnDisabled(idx === draft.length - 1)} aria-label={t('quickControls.moveDown')}>
                  <ArrowDown size={18} strokeWidth={1.75} />
                </button>
                <button onClick={() => setEditingSlot(idx)} className="z-icon-btn" aria-label={t('quickControls.change')}>
                  <ChevronRight size={18} strokeWidth={1.75} className="icon-flip-rtl" />
                </button>
                <button onClick={() => clearSlot(idx)} className="z-icon-btn" style={{ color: 'var(--err-text)' }} aria-label={t('common.remove')}>
                  <X size={18} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
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
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 16px', minHeight: 56, borderRadius: 'var(--r-ctl)',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
}

const iconBox = {
  width: 40, height: 40, borderRadius: 'var(--r-ctl)', flexShrink: 0,
  background: 'var(--surface-2)', color: 'var(--ink-2)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

// A disabled reorder arrow keeps its 44px footprint so the row's controls
// never shift; only its ink fades to the faint token.
const iconBtnDisabled = (disabled) => disabled
  ? { color: 'var(--ink-faint)', cursor: 'default' }
  : undefined

export default QuickControlsPicker
