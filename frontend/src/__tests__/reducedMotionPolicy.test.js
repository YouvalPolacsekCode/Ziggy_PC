// index.css used to clamp EVERY animation and transition to .01ms under
// prefers-reduced-motion with !important, which outranked the layer's own
// "keep colour and opacity, drop travel" rules (findings §3.1). The clamp now
// applies only while the layer is off, so the rollback is unchanged and the
// layer's policy is the policy.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INDEX = fs.readFileSync(path.resolve(HERE, '../index.css'), 'utf8')
const LAYER = fs.readFileSync(path.resolve(HERE, '../motion/motion.css'), 'utf8')

describe('reduced motion policy', () => {
  it('the global clamp is scoped to the motion-off tree', () => {
    expect(INDEX).toContain('html:not([data-motion="on"]) *, html:not([data-motion="on"]) *::before, html:not([data-motion="on"]) *::after { animation-duration: .01ms !important')
    expect(INDEX).not.toMatch(/^\s*\*, \*::before, \*::after \{ animation-duration: \.01ms !important/m)
  })
  it('the layer stops decorative loops under reduced motion', () => {
    expect(LAYER).toMatch(/\[data-motion="on"\] \.animate-pulse[^{]*\{\s*animation: none/)
    expect(LAYER).toMatch(/\[data-motion="on"\] \.z-pulse[^{]*\{\s*animation: none/)
  })

  // Scoping the global clamp out of the layer's tree was right for the rules
  // the layer NAMES, and wrong for everything it does not: a transition
  // written inline by a component, a `@keyframes` loop in a page's own CSS,
  // every third-party animation. With the layer on, those were suddenly
  // unclamped under reduced motion — which is the one combination nobody
  // tests by hand. So the clamp comes back BOUNDED: it caps duration and
  // iteration count instead of flattening everything to .01ms, which leaves
  // the layer's named rules (160–220ms fades, colour) intact.
  it('the layer re-clamps whatever it does not name', () => {
    expect(LAYER).toMatch(/\[data-motion="on"\] \*,[\s\S]{0,160}?transition-duration: 160ms !important/)
    expect(LAYER).toMatch(/\[data-motion="on"\] \*,[\s\S]{0,200}?animation-iteration-count: 1 !important/)
    expect(LAYER).toContain('[data-motion="on"] *::before')
    expect(LAYER).toContain('[data-motion="on"] *::after')
  })

  // A frozen spinner does not read as "calmer", it reads as "stuck". The one
  // loop that means "still working" keeps running.
  it('the loading spinner keeps spinning', () => {
    expect(LAYER).toMatch(/\[data-motion="on"\] \.z-spin \{ animation-iteration-count: infinite !important/)
    expect(LAYER).toMatch(/\[data-motion-reduced="true"\]\[data-motion="on"\] \.z-spin \{ animation-iteration-count: infinite !important/)
  })

  // Both halves of the policy, always: the media query answers before the JS
  // has run, the mirrored attribute answers an OS setting that flips
  // mid-session.
  it('mirrors the bounded clamp onto the attribute form', () => {
    expect(LAYER).toMatch(/\[data-motion-reduced="true"\]\[data-motion="on"\] \*,[\s\S]{0,200}?transition-duration: 160ms !important/)
    expect(LAYER).toMatch(/\[data-motion-reduced="true"\]\[data-motion="on"\] \*,[\s\S]{0,260}?animation-iteration-count: 1 !important/)
  })

  // The clamp in index.css must say where the other half of the policy lives,
  // or the next reader scopes it again for the same good reason.
  it('index.css points at the layer for the layer\'s own policy', () => {
    expect(INDEX).toMatch(/motion\/motion\.css/)
  })
})
