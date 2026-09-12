// The lab shell — the instrument, not the exhibit.
//
// Its whole job is to make ten complete front ends comparable, so every
// decision here is about removing variables between one look and the next:
//
//  - The frame never changes size when the palette does, so nothing jumps and
//    your eye stays on the same rectangle.
//  - Scroll position is kept as a RATIO across a palette switch, so "the
//    devices block" stays under your cursor when you flick between two
//    directions instead of snapping back to the top.
//  - Side-by-side is forced onto the same screen, and its two scrollers are
//    linked, because comparing a Home against a Device page proves nothing.
//  - The grid renders ten REAL concepts and scales them with a transform. A
//    thumbnail that is a shrunk truth can be trusted; a simplified one can't.
//
// Nothing in this file may take a colour from a palette — see lab.css. The
// shell is a fixed neutral grey so you are judging ten palettes, not eleven.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Concept from './Concept'
import { PALETTES, byId, indexOf } from './palettes'

/* Screen ids come from Concept; the labels are Ziggy's words for them. */
const SCREENS = [
  ['home', 'Home'],
  ['rooms', 'Rooms'],
  ['device', 'Devices'],
  ['assistant', 'Ziggy'],
  ['actions', 'Actions'],
]

const VP = {
  mobile: { w: 390, h: 844, cls: 'lab-phone', label: 'Phone 390×844' },
  desktop: { w: 1280, h: 800, cls: 'lab-desktop', label: 'Desktop 1280×800' },
}

/* sessionStorage only — localStorage is shared with the real app and is out of
   bounds. A lab that forgets where you were between reloads is annoying; a lab
   that writes into the product's storage is dangerous. */
const NS = 'ziggy-palette-lab:'
const read = (k, d) => {
  try {
    const v = sessionStorage.getItem(NS + k)
    return v === null ? d : JSON.parse(v)
  } catch {
    return d
  }
}
function usePersisted(key, initial) {
  const [v, setV] = useState(() => read(key, initial))
  useEffect(() => {
    try { sessionStorage.setItem(NS + key, JSON.stringify(v)) } catch { /* private mode */ }
  }, [key, v])
  return [v, setV]
}

/* The concept's body scroller is an implementation detail of Concept, so we
   find it rather than require it to announce itself: the first descendant that
   actually overflows vertically and is allowed to scroll. The overflow guard
   matters — the mobile room carousel is an overflow-x scroller whose computed
   overflow-y is also `auto`, and it must not win. */
function findScroller(root) {
  if (!root) return null
  for (const n of root.querySelectorAll('div')) {
    if (n.scrollHeight - n.clientHeight > 8) {
      const ov = getComputedStyle(n).overflowY
      if (ov === 'auto' || ov === 'scroll') return n
    }
  }
  return null
}

const Hexes = ({ p }) => (
  <span className="lab-hex">{p.swatch.map((h) => <span key={h}>{h}</span>)}</span>
)

const Swatch = ({ p, sm }) => (
  <span className={sm ? 'lab-swatch sm' : 'lab-swatch'} title={p.swatch.join('  ')}>
    {p.swatch.map((h) => <i key={h} style={{ background: h }} />)}
  </span>
)

/* The design DNA in one line. Two palettes can share a hue and still be
   completely different products; these are the fields that say how. */
const dna = (p) =>
  `${p.mode} · ${p.nav} nav · ${p.tile} tiles · ${p.icons} icons · ${p.border} edges · radius ${p.shape.card} · gap ${p.space.gap}`

/* ------------------------------------------------------------------ frames */

function Frame({ palette, viewport, screen, onScreen, frameRef }) {
  const vp = VP[viewport]
  return (
    <div ref={frameRef} className={`lab-frame ${vp.cls}`}>
      {/* Keyed on palette + viewport so a switch is a clean remount. Two
          palettes have genuinely different trees; reconciling them risks a
          stale style surviving into the next direction and lying to you. */}
      <Concept
        key={`${palette.id}:${viewport}`}
        palette={palette}
        viewport={viewport}
        screen={screen}
        onScreen={onScreen}
      />
    </div>
  )
}

function Fit({ w, h, scale, children }) {
  return (
    <div style={{ width: w * scale, height: h * scale, flexShrink: 0 }}>
      <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- pieces */

/* True on a phone. The lab is an instrument built for a wide screen, but the
   thing it is showing IS a phone app, so being able to hold a direction in your
   hand is worth more than any amount of desk comparison. On a narrow screen the
   rail becomes a slide-over, the concept gets the whole screen at 1:1, and a
   swipe changes direction. */
function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const on = (e) => setNarrow(e.matches)
    mq.addEventListener('change', on)
    setNarrow(mq.matches)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

function Rail({ current, left, right, mode, side, onPick, narrow, open, onClose }) {
  if (narrow && !open) return null
  return (
    <aside className="lab-rail" data-sheet={narrow ? 'true' : undefined}>
      {narrow && (
        <button className="lab-btn lab-sheet-close" onClick={onClose} aria-label="Close">
          Done
        </button>
      )}
      <div className="lab-rail-head">
        <div className="lab-rail-title">Ten directions</div>
        <div className="lab-rail-sub">
          {mode === 'compare'
            ? `Click sets the ${side} pane · arrows too`
            : 'Click, or ← → , or 1–0'}
        </div>
      </div>
      <div className="lab-rail-list lab-scroll">
        {PALETTES.map((p, i) => {
          const on = mode === 'compare' ? (p.id === left || p.id === right) : p.id === current
          const focused = mode === 'compare'
            ? p.id === (side === 'left' ? left : right)
            : p.id === current
          return (
            <button
              key={p.id}
              className="lab-rail-item"
              data-on={String(on)}
              data-focus={String(focused)}
              onClick={() => onPick(p.id)}
              title={p.thesis}
            >
              <span className="lab-rail-row">
                <span className="lab-rail-n">{(i + 1) % 10}</span>
                <span className="lab-rail-name">{p.name}</span>
                {mode === 'compare' && p.id === left && <span className="lab-tag">L</span>}
                {mode === 'compare' && p.id === right && <span className="lab-tag">R</span>}
              </span>
              <Swatch p={p} sm />
              <Hexes p={p} />
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function Seg({ items, value, onChange }) {
  return (
    <div className="lab-seg">
      {items.map(([v, label]) => (
        <button
          key={v}
          className="lab-btn"
          data-on={String(v === value)}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function SidePicker({ label, id, onChange, onStep, width }) {
  const p = byId(id)
  return (
    <div className="lab-side-head" style={{ width }}>
      <div className="lab-side-row">
        <span className="lab-side-label">{label}</span>
        <button className="lab-btn lab-icon-btn" onClick={() => onStep(-1)} title="Previous palette">‹</button>
        <select className="lab-select" value={id} onChange={(e) => onChange(e.target.value)}>
          {PALETTES.map((q, i) => (
            <option key={q.id} value={q.id}>{`${i + 1}. ${q.name}`}</option>
          ))}
        </select>
        <button className="lab-btn lab-icon-btn" onClick={() => onStep(1)} title="Next palette">›</button>
        <Swatch p={p} sm />
      </div>
      <div className="lab-side-thesis">{p.thesis}</div>
    </div>
  )
}

function Help({ onClose }) {
  const rows = [
    ['← →  /  ↑ ↓', 'Previous / next palette'],
    ['1 … 9 , 0', 'Jump straight to palette 1–10'],
    ['[  ]', 'Previous / next screen'],
    ['v', 'Toggle phone / desktop'],
    ['s  c  g', 'Single · Compare · Grid'],
    ['l  r', 'In compare: aim the arrows at the left / right pane'],
    ['f', 'In compare: swap the two panes'],
    ['Enter', 'In grid: open the highlighted palette'],
    ['?', 'This panel · Esc closes'],
  ]
  return (
    <div className="lab-help" onClick={onClose}>
      <div className="lab-help-card" onClick={(e) => e.stopPropagation()}>
        <div className="lab-help-title">Keys</div>
        {rows.map(([k, d]) => (
          <div className="lab-help-row" key={k}>
            <span className="lab-kbd">{k}</span>
            <span>{d}</span>
          </div>
        ))}
        <button className="lab-btn" style={{ marginTop: 14 }} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------- lab */

export default function Lab() {
  const [mode, setMode] = usePersisted('mode', 'single')       // single | compare | grid
  const [viewport, setViewport] = usePersisted('viewport', 'mobile')
  const [screen, setScreenRaw] = usePersisted('screen', 'home')
  const [current, setCurrent] = usePersisted('current', PALETTES[0].id)
  const [left, setLeft] = usePersisted('left', PALETTES[0].id)
  const [right, setRight] = usePersisted('right', PALETTES[2].id)
  const [side, setSide] = usePersisted('side', 'left')
  const [sync, setSync] = usePersisted('sync', true)
  const [help, setHelp] = useState(false)
  const narrow = useNarrow()
  const [railOpen, setRailOpen] = useState(false)

  const stageRef = useRef(null)
  const singleRef = useRef(null)
  const leftRef = useRef(null)
  const rightRef = useRef(null)
  const ratioRef = useRef(0)
  const lockRef = useRef(false)

  // A phone can only meaningfully show the phone viewport, and only one frame.
  // Compare is corrected in state (one place, so every branch below stays
  // simple); the viewport is pinned locally so widening the window restores the
  // desktop preview the person had chosen.
  useEffect(() => {
    if (narrow && mode === 'compare') setMode('single')
  }, [narrow, mode, setMode])
  const vp = VP[narrow ? 'mobile' : viewport]

  /* A different screen is a different page; carrying a scroll ratio across it
     would land you somewhere arbitrary. */
  const setScreen = useCallback((s) => { ratioRef.current = 0; setScreenRaw(s) }, [setScreenRaw])

  const activeId = mode === 'compare' ? (side === 'left' ? left : right) : current
  const setActiveId = useCallback((id) => {
    if (mode === 'compare') (side === 'left' ? setLeft : setRight)(id)
    else setCurrent(id)
  }, [mode, side, setLeft, setRight, setCurrent])

  const step = useCallback((d) => {
    const i = indexOf(activeId)
    setActiveId(PALETTES[(i + d + PALETTES.length) % PALETTES.length].id)
  }, [activeId, setActiveId])

  const stepScreen = useCallback((d) => {
    const i = SCREENS.findIndex(([s]) => s === screen)
    setScreen(SCREENS[(i + d + SCREENS.length) % SCREENS.length][0])
  }, [screen, setScreen])

  /* -------------------------------------------------------------- keyboard */
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return
      const k = e.key
      if (k === 'Escape') { setHelp(false); if (mode === 'grid') setMode('single'); return }
      if (k === '?') { setHelp((v) => !v); return }
      if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); step(-1); return }
      if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); step(1); return }
      if (k === '[') { stepScreen(-1); return }
      if (k === ']') { stepScreen(1); return }
      if (k === 'v') { setViewport((v) => (v === 'mobile' ? 'desktop' : 'mobile')); return }
      if (k === 's') { setMode('single'); return }
      if (k === 'c') { setMode('compare'); return }
      if (k === 'g') { setMode('grid'); return }
      if (k === 'l' && mode === 'compare') { setSide('left'); return }
      if (k === 'r' && mode === 'compare') { setSide('right'); return }
      if (k === 'f' && mode === 'compare') { setLeft(right); setRight(left); return }
      if (k === 'Enter' && mode === 'grid') { setMode('single'); return }
      if (/^[0-9]$/.test(k)) {
        const i = k === '0' ? 9 : Number(k) - 1
        if (i < PALETTES.length) setActiveId(PALETTES[i].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, left, right, step, stepScreen, setActiveId, setMode, setViewport, setSide, setLeft, setRight])

  /* ------------------------------------------------- scroll: record + link */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onScroll = (e) => {
      const t = e.target
      if (!t || !t.scrollHeight) return
      const max = t.scrollHeight - t.clientHeight
      if (max <= 8) return
      ratioRef.current = t.scrollTop / max
      if (lockRef.current) return
      if (mode !== 'compare' || !sync) return
      lockRef.current = true
      for (const f of [leftRef.current, rightRef.current]) {
        if (!f || f.contains(t)) continue
        const s = findScroller(f)
        if (!s) continue
        const m = s.scrollHeight - s.clientHeight
        if (m > 8) s.scrollTop = ratioRef.current * m
      }
      requestAnimationFrame(() => { lockRef.current = false })
    }
    el.addEventListener('scroll', onScroll, true)
    return () => el.removeEventListener('scroll', onScroll, true)
  }, [mode, sync])

  /* ------------------------------------------- scroll: restore after switch */
  useLayoutEffect(() => {
    if (mode === 'grid') return
    const r = ratioRef.current
    if (!r) return
    let b
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => {
        lockRef.current = true
        for (const f of [singleRef.current, leftRef.current, rightRef.current]) {
          const s = findScroller(f)
          if (!s) continue
          const m = s.scrollHeight - s.clientHeight
          if (m > 8) s.scrollTop = r * m
        }
        requestAnimationFrame(() => { lockRef.current = false })
      })
    })
    return () => { cancelAnimationFrame(a); if (b) cancelAnimationFrame(b) }
  }, [current, left, right, mode, viewport, screen])

  /* ----------------------------------------------------------- fit to stage */
  const count = mode === 'compare' ? 2 : 1
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    // On a phone the frame should fill the screen, so the desk-view padding
    // budget would shrink it for no reason.
    const PAD = narrow ? 8 : 48
    const GAP = 22
    // Compare puts a picker + thesis above each frame; that strip is part of
    // the pane's height, so it has to come out of the budget or the frames
    // hang off the bottom of the stage.
    const HEAD = mode === 'compare' ? 112 : 0
    const measure = () => {
      if (mode === 'grid') { setScale(1); return }
      const availW = el.clientWidth - PAD - GAP * (count - 1)
      const availH = el.clientHeight - PAD - HEAD
      const next = Math.min(1, availW / (vp.w * count), availH / vp.h)
      setScale(Math.max(0.2, Number.isFinite(next) ? next : 1))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode, count, vp.w, vp.h, narrow])

  /* ------------------------------------------------------- swipe (phone) */
  // There is no keyboard on a phone, so the arrow keys that drive this on a
  // desk have no equivalent. A horizontal swipe on the stage steps direction.
  // It only commits on a gesture that is clearly horizontal — the concept
  // inside scrolls vertically and a carousel inside it scrolls horizontally,
  // so a lazy threshold here would steal both.
  useEffect(() => {
    if (!narrow) return undefined
    const el = stageRef.current
    if (!el) return undefined
    let x0 = 0, y0 = 0, t0 = 0, tracking = false
    const down = (e) => {
      const t = e.touches ? e.touches[0] : e
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); tracking = true
    }
    const up = (e) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches ? e.changedTouches[0] : e
      const dx = t.clientX - x0
      const dy = t.clientY - y0
      // Horizontal by a factor of two, far enough to be deliberate, and quick
      // enough to be a flick rather than a drag that happened to end sideways.
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return
      if (Date.now() - t0 > 700) return
      step(dx < 0 ? 1 : -1)
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchend', up, { passive: true })
    return () => {
      el.removeEventListener('touchstart', down)
      el.removeEventListener('touchend', up)
    }
  }, [narrow, step])

  /* --------------------------------------------------------------- render */
  const cur = byId(current)
  const lp = byId(left)
  const rp = byId(right)

  // Narrower on a phone so two fit across. This is the single source of the
  // thumbnail's size — the CSS must not set a column width, or the shell and
  // the scaled concept inside it disagree and the thumbnails clip.
  const thumbW = viewport === 'desktop' && !narrow ? 400 : narrow ? 168 : 200
  const thumbScale = thumbW / vp.w
  // A compare pane is at least as wide as its own picker row, so a scaled-down
  // phone doesn't leave the select overlapping the other pane.
  const paneW = Math.max(330, Math.round(vp.w * scale))

  return (
    <div className="lab-root" data-narrow={String(narrow)}>
      {narrow && railOpen && <div className="lab-sheet-back" onClick={() => setRailOpen(false)} />}
      <Rail
        current={current}
        left={left}
        right={right}
        mode={mode}
        side={side}
        narrow={narrow}
        open={railOpen}
        onClose={() => setRailOpen(false)}
        onPick={(id) => {
          if (mode === 'grid') { setCurrent(id); setMode('single') }
          else setActiveId(id)
          if (narrow) setRailOpen(false)
        }}
      />

      <div className="lab-main">
        <header className="lab-top">
          {narrow && (
            <button className="lab-btn" onClick={() => setRailOpen(true)}>
              ☰ {cur.name}
            </button>
          )}
          <Seg
            // Compare needs two frames side by side, which a phone cannot give
            // without shrinking both past the point of being judgeable. It is
            // hidden here rather than offered and disappointing.
            items={narrow
              ? [['single', 'One'], ['grid', 'All 10']]
              : [['single', 'Single'], ['compare', 'Compare'], ['grid', 'Grid of 10']]}
            value={mode === 'compare' && narrow ? 'single' : mode}
            onChange={setMode}
          />
          <span className="lab-div" />
          <Seg items={SCREENS} value={screen} onChange={setScreen} />
          <span className="lab-div" />
          <Seg
            items={[['mobile', 'Phone'], ['desktop', 'Desktop']]}
            value={viewport}
            onChange={setViewport}
          />

          <span className="lab-spacer" />

          {mode === 'compare' && (
            <>
              <Seg items={[['left', 'Arrows ▸ L'], ['right', 'Arrows ▸ R']]} value={side} onChange={setSide} />
              <button className="lab-btn" onClick={() => { setLeft(right); setRight(left) }} title="Swap panes (f)">Swap</button>
              <button className="lab-btn" data-on={String(sync)} onClick={() => setSync((v) => !v)} title="Link the two scrollers">
                Link scroll
              </button>
            </>
          )}

          {mode !== 'compare' && (
            <div className="lab-nav">
              <button className="lab-btn lab-icon-btn" onClick={() => step(-1)} title="Previous palette (←)">‹</button>
              <span className="lab-now">
                <b>{indexOf(activeId) + 1}/10</b> {byId(activeId).name}
              </span>
              <button className="lab-btn lab-icon-btn" onClick={() => step(1)} title="Next palette (→)">›</button>
            </div>
          )}

          <span className="lab-scaletag">
            {vp.label}{scale < 0.999 && mode !== 'grid' ? ` · ${Math.round(scale * 100)}%` : ''}
          </span>
          <button className="lab-btn" onClick={() => setHelp(true)} title="Keyboard shortcuts">?</button>
        </header>

        <div className="lab-stage lab-scroll" data-mode={mode} ref={stageRef}>
          {mode === 'single' && (
            <Fit w={vp.w} h={vp.h} scale={scale}>
              <Frame
                palette={cur}
                viewport={viewport}
                screen={screen}
                onScreen={setScreen}
                frameRef={singleRef}
              />
            </Fit>
          )}

          {mode === 'compare' && (
            <div className="lab-pair">
              <div className="lab-pane" data-focus={String(side === 'left')}>
                <SidePicker
                  label="Left"
                  id={left}
                  width={paneW}
                  onChange={(id) => { setSide('left'); setLeft(id) }}
                  onStep={(d) => { setSide('left'); setLeft(PALETTES[(indexOf(left) + d + 10) % 10].id) }}
                />
                <Fit w={vp.w} h={vp.h} scale={scale}>
                  <Frame palette={lp} viewport={viewport} screen={screen} onScreen={setScreen} frameRef={leftRef} />
                </Fit>
              </div>
              <div className="lab-pane" data-focus={String(side === 'right')}>
                <SidePicker
                  label="Right"
                  id={right}
                  width={paneW}
                  onChange={(id) => { setSide('right'); setRight(id) }}
                  onStep={(d) => { setSide('right'); setRight(PALETTES[(indexOf(right) + d + 10) % 10].id) }}
                />
                <Fit w={vp.w} h={vp.h} scale={scale}>
                  <Frame palette={rp} viewport={viewport} screen={screen} onScreen={setScreen} frameRef={rightRef} />
                </Fit>
              </div>
            </div>
          )}

          {mode === 'grid' && (
            <div className="lab-grid" style={{ '--thumb': `${thumbW}px` }}>
              {PALETTES.map((p, i) => (
                // Not a <button>: a concept contains real buttons of its own,
                // and a button inside a button is invalid HTML that React will
                // (rightly) shout about.
                <div
                  key={p.id}
                  className="lab-grid-card"
                  role="button"
                  tabIndex={0}
                  data-on={String(p.id === current)}
                  onClick={() => { setCurrent(p.id); setMode('single') }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault(); setCurrent(p.id); setMode('single')
                    }
                  }}
                  title={p.thesis}
                >
                  <div
                    className="lab-thumb-shell"
                    style={{ width: thumbW, height: Math.round(vp.h * thumbScale) }}
                  >
                    <div
                      className={`lab-frame lab-thumb ${vp.cls}`}
                      style={{
                        width: vp.w, height: vp.h, borderRadius: 0, border: 'none',
                        boxShadow: 'none', transform: `scale(${thumbScale})`,
                      }}
                    >
                      {/* A real concept, scaled. Not a mock of one. */}
                      <Concept palette={p} viewport={viewport} screen={screen} onScreen={() => {}} />
                    </div>
                  </div>
                  <div className="lab-grid-meta">
                    <span className="lab-rail-row">
                      <span className="lab-rail-n">{(i + 1) % 10}</span>
                      <span className="lab-rail-name">{p.name}</span>
                    </span>
                    <Swatch p={p} sm />
                    <Hexes p={p} />
                    <span className="lab-grid-thesis">{p.thesis}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="lab-foot">
          {mode === 'compare' ? (
            <>
              <span className="lab-foot-one"><b>L · {lp.name}</b> — {lp.thesis}</span>
              <span className="lab-foot-one"><b>R · {rp.name}</b> — {rp.thesis}</span>
            </>
          ) : (
            <>
              <span className="lab-foot-one"><b>{byId(activeId).name}</b> — {byId(activeId).thesis}</span>
              <Hexes p={byId(activeId)} />
              <span className="lab-dna">{dna(byId(activeId))}</span>
            </>
          )}
        </footer>
      </div>

      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  )
}
