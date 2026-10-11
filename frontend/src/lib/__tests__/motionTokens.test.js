// One vocabulary. Two files used to carry two different strong ease-outs
// (findings §3.2); this pins them to the same values and pins the CSS tokens
// to the JS ones so a curve cannot drift in one place.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as lib from '../motion'
import * as layer from '../../motion/motion'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INDEX_CSS = fs.readFileSync(path.resolve(HERE, '../../index.css'), 'utf8')
const SRC = path.resolve(HERE, '../..')

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) { if (name !== 'lab' && name !== '__tests__') walk(p, out) }
    else if (/\.(jsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

describe('motion tokens', () => {
  it('lib/motion.js and motion/motion.js share one EASE / DUR / SPRING', () => {
    expect(layer.EASE).toBe(lib.EASE)
    expect(layer.CSS_EASE).toBe(lib.CSS_EASE)
    expect(layer.DUR).toBe(lib.DUR)
    expect(layer.SPRING).toBe(lib.SPRING)
  })
  it('has one strong ease-out and the enter preset uses it', () => {
    expect(lib.EASE.out).toEqual([0.23, 1, 0.32, 1])
    expect(lib.EASE_ENTER).toEqual([0.23, 1, 0.32, 1])
    expect(lib.CSS_EASE.out).toBe('cubic-bezier(0.23, 1, 0.32, 1)')
    expect(lib.T_ENTER.ease).toEqual(lib.EASE.out)
  })
  it('exposes the five durations and six springs the spec names', () => {
    expect(lib.DUR).toEqual({ press: 0.12, micro: 0.16, fast: 0.2, base: 0.26, slow: 0.4 })
    expect(Object.keys(lib.SPRING).sort()).toEqual(['calm', 'detent', 'gentle', 'gesture', 'press', 'snappy'])
    expect(lib.SPRING.gesture).toEqual({ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 })
    expect(lib.SPRING_SHEET).toBe(lib.SPRING.gesture)
  })
  it('index.css tokens agree with the JS values', () => {
    expect(INDEX_CSS).toMatch(/--ease-enter:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/)
    expect(INDEX_CSS).toMatch(/--ease-out-strong:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/)
    expect(INDEX_CSS).toMatch(/--ease-in-out:\s*cubic-bezier\(0\.77, 0, 0\.175, 1\)/)
    expect(INDEX_CSS).toMatch(/--ease-drawer:\s*cubic-bezier\(0\.32, 0\.72, 0, 1\)/)
    expect(INDEX_CSS).toMatch(/--dur-fast:\s*160ms/)
    expect(INDEX_CSS).toMatch(/--dur-base:\s*260ms/)
    expect(INDEX_CSS).toMatch(/--dur-slow:\s*400ms/)
  })
  it('the dead exports are gone and nobody imports them', () => {
    expect(layer.safe).toBeUndefined()
    expect(layer.onReducedChange).toBeUndefined()
    const all = walk(SRC).map(p => fs.readFileSync(p, 'utf8')).join('\n')
    expect(all).not.toMatch(/\buseSheetDetents\b/)
    expect(all).not.toMatch(/\bpageEnterProps\b/)
  })
})
