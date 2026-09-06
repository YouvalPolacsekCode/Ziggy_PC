// ChatCards — every tool-result `kind` renders without crashing, and the
// interactive bits call the actions registry with the documented args.

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const runAction = vi.fn()
vi.mock('../../../lib/api', () => ({ runAction: (...a) => runAction(...a) }))
// i18n → identity so assertions match on keys; UI lang fixed to 'en'. Cards
// translate with the pure `t(key, params, lang)` bound to the turn's language.
vi.mock('../../../lib/i18n', () => ({
  t: (k) => k,
  useT: () => (k) => k,
  useLang: () => 'en',
  useIsRTL: () => false,
}))

import ChatCard, { CARD_KINDS, verdictTitle, deviceLabel, roomLabel, sortDevices } from '../ChatCards'
import { useChatStore } from '../../../stores/chatStore'

// Cards navigate (useNavigate), so every render lives inside a router. The
// probe echoes the current location so tests can assert where a click went.
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc" data-path={loc.pathname + loc.search} data-state={JSON.stringify(loc.state)} />
}

function render(ui) {
  return rtlRender(
    <MemoryRouter initialEntries={['/chat']}>
      <Routes>
        <Route path="*" element={<>{ui}<LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const locPath = () => screen.getByTestId('loc').getAttribute('data-path')
const locState = () => JSON.parse(screen.getByTestId('loc').getAttribute('data-state'))

const SAMPLES = {
  device_list: { kind: 'device_list', devices: [
    { entity_id: 'light.kitchen', name: 'Kitchen light', room: 'kitchen', room_he: 'מטבח', domain: 'light', state: 'on', on: true, he_noun: 'אור במטבח' },
    { entity_id: 'binary_sensor.door', name: 'Front door', room: 'hall', domain: 'binary_sensor', state: 'off', on: false, he_noun: 'דלת' },
  ] },
  automations: { kind: 'automations', automations: [
    { id: 'a1', name: 'Night lights', enabled: true, last_triggered: '2026-09-05T20:00:00Z' },
    { id: 'a2', name: 'Morning', enabled: false },
  ] },
  capabilities: { kind: 'capabilities', overview: true, capabilities: [
    { name: 'Smart Room', pitch: 'Lights follow you', what_it_does: '…', status: 'live', live: true, layer: 'recipe' },
    { name: 'Pre-cool', pitch: 'Cool before you arrive', status: 'planned', live: false, layer: 'bundle' },
  ] },
  why_not: { kind: 'why_not', verdicts: ['device_unreachable', 'automation_disabled'], device_reachable: false,
    routines: [{ name: 'Hall motion', enabled: false, last_run: 'none in window' }],
    room_sensors: [{ room: 'hall', state: 'on', held_minutes: 45, problem: 'stuck' }],
    occupancy: { state: 'occupied' },
    tried: [{ step: 'refresh', outcome: 'no_change' }] },
  home_health: { kind: 'home_health', severity: 'attention', offline_count: 2 },
  down_devices: { kind: 'down_devices', count: 2, names: ['Balcony light', 'Bedroom AC'] },
  repair_history: { kind: 'repair_history', attempts: [{ step: 'reconnect', outcome: 'ok', ts: 1757100000 }] },
  recent_activity: { kind: 'recent_activity', changes: ['Kitchen light turned on', 'Front door opened'] },
  camera_look: { kind: 'camera_look', camera: 'Porch', room: 'entrance', description: 'A person at the door', tags: ['person', 'daylight'], people_count: 1 },
  needs_approval: { kind: 'needs_approval', fix: 'restart_bridge', acted: false },
  pairing_diagnosis: { kind: 'pairing_diagnosis', verdict: 'radio_down', radio: 'off', device_id: 'abc123', hint: 'Plug the stick back in' },
  cause_trace: { kind: 'cause_trace', cause: 'leave_home', at: '21:04', entity_id: 'light.kitchen' },
  device_diagnosis: { kind: 'device_diagnosis', reachable: true, battery: 40, signal: 'weak' },
}

// jsdom's default innerWidth is 1024 — exactly the wide breakpoint — so every
// collapse test pins the viewport explicitly.
function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

// n switchable lights, half of them on, spread over four rooms.
function manyDevices(n) {
  const rooms = ['kitchen', 'living_room', 'bedroom', 'hall']
  return Array.from({ length: n }, (_, i) => ({
    entity_id: `light.d${i}`, name: `Device ${i}`, room: rooms[i % 4], room_he: `חדר ${i % 4}`,
    domain: 'light', state: i % 2 ? 'on' : 'off', on: i % 2 === 1, he_noun: `אור ${i}`,
  }))
}

beforeEach(() => {
  runAction.mockReset()
  useChatStore.setState({ chatDock: false })
  setViewport(400)
})

describe('ChatCard', () => {
  it('covers every registered kind in the samples', () => {
    for (const k of CARD_KINDS) expect(SAMPLES[k], `missing sample for ${k}`).toBeTruthy()
  })

  for (const [kind, card] of Object.entries(SAMPLES)) {
    it(`renders ${kind} without crashing`, () => {
      const { container } = render(<ChatCard card={card} />)
      expect(container.firstChild).not.toBeNull()
    })
  }

  it('renders nothing for a missing or kind-less card', () => {
    const bare = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>)
    expect(bare(<ChatCard card={null} />).container.firstChild).toBeNull()
    expect(bare(<ChatCard card={{ devices: [] }} />).container.firstChild).toBeNull()
  })

  it('key/value fallback hides id-looking keys', () => {
    render(<ChatCard card={SAMPLES.pairing_diagnosis} />)
    expect(screen.queryByText('abc123')).toBeNull()
    expect(screen.getByText('Plug the stick back in')).toBeInTheDocument()
  })

  it('device toggle calls control_device and rolls back on failure', async () => {
    runAction.mockRejectedValueOnce(new Error('boom'))
    render(<ChatCard card={SAMPLES.device_list} />)
    // Only the light is switchable; the door sensor gets no switch.
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(1)
    expect(switches[0]).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(switches[0])
    expect(runAction).toHaveBeenCalledWith('control_device', { entity_id: 'light.kitchen', action: 'off' }, 'en')
    await waitFor(() => expect(switches[0]).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByText(/chat\.card\.actionFailed/)).toBeInTheDocument()
  })

  it('device toggle keeps the optimistic state on success', async () => {
    runAction.mockResolvedValueOnce({ ok: true })
    const onAction = vi.fn()
    render(<ChatCard card={SAMPLES.device_list} onAction={onAction} />)
    const sw = screen.getAllByRole('switch')[0]
    fireEvent.click(sw)
    await waitFor(() => expect(onAction).toHaveBeenCalled())
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('automation switch calls toggle_automation with the name', async () => {
    runAction.mockResolvedValueOnce({ ok: true })
    render(<ChatCard card={SAMPLES.automations} />)
    const [night] = screen.getAllByRole('switch')
    fireEvent.click(night)
    expect(runAction).toHaveBeenCalledWith('toggle_automation', { name: 'Night lights', enabled: false }, 'en')
    await waitFor(() => expect(night).toHaveAttribute('aria-checked', 'false'))
  })

  it('why_not shows the verdict title and a fix button only with an entity id', async () => {
    runAction.mockResolvedValueOnce({ ok: true })
    const { unmount } = render(<ChatCard card={SAMPLES.why_not} />)
    expect(screen.getByText('chat.card.verdict.deviceUnreachable')).toBeInTheDocument()
    expect(screen.queryByText('chat.card.tryFix')).toBeNull()
    unmount()

    render(<ChatCard card={SAMPLES.why_not} entityId="light.hall" />)
    fireEvent.click(screen.getByText('chat.card.tryFix'))
    expect(runAction).toHaveBeenCalledWith('refresh_device', { entity_id: 'light.hall' }, 'en')
    await waitFor(() => expect(screen.getByText('chat.card.fixSent')).toBeInTheDocument())
  })

  it('why_not picks up entity_id from the card itself', () => {
    render(<ChatCard card={{ ...SAMPLES.why_not, entity_id: 'light.hall' }} />)
    expect(screen.getByText('chat.card.tryFix')).toBeInTheDocument()
  })

  it('why_not hides the fix button when the device is reachable', () => {
    render(<ChatCard card={{ ...SAMPLES.why_not, device_reachable: true }} entityId="light.hall" />)
    expect(screen.queryByText('chat.card.tryFix')).toBeNull()
  })

  it('verdictTitle humanizes unknown codes', () => {
    const t = (k) => k
    expect(verdictTitle(t, 'device_unreachable')).toBe('chat.card.verdict.deviceUnreachable')
    expect(verdictTitle(t, 'something_new')).toBe('something new')
  })

  // ── Compact grid + collapse ────────────────────────────────────────────────

  describe('device_list grid', () => {
    it('shows 8 cells on a narrow window and a show-all button that expands to 16', () => {
      render(<ChatCard card={{ kind: 'device_list', devices: manyDevices(16) }} />)
      expect(screen.getAllByRole('switch')).toHaveLength(8)
      const more = screen.getByRole('button', { name: 'chat.card.showAll' })
      expect(more).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(more)
      expect(screen.getAllByRole('switch')).toHaveLength(16)
      const less = screen.getByRole('button', { name: 'chat.card.less' })
      expect(less).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(less)
      expect(screen.getAllByRole('switch')).toHaveLength(8)
    })

    it('shows 12 cells on a wide window', () => {
      setViewport(1280)
      render(<ChatCard card={{ kind: 'device_list', devices: manyDevices(16) }} />)
      expect(screen.getAllByRole('switch')).toHaveLength(12)
      expect(screen.getByRole('button', { name: 'chat.card.showAll' })).toBeInTheDocument()
    })

    it('has no show-all button when everything fits', () => {
      render(<ChatCard card={{ kind: 'device_list', devices: manyDevices(8) }} />)
      expect(screen.getAllByRole('switch')).toHaveLength(8)
      expect(screen.queryByRole('button', { name: 'chat.card.showAll' })).toBeNull()
    })

    it('lays the cells out as an auto-fill grid', () => {
      const { container } = render(<ChatCard card={{ kind: 'device_list', devices: manyDevices(3) }} />)
      const grid = [...container.querySelectorAll('div')].find((el) => el.style.display === 'grid')
      expect(grid).toBeTruthy()
      expect(grid.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(150px, 1fr))')
    })

    it('puts ON devices first, then sorts by room', () => {
      const devices = [
        { entity_id: 'light.a', name: 'A', room: 'kitchen', domain: 'light', on: false },
        { entity_id: 'light.b', name: 'B', room: 'hall', domain: 'light', on: true },
        { entity_id: 'light.c', name: 'C', room: 'bedroom', domain: 'light', on: false },
        { entity_id: 'light.d', name: 'D', room: 'kitchen', domain: 'light', on: true },
      ]
      expect(sortDevices(devices, 'en').map((d) => d.name)).toEqual(['B', 'D', 'C', 'A'])
      render(<ChatCard card={{ kind: 'device_list', devices }} />)
      const names = screen.getAllByRole('button').map((b) => b.textContent).filter((n) => /^[A-D]$/.test(n))
      expect(names).toEqual(['B', 'D', 'C', 'A'])
    })
  })

  describe('labels follow the turn language', () => {
    const devices = [
      { entity_id: 'light.kitchen', name: 'Kitchen light', room: 'kitchen', room_he: 'מטבח', domain: 'light', on: true, he_noun: 'אור במטבח' },
      { entity_id: 'switch.plug', name: 'Plug', room: 'living_room', room_he: 'סלון', domain: 'switch', on: false, he_noun: 'המכשיר' },
    ]

    it("card.lang === 'en' shows name, not he_noun", () => {
      render(<ChatCard card={{ kind: 'device_list', lang: 'en', devices }} />)
      expect(screen.getByRole('button', { name: 'Kitchen light' })).toBeInTheDocument()
      expect(screen.queryByText('אור במטבח')).toBeNull()
      expect(screen.getByText('Living room')).toBeInTheDocument()
    })

    it("card.lang === 'he' shows he_noun and room_he", () => {
      render(<ChatCard card={{ kind: 'device_list', lang: 'he', devices }} />)
      expect(screen.getByRole('button', { name: 'אור במטבח' })).toBeInTheDocument()
      expect(screen.queryByText('Kitchen light')).toBeNull()
      expect(screen.getByText('מטבח')).toBeInTheDocument()
    })

    it("'he' with the generic noun falls back to the real name", () => {
      render(<ChatCard card={{ kind: 'device_list', lang: 'he', devices }} />)
      expect(screen.getByRole('button', { name: 'Plug' })).toBeInTheDocument()
      expect(screen.queryByText('המכשיר')).toBeNull()
    })

    it('falls back to the UI language when the card carries none', () => {
      render(<ChatCard card={{ kind: 'device_list', devices }} />)
      expect(screen.getByRole('button', { name: 'Kitchen light' })).toBeInTheDocument()
    })

    it('in-card actions run in the turn language', () => {
      runAction.mockResolvedValueOnce({ ok: true })
      render(<ChatCard card={{ kind: 'device_list', lang: 'he', devices }} />)
      fireEvent.click(screen.getAllByRole('switch')[0])
      expect(runAction).toHaveBeenCalledWith('control_device', { entity_id: 'light.kitchen', action: 'off' }, 'he')
    })

    it('deviceLabel / roomLabel helpers', () => {
      expect(deviceLabel({ name: 'X', he_noun: 'המכשיר' }, 'he')).toBe('X')
      expect(deviceLabel({ name: 'X', he_noun: 'האור' }, 'he')).toBe('האור')
      expect(deviceLabel({ name: '', he_noun: 'המכשיר' }, 'he')).toBe('המכשיר')
      expect(deviceLabel({ name: 'X', he_noun: 'האור' }, 'en')).toBe('X')
      expect(deviceLabel({ he_noun: 'האור' }, 'en')).toBe('האור')
      expect(roomLabel({ room: 'living_room', room_he: 'סלון' }, 'en')).toBe('Living room')
      expect(roomLabel({ room: 'living_room', room_he: 'סלון' }, 'he')).toBe('סלון')
      expect(roomLabel({ room: 'living_room' }, 'he')).toBe('living room')
    })
  })

  describe('collapse on the other list cards', () => {
    it('automations collapse to 8 and expand', () => {
      const automations = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, name: `Auto ${i}`, enabled: true }))
      render(<ChatCard card={{ kind: 'automations', automations }} />)
      expect(screen.getAllByRole('switch')).toHaveLength(8)
      fireEvent.click(screen.getByRole('button', { name: 'chat.card.showAll' }))
      expect(screen.getAllByRole('switch')).toHaveLength(10)
    })

    it('capabilities render as a 2-column grid, collapse to 8 and expand', () => {
      const capabilities = Array.from({ length: 11 }, (_, i) => ({ name: `Cap ${i}`, pitch: `Pitch ${i}`, live: i % 2 === 0 }))
      const { container } = render(<ChatCard card={{ kind: 'capabilities', capabilities }} />)
      const grid = [...container.querySelectorAll('div')].find((el) => el.style.display === 'grid')
      expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
      expect(screen.getAllByText(/^Cap \d+$/)).toHaveLength(8)
      expect(screen.getAllByRole('img', { name: 'chat.card.live' })).toHaveLength(4)
      fireEvent.click(screen.getByRole('button', { name: 'chat.card.showAll' }))
      expect(screen.getAllByText(/^Cap \d+$/)).toHaveLength(11)
    })

    it('recent_activity collapses to 8 and expands', () => {
      const changes = Array.from({ length: 9 }, (_, i) => `Change ${i}`)
      render(<ChatCard card={{ kind: 'recent_activity', changes }} />)
      expect(screen.getAllByRole('listitem')).toHaveLength(8)
      fireEvent.click(screen.getByRole('button', { name: 'chat.card.showAll' }))
      expect(screen.getAllByRole('listitem')).toHaveLength(9)
      fireEvent.click(screen.getByRole('button', { name: 'chat.card.less' }))
      expect(screen.getAllByRole('listitem')).toHaveLength(8)
    })
  })

  // ── In-context navigation ──────────────────────────────────────────────────

  describe('deep links', () => {
    it('device name opens /devices/<id> with state.fromChat', () => {
      render(<ChatCard card={SAMPLES.device_list} />)
      fireEvent.click(screen.getByRole('button', { name: 'Kitchen light' }))
      expect(locPath()).toBe('/devices/light.kitchen')
      expect(locState()).toEqual({ fromChat: true })
    })

    it('device toggle does NOT navigate', () => {
      runAction.mockResolvedValueOnce({ ok: true })
      render(<ChatCard card={SAMPLES.device_list} />)
      fireEvent.click(screen.getAllByRole('switch')[0])
      expect(runAction).toHaveBeenCalledWith('control_device', { entity_id: 'light.kitchen', action: 'off' }, 'en')
      expect(locPath()).toBe('/chat')
      expect(locState()).toBeNull()
    })

    // jsdom ships no matchMedia; stub it per test so the breakpoint is explicit.
    const withViewport = (matches, fn) => {
      const orig = window.matchMedia
      window.matchMedia = vi.fn(() => ({ matches, addEventListener() {}, removeEventListener() {} }))
      try { fn() } finally { window.matchMedia = orig }
    }

    it('does not dock the chat on a narrow screen', () => withViewport(false, () => {
      render(<ChatCard card={SAMPLES.device_list} />)
      fireEvent.click(screen.getByRole('button', { name: 'Kitchen light' }))
      expect(useChatStore.getState().chatDock).toBe(false)
      expect(locPath()).toBe('/devices/light.kitchen')
    }))

    it('docks the chat when the viewport is wide', () => withViewport(true, () => {
      render(<ChatCard card={SAMPLES.device_list} />)
      fireEvent.click(screen.getByRole('button', { name: 'Kitchen light' }))
      expect(useChatStore.getState().chatDock).toBe(true)
      expect(locPath()).toBe('/devices/light.kitchen')
    }))

    it('automation name opens /actions?focus=<id>, or /actions without one', () => {
      const { unmount } = render(<ChatCard card={SAMPLES.automations} />)
      fireEvent.click(screen.getByRole('button', { name: 'Night lights' }))
      expect(locPath()).toBe('/actions?focus=a1')
      expect(locState()).toEqual({ fromChat: true })
      unmount()

      render(<ChatCard card={{ kind: 'automations', automations: [{ name: 'No id', enabled: true }] }} />)
      fireEvent.click(screen.getByRole('button', { name: 'No id' }))
      expect(locPath()).toBe('/actions')
    })

    it('automation switch does NOT navigate', () => {
      runAction.mockResolvedValueOnce({ ok: true })
      render(<ChatCard card={SAMPLES.automations} />)
      fireEvent.click(screen.getAllByRole('switch')[0])
      expect(locPath()).toBe('/chat')
    })

    it('why_not verdict opens the device only when an entity id is known', () => {
      const { unmount } = render(<ChatCard card={SAMPLES.why_not} />)
      // Without an id the verdict is plain text, not a link.
      expect(screen.queryByRole('button', { name: 'chat.card.verdict.deviceUnreachable' })).toBeNull()
      unmount()

      render(<ChatCard card={{ ...SAMPLES.why_not, entity_id: 'light.hall' }} />)
      fireEvent.click(screen.getByRole('button', { name: 'chat.card.verdict.deviceUnreachable' }))
      expect(locPath()).toBe('/devices/light.hall')
      expect(locState()).toEqual({ fromChat: true })
    })

    it('down_devices names open the devices list; camera_look opens cameras', () => {
      const { unmount } = render(<ChatCard card={SAMPLES.down_devices} />)
      fireEvent.click(screen.getByRole('button', { name: 'Balcony light' }))
      expect(locPath()).toBe('/devices')
      unmount()

      render(<ChatCard card={SAMPLES.camera_look} />)
      fireEvent.click(screen.getByRole('button', { name: 'Porch · entrance' }))
      expect(locPath()).toBe('/cameras')
      expect(locState()).toEqual({ fromChat: true })
    })
  })
})
