// WebOnboarding — web/PWA first-run wizard orchestration.
//
// Coverage:
//  - WebSetupStep POSTs /api/auth/setup and advances to SENSORS with the
//    returned session token threaded as authToken.
//  - The session token is NOT committed to the auth store until DONE (so the
//    unauthenticated gate never unmounts the wizard mid-flow).
//  - StarterStep receives the session token as BOTH authToken and userToken.
//  - DONE commits the token via authStore.setToken(token, 'super_admin').
//  - A 409/already-configured setup surfaces the "exists" error and does not
//    advance into the wizard.

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// i18n → identity (assertions match on keys).
vi.mock('../../lib/i18n', () => ({ useT: () => (k) => k }))

// Stub the shared steps so this test exercises WebOnboarding's orchestration
// (token threading + transitions) without HA / real step internals.
vi.mock('../onboarding/steps', () => ({
  SensorsStep: ({ onDone, authToken }) =>
    <button data-testid="sensors" data-token={authToken || ''} onClick={() => onDone(2)}>sensors</button>,
  StarterStep: ({ onDone, authToken, userToken }) =>
    <button data-testid="starter" data-token={authToken || ''} data-user={userToken || ''} onClick={() => onDone(1)}>starter</button>,
  NotifyStep: ({ onDone }) =>
    <button data-testid="notify" onClick={() => onDone()}>notify</button>,
  DoneStep: ({ onDone, authToken, isFirstPair }) =>
    <button data-testid="done" data-token={authToken || ''} data-first={String(isFirstPair)} onClick={() => onDone()}>done</button>,
}))

const setToken = vi.fn()
vi.mock('../../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ setToken }) },
}))

vi.mock('../../lib/mobileApi', () => ({
  setHomeLocation: vi.fn(() => Promise.resolve(true)),
}))

import WebOnboarding from '../WebOnboarding'

function mockFetch() {
  global.fetch = vi.fn((url, opts) => {
    if (String(url).endsWith('/api/auth/setup')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ token: 'sess_tok', role: 'super_admin' }),
      })
    }
    // /api/onboarding/prefs — fire-and-forget
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
  })
}

function fillAndCreate() {
  const inputs = document.querySelectorAll('input')
  fireEvent.change(inputs[0], { target: { value: 'owner' } })
  fireEvent.change(inputs[1], { target: { value: 'secret123' } })
  fireEvent.click(screen.getByText('mobileOnboard.claim.create'))
}

beforeEach(() => {
  setToken.mockReset()
  mockFetch()
})

describe('WebOnboarding', () => {
  it('creates the owner via /api/auth/setup and threads the session token, committing only at DONE', async () => {
    render(<WebOnboarding />)
    fillAndCreate()

    // SENSORS appears with the session token as authToken.
    const sensors = await screen.findByTestId('sensors')
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/setup', expect.objectContaining({ method: 'POST' }))
    expect(sensors.getAttribute('data-token')).toBe('sess_tok')
    // Token NOT yet committed.
    expect(setToken).not.toHaveBeenCalled()

    fireEvent.click(sensors)
    // STARTER gets the token as BOTH authToken and userToken.
    const starter = await screen.findByTestId('starter')
    expect(starter.getAttribute('data-token')).toBe('sess_tok')
    expect(starter.getAttribute('data-user')).toBe('sess_tok')

    fireEvent.click(starter)
    fireEvent.click(await screen.findByTestId('notify'))

    // LOCATION (real WebLocationStep) — skip it.
    fireEvent.click(await screen.findByText('mobileOnboard.skipForNow'))

    // DONE — fresh setup, so isFirstPair=true and it carries the token.
    const done = await screen.findByTestId('done')
    expect(done.getAttribute('data-first')).toBe('true')
    expect(done.getAttribute('data-token')).toBe('sess_tok')
    expect(setToken).not.toHaveBeenCalled()   // still not committed

    fireEvent.click(done)
    expect(setToken).toHaveBeenCalledTimes(1)
    expect(setToken).toHaveBeenCalledWith('sess_tok', 'super_admin')
  })

  it('does not advance when the home is already configured (409)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 409,
      json: () => Promise.resolve({ detail: 'already' }),
    }))
    render(<WebOnboarding />)
    fillAndCreate()

    await waitFor(() => expect(screen.getByText('mobileOnboard.claim.errExists')).toBeTruthy())
    expect(screen.queryByTestId('sensors')).toBeNull()
    expect(setToken).not.toHaveBeenCalled()
  })
})
