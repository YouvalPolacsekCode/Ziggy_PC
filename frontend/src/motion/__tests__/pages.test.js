import { describe, it, expect, beforeEach, vi } from 'vitest'

// This Node runtime's own experimental global `localStorage` (gated behind
// `--localstorage-file`) shadows jsdom's per-window Storage, leaving
// `localStorage` `undefined` instead of a working Storage — see
// `homeRouting.test.js`'s `typeof localStorage !== 'undefined'` guard for the
// same hazard elsewhere in this suite. Shim it in-memory so the assertions
// below exercise the same behavior a real browser would.
if (typeof window.localStorage === 'undefined' || !window.localStorage) {
  let store = {}
  window.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    clear: () => { store = {} },
  }
}

async function load(search) {
  vi.resetModules()
  window.history.replaceState({}, '', `/${search}`)
  return import('../pages')
}

describe('data-motion-pages flag', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-motion-pages') })

  it('defaults on and mirrors to <html>', async () => {
    const m = await load('')
    expect(m.isPagesOn()).toBe(true)
    expect(document.documentElement.getAttribute('data-motion-pages')).toBe('on')
  })
  it('?pages=off turns it off and sticks', async () => {
    const m = await load('?pages=off')
    expect(m.isPagesOn()).toBe(false)
    expect(localStorage.getItem('ziggy_motion_pages')).toBe('off')
    const again = await load('')
    expect(again.isPagesOn()).toBe(false)
  })
  it('?pages=on re-enables', async () => {
    localStorage.setItem('ziggy_motion_pages', 'off')
    const m = await load('?pages=on')
    expect(m.isPagesOn()).toBe(true)
    expect(document.documentElement.getAttribute('data-motion-pages')).toBe('on')
  })
  it('setPages notifies subscribers', async () => {
    const m = await load('')
    const seen = []
    const off = m.onPagesChange(v => seen.push(v))
    m.setPages(false)
    off()
    m.setPages(true)
    expect(seen).toEqual([false])
    expect(document.documentElement.getAttribute('data-motion-pages')).toBe('on')
  })
})
