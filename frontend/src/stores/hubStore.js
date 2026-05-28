// Hub-only state: active (server) layout + edit-mode draft.
//
// Two layout slots:
//   - layout:  the saved server state (what the renderer shows when not editing)
//   - draft:   the in-progress edit (the renderer shows this when editing=true)
//
// Cancel throws the draft away. Done sends the draft to the server with
// optimistic update + rollback on failure.
//
// Separate from uiStore / deviceStore so the existing Dashboard never depends
// on Hub state.

import { create } from 'zustand'
import { getHubLayout, saveHubLayout } from '../lib/api'
import { getTabletId } from '../lib/hubTablet'

const SIZE_CYCLE = ['S', 'M', 'L', 'FULL']

// Make a fresh deep-ish copy of a layout doc — we only ever mutate sections
// and section.config (both plain JSON), so a JSON round-trip is fine and the
// safest way to avoid accidental shared-reference bugs in draft state.
function cloneLayout(doc) {
  if (!doc) return null
  try { return JSON.parse(JSON.stringify(doc)) }
  catch { return doc }
}

function newSectionId() {
  return 'sec_' + Math.random().toString(36).slice(2, 10)
}

export const useHubStore = create((set, get) => ({
  layout:   null,
  loading:  false,
  error:    null,

  // ── Edit-mode state ────────────────────────────────────────────────────────
  editing:  false,
  draft:    null,           // live copy mutated by the editor; null when not editing
  configuringSectionId: null,  // when set, Hub.jsx shows the per-section config sheet

  // Drag-reorder state. Pointer-events-based — works on touch + mouse without
  // a drag library. The dragged section is swapped through the layout as the
  // pointer moves; the visible reflow IS the feedback (no ghost element).
  dragId:     null,
  dragOverId: null,

  openConfig(id)  { set({ configuringSectionId: id }) },
  closeConfig()   { set({ configuringSectionId: null }) },

  async fetchLayout() {
    set({ loading: true, error: null })
    try {
      const res = await getHubLayout(getTabletId(), null)
      set({ layout: res.layout, loading: false })
    } catch (e) {
      set({ error: e?.userMessage || 'Could not load layout', loading: false })
    }
  },

  // ── Edit lifecycle ─────────────────────────────────────────────────────────

  startEdit() {
    if (!getTabletId()) {
      set({ error: 'Pair this tablet before editing the layout.' })
      return
    }
    const base = get().layout
    if (!base) return
    set({ editing: true, draft: cloneLayout(base) })
  },

  cancelEdit() {
    set({ editing: false, draft: null, configuringSectionId: null,
          dragId: null, dragOverId: null })
  },

  async commitEdit() {
    const draft = get().draft
    if (!draft) { set({ editing: false }); return }
    const tabletId = getTabletId()
    if (!tabletId) {
      set({ error: 'Pair this tablet before saving layout changes.', editing: false, draft: null })
      return
    }
    const prev = get().layout
    set({ layout: draft, editing: false, draft: null, configuringSectionId: null,
          dragId: null, dragOverId: null })
    try {
      const res = await saveHubLayout(tabletId, draft)
      set({ layout: res.layout })
    } catch (e) {
      // Rollback. Re-open the editor with the unsaved draft so the user
      // doesn't lose their work — better than silently discarding.
      set({ layout: prev, editing: true, draft, error: e?.userMessage || 'Failed to save layout' })
    }
  },

  // ── Draft mutations (no-ops unless editing) ────────────────────────────────

  _mutateDraft(fn) {
    const d = get().draft
    if (!d) return
    const next = cloneLayout(d)
    fn(next)
    set({ draft: next })
  },

  moveSection(id, dir) {
    get()._mutateDraft(d => {
      const idx = d.sections.findIndex(s => s.id === id)
      if (idx < 0) return
      const swap = idx + (dir === 'up' ? -1 : 1)
      if (swap < 0 || swap >= d.sections.length) return
      const tmp = d.sections[idx]
      d.sections[idx]  = d.sections[swap]
      d.sections[swap] = tmp
    })
  },

  cycleSectionSize(id) {
    get()._mutateDraft(d => {
      const s = d.sections.find(x => x.id === id)
      if (!s) return
      const i = SIZE_CYCLE.indexOf(s.size)
      s.size = SIZE_CYCLE[(i + 1 + SIZE_CYCLE.length) % SIZE_CYCLE.length]
    })
  },

  removeSection(id) {
    get()._mutateDraft(d => {
      d.sections = d.sections.filter(s => s.id !== id)
    })
  },

  addSection(type, opts = {}) {
    get()._mutateDraft(d => {
      d.sections.push({
        id:     newSectionId(),
        type,
        size:   opts.size || 'M',
        config: opts.config || {},
      })
    })
  },

  updateSectionConfig(id, config) {
    get()._mutateDraft(d => {
      const s = d.sections.find(x => x.id === id)
      if (!s) return
      // Replace, not merge — the config form passes the full intended config.
      // Merging would strip-then-leave-old-keys when a user clears a field.
      s.config = config || {}
    })
  },

  // ── Drag-reorder ───────────────────────────────────────────────────────────

  startDrag(id) {
    if (!get().editing) return
    set({ dragId: id, dragOverId: null })
  },

  // Called by Hub.jsx's global pointermove handler whenever the pointer
  // enters a different section. Splices the dragged section out and re-inserts
  // it at the hovered section's index so the layout reflows under the finger
  // in real time. No-op when hover target hasn't changed.
  hoverDrag(targetId) {
    const cur = get()
    if (!cur.dragId || !targetId || cur.dragId === targetId) return
    if (cur.dragOverId === targetId) return
    set({ dragOverId: targetId })
    get()._mutateDraft(d => {
      const fromIdx = d.sections.findIndex(s => s.id === cur.dragId)
      const toIdx   = d.sections.findIndex(s => s.id === targetId)
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return
      const [moved] = d.sections.splice(fromIdx, 1)
      d.sections.splice(toIdx, 0, moved)
    })
  },

  endDrag() {
    set({ dragId: null, dragOverId: null })
  },

  clearError() { set({ error: null }) },
}))
