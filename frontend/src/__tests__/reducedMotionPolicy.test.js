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
})
