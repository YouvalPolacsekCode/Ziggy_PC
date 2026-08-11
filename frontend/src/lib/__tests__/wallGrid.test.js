import { describe, it, expect } from 'vitest'
import {
  collides, reflow, place, resize, insert, remove, refit,
  clampSize, colsForWidth, rectFor, cellFromPx, layoutRows, isValid,
  rowHeightFor,
  DEFAULT_COLS, ROW_H, GRID_GAP,
} from '../wallGrid'

// Compact fixture helper: m('a', x, y, w, h)
const m = (id, x, y, w, h) => ({ id, type: 't', x, y, w, h })

const MAN = { minW: 2, minH: 2, defaultW: 4, defaultH: 3, maxW: 8, maxH: 10 }

describe('collides', () => {
  it('detects overlap', () => {
    expect(collides(m('a', 0, 0, 4, 4), m('b', 2, 2, 4, 4))).toBe(true)
  })
  it('treats touching edges as non-overlapping', () => {
    expect(collides(m('a', 0, 0, 4, 4), m('b', 4, 0, 4, 4))).toBe(false)
    expect(collides(m('a', 0, 0, 4, 4), m('b', 0, 4, 4, 4))).toBe(false)
  })
  it('never collides with itself', () => {
    const a = m('a', 0, 0, 4, 4)
    expect(collides(a, a)).toBe(false)
    expect(collides(a, { ...a })).toBe(false)
  })
})

describe('reflow', () => {
  it('floats modules to the top', () => {
    const out = reflow([m('a', 0, 5, 4, 2)])
    expect(out[0].y).toBe(0)
  })

  it('stacks without overlapping', () => {
    const out = reflow([m('a', 0, 9, 4, 3), m('b', 0, 2, 4, 2)])
    expect(isValid(out)).toBe(true)
    // b was higher, so it settles on top
    const b = out.find((x) => x.id === 'b')
    const a = out.find((x) => x.id === 'a')
    expect(b.y).toBe(0)
    expect(a.y).toBe(b.h)
  })

  it('lets modules in different columns both reach the top', () => {
    const out = reflow([m('a', 0, 4, 4, 2), m('b', 6, 7, 4, 2)])
    expect(out.every((x) => x.y === 0)).toBe(true)
  })

  it('is idempotent', () => {
    const once  = reflow([m('a', 0, 3, 4, 2), m('b', 2, 8, 6, 3), m('c', 8, 1, 4, 4)])
    const twice = reflow(once)
    expect(twice).toEqual(once)
  })

  it('pulls out-of-bounds modules back inside', () => {
    const out = reflow([m('a', 11, 0, 6, 2)])
    expect(out[0].x + out[0].w).toBeLessThanOrEqual(DEFAULT_COLS)
    expect(isValid(out)).toBe(true)
  })

  // Regression: reflow used to only float modules UPWARD, assuming its input
  // was already overlap-free. refit() breaks that assumption — scaling a
  // 12-col layout onto 8 makes side-by-side cards overlap. The old code left
  // the overlap on screen (Shopping and Scenes visibly stacked on top of each
  // other on a 1280px tablet).
  it('resolves an overlap present in its input', () => {
    const overlapping = [m('a', 3, 2, 3, 5), m('b', 5, 2, 3, 3)]
    const out = reflow(overlapping, 8)
    expect(isValid(out, 8)).toBe(true)
  })

  it('resolves a pile of mutually overlapping modules', () => {
    const pile = [m('a', 0, 0, 6, 3), m('b', 2, 1, 6, 3), m('c', 4, 2, 6, 3), m('d', 0, 0, 12, 2)]
    const out = reflow(pile)
    expect(isValid(out)).toBe(true)
    expect(out).toHaveLength(4)
  })

  it('honours a pinned module: it keeps its exact position', () => {
    const out = reflow([m('a', 0, 0, 4, 2), m('b', 0, 0, 4, 2)], DEFAULT_COLS, 'b')
    const b = out.find((x) => x.id === 'b')
    expect(b).toMatchObject({ x: 0, y: 0 })
    expect(isValid(out)).toBe(true)
  })

  it('does not mutate its input', () => {
    const input = [m('a', 0, 5, 4, 2)]
    const snapshot = JSON.parse(JSON.stringify(input))
    reflow(input)
    expect(input).toEqual(snapshot)
  })
})

describe('place', () => {
  it('lands the module exactly where dropped', () => {
    const out = place([m('a', 0, 0, 4, 2), m('b', 4, 0, 4, 2)], 'b', 0, 0)
    const b = out.find((x) => x.id === 'b')
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
  })

  it('pushes the displaced module down, not the dropped one', () => {
    const out = place([m('a', 0, 0, 4, 2), m('b', 4, 0, 4, 2)], 'b', 0, 0)
    const a = out.find((x) => x.id === 'a')
    expect(a.y).toBeGreaterThanOrEqual(2)
    expect(isValid(out)).toBe(true)
  })

  it('clamps a drop past the trailing edge back inside', () => {
    const out = place([m('a', 0, 0, 4, 2)], 'a', 99, 0)
    const a = out[0]
    expect(a.x + a.w).toBeLessThanOrEqual(DEFAULT_COLS)
  })

  it('clamps a negative drop to the origin', () => {
    const out = place([m('a', 4, 4, 4, 2)], 'a', -5, -5)
    expect(out[0].x).toBe(0)
    expect(out[0].y).toBe(0)
  })

  it('leaves no gaps after a cascade', () => {
    const start = [m('a', 0, 0, 4, 2), m('b', 0, 2, 4, 2), m('c', 0, 4, 4, 2)]
    const out = place(start, 'c', 0, 0)
    expect(isValid(out)).toBe(true)
    // Gravity: the topmost module must sit at row 0
    expect(Math.min(...out.map((x) => x.y))).toBe(0)
  })

  it('is a no-op for an unknown id', () => {
    const start = [m('a', 0, 0, 4, 2)]
    expect(place(start, 'nope', 5, 5)).toEqual(reflow(start))
  })
})

describe('resize', () => {
  it('honours manifest minimums', () => {
    const out = resize([m('a', 0, 0, 4, 4)], 'a', 1, 1, MAN)
    expect(out[0].w).toBe(MAN.minW)
    expect(out[0].h).toBe(MAN.minH)
  })

  it('honours manifest maximums', () => {
    const out = resize([m('a', 0, 0, 4, 4)], 'a', 99, 99, MAN)
    expect(out[0].w).toBe(MAN.maxW)
    expect(out[0].h).toBe(MAN.maxH)
  })

  it('never exceeds the column count', () => {
    const out = resize([m('a', 0, 0, 4, 4)], 'a', 99, 4, { maxW: 99 })
    expect(out[0].w).toBeLessThanOrEqual(DEFAULT_COLS)
  })

  it('slides back inside when grown past the trailing edge', () => {
    const out = resize([m('a', 9, 0, 3, 2)], 'a', 8, 2, MAN)
    const a = out[0]
    expect(a.x + a.w).toBeLessThanOrEqual(DEFAULT_COLS)
    expect(isValid(out)).toBe(true)
  })

  it('pushes neighbours out of the way when growing', () => {
    const out = resize([m('a', 0, 0, 4, 2), m('b', 0, 2, 4, 2)], 'a', 4, 6, MAN)
    expect(isValid(out)).toBe(true)
    expect(out.find((x) => x.id === 'b').y).toBeGreaterThanOrEqual(6)
  })
})

describe('insert', () => {
  it('places into the first free slot', () => {
    const out = insert([m('a', 0, 0, 4, 3)], { id: 'n', type: 't' }, MAN)
    expect(isValid(out)).toBe(true)
    expect(out).toHaveLength(2)
    const n = out.find((x) => x.id === 'n')
    expect(n.w).toBe(MAN.defaultW)
    expect(n.h).toBe(MAN.defaultH)
  })

  it('fills a hole beside an existing module rather than appending below', () => {
    const out = insert([m('a', 0, 0, 4, 3)], { id: 'n', type: 't' }, MAN)
    const n = out.find((x) => x.id === 'n')
    expect(n.y).toBe(0)
    expect(n.x).toBe(4)
  })

  it('appends below when the row is full', () => {
    const full = [m('a', 0, 0, 12, 3)]
    const out = insert(full, { id: 'n', type: 't' }, MAN)
    expect(out.find((x) => x.id === 'n').y).toBe(3)
    expect(isValid(out)).toBe(true)
  })

  it('allows duplicates of the same type', () => {
    let out = insert([], { id: 'c1', type: 'camera' }, MAN)
    out = insert(out, { id: 'c2', type: 'camera' }, MAN)
    expect(out.filter((x) => x.type === 'camera')).toHaveLength(2)
    expect(isValid(out)).toBe(true)
  })

  it('works on an empty board', () => {
    const out = insert([], { id: 'n', type: 't' }, MAN)
    expect(out).toEqual([{ id: 'n', type: 't', x: 0, y: 0, w: 4, h: 3 }])
  })
})

describe('remove', () => {
  it('drops the module and closes the gap', () => {
    const out = remove([m('a', 0, 0, 4, 2), m('b', 0, 2, 4, 2)], 'a')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
    expect(out[0].y).toBe(0)
  })

  it('is a no-op for an unknown id', () => {
    const start = [m('a', 0, 0, 4, 2)]
    expect(remove(start, 'nope')).toEqual(reflow(start))
  })
})

describe('refit', () => {
  it('scales a 12-col layout down to 6 without overlap', () => {
    const wide = [m('a', 0, 0, 6, 3), m('b', 6, 0, 6, 3)]
    const out = refit(wide, 12, 6)
    expect(isValid(out, 6)).toBe(true)
    expect(out.every((x) => x.x + x.w <= 6)).toBe(true)
  })

  // Regression for the exact layout that shipped as the default: it must
  // survive being re-fitted onto every column count the board can choose.
  it('keeps the shipped default layout valid at every breakpoint', () => {
    const shipped = [
      { id: 'w_ziggy',    type: 'ziggy',    x: 0, y: 0, w: 12, h: 2 },
      { id: 'w_agenda',   type: 'agenda',   x: 0, y: 2, w: 4,  h: 5 },
      { id: 'w_shopping', type: 'shopping', x: 4, y: 2, w: 4,  h: 5 },
      { id: 'w_scenes',   type: 'scenes',   x: 8, y: 2, w: 4,  h: 3 },
      { id: 'w_pinned',   type: 'pinned',   x: 8, y: 5, w: 4,  h: 2 },
    ]
    for (const cols of [2, 4, 6, 8, 12]) {
      const out = refit(shipped, 12, cols)
      expect(isValid(out, cols), `overlap at ${cols} cols`).toBe(true)
      expect(out).toHaveLength(shipped.length)
    }
  })

  it('never shrinks a module below one column', () => {
    const out = refit([m('a', 0, 0, 1, 2)], 12, 2)
    expect(out[0].w).toBeGreaterThanOrEqual(1)
  })

  it('is a plain reflow when the column count is unchanged', () => {
    const mods = [m('a', 0, 4, 4, 2)]
    expect(refit(mods, 12, 12)).toEqual(reflow(mods, 12))
  })

  it('survives a round trip down and back up', () => {
    const wide = [m('a', 0, 0, 6, 3), m('b', 6, 0, 6, 3), m('c', 0, 3, 12, 2)]
    const out = refit(refit(wide, 12, 4), 4, 12)
    expect(isValid(out, 12)).toBe(true)
  })

  // Regression: proportional scaling alone turned a 4-of-12 card into 1-of-4
  // (~130px) on a 7" panel, truncating every label to "Whol…".
  describe('respects manifest minimums', () => {
    const manifestFor = (type) => ({ agenda: { minW: 3 }, ziggy: { minW: 3 } }[type])
    const board = [
      { id: 'z', type: 'ziggy',  x: 0, y: 0, w: 12, h: 2 },
      { id: 'a', type: 'agenda', x: 0, y: 2, w: 4,  h: 5 },
      { id: 'b', type: 'agenda', x: 4, y: 2, w: 4,  h: 5 },
      { id: 'c', type: 'agenda', x: 8, y: 2, w: 4,  h: 5 },
    ]

    it('never shrinks a card below its declared minimum', () => {
      const out = refit(board, 12, 6, manifestFor)
      expect(out.every((x) => x.w >= 3)).toBe(true)
      expect(isValid(out, 6)).toBe(true)
    })

    it('goes full width when the minimum would leave an unusable sliver', () => {
      const out = refit(board, 12, 4, manifestFor)
      // minW 3 of 4 columns leaves a 1-col gap nothing fits in, so cards take
      // the whole row and stack instead.
      expect(out.every((x) => x.w === 4)).toBe(true)
      expect(isValid(out, 4)).toBe(true)
    })

    it('keeps a two-up arrangement where there is room for one', () => {
      const out = refit(board, 12, 6, manifestFor)
      const agendas = out.filter((x) => x.type === 'agenda')
      // Two 3-wide cards fit side by side on a 6-column board.
      expect(agendas.some((x) => x.x === 0)).toBe(true)
      expect(agendas.some((x) => x.x === 3)).toBe(true)
    })

    it('still works with no manifest lookup supplied', () => {
      expect(isValid(refit(board, 12, 4), 4)).toBe(true)
    })

    // THIS IS WHY the store must never write a refitted layout back to
    // storage. Refit is deliberately lossy: collapsing three-across onto a
    // narrow board produces stacked full-width cards, and widening that back
    // out cannot know they were once side by side. The authored layout stays
    // authoritative and the view is derived on render.
    //
    // A previous version refitted on every resize and persisted the result,
    // so rotating a tablet silently destroyed the user's arrangement.
    it('is lossy round-tripping through a narrow board (hence derive, never write back)', () => {
      const narrow  = refit(board, 12, 4, manifestFor)
      const widened = refit(narrow, 4, 12, manifestFor)
      const sig = (mods) => mods.map((x) => `${x.id}:${x.x},${x.y},${x.w}`).sort().join('|')
      expect(sig(widened)).not.toBe(sig(reflow(board, 12)))

      // Whereas fitting the ORIGINAL to each width is stable and repeatable.
      expect(sig(refit(board, 12, 12, manifestFor))).toBe(sig(reflow(board, 12)))
      expect(sig(refit(board, 12, 4, manifestFor))).toBe(sig(narrow))
    })
  })
})

describe('clampSize', () => {
  it('applies grid bound when manifest maxW exceeds it', () => {
    expect(clampSize({ w: 20, h: 2 }, { maxW: 50 }, 12).w).toBe(12)
  })
  it('tolerates a missing manifest', () => {
    expect(clampSize({ w: 4, h: 3 }, undefined, 12)).toMatchObject({ w: 4, h: 3 })
  })
  it('never returns a width below 1 on a tiny grid', () => {
    expect(clampSize({ w: 5, h: 2 }, { minW: 4 }, 2).w).toBeGreaterThanOrEqual(1)
  })
})

describe('colsForWidth', () => {
  it('steps down on narrow boards', () => {
    expect(colsForWidth(380)).toBe(2)
    expect(colsForWidth(500)).toBe(4)
    expect(colsForWidth(700)).toBe(6)
    expect(colsForWidth(820)).toBe(8)
    expect(colsForWidth(1400)).toBe(DEFAULT_COLS)
  })

  // A 1280×800 landscape tablet — the single most common wall panel — leaves
  // roughly 930px of board after the rooms rail. That must land on the full
  // 12 columns, otherwise the shipped 12-column layout is silently re-fitted
  // on the most important device we support.
  it('gives a 1280px landscape tablet the full 12 columns', () => {
    expect(colsForWidth(930)).toBe(DEFAULT_COLS)
  })
  it('is monotonic across the range', () => {
    let prev = 0
    for (let w = 200; w <= 2000; w += 20) {
      const c = colsForWidth(w)
      expect(c).toBeGreaterThanOrEqual(prev)
      prev = c
    }
  })
})

describe('geometry', () => {
  it('rectFor and cellFromPx round-trip', () => {
    const boardW = 1200
    const cols = 12
    const mod = m('a', 3, 2, 4, 3)
    const r = rectFor(mod, cols, boardW)
    const cell = cellFromPx(r.left, r.top, cols, boardW)
    expect(cell).toEqual({ x: 3, y: 2 })
  })

  it('a full-width module spans the whole board', () => {
    const r = rectFor(m('a', 0, 0, 12, 1), 12, 1200)
    expect(Math.round(r.width)).toBe(1200)
  })

  it('row height accounts for the gap', () => {
    const r = rectFor(m('a', 0, 0, 1, 2), 12, 1200)
    expect(r.height).toBe(ROW_H * 2 + GRID_GAP)
  })

  it('layoutRows reports the deepest extent', () => {
    expect(layoutRows([m('a', 0, 0, 4, 2), m('b', 4, 3, 4, 5)])).toBe(8)
    expect(layoutRows([])).toBe(0)
  })

  it('rectFor honours a stretched row height', () => {
    const r = rectFor(m('a', 0, 2, 4, 2), 12, 1200, 100)
    expect(r.top).toBe(2 * (100 + GRID_GAP))
    expect(r.height).toBe(2 * 100 + GRID_GAP)
  })

  it('rectFor and cellFromPx round-trip at a stretched row height', () => {
    const rowH = 118
    const r = rectFor(m('a', 3, 4, 4, 3), 12, 1200, rowH)
    expect(cellFromPx(r.left, r.top, 12, 1200, rowH)).toEqual({ x: 3, y: 4 })
  })
})

describe('rowHeightFor', () => {
  // A wall dashboard should fill its panel. A short layout on a tall portrait
  // tablet used to render as a band across the top with hundreds of pixels of
  // dead space beneath it.
  it('stretches rows to fill a tall viewport', () => {
    const mods = [m('a', 0, 0, 12, 2), m('b', 0, 2, 6, 3)]   // 5 rows
    const h = rowHeightFor(mods, 1100)
    expect(h).toBeGreaterThan(ROW_H)
  })

  it('never shrinks below the base row height', () => {
    const mods = [m('a', 0, 0, 4, 20)]                       // taller than the screen
    expect(rowHeightFor(mods, 300)).toBe(ROW_H)
  })

  it('caps the stretch so two cards do not become absurd', () => {
    const mods = [m('a', 0, 0, 12, 1)]
    expect(rowHeightFor(mods, 4000)).toBeLessThanOrEqual(ROW_H * 2.2)
  })

  it('is safe on an empty board or an unmeasured viewport', () => {
    expect(rowHeightFor([], 800)).toBe(ROW_H)
    expect(rowHeightFor([m('a', 0, 0, 4, 2)], 0)).toBe(ROW_H)
  })

  it('the stretched board actually fills the space it was given', () => {
    const mods = [m('a', 0, 0, 12, 2), m('b', 0, 2, 6, 3)]
    const availH = 700
    const rows = layoutRows(mods)
    const h = rowHeightFor(mods, availH)
    const boardH = rows * h + (rows - 1) * GRID_GAP
    expect(Math.round(boardH)).toBe(availH)
  })
})

describe('invariants under random churn', () => {
  // Deterministic PRNG so a failure is reproducible.
  function rng(seed) {
    let s = seed
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296
      return s / 4294967296
    }
  }

  it('stays valid across 500 random operations', () => {
    const rand = rng(42)
    let mods = []
    let n = 0
    for (let i = 0; i < 500; i++) {
      const op = Math.floor(rand() * 4)
      if (op === 0 || mods.length === 0) {
        mods = insert(mods, { id: `m${n++}`, type: 't' }, MAN)
      } else if (op === 1) {
        const t = mods[Math.floor(rand() * mods.length)]
        mods = place(mods, t.id, Math.floor(rand() * 14) - 1, Math.floor(rand() * 12))
      } else if (op === 2) {
        const t = mods[Math.floor(rand() * mods.length)]
        mods = resize(mods, t.id, Math.floor(rand() * 12) + 1, Math.floor(rand() * 8) + 1, MAN)
      } else {
        const t = mods[Math.floor(rand() * mods.length)]
        mods = remove(mods, t.id)
      }
      // Never overlapping, never out of bounds — after every single operation.
      expect(isValid(mods)).toBe(true)
      // And settling is always safe and stable: gravity converges in one pass.
      const settled = reflow(mods)
      expect(isValid(settled)).toBe(true)
      expect(reflow(settled)).toEqual(settled)
    }
  })
})

describe('drop-then-settle semantics', () => {
  // During a drag the dropped card must hold the cell under the finger, even
  // if that leaves space above it — otherwise cards squirm away mid-gesture
  // and the board feels like it is fighting you. Gravity is applied on
  // RELEASE instead, via a plain reflow, which is what keeps the promise that
  // a finished board has no holes.
  it('place() keeps the dropped card exactly where it was dropped', () => {
    const out = place([m('a', 0, 0, 4, 2), m('b', 0, 6, 4, 2)], 'b', 0, 6)
    expect(out.find((x) => x.id === 'b')).toMatchObject({ x: 0, y: 6 })
  })

  it('a settle pass afterwards closes the gap', () => {
    const dropped = place([m('a', 0, 0, 4, 2), m('b', 0, 6, 4, 2)], 'b', 0, 6)
    const settled = reflow(dropped)
    expect(settled.find((x) => x.id === 'b')).toMatchObject({ y: 2 })
    expect(isValid(settled)).toBe(true)
  })
})
