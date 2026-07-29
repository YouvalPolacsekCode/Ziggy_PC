// mobileApi onboarding auth seam — the explicit authToken argument.
//
// Native onboarding passes no token and falls back to the paired device token
// (from storage). The web/PWA flow passes the owner's super_admin session token
// explicitly. These tests pin that contract: an explicit token is used verbatim
// as the Bearer and NEVER falls back to the device token.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// storage.get returns the device token when the web flow does NOT pass one.
const storageGet = vi.fn(async () => 'device_tok')
vi.mock('../native', () => ({
  storage: { get: (...a) => storageGet(...a), set: vi.fn(), remove: vi.fn() },
}))

import { getOnboardingSensors, confirmSensors, completeOnboarding } from '../mobileApi'

function okJson(body = {}) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

beforeEach(() => {
  storageGet.mockClear()
  global.fetch = vi.fn(() => okJson({ ok: true }))
})

function authHeaderOf(callIndex = 0) {
  const [, opts] = global.fetch.mock.calls[callIndex]
  return opts.headers.Authorization
}

describe('onboarding API authToken argument', () => {
  it('uses an explicit session token as the Bearer (web flow)', async () => {
    await getOnboardingSensors('sess_tok')
    expect(global.fetch).toHaveBeenCalledWith('/api/onboarding/sensors', expect.anything())
    expect(authHeaderOf()).toBe('Bearer sess_tok')
    // Never consulted the device-token storage.
    expect(storageGet).not.toHaveBeenCalled()
  })

  it('falls back to the device token when no token is passed (native flow)', async () => {
    await getOnboardingSensors()
    expect(authHeaderOf()).toBe('Bearer device_tok')
    expect(storageGet).toHaveBeenCalled()
  })

  it('threads the session token through confirmSensors and completeOnboarding', async () => {
    await confirmSensors([{ ha_device_id: 'd1', name: 'x' }], 'sess_tok')
    expect(authHeaderOf()).toBe('Bearer sess_tok')

    global.fetch.mockClear()
    await completeOnboarding({ time_elapsed_seconds: 1 }, 'sess_tok')
    expect(authHeaderOf()).toBe('Bearer sess_tok')
  })
})
