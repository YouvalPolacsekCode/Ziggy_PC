// Settings → Account must not offer a "Your name" card the hub cannot save.
//
// Why: the household endpoints shipped after release-2026.09.18-4, but the
// phone's bundle comes from Canary. On a customer hub still on that tag the
// GET 404s, the card rendered empty anyway, and Save failed every time with a
// generic error. The card is now shown only after the hub has answered.

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/i18n', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useT: () => (k) => k, t: (k) => k }
})
vi.mock('../../components/PairWithPhone', () => ({ PairWithPhone: () => null }))
vi.mock('../../components/MobileDevicesList', () => ({ MobileDevicesList: () => null }))
vi.mock('../Memory', () => ({ MemoryPanel: () => null }))
vi.mock('../AdminSettings', () => ({ PushPreferenceCenter: () => null }))
vi.mock('../../stores/featuresStore', () => ({ useFeature: () => false }))
vi.mock('../../stores/uiStore', () => ({ useUIStore: () => ({ addToast: vi.fn() }) }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: (sel) => sel({ role: 'user', logout: vi.fn(), setRole: vi.fn() }) }))

const api = vi.hoisted(() => ({
  getPresenceZone: vi.fn(),
  listPresenceZones: vi.fn(),
  getMyPresencePerson: vi.fn(),
  getAuthStatus: vi.fn(),
  getHousehold: vi.fn(),
}))
// Every helper Settings.jsx (and the sections it imports) pulls from lib/api,
// listed explicitly: a Proxy-based catch-all was silently not what the
// component ended up calling.
vi.mock('../../lib/api', () => {
  const stub = () => vi.fn(() => Promise.resolve({}))
  return {
    getHealth: stub(), getHaDevices: stub(), getActivity: stub(), zigbeePermit: stub(),
    getGeneralSettings: stub(), patchGeneralSettings: stub(), changePassword: stub(),
    getUsers: stub(), updateUser: stub(), deleteUser: stub(), deleteMyAccount: stub(), factoryResetHub: stub(),
    createInvite: stub(), listInvites: stub(), revokeInvite: stub(),
    listExternalTokens: stub(), createExternalToken: stub(), revokeExternalToken: stub(),
    savePresenceZone: stub(), getPresenceDebug: stub(), pingMePresence: stub(), setMyPresenceLanHost: stub(),
    createPresenceZone: stub(), updatePresenceZone: stub(), deletePresenceZone: stub(), renameHouseholdMember: stub(),
    getPresencePersons: stub(),
    getTtsVoices: stub(), setActiveTtsVoices: stub(), previewTtsVoice: stub(),
    listIrBlasters: stub(), patchIrBlaster: stub(), deleteIrBlaster: stub(), discoverIrBlasters: stub(),
    getPresenceZone: api.getPresenceZone,
    listPresenceZones: api.listPresenceZones,
    getMyPresencePerson: api.getMyPresencePerson,
    getAuthStatus: api.getAuthStatus,
    getHousehold: api.getHousehold,
  }
})

import { AccountPage } from '../Settings'

function notFound() {
  const e = new Error('Not Found'); e.status = 404; return Promise.reject(e)
}

beforeEach(() => {
  // PresenceSection reads the track-me flag from localStorage on first render;
  // this jsdom profile does not provide the global.
  const store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  })
  api.getPresenceZone.mockResolvedValue({ configured: true, lat: 32.5, lon: 34.9, radius: 80 })
  api.listPresenceZones.mockResolvedValue({ zones: [] })
  api.getMyPresencePerson.mockResolvedValue({ person: { name: 'Youval', lan_host: '' } })
  api.getAuthStatus.mockResolvedValue({ username: 'youval@example.com', role: 'user' })
})

describe('AccountPage · "Your name" card', () => {
  it('shows the card when the hub serves the household endpoint', async () => {
    api.getHousehold.mockResolvedValue({ household: [{ username: 'youval@example.com', name: 'Youval' }] })
    render(<MemoryRouter><AccountPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('my-name-card')).toBeInTheDocument())
    expect(screen.getByLabelText('homeSensing.myName.title')).toHaveValue('Youval')
  })

  it('hides the card when the hub 404s the household endpoint (older release)', async () => {
    api.getHousehold.mockImplementation(notFound)
    render(<MemoryRouter><AccountPage /></MemoryRouter>)
    // The account form is always there; the name card must not be.
    await waitFor(() => expect(screen.getByText('settings.changePassword')).toBeInTheDocument())
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByTestId('my-name-card')).not.toBeInTheDocument()
  })
})
