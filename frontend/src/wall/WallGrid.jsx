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

// ─── one placed module ──────────────────────────────────────────────────────

const ModuleHost = memo(function ModuleHost({
  mod, rect, editing, dragging, resizing, override, ctx, onDragStart, onResizeStart,
}) {
  const t = useT()
  const manifest = getManifest(mod.type)
  const Component = MODULE_COMPONENTS[mod.type]

  const style = override
    ? { left: override.left, top: override.top, width: rect.width, height: rect.height }
    : { left: rect.left, top: rect.top, width: rect.width, height: rect.height }

  return (
    <div
      className={`zw-mod${dragging ? ' is-dragging' : ''}${resizing ? ' is-resizing' : ''}`}
      style={style}
      data-module-id={mod.id}
      onPointerDown={editing ? (e) => onDragStart(e, mod) : undefined}
    >
      {editing && (
        <div className="zw-mod-tools">
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

  const onDragStart = useCallback((e, mod) => {
    if (!boardW) return
    // Ignore secondary buttons and multi-touch — a second finger during a drag
    // should not hijack the gesture.
    if (e.button != null && e.button !== 0) return
    const r = rectFor(mod, cols, boardW, rowHRef.current)
    gesture.current = {
      id: mod.id,
      startX: e.clientX, startY: e.clientY,
      originLeft: r.left, originTop: r.top,
      lastCellX: mod.x, lastCellY: mod.y,
    }
    setActiveId(mod.id)
    setMode('drag')
    setGhost({ left: r.left, top: r.top })
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [cols, boardW])

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
  }, [cols, boardW])

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
        style={{ height: boardH, touchAction: editing ? 'none' : 'auto' }}
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
    </div>
  )
}
