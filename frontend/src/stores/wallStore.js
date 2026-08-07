// Wall dashboard store — layout, edit draft, capability elevation, idle.
//
// ADDITIVE: this store is new and independent. `hubStore` is untouched and the
// existing /hub route keeps using it. Nothing here reads or writes the old
// dashboard_layouts storage.
//
// Layout shape (schema v2, persisted to /api/wall/layout):
//   { version: 2, cols: 12, modules: [{ id, type, x, y, w, h, config }],
//     rail: { width, collapsed }, idle: { enabled, timeout_s } }
//
// Edit model: `startEdit` snapshots the live layout into `draft`. Every drag,
// resize, add, and remove mutates the draft only. `commitEdit` persists and
// promotes; `cancelEdit` throws the draft away. The live board never shows a
// half-finished arrangement.

import { create } from 'zustand'
import { insert, place, remove, resize, reflow, refit, isValid, DEFAULT_COLS } from '../lib/wallGrid'
import { getWallLayout, putWallLayout } from '../lib/api'
import { getManifest } from '../wall/modules/registry'
import { getTabletId } from '../lib/hubTablet'

export const LAYOUT_VERSION = 2

// Shipped default. A tablet that has never been arranged sees this: the things
// a family actually looks at from across a kitchen, biggest first.
export function defaultLayout(cols = DEFAULT_COLS) {
  // Fills all 12 columns: a fresh tablet should look arranged, not like
  // someone abandoned it half-configured with a blank right-hand third.
  const modules = [
    { id: 'w_ziggy',    type: 'ziggy',    x: 0, y: 0, w: 12, h: 2, config: {} },
    { id: 'w_agenda',   type: 'agenda',   x: 0, y: 2, w: 4,  h: 5, config: {} },
    { id: 'w_shopping', type: 'shopping', x: 4, y: 2, w: 4,  h: 5, config: {} },
    { id: 'w_scenes',   type: 'scenes',   x: 8, y: 2, w: 4,  h: 3, config: {} },
    { id: 'w_pinned',   type: 'pinned',   x: 8, y: 5, w: 4,  h: 3, config: {} },
  ]
  return {
    version: LAYOUT_VERSION,
    cols,
    modules: reflow(modules, cols),
    rail: { collapsed: false },
    idle: { enabled: true, timeout_s: 300 },
  }
}

// Accept anything, return something renderable. The board must never blank out
// because a stored document drifted — an unknown module type is dropped, a
// malformed rect is repaired by the grid engine.
export function sanitizeLayout(doc, cols = DEFAULT_COLS) {
  const base = defaultLayout(cols)
  if (!doc || typeof doc !== 'object') return base

  const raw = Array.isArray(doc.modules) ? doc.modules : []
  const seen = new Set()
  const modules = raw
    .filter((m) => m && typeof m.type === 'string' && getManifest(m.type))
    .map((m, i) => {
      let id = String(m.id || `w_${m.type}_${i}`).slice(0, 64)
      // Duplicate ids would make drag target the wrong instance.
      while (seen.has(id)) id = `${id}_`
      seen.add(id)
      const man = getManifest(m.type)
      return {
        id,
        type: m.type,
        x: Number.isFinite(m.x) ? Math.max(0, Math.trunc(m.x)) : 0,
        y: Number.isFinite(m.y) ? Math.max(0, Math.trunc(m.y)) : 0,
        w: Number.isFinite(m.w) ? Math.max(1, Math.trunc(m.w)) : (man.defaultW ?? 4),
        h: Number.isFinite(m.h) ? Math.max(1, Math.trunc(m.h)) : (man.defaultH ?? 3),
        config: (m.config && typeof m.config === 'object') ? m.config : {},
      }
    })
    .slice(0, 40)

  // Preserve the width this layout was AUTHORED at. Fitting it to the current
  // board happens on render (see `viewModules`), never in storage — otherwise
  // simply opening the wall on a small tablet would rewrite the arrangement.
  const storedCols = Number.isFinite(doc.cols) ? doc.cols : DEFAULT_COLS
  return {
    version: LAYOUT_VERSION,
    cols: storedCols,
    modules: modules.length ? reflow(modules, storedCols) : base.modules,
    rail: {
      collapsed: !!(doc.rail && doc.rail.collapsed),
    },
    idle: {
      enabled: doc.idle?.enabled !== false,
      timeout_s: Number.isFinite(doc.idle?.timeout_s)
        ? Math.min(3600, Math.max(30, Math.trunc(doc.idle.timeout_s)))
        : 300,
    },
  }
}

let _saveTimer = null

export const useWallStore = create((set, get) => ({
  layout:   null,
  draft:    null,
  cols:     DEFAULT_COLS,
  loading:  false,
  error:    null,
  editing:  false,
  saving:   false,

  // Which module is being dragged / resized right now (edit mode only).
  dragId:   null,
  resizeId: null,

  // Capability elevation granted by a correct PIN: { [capability]: expiresAtMs }
  elevated: {},
  // The capability a PIN prompt is currently gating, or null.
  pinFor:   null,
  // Resolved after the prompt succeeds — lets a control resume what it started.
  _pinResolve: null,

  // ─── layout lifecycle ─────────────────────────────────────────────────────

  async fetchLayout() {
    set({ loading: true, error: null })
    try {
      const tabletId = getTabletId()
      const res = await getWallLayout(tabletId)
      set({ layout: sanitizeLayout(res?.layout, get().cols), loading: false })
    } catch (e) {
      // A layout we cannot fetch must not blank the wall — fall back to the
      // shipped default and surface the error quietly.
      set({
        layout: get().layout ?? defaultLayout(get().cols),
        loading: false,
        error: e?.userMessage || 'Could not load this tablet’s layout.',
      })
    }
  },

  /**
   * Record the column count the board is currently rendering at.
   *
   * Deliberately does NOT rewrite the stored layout. `refit` is lossy — a
   * 12-column board collapsed onto 4 becomes a stack of full-width cards, and
   * scaling that back up cannot recover the original three-across
   * arrangement. An earlier version refitted and wrote back on every resize,
   * which meant rotating the tablet (or a keyboard opening) silently and
   * permanently destroyed the layout the user had arranged.
   *
   * Instead the stored layout stays authored at its own `cols`, and the view
   * for the current width is derived on render. Editing re-authors.
   */
  setCols(cols) {
    if (!cols || cols === get().cols) return
    set({ cols })
  },

  /** The modules to render right now: authored layout, fitted to this width. */
  viewModules() {
    const { layout, cols, editing, draft } = get()
    if (editing && draft) return draft.modules
    if (!layout) return []
    return refit(layout.modules, layout.cols || DEFAULT_COLS, cols, getManifest)
  },

  startEdit() {
    const l = get().layout
    if (!l) return
    const cols = get().cols
    // Edit at the width the user is actually looking at, then persist that as
    // the new authored arrangement when they tap Done.
    set({
      editing: true,
      draft: { ...l, cols, modules: refit(l.modules, l.cols || DEFAULT_COLS, cols, getManifest) },
    })
  },

  cancelEdit() {
    set({ editing: false, draft: null, dragId: null, resizeId: null })
  },

  async commitEdit() {
    const { draft, cols } = get()
    if (!draft) { set({ editing: false }); return }

    // Cheap assertion: never persist a layout the engine considers invalid.
    const modules = isValid(draft.modules, cols) ? draft.modules : reflow(draft.modules, cols)
    // Stamp the width this arrangement was authored at, so a later view on a
    // different-sized tablet knows what to fit it FROM.
    const next = { ...draft, cols, modules }

    // Optimistic promote so the board settles instantly; roll back on failure.
    const prev = get().layout
    set({ layout: next, editing: false, draft: null, dragId: null, resizeId: null, saving: true })
    try {
      await putWallLayout(getTabletId(), next)
      set({ saving: false, error: null })
    } catch (e) {
      set({ layout: prev, saving: false, error: e?.userMessage || 'Could not save the layout.' })
    }
  },

  // ─── draft mutations (edit mode only) ─────────────────────────────────────

  _mutate(fn) {
    const { draft, cols } = get()
    if (!draft) return
    set({ draft: { ...draft, modules: fn(draft.modules, cols) } })
  },

  moveModule(id, x, y) { get()._mutate((mods, cols) => place(mods, id, x, y, cols)) },

  resizeModule(id, w, h) {
    const type = get().draft?.modules.find((m) => m.id === id)?.type
    get()._mutate((mods, cols) => resize(mods, id, w, h, getManifest(type), cols))
  },

  addModule(type) {
    const man = getManifest(type)
    if (!man) return
    const id = `w_${type}_${Math.random().toString(36).slice(2, 8)}`
    get()._mutate((mods, cols) => insert(mods, { id, type, config: {} }, man, cols))
  },

  removeModule(id) { get()._mutate((mods, cols) => remove(mods, id, cols)) },

  configureModule(id, patch) {
    get()._mutate((mods) =>
      mods.map((m) => (m.id === id ? { ...m, config: { ...m.config, ...patch } } : m)))
  },

  setDragId(id)   { set({ dragId: id }) },
  setResizeId(id) { set({ resizeId: id }) },

  /**
   * Called when a drag or resize gesture ends.
   *
   * Mid-gesture the moving card is pinned so neighbours slide around it rather
   * than the card squirming away from the finger. That can legitimately leave
   * a gap above it, so on release we run a plain gravity pass — which is what
   * upholds the "a finished board never has holes" rule.
   */
  endGesture() {
    const { draft, cols } = get()
    if (!draft) return
    set({ draft: { ...draft, modules: reflow(draft.modules, cols) }, dragId: null, resizeId: null })
  },

  toggleRail() {
    const cur = get()
    const target = cur.editing ? 'draft' : 'layout'
    const l = cur[target]
    if (!l) return
    set({ [target]: { ...l, rail: { ...l.rail, collapsed: !l.rail.collapsed } } })
    if (!cur.editing) get().persistSoon()
  },

  setIdleConfig(patch) {
    const l = get().layout
    if (!l) return
    set({ layout: { ...l, idle: { ...l.idle, ...patch } } })
    get().persistSoon()
  },

  // Debounced background save for changes made outside edit mode (rail
  // collapse, idle timeout). Never blocks the UI, never toasts on failure —
  // these are preferences, not commands.
  persistSoon() {
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => {
      const l = get().layout
      if (l) putWallLayout(getTabletId(), l).catch(() => {})
    }, 800)
  },

  // ─── capability elevation ─────────────────────────────────────────────────

  isElevated(cap) {
    const exp = get().elevated[cap]
    return !!exp && exp > Date.now()
  },

  grantElevation(cap, ttlMs) {
    set((s) => ({ elevated: { ...s.elevated, [cap]: Date.now() + ttlMs } }))
  },

  /** Open the PIN prompt for `cap`; resolves true once unlocked, false if cancelled. */
  requestPin(cap) {
    return new Promise((resolve) => {
      set({ pinFor: cap, _pinResolve: resolve })
    })
  },

  resolvePin(ok) {
    const r = get()._pinResolve
    set({ pinFor: null, _pinResolve: null })
    if (r) r(!!ok)
  },

  /** Drop every elevation — called when the wall goes idle. */
  dropElevation() { set({ elevated: {} }) },

  clearError() { set({ error: null }) },
}))
