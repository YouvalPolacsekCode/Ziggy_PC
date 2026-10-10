import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { setMotion } from '../flag'
import { TabCrossfade } from '../TabCrossfade'

describe('TabCrossfade', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* jsdom may lack it */ } })
  it('motion on: keys the body on the tab and marks the container', () => {
    setMotion(true)
    const { container, rerender } = render(<TabCrossfade tab="a"><p>A</p></TabCrossfade>)
    expect(container.querySelector('[data-motion-tabs]')).not.toBeNull()
    expect(container.querySelector('[data-motion-tab="a"]')).not.toBeNull()
    rerender(<TabCrossfade tab="b"><p>B</p></TabCrossfade>)
    expect(container.querySelector('[data-motion-tab="b"]')?.textContent).toBe('B')
  })
  it('motion off: renders the children bare', () => {
    setMotion(false)
    const { container } = render(<TabCrossfade tab="a"><p>A</p></TabCrossfade>)
    expect(container.querySelector('[data-motion-tabs]')).toBeNull()
    expect(container.innerHTML).toBe('<p>A</p>')
  })
})
