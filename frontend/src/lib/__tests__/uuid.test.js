// safeUuid must keep working over plain http://<lan-ip>, where
// crypto.randomUUID is undefined but crypto.getRandomValues is not. Regression
// lock for the automation-wizard Add action / Add condition breakage.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { safeUuid } from '../uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('safeUuid', () => {
  const realCrypto = globalThis.crypto

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true })
    vi.restoreAllMocks()
  })

  it('uses crypto.randomUUID when present (secure context)', () => {
    const spy = vi.fn(() => '11111111-1111-4111-8111-111111111111')
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: spy, getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
      configurable: true,
    })
    expect(safeUuid()).toBe('11111111-1111-4111-8111-111111111111')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('falls back to getRandomValues when randomUUID is missing (http LAN)', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) }, // no randomUUID
      configurable: true,
    })
    const id = safeUuid()
    expect(id).toMatch(V4)
  })

  it('still returns a v4-shaped id with no crypto at all', () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    expect(safeUuid()).toMatch(V4)
  })

  it('produces unique values', () => {
    const s = new Set(Array.from({ length: 500 }, () => safeUuid()))
    expect(s.size).toBe(500)
  })
})
