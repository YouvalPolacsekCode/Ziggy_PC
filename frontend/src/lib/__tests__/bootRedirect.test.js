// Where the app boots, given where the browser landed.
//
// Three rewrites used to live inline in App.jsx and disagreed about which
// paths are deep links. A bookmark to the ops console (/ops/cloud) was
// rewritten to '/' on every cold start, and in wall mode '/' then became
// /wall — so the bookmark opened the wall dashboard. This pins the rules.

import { describe, expect, it } from 'vitest'
import { bootPath, isDeepLink } from '../bootRedirect'

const cold = (pathname, extra = {}) =>
  bootPath({ pathname, navType: 'navigate', justLoggedIn: false, wallMode: false, ...extra })

describe('isDeepLink', () => {
  it('treats the ops console, wall and public presence pages as deep links', () => {
    expect(isDeepLink('/ops')).toBe(true)
    expect(isDeepLink('/ops/cloud')).toBe(true)
    expect(isDeepLink('/ops/debug')).toBe(true)
    expect(isDeepLink('/wall')).toBe(true)
    expect(isDeepLink('/presence/abc')).toBe(true)
  })

  it('does not treat ordinary app pages as deep links', () => {
    expect(isDeepLink('/')).toBe(false)
    expect(isDeepLink('/settings')).toBe(false)
    expect(isDeepLink('/devices/light.kitchen')).toBe(false)
    // prefix match must be on a path segment, not a string prefix
    expect(isDeepLink('/opsy')).toBe(false)
    expect(isDeepLink('/wallpaper')).toBe(false)
  })
})

describe('bootPath — cold start', () => {
  it('sends an ordinary page home on a fresh navigation', () => {
    expect(cold('/settings')).toBe('/')
    expect(cold('/devices')).toBe('/')
  })

  it('keeps an ops console bookmark exactly where it points', () => {
    expect(cold('/ops/cloud')).toBe(null)
    expect(cold('/ops')).toBe(null)
  })

  it('keeps an ops console bookmark even on a wall-mode device', () => {
    expect(cold('/ops/cloud', { wallMode: true })).toBe(null)
  })

  it('keeps the wall and public presence pages', () => {
    expect(cold('/wall')).toBe(null)
    expect(cold('/presence/xyz')).toBe(null)
  })

  it('does nothing on a reload', () => {
    expect(cold('/settings', { navType: 'reload' })).toBe(null)
    expect(cold('/ops/cloud', { navType: 'reload' })).toBe(null)
  })

  it('boots a wall-mode device into the wall from the root', () => {
    expect(cold('/', { wallMode: true })).toBe('/wall')
    expect(cold('/settings', { wallMode: true })).toBe('/wall')
    expect(cold('/', { wallMode: false })).toBe(null)
  })
})

describe('bootPath — just logged in', () => {
  it('sends the post-logout page home', () => {
    expect(cold('/settings', { justLoggedIn: true, navType: 'reload' })).toBe('/')
  })

  it('lands on the ops console when that is where login happened', () => {
    expect(cold('/ops/cloud', { justLoggedIn: true, navType: 'reload' })).toBe(null)
  })
})
