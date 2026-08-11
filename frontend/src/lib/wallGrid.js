// Wall dashboard grid engine — pure math, no React, no DOM.
//
// The wall dashboard lays modules out on a fixed-column grid (default 12).
// A module occupies whole cells: { id, type, x, y, w, h }. Coordinates are
// in grid units, NOT pixels — the renderer multiplies by the measured column
// width and the fixed row height.
//
// Why a separate pure module: drag/resize/reflow is the fiddliest logic in
// the whole dashboard and it must behave identically on a 7" Fire tablet and
// a 13" iPad. Keeping it free of React and DOM means it's exhaustively
// unit-testable without a browser, and the components stay presentational.
//
// Invariants every exported mutator guarantees on its return value:
//   1. No two modules overlap.
//   2. No module is out of bounds (x >= 0, x + w <= cols).
//   3. There is no vertical gap a module could fall into ("gravity").
//   4. Ordering is deterministic — same input, same output.
//
// The reflow model is the one people already know from phone home screens
// and dashboard builders: dropping a module pushes whatever it lands on
// downward, then everything floats back up until it hits something.

export const DEFAULT_COLS = 12
export const ROW_H = 64          // px per row unit — renderer's concern, exported for it
export const GRID_GAP = 12       // px between cells

// ─── helpers ────────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** Do two rectangles share any cell? Touching edges do NOT count. */
export function collides(a, b) {
  if (a === b || a.id === b.id) return false
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  )
}

/** Stable ordering: top-to-bottom, then leading-edge-first. */
function byPosition(a, b) {
  if (a.y !== b.y) return a.y - b.y
  if (a.x !== b.x) return a.x - b.x
  // Final tiebreak on id so equal positions never reorder nondeterministically
  // between runs (Object key order is not something we want to depend on).
  return String(a.id).localeCompare(String(b.id))
}

const cloneAll = (mods) => mods.map((m) => ({ ...m }))

// ─── manifest bounds ────────────────────────────────────────────────────────

/**
 * Clamp a module's size to the bounds its manifest declares, and to the grid.
 * Manifest may be absent (unknown module type) — then only grid bounds apply.
 */
export function clampSize(mod, manifest, cols = DEFAULT_COLS) {
  const minW = Math.max(1, manifest?.minW ?? 1)
  const minH = Math.max(1, manifest?.minH ?? 1)
  const maxW = Math.min(cols, manifest?.maxW ?? cols)
  const maxH = manifest?.maxH ?? 24
  const w = clamp(mod.w, Math.min(minW, cols), maxW)
  const h = clamp(mod.h, minH, maxH)
  return { ...mod, w, h }
}

// ─── gravity ────────────────────────────────────────────────────────────────

/** Lowest y >= 0 at which `mod` clears everything in `settled`. */
function firstFreeY(mod, settled) {
  for (let y = 0; ; y++) {
    const probe = { ...mod, y }
    if (!settled.some((s) => collides(probe, s))) return y
    // No termination guard needed: each candidate row is finite and the
    // settled set is finite, so a free row always exists below the deepest
    // occupied one.
  }
}

/**
 * Gravity pack: settle every module as high as it will go, in reading order.
 *
 * This both closes vertical gaps AND resolves overlaps, which matters because
 * `refit` legitimately produces overlapping rectangles when it scales a
 * 12-column layout onto 6 — two cards that were side by side no longer fit
 * side by side. An earlier version only floated modules upward and silently
 * left those overlaps on screen.
 *
 * `pinnedId` (optional) is placed first at its exact coordinates and never
 * moved, so a card lands where the finger dropped it and everything else
 * arranges itself around it.
 *
 * Idempotent: reflow(reflow(x)) === reflow(x).
 */
export function reflow(modules, cols = DEFAULT_COLS, pinnedId = null) {
  const all = cloneAll(modules)

  // Clamp into the grid first — a narrower viewport can shrink `cols` under
  // an existing layout, and an out-of-bounds card can't be packed sensibly.
  for (const mod of all) {
    mod.w = clamp(mod.w, 1, cols)
    mod.x = clamp(mod.x, 0, cols - mod.w)
    mod.y = Math.max(0, mod.y)
  }

  const settled = []
  const pinned = pinnedId ? all.find((m) => m.id === pinnedId) : null
  if (pinned) settled.push(pinned)

  for (const mod of all.slice().sort(byPosition)) {
    if (pinned && mod.id === pinned.id) continue
    mod.y = firstFreeY(mod, settled)
    settled.push(mod)
  }

  return settled.sort(byPosition)
}

/**
 * Settle the board around one module held fixed. Used by drag and resize so
 * the card under the finger stays put while its neighbours get out of the way.
 */
function packAround(modules, pinnedId, cols = DEFAULT_COLS) {
  const list = cloneAll(modules)
  if (!list.some((m) => m.id === pinnedId)) return reflow(list, cols)
  return reflow(list, cols, pinnedId)
}

// ─── mutators ───────────────────────────────────────────────────────────────

/** Move a module to (x, y), pushing neighbours out of the way, then settle. */
export function place(modules, id, x, y, cols = DEFAULT_COLS) {
  const list = cloneAll(modules)
  const mod = list.find((m) => m.id === id)
  if (!mod) return reflow(list, cols)

  mod.x = clamp(Math.round(x), 0, Math.max(0, cols - mod.w))
  mod.y = Math.max(0, Math.round(y))

  return packAround(list, id, cols)
}

/** Resize a module, honouring its manifest bounds, then settle. */
export function resize(modules, id, w, h, manifest, cols = DEFAULT_COLS) {
  const list = cloneAll(modules)
  const idx = list.findIndex((m) => m.id === id)
  if (idx === -1) return reflow(list, cols)

  const sized = clampSize({ ...list[idx], w: Math.round(w), h: Math.round(h) }, manifest, cols)
  // Growing rightward past the edge slides the module back inside rather
  // than silently truncating it — matches what a finger drag "means".
  sized.x = clamp(sized.x, 0, Math.max(0, cols - sized.w))
  list[idx] = sized

  return packAround(list, id, cols)
}

/**
 * First-fit placement for a newly added module: scan row by row, leading edge
 * first, for the first free rectangle. Always succeeds — worst case it lands
 * below everything.
 */
export function insert(modules, mod, manifest, cols = DEFAULT_COLS) {
  const list = reflow(cloneAll(modules), cols)
  const sized = clampSize(
    { ...mod, w: mod.w ?? manifest?.defaultW ?? 4, h: mod.h ?? manifest?.defaultH ?? 4 },
    manifest,
    cols,
  )

  const maxY = list.reduce((acc, m) => Math.max(acc, m.y + m.h), 0)
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= cols - sized.w; x++) {
      const probe = { ...sized, x, y }
      if (!list.some((m) => collides(probe, m))) {
        return reflow([...list, probe], cols)
      }
    }
  }
  // Nothing fitted in the existing area — append a new row at the bottom.
  return reflow([...list, { ...sized, x: 0, y: maxY }], cols)
}

/** Remove a module and close the gap it leaves. */
export function remove(modules, id, cols = DEFAULT_COLS) {
  return reflow(cloneAll(modules).filter((m) => m.id !== id), cols)
}

// ─── viewport adaptation ────────────────────────────────────────────────────

/**
 * Re-fit a layout authored at `fromCols` onto a narrower/wider grid.
 *
 * A layout saved on a 12-column 10" tablet has to survive being opened on a
 * 7" one where we only render 6 columns. Widths scale proportionally (never
 * below 1, never above the new column count), positions scale with them, and
 * the gravity pass cleans up whatever that produces.
 */
export function refit(modules, fromCols, toCols, manifestFor = null) {
  if (!fromCols || fromCols === toCols) return reflow(modules, toCols)
  const ratio = toCols / fromCols

  const scaled = cloneAll(modules).map((m) => {
    const minW = Math.max(1, manifestFor?.(m.type)?.minW ?? 1)
    let w = Math.round(m.w * ratio) || 1

    // Purely proportional scaling produces unusable cards on a small board:
    // a 4-of-12 agenda becomes 1-of-4, about 130px, and every label truncates
    // to "Whol…". Respect what the module says it needs.
    if (w < minW) w = minW

    // If the minimum eats most of the row anyway, take the whole row rather
    // than leaving a sliver too narrow for anything else to occupy. This is
    // what turns a 3-up desktop board into clean full-width stacked cards on
    // a 7" panel, instead of a ragged column with dead space beside it.
    if (minW >= toCols * 0.75) w = toCols

    w = clamp(w, 1, toCols)
    const x = clamp(Math.round(m.x * ratio), 0, toCols - w)
    return { ...m, x, w }
  })

  return reflow(scaled, toCols)
}

/**
 * How many columns to render at a given board width.
 *
 * Below ~640px of module area a 12-column grid produces cells too narrow to
 * hit with a finger, so we step down. These thresholds are the module area
 * (viewport minus the rooms rail), not the raw viewport.
 */
export function colsForWidth(px) {
  if (px < 400) return 2
  if (px < 600) return 4
  if (px < 780) return 6
  if (px < 880) return 8
  return DEFAULT_COLS
}

// ─── geometry for the renderer ──────────────────────────────────────────────

// How far a row may stretch beyond its base height to fill a tall screen.
// Without a cap, a two-card layout on a 1280px-tall portrait panel would
// produce absurdly tall cards full of empty space.
const MAX_ROW_STRETCH = 2.2

/**
 * Row height to render at, given the layout and the space available.
 *
 * A wall dashboard should fill its screen — a portrait tablet showing a short
 * layout as a band across the top with 500px of dead space below looks broken,
 * not minimal. So rows stretch (never shrink; a layout taller than the
 * viewport scrolls instead, which is correct).
 */
export function rowHeightFor(modules, availableH) {
  const rows = layoutRows(modules)
  if (!rows || !availableH) return ROW_H
  const fit = (availableH - GRID_GAP * (rows - 1)) / rows
  return clamp(fit, ROW_H, ROW_H * MAX_ROW_STRETCH)
}

/** Pixel rect for a module, given measured board width and row height. */
export function rectFor(mod, cols, boardW, rowH = ROW_H) {
  const colW = (boardW - GRID_GAP * (cols - 1)) / cols
  return {
    left:   mod.x * (colW + GRID_GAP),
    top:    mod.y * (rowH + GRID_GAP),
    width:  mod.w * colW + (mod.w - 1) * GRID_GAP,
    height: mod.h * rowH + (mod.h - 1) * GRID_GAP,
  }
}

/** Inverse of rectFor: snap a pixel offset to the nearest grid cell. */
export function cellFromPx(left, top, cols, boardW, rowH = ROW_H) {
  const colW = (boardW - GRID_GAP * (cols - 1)) / cols
  return {
    x: Math.round(left / (colW + GRID_GAP)),
    y: Math.round(top / (rowH + GRID_GAP)),
  }
}

/** Total rows a layout occupies — drives the board's scroll height. */
export function layoutRows(modules) {
  return modules.reduce((acc, m) => Math.max(acc, m.y + m.h), 0)
}

// ─── validation ─────────────────────────────────────────────────────────────

/**
 * True when a layout satisfies every invariant. Used by tests and by the
 * store as a cheap assertion before persisting.
 */
export function isValid(modules, cols = DEFAULT_COLS) {
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i]
    if (m.x < 0 || m.y < 0 || m.w < 1 || m.h < 1) return false
    if (m.x + m.w > cols) return false
    for (let j = i + 1; j < modules.length; j++) {
      if (collides(m, modules[j])) return false
    }
  }
  return true
}
