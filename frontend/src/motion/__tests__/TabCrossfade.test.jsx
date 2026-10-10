import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
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

  // `popLayout` lifts the leaver out of flow and paints it OVER the arriving
  // body, so while it fades a tap landed on the tab you had just left.
  it('the body on its way out is not clickable', () => {
    setMotion(true)
    const { container, rerender } = render(<TabCrossfade tab="a"><p>A</p></TabCrossfade>)
    rerender(<TabCrossfade tab="b"><p>B</p></TabCrossfade>)
    const panes = [...container.querySelectorAll('[data-motion-tab]')]
    const leaving = panes.find(p => p.getAttribute('data-motion-tab') === 'a')
    expect(leaving).not.toBeUndefined()
    expect(leaving.style.pointerEvents).toBe('none')
    // ...and the live one is the plain element it always was.
    const live = panes.find(p => p.getAttribute('data-motion-tab') === 'b')
    expect(live.style.pointerEvents).toBe('')
  })

  // `mode="popLayout"` measures each child through a ref so it can pin the
  // leaver at its own size while it is out of flow. A pane component that
  // swallowed that ref would let the exiting body collapse to nothing — React
  // says so on the console, which is what this watches for.
  it('forwards popLayout\'s measurement ref', () => {
    setMotion(true)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { rerender } = render(<TabCrossfade tab="a"><p>A</p></TabCrossfade>)
      rerender(<TabCrossfade tab="b"><p>B</p></TabCrossfade>)
      const said = spy.mock.calls.map(c => String(c[0])).join('\n')
      expect(said).not.toMatch(/cannot be given refs/)
    } finally { spy.mockRestore() }
  })
})

// The failure mode AppShell's comment records, in miniature: a re-render storm
// mid-animation (a WS message, a store update fanning out) dropping an exit
// handshake and stranding a body on screen for ever. This IS an
// AnimatePresence, unlike the page transition, so it is the one place in the
// layer where that handshake still exists — which is exactly why it is tested.
//
// REAL TIMERS, deliberately. framer runs its animations on a frame loop whose
// `requestAnimationFrame` is captured at import time, so vitest's fake timers
// never drive it and nothing ever completes (the exiting body stays for ever
// and the test "fails" for a reason that has nothing to do with the code).
// PageTransition's storm test can use fake timers because its watchdog is a
// plain setTimeout.
describe('TabCrossfade under a re-render storm', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* jsdom may lack it */ } })

  it('a storm during a tab change leaves exactly one body', async () => {
    setMotion(true)
    const Host = ({ tab, tick = 0 }) => (
      <div data-tick={tick}><TabCrossfade tab={tab}><p>{tab}</p></TabCrossfade></div>
    )
    const { container, rerender } = render(<Host tab="a" />)
    rerender(<Host tab="b" />)
    for (let i = 1; i <= 20; i++) rerender(<Host tab="b" tick={i} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 700)) })
    const panes = container.querySelectorAll('[data-motion-tab]')
    expect(panes.length).toBe(1)
    expect(panes[0].getAttribute('data-motion-tab')).toBe('b')
    expect(panes[0].style.pointerEvents).toBe('')
  })
})
