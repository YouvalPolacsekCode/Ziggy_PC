// Section edit overlay + section picker — only rendered in edit mode.
//
// EditOverlay: floats above each section with delete (×), ↑/↓ reorder, and a
// size cycler (S → M → L → FULL → S). Pointer events on the section underneath
// are blocked so the overlay's controls always win taps.
//
// SectionPickerModal: modal listing every available section type grouped by
// category. Picking a type adds a default-sized instance to the end of the
// draft and closes the picker.

import { useHubStore } from '../../stores/hubStore'

// ─── Per-section overlay ─────────────────────────────────────────────────────

// Types that surface useful settings in the config sheet. Other types render
// a "Nothing to configure" message; rather than show a no-op gear button, we
// hide it entirely so the affordance only appears where it does something.
const CONFIGURABLE_TYPES = new Set([
  'weather_card', 'camera_tile', 'tasks_list', 'alerts_inbox', 'scene_grid',
  'command_button', 'scene_button',
])

export function EditOverlay({ section }) {
  const moveSection      = useHubStore(s => s.moveSection)
  const cycleSectionSize = useHubStore(s => s.cycleSectionSize)
  const removeSection    = useHubStore(s => s.removeSection)
  const openConfig       = useHubStore(s => s.openConfig)
  const startDrag        = useHubStore(s => s.startDrag)

  const hasConfig = CONFIGURABLE_TYPES.has(section.type)

  // The grip is now a real drag handle. preventDefault stops the browser from
  // hijacking touches as page scroll; setPointerCapture binds the move/up
  // events to the global window listener in Hub.jsx so the pointer can leave
  // the grip without breaking the drag.
  const onGripDown = (e) => {
    e.preventDefault()
    e.stopPropagation()
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch {}
    startDrag(section.id)
  }

  return (
    <div className="z-hub-edit-overlay">
      <div
        className="z-hub-edit-grip"
        onPointerDown={onGripDown}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        role="button"
      >⋮⋮</div>
      <div className="z-hub-edit-actions" onPointerDown={e => e.stopPropagation()}>
        <button onClick={() => moveSection(section.id, 'up')}   title="Move up">↑</button>
        <button onClick={() => moveSection(section.id, 'down')} title="Move down">↓</button>
        <button onClick={() => cycleSectionSize(section.id)}    title="Cycle size">{section.size}</button>
        {hasConfig && (
          <button onClick={() => openConfig(section.id)} title="Configure" aria-label="Configure">⚙</button>
        )}
        <button onClick={() => removeSection(section.id)}       className="danger" title="Remove">×</button>
      </div>
    </div>
  )
}

// ─── Picker ──────────────────────────────────────────────────────────────────

// Catalog of types the user can add. Mirrors REGISTRY in LayoutRenderer.jsx
// and _KNOWN_TYPES in services/dashboard_layouts.py — if you add a section
// type, update all three.
const CATALOG = [
  { group: 'At a glance',
    items: [
      { type: 'status_strip',   label: 'Greeting',         size: 'FULL', hint: 'Time of day + clock' },
      { type: 'weather_card',   label: 'Weather',          size: 'M',    hint: 'Placeholder until /api/weather lands' },
      { type: 'mode_switcher',  label: 'Mode',             size: 'S',    hint: 'Home / Away / Night / Vacation (coming)' },
    ],
  },
  { group: 'Rooms & devices',
    items: [
      { type: 'rooms_carousel', label: 'Rooms carousel',   size: 'FULL', hint: 'Horizontal scroll of all rooms' },
      { type: 'quick_devices',  label: 'Quick controls',   size: 'FULL', hint: 'Your pinned devices (max 4)' },
      { type: 'camera_tile',    label: 'Camera',           size: 'M',    hint: 'Live tile (coming)' },
    ],
  },
  { group: 'Scenes & commands',
    items: [
      { type: 'scene_grid',     label: 'Scenes grid',      size: 'FULL', hint: 'Tap to run any routine' },
      { type: 'command_button', label: 'Command button',   size: 'S',    hint: 'Bind a single Ziggy intent' },
    ],
  },
  { group: 'Music',
    items: [
      { type: 'media_card',     label: 'Music',            size: 'M',    hint: 'Now playing across enabled speakers (requires Music feature)' },
    ],
  },
  { group: 'Notifications',
    items: [
      { type: 'alerts_inbox',   label: 'Alerts',           size: 'M',    hint: 'Active alerts (placeholder)' },
      { type: 'tasks_list',     label: 'Tasks',            size: 'M',    hint: 'Open tasks' },
    ],
  },
]

export function SectionPickerModal({ open, onClose }) {
  const addSection = useHubStore(s => s.addSection)
  if (!open) return null

  const pick = (item) => {
    addSection(item.type, { size: item.size, config: {} })
    onClose()
  }

  return (
    <div className="z-hub-picker-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="z-hub-picker" onClick={e => e.stopPropagation()}>
        <div className="z-hub-picker-head">
          <p className="z-eyebrow" style={{ margin: 0 }}>Add to layout</p>
          <button onClick={onClose} aria-label="Close" className="z-hub-picker-close">×</button>
        </div>
        <div className="z-hub-picker-body">
          {CATALOG.map(group => (
            <div key={group.group} style={{ marginBottom: 18 }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--ink-faint)',
                          textTransform: 'uppercase', letterSpacing: 0.5 }}>{group.group}</p>
              <div style={{ display: 'grid', gap: 8 }}>
                {group.items.map(item => (
                  <button key={item.type} onClick={() => pick(item)} className="z-hub-picker-item">
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{item.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{item.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
