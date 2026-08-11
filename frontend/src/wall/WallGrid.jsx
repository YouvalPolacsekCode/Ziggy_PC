// The module board — absolute-positioned grid with touch drag + corner resize.
//
// Interaction model, deliberately chosen to match a phone home screen because
// that's the mental model every user already has:
//   - Drag a card and its neighbours get out of the way *live*, not on drop.
//   - Release and it lands on the cell under your finger.
//   - Nothing ever overlaps and no hole is ever left behind.
//
// The maths lives in lib/wallGrid.js. This file only turns pointer events into
// cell coordinates and hands them to the store. That separation is what makes
// the hard part testable without a browser.
//
// Pointer events (not mouse/touch pairs) so a finger, a stylus and a mouse all
// take the same path. `setPointerCapture` keeps the gesture alive when the
// finger slides outside the card, which on a 7" tablet is most of the time.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWallStore } from '../stores/wallStore'
import {
  rectFor, cellFromPx, layoutRows, colsForWidth, rowHeightFor, refit, ROW_H, GRID_GAP,
} from '../lib/wallGrid'
import { getManifest } from './modules/registry'
import { MODULE_COMPONENTS } from './modules/components'
import { useT } from '../lib/i18n'
import { ModuleConfigSheet, ModuleExpanded } from './ModuleSheet'

// ─── one placed module ──────────────────────────────────────────────────────

const ModuleHost = memo(function ModuleHost({
  mod, rect, editing, dragging, resizing, override, ctx, onDragStart, onResizeStart, onConfigure, onExpand,
}) {
  const t = useT()
  const manifest = getManifest(mod.type)
  const Component = MODULE_COMPONENTS[mod.type]

  const style = override
    ? { left: override.left, top: override.top, width: rect.width, height: rect.height }
    : { left: rect.left, top: rect.top, width: rect.width, height: rect.height }

  const hasSettings = Object.keys(manifest?.configSchema || {}).length > 0
  const canExpand   = !editing && manifest?.expandable

  return (
    <div
      className={`zw-mod${dragging ? ' is-dragging' : ''}${resizing ? ' is-resizing' : ''}`}
      style={style}
      data-module-id={mod.id}
      onPointerDown={editing ? (e) => onDragStart(e, mod) : undefined}
    >
      {/* Tap-to-expand sits UNDER the card's own controls, so tapping a
          checkbox still ticks it and only tapping empty space opens the
          overlay. A card you can control must not become a card you can only
          open. */}
      {canExpand && (
        <button
          className="zw-expand-hit"
          aria-label={t('wall.expand')}
          onClick={() => onExpand(mod)}
          tabIndex={-1}
        />
      )}
      {editing && (
        <div className="zw-mod-tools">
          {hasSettings && (
            <button
              className="zw-tool"
              aria-label={t('wall.editConfigure')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onConfigure(mod.id) }}
            >⚙</button>
          )}
          <button
            className="zw-tool is-danger"
            aria-label={t('wall.editRemove')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); ctx.removeModule(mod.id) }}
          >✕</button>
        </div>
      )}

      {Component
        ? <Component mod={mod} manifest={manifest} ctx={ctx} />
        : <div className="zw-card"><div className="zw-empty">{mod.type}</div></div>}

      {editing && (
        <button
          className="zw-resize"
          aria-label="resize"
          onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e, mod) }}
        />
      )}
    </div>
  )
})

// ─── board ──────────────────────────────────────────────────────────────────

export default function WallGrid({ ctx }) {
  const t = useT()
  const editing  = useWallStore((s) => s.editing)
  const layout   = useWallStore((s) => s.layout)
  const draft    = useWallStore((s) => s.draft)
  const cols     = useWallStore((s) => s.cols)
  const setCols  = useWallStore((s) => s.setCols)
  const moveModule   = useWallStore((s) => s.moveModule)
  const resizeModule = useWallStore((s) => s.resizeModule)
  const endGesture   = useWallStore((s) => s.endGesture)

  // The authored layout is never mutated by a resize. What we render is the
  // authored arrangement fitted to the width we happen to be at, recomputed
  // on the fly — so rotating the tablet and rotating back restores exactly
  // what the user arranged.
  const modules = useMemo(() => {
    if (editing) return draft?.modules || []
    if (!layout) return []
    return refit(layout.modules, layout.cols || cols, cols, getManifest)
  }, [editing, draft, layout, cols])

  const boardRef = useRef(null)
  const [boardW, setBoardW] = useState(0)
  // Height of the scroll viewport, used to stretch rows so the board fills
  // the screen on tall portrait panels instead of leaving dead space.
  const [availH, setAvailH] = useState(0)

  // Gesture state lives in a ref: pointermove fires at display rate and we do
  // not want a React render per frame. Only the *snapped cell* changes go
  // through the store, and the dragged card's pixel position goes through a
  // single lightweight state slot.
  const gesture = useRef(null)
  const [ghost, setGhost] = useState(null)      // pixel position of the dragged card
  const [activeId, setActiveId] = useState(null)
  const [mode, setMode] = useState(null)        // 'drag' | 'resize'

  // Row height mirrored into a ref. The pointer handlers are created once per
  // gesture and would otherwise close over a stale value if the board resized
  // mid-drag (rotating the tablet, or the on-screen keyboard opening).
  const rowHRef = useRef(ROW_H)

  const [configId, setConfigId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  // Leaving edit mode must not strand an open settings sheet.
  useEffect(() => { if (!editing) setConfigId(null) }, [editing])

  // ── measure ───────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = boardRef.current
    if (!el) return
    const measure = (w) => { setBoardW(w); setCols(colsForWidth(w)) }
    const ro = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width)
      // The wrapper is the scroll viewport; the board itself grows with content.
      setAvailH(el.parentElement?.clientHeight || 0)
    })
    ro.observe(el)
    measure(el.clientWidth)
    setAvailH(el.parentElement?.clientHeight || 0)
    return () => ro.disconnect()
  }, [setCols])

  // ── drag ──────────────────────────────────────────────────────────────────

  // How long a finger must rest on a card before it becomes a drag, and how far
  // it may stray in that time. Below this, the touch is a scroll.
  // Slightly longer than a tap, short enough not to feel like waiting. This
  // is now the only way to pick a card up, so it has to be forgiving.
  const LONG_PRESS_MS = 320
  const MOVE_TOLERANCE = 10
  const pressTimer = useRef(null)

  const cancelPress = useCallback(() => {
    clearTimeout(pressTimer.current)
    pressTimer.current = null
  }, [])

  // Kept module-stable so add/removeEventListener see the same reference.
  const blockScrollRef = useRef(null)
  if (!blockScrollRef.current) blockScrollRef.current = (ev) => { ev.preventDefault() }
  const _blockScroll = blockScrollRef.current

  /**
   * Long-press to pick a card up; a plain drag scrolls the board.
   *
   * The first version started dragging on pointerdown and set
   * `touch-action: none` on the whole board, which made the board impossible
   * to SCROLL in edit mode — so any card below the fold was unreachable, and
   * you could not edit the thing you were trying to edit. Deferring the drag
   * until the finger has rested is the standard phone-home-screen gesture and
   * leaves normal scrolling intact.
   */
  const onDragStart = useCallback((e, mod, viaHandle = false) => {
    if (!boardW) return
    // Ignore secondary buttons and multi-touch — a second finger during a drag
    // should not hijack the gesture.
    if (e.button != null && e.button !== 0) return

    const startX = e.clientX
    const startY = e.clientY
    const pointerId = e.pointerId
    const target = e.currentTarget

    // A mouse is precise and has no scroll ambiguity; the grip handle is an
    // unambiguous, deliberate target. Both pick the card up at once. Only a
    // finger on the card BODY has to wait, because that same gesture is also
    // how you scroll the board.
    const immediate = viaHandle || e.pointerType === 'mouse'

    const begin = () => {
      const r = rectFor(mod, cols, boardW, rowHRef.current)
      gesture.current = {
        id: mod.id,
        startX, startY,
        originLeft: r.left, originTop: r.top,
        lastCellX: mod.x, lastCellY: mod.y,
      }
      setActiveId(mod.id)
      setMode('drag')
      setGhost({ left: r.left, top: r.top })
      try { target.setPointerCapture?.(pointerId) } catch { /* element may be gone */ }
      // Suppress native scrolling for the rest of the gesture. `touch-action`
      // is evaluated by the browser at touch-START, so flipping it once the
      // long-press fires is too late — the browser has already decided this
      // touch is a scroll, and would either pan the board under the card or
      // fire pointercancel and kill the drag outright. A non-passive
      // touchmove that preventDefaults is the only thing that actually stops
      // it mid-gesture.
      window.addEventListener('touchmove', _blockScroll, { passive: false })
      // A short buzz confirms the card is now "in hand" — without it, a
      // long-press feels like nothing happened.
      try { navigator.vibrate?.(12) } catch { /* unsupported */ }
    }

    if (immediate) { begin(); return }

    // Abort the pending pick-up if the finger travels: that is a scroll.
    const watch = (ev) => {
      if (Math.abs(ev.clientX - startX) > MOVE_TOLERANCE ||
          Math.abs(ev.clientY - startY) > MOVE_TOLERANCE) {
        cancelPress()
        window.removeEventListener('pointermove', watch)
      }
    }
    window.addEventListener('pointermove', watch, { passive: true })
    const stop = () => {
      cancelPress()
      window.removeEventListener('pointermove', watch)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointerup', stop, { passive: true })
    window.addEventListener('pointercancel', stop, { passive: true })

    pressTimer.current = setTimeout(() => {
      window.removeEventListener('pointermove', watch)
      begin()
    }, LONG_PRESS_MS)
  }, [cols, boardW, cancelPress])

  useEffect(() => () => cancelPress(), [cancelPress])

  const onResizeStart = useCallback((e, mod) => {
    if (!boardW) return
    const r = rectFor(mod, cols, boardW, rowHRef.current)
    gesture.current = {
      id: mod.id,
      startX: e.clientX, startY: e.clientY,
      originW: r.width, originH: r.height,
      lastW: mod.w, lastH: mod.h,
      // RTL grows the card toward the *left*, so the horizontal delta flips.
      dirFactor: document?.documentElement?.dir === 'rtl' ? -1 : 1,
    }
    setActiveId(mod.id)
    setMode('resize')
    e.currentTarget.setPointerCapture?.(e.pointerId)
    window.addEventListener('touchmove', _blockScroll, { passive: false })
  }, [cols, boardW, _blockScroll])

  useEffect(() => {
    if (!mode) return

    const colW = (boardW - GRID_GAP * (cols - 1)) / cols

    const onMove = (e) => {
      const g = gesture.current
      if (!g) return

      if (mode === 'drag') {
        const left = g.originLeft + (e.clientX - g.startX)
        const top  = g.originTop  + (e.clientY - g.startY)
        setGhost({ left, top })

        const cell = cellFromPx(left, top, cols, boardW, rowHRef.current)
        // Only touch the store when the snapped cell actually changes —
        // otherwise every frame triggers a full reflow + re-render.
        if (cell.x !== g.lastCellX || cell.y !== g.lastCellY) {
          g.lastCellX = cell.x
          g.lastCellY = cell.y
          moveModule(g.id, cell.x, cell.y)
        }
      } else {
        const dw = (e.clientX - g.startX) * g.dirFactor
        const dh = e.clientY - g.startY
        const w = Math.max(1, Math.round((g.originW + dw + GRID_GAP) / (colW + GRID_GAP)))
        const h = Math.max(1, Math.round((g.originH + dh + GRID_GAP) / (rowHRef.current + GRID_GAP)))
        if (w !== g.lastW || h !== g.lastH) {
          g.lastW = w
          g.lastH = h
          resizeModule(g.id, w, h)
        }
      }
    }

    const onEnd = () => {
      cancelPress()
      window.removeEventListener('touchmove', _blockScroll)
      gesture.current = null
      setGhost(null)
      setActiveId(null)
      setMode(null)
      // Apply gravity now that nothing is pinned under a finger.
      endGesture()
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onEnd, { passive: true })
    window.addEventListener('pointercancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [mode, cols, boardW, moveModule, resizeModule])

  // Leaving edit mode mid-gesture must not strand the handlers.
  useEffect(() => { if (!editing && mode) { gesture.current = null; setMode(null); setGhost(null); setActiveId(null) } }, [editing, mode])

  const rows   = layoutRows(modules)
  const rowH   = rowHeightFor(modules, availH)
  const boardH = rows * rowH + Math.max(0, rows - 1) * GRID_GAP
  rowHRef.current = rowH

  return (
    <div className="zw-board-wrap">
      <div
        className="zw-board"
        ref={boardRef}
        // `touch-action` is only suppressed while a card is actually in hand.
        // Setting it for all of edit mode stopped the board scrolling, which
        // made any card below the fold impossible to reach.
        style={{ height: boardH, touchAction: mode ? 'none' : 'auto' }}
      >
        {boardW > 0 && modules.map((mod) => {
          const rect = rectFor(mod, cols, boardW, rowH)
          const isDragging = mode === 'drag' && activeId === mod.id
          return (
            <ModuleHost
              key={mod.id}
              mod={mod}
              rect={rect}
              editing={editing}
              dragging={isDragging}
              resizing={mode === 'resize' && activeId === mod.id}
              override={isDragging ? ghost : null}
              ctx={ctx}
              onDragStart={onDragStart}
              onResizeStart={onResizeStart}
              onConfigure={setConfigId}
              onExpand={setExpanded}
            />
          )
        })}

        {/* Landing pad under the dragged card, so the target cell is legible
            even while the card itself floats under the finger. */}
        {mode === 'drag' && activeId && boardW > 0 && (() => {
          const m = modules.find((x) => x.id === activeId)
          if (!m) return null
          const r = rectFor(m, cols, boardW, rowH)
          return <div className="zw-drop-ghost" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
        })()}

        {modules.length === 0 && (
          <div className="zw-empty" style={{ paddingTop: 60 }}>{t('wall.emptyBoard')}</div>
        )}
      </div>

      {configId && <ModuleConfigSheet modId={configId} onClose={() => setConfigId(null)} />}
      {expanded && <ModuleExpanded mod={expanded} ctx={ctx} onClose={() => setExpanded(null)} />}
    </div>
  )
}
