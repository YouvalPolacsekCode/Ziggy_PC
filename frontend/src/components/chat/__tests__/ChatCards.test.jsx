// ChatCards — every tool-result `kind` renders without crashing, and the
// interactive bits call the actions registry with the documented args.

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

// framer-motion → plain elements. `motion.<tag>` strips the animation props
// (jsdom has no rAF-driven animation to speak of) and records them on the
// element as data attributes so tests can assert what would have animated.
// `useReducedMotion` reads a switchable flag.
// The real uiStore persists through localStorage, which jsdom's opaque origin
// refuses; DeviceIcon only reads `iconStyle`, so a bare store stands in.
// The deviceStore talks to the API on import; the cards only read
// `ziggyRooms` (to map a room slug to a Rooms-page id), so a bare store
// stands in for that too.
vi.mock('../../../stores/uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create(() => ({ iconStyle: 'emoji' })) }
})
vi.mock('../../../stores/deviceStore', async () => {
  const { create } = await import('zustand')
  return { useDeviceStore: create(() => ({ ziggyRooms: [] })) }
})

const motionState = { reduce: false }
const MOTION_PROPS = ['initial', 'animate', 'exit', 'transition', 'layout', 'whileHover', 'whileTap', 'variants']
vi.mock('framer-motion', () => {
  const cache = {}
  const motion = new Proxy({}, {
    get(_, tag) {
      if (!cache[tag]) {
        cache[tag] = React.forwardRef(function Motion(props, ref) {
          const rest = { ...props }
          const had = []
          for (const k of MOTION_PROPS) if (k in rest) { if (rest[k] != null && rest[k] !== false) had.push(k); delete rest[k] }
          return React.createElement(tag, { ...rest, ref, 'data-motion': had.join(' ') || undefined })
        })
      }
      return cache[tag]
    },
  })
  return {
    motion,
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => motionState.reduce,
  }
})

import ChatCard, {
  CARD_KINDS, CHIP_LIMIT, verdictTitle, deviceLabel, roomLabel, sortDevices, sortChips, groupByRoom, deviceKind,
  enterProps, roomPath, slugifyRoom, stateSuffix, formatReading, navigateLabel,
} from '../ChatCards'
import { useUIStore } from '../../../stores/uiStore'
import { useChatStore } from '../../../stores/chatStore'
import { useDeviceStore } from '../../../stores/deviceStore'

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
  device: { kind: 'device', path: '/devices/light.desk_lamp', device: {
    entity_id: 'light.desk_lamp', name: 'Desk lamp', room: 'study', room_he: 'חדר עבודה', domain: 'light',
    state: 'on', on: true, he_noun: 'המנורה', place_he: 'על השולחן', ir: false, ir_id: null,
  } },
  reading: { kind: 'reading', readings: [
    { name: 'Study temperature', room: 'Study', value: 26, unit: '°C' },
    { name: 'Study humidity', room: 'Study', value: 48, unit: '%' },
    { name: 'Power', room: '', value: 1.2, unit: 'kW' },
  ] },
  navigate: { kind: 'navigate', path: '/devices/light.desk_lamp', screen: 'device', label: 'Desk lamp' },
}

// jsdom's default innerWidth is 1024 — exactly the wide breakpoint — so every
// collapse test pins the viewport explicitly.
function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

// n switchable lights, half of them on, spread over four rooms.
function manyDevices(n, rooms = ['kitchen', 'living_room', 'bedroom', 'hall']) {
  return Array.from({ length: n }, (_, i) => ({
    entity_id: `light.d${i}`, name: `Device ${i}`, room: rooms[i % rooms.length], room_he: `חדר ${i % rooms.length}`,
    domain: 'light', state: i % 2 ? 'on' : 'off', on: i % 2 === 1, he_noun: `אור ${i}`,
  }))
}

// The chip's press target (the body button) for a device by its name.
const chipButton = (name) => screen.getByRole('button', { name })
const toggles = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
const tileNames = () => screen.getAllByTestId('room-tile').map((t) => t.getAttribute('data-room'))

beforeEach(() => {
  runAction.mockReset()
  useChatStore.setState({ chatDock: false })
  useUIStore.setState({ iconStyle: 'emoji' })
  useDeviceStore.setState({ ziggyRooms: [] })
  motionState.reduce = false
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

  // ── device_list: rooms, not rows ───────────────────────────────────────────

  describe('device_list rooms', () => {
    it('groups devices into one tile per room, Elsewhere last', () => {
      const devices = [
        { entity_id: 'light.a', name: 'A', room: 'kitchen', domain: 'light', on: false },
        { entity_id: 'light.b', name: 'B', room: '', domain: 'light', on: true },
        { entity_id: 'light.c', name: 'C', room: 'hall', domain: 'light', on: false },
        { entity_id: 'light.d', name: 'D', room: 'kitchen', domain: 'light', on: false },
      ]
      render(<ChatCard card={{ kind: 'device_list', devices }} />)
      const tiles = screen.getAllByTestId('room-tile')
      expect(tiles).toHaveLength(3)
      expect(tileNames()).toEqual(['hall', 'kitchen', ''])
      expect(within(tiles[2]).getByText('chat.card.elsewhere')).toBeInTheDocument()
      // Kitchen holds both of its chips.
      expect(within(tiles[1]).getAllByTestId('device-chip')).toHaveLength(2)
    })

    it('orders rooms by how much is on, then by name; ON chips lead inside a room', () => {
      const devices = [
        { entity_id: 'light.a', name: 'A', room: 'kitchen', domain: 'light', on: false },
        { entity_id: 'light.b', name: 'B', room: 'hall', domain: 'light', on: true },
        { entity_id: 'light.c', name: 'C', room: 'bedroom', domain: 'light', on: true },
        { entity_id: 'light.d', name: 'D', room: 'kitchen', domain: 'light', on: true },
        { entity_id: 'light.e', name: 'E', room: 'bedroom', domain: 'light', on: true },
      ]
      const groups = groupByRoom(devices, 'en')
      expect(groups.map((g) => [g.slug, g.on])).toEqual([['bedroom', 2], ['hall', 1], ['kitchen', 1]])
      render(<ChatCard card={{ kind: 'device_list', devices }} />)
      expect(tileNames()).toEqual(['bedroom', 'hall', 'kitchen'])
      const kitchen = screen.getAllByTestId('room-tile')[2]
      expect(within(kitchen).getAllByTestId('device-chip').map((c) => c.textContent)).toEqual(['💡D', '💡A'])
      // sortDevices still puts ON first, then by room name, for callers that
      // use it directly.
      expect(sortDevices(devices, 'en').map((d) => d.name)).toEqual(['C', 'E', 'B', 'D', 'A'])
    })

    it('shows an "n on" count only where something is on', () => {
      const devices = [
        { entity_id: 'light.a', name: 'A', room: 'kitchen', domain: 'light', on: true },
        { entity_id: 'light.b', name: 'B', room: 'kitchen', domain: 'light', on: true },
        { entity_id: 'light.c', name: 'C', room: 'hall', domain: 'light', on: false },
        { entity_id: 'light.d', name: 'D', room: 'bedroom', domain: 'light', on: true },
      ]
      render(<ChatCard card={{ kind: 'device_list', devices }} />)
      const [kitchen, bedroom, hall] = screen.getAllByTestId('room-tile')
      expect(within(kitchen).getByText('chat.card.onCount')).toBeInTheDocument()
      expect(within(bedroom).getByText('chat.card.onOne')).toBeInTheDocument()
      expect(within(hall).queryByText(/chat\.card\.on/)).toBeNull()
    })

    it('the eyebrow reads "home · n devices" with no count pill', () => {
      const { container } = render(<ChatCard card={SAMPLES.device_list} />)
      expect(container.querySelector('.z-eyebrow').textContent).toBe('chat.card.home · chat.card.devices')
      expect(container.querySelector('.z-mono')).toBeNull()
    })

    it('has no switch role, checkbox or underline anywhere in the card', () => {
      const { container } = render(<ChatCard card={{ kind: 'device_list', devices: manyDevices(6) }} />)
      expect(screen.queryAllByRole('switch')).toHaveLength(0)
      expect(container.querySelector('input')).toBeNull()
      for (const el of container.querySelectorAll('*')) expect(el.style.textDecoration).not.toContain('underline')
    })

    it('folds a room past 8 chips behind a "+N" chip that expands it', () => {
      render(<ChatCard card={{ kind: 'device_list', devices: manyDevices(11, ['kitchen']) }} />)
      expect(screen.getAllByTestId('device-chip')).toHaveLength(CHIP_LIMIT)
      const more = screen.getByTestId('more-chip')
      expect(more.textContent).toBe('chat.card.more')
      fireEvent.click(within(more).getByRole('button', { name: 'chat.card.showMore' }))
      expect(screen.getAllByTestId('device-chip')).toHaveLength(11)
      expect(screen.queryByTestId('more-chip')).toBeNull()
    })

    it('a room with exactly 8 chips shows them all with no "+N"', () => {
      render(<ChatCard card={{ kind: 'device_list', devices: manyDevices(8, ['kitchen']) }} />)
      expect(screen.getAllByTestId('device-chip')).toHaveLength(8)
      expect(screen.queryByTestId('more-chip')).toBeNull()
    })

    it('lays the tiles out as an auto-fill grid of room tiles', () => {
      const { container } = render(<ChatCard card={{ kind: 'device_list', devices: manyDevices(3) }} />)
      expect(container.querySelector('.zc-rooms')).toBeTruthy()
      expect(container.querySelectorAll('.zc-room')).toHaveLength(3)
    })
  })

  // ── Chip = switch ──────────────────────────────────────────────────────────

  describe('device chip', () => {
    it('tapping a switchable chip calls control_device with on/off and rolls back on failure', async () => {
      runAction.mockRejectedValueOnce(new Error('boom'))
      render(<ChatCard card={SAMPLES.device_list} />)
      // Only the light is switchable; the door sensor is a static chip.
      expect(toggles()).toHaveLength(1)
      const light = chipButton('Kitchen light')
      expect(light).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(light)
      expect(runAction).toHaveBeenCalledWith('control_device', { entity_id: 'light.kitchen', action: 'off' }, 'en')
      // Optimistic flip, then rollback with the quiet failure note.
      await waitFor(() => expect(screen.getByText('chat.card.actionFailed')).toBeInTheDocument())
      expect(light).toHaveAttribute('aria-pressed', 'true')
      expect(light.closest('[data-testid="device-chip"]')).toHaveAttribute('data-on', 'true')
    })

    it('keeps the optimistic state on success and tints the chip', async () => {
      runAction.mockResolvedValueOnce({ ok: true })
      const onAction = vi.fn()
      render(<ChatCard card={SAMPLES.device_list} onAction={onAction} />)
      const chip = screen.getAllByTestId('device-chip')[0]
      expect(chip).toHaveAttribute('data-on', 'true')
      expect(chip.className).toContain('zc-chip--on')
      fireEvent.click(chipButton('Kitchen light'))
      await waitFor(() => expect(onAction).toHaveBeenCalled())
      expect(chipButton('Kitchen light')).toHaveAttribute('aria-pressed', 'false')
      expect(chip).toHaveAttribute('data-on', 'false')
      expect(chip.className).not.toContain('zc-chip--on')
    })

    it('a sensor renders as a static chip with its state as a suffix', () => {
      const devices = [
        { entity_id: 'binary_sensor.door', name: 'Front door', room: 'hall', domain: 'binary_sensor', state: 'on', on: true },
        { entity_id: 'sensor.temp', name: 'Temperature', room: 'hall', domain: 'sensor', device_class: 'temperature', state: '23.6' },
      ]
      render(<ChatCard card={{ kind: 'device_list', devices }} />)
      expect(toggles()).toHaveLength(0)
      const [door, temp] = screen.getAllByTestId('device-chip')
      expect(within(door).getByText('chat.card.state.open')).toBeInTheDocument()
      expect(within(temp).getByText('24°')).toBeInTheDocument()
      // Tapping a static chip has nothing to flip: it opens the device.
      fireEvent.click(within(door).getByRole('button', { name: /Front door/ }))
      expect(runAction).not.toHaveBeenCalled()
      expect(locPath()).toBe('/devices/binary_sensor.door')
    })

    it('stateSuffix reads binary states through the kind', () => {
      const t = (k) => k
      expect(stateSuffix({ domain: 'binary_sensor', state: 'off' }, 'door', t)).toBe('chat.card.state.closed')
      expect(stateSuffix({ domain: 'binary_sensor', state: 'on' }, 'motion', t)).toBe('chat.card.state.motion')
      expect(stateSuffix({ domain: 'binary_sensor', state: 'off' }, 'motion', t)).toBe('chat.card.state.clear')
      expect(stateSuffix({ domain: 'sensor', state: '55.2' }, 'humidity', t)).toBe('55%')
      expect(stateSuffix({ domain: 'sensor', state: 'unavailable' }, 'humidity', t)).toBe('')
      expect(stateSuffix({ domain: 'cover', state: 'half_open' }, 'shutter', t)).toBe('half open')
    })
  })

  // ── automations: same chip language ────────────────────────────────────────

  describe('automations chips', () => {
    it('each automation is a chip with the lightning glyph; tapping toggles it', async () => {
      runAction.mockResolvedValueOnce({ ok: true })
      render(<ChatCard card={SAMPLES.automations} />)
      const [night, morning] = screen.getAllByTestId('automation-chip')
      expect(night).toHaveAttribute('data-on', 'true')
      expect(morning).toHaveAttribute('data-on', 'false')
      expect(night.querySelector('svg.lucide-zap')).toBeTruthy()
      expect(screen.queryAllByRole('switch')).toHaveLength(0)
      fireEvent.click(chipButton('Night lights'))
      expect(runAction).toHaveBeenCalledWith('toggle_automation', { name: 'Night lights', enabled: false }, 'en')
      await waitFor(() => expect(chipButton('Night lights')).toHaveAttribute('aria-pressed', 'false'))
      expect(night).toHaveAttribute('data-on', 'false')
    })

    it('folds past 8 behind "+N"', () => {
      const automations = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, name: `Auto ${i}`, enabled: true }))
      render(<ChatCard card={{ kind: 'automations', automations }} />)
      expect(screen.getAllByTestId('automation-chip')).toHaveLength(8)
      fireEvent.click(within(screen.getByTestId('more-chip')).getByRole('button'))
      expect(screen.getAllByTestId('automation-chip')).toHaveLength(10)
    })
  })

  // ── Icons + motion ─────────────────────────────────────────────────────────

  describe('device chip icon', () => {
    it('every chip carries the shared DeviceIcon for its kind (emoji style)', () => {
      render(<ChatCard card={SAMPLES.device_list} />)
      // Kitchen (1 on) sorts before hall (0 on).
      const chips = screen.getAllByTestId('device-chip')
      expect(chips).toHaveLength(2)
      // light.kitchen → kind 'light' → 💡; binary_sensor "Front door" → 'door' → 🚪
      expect(chips[0].querySelector('.zc-chip-ico').textContent).toBe('💡')
      expect(chips[1].querySelector('.zc-chip-ico').textContent).toBe('🚪')
    })

    it('follows the Settings → Display icon style (image mode renders an <img>)', () => {
      useUIStore.setState({ iconStyle: 'line' })
      render(<ChatCard card={SAMPLES.device_list} />)
      const [light] = screen.getAllByTestId('device-chip')
      expect(light.querySelector('img[aria-hidden="true"]')).toBeTruthy()
    })

    it('deviceKind resolves from the card payload shape', () => {
      expect(deviceKind({ entity_id: 'light.kitchen', domain: 'light', name: 'Kitchen light' })).toBe('light')
      expect(deviceKind({ entity_id: 'switch.kettle', domain: 'switch', name: 'Kettle' })).toBe('kettle')
      expect(deviceKind({ entity_id: 'climate.ac', domain: 'climate', name: 'AC' })).toBe('ac')
      expect(deviceKind({ entity_id: 'binary_sensor.x', domain: 'binary_sensor', name: 'Hall motion' })).toBe('motion')
      expect(deviceKind({ entity_id: 'sensor.temp', domain: 'sensor', name: 'Temp', device_class: 'temperature' })).toBe('temperature')
      expect(deviceKind({})).toBe('unknown')
    })
  })

  describe('motion', () => {
    it('tiles stagger in 30ms apart with a 4px rise; chips ride with their tile', () => {
      const props = [0, 1, 2, 9].map((i) => enterProps(false, i))
      for (const p of props) {
        expect(p.initial).toEqual({ opacity: 0, y: 4 })
        expect(p.animate).toEqual({ opacity: 1, y: 0 })
        expect(p.transition.duration).toBeLessThanOrEqual(0.2)
      }
      expect(props[1].transition.delay).toBeCloseTo(0.03)
      expect(props[2].transition.delay).toBeCloseTo(0.06)
      // Delay is capped so a home full of rooms still lands under ~450ms.
      expect(props[3].transition.delay + props[3].transition.duration).toBeLessThan(0.45)
      render(<ChatCard card={{ kind: 'device_list', devices: manyDevices(4) }} />)
      for (const tile of screen.getAllByTestId('room-tile')) {
        expect(tile.getAttribute('data-motion')).toBe('initial animate transition')
      }
      for (const chip of screen.getAllByTestId('device-chip')) {
        expect(chip.getAttribute('data-motion')).toBeNull()
      }
    })

    it('reduced motion: no transition props at all', () => {
      motionState.reduce = true
      expect(enterProps(true, 3)).toEqual({})
      render(<ChatCard card={SAMPLES.device_list} />)
      for (const tile of screen.getAllByTestId('room-tile')) {
        expect(tile.getAttribute('data-motion')).toBeNull()
      }
      render(<ChatCard card={SAMPLES.automations} />)
      expect(screen.getByTestId('automation-chips').getAttribute('data-motion')).toBeNull()
    })
  })

  describe('labels follow the turn language', () => {
    const devices = [
      { entity_id: 'light.kitchen', name: 'Kitchen light', room: 'kitchen', room_he: 'מטבח', domain: 'light', on: true, he_noun: 'אור במטבח' },
      { entity_id: 'switch.plug', name: 'Plug', room: 'living_room', room_he: 'סלון', domain: 'switch', on: false, he_noun: 'המכשיר' },
    ]

    it("card.lang === 'en' shows name, not he_noun, and lays out ltr", () => {
      const { container } = render(<ChatCard card={{ kind: 'device_list', lang: 'en', devices }} />)
      expect(chipButton('Kitchen light')).toBeInTheDocument()
      expect(screen.queryByText('אור במטבח')).toBeNull()
      expect(screen.getByText('Living room')).toBeInTheDocument()
      expect(container.querySelector('.zc-card').getAttribute('dir')).toBe('ltr')
    })

    it("card.lang === 'he' shows he_noun and room_he, and lays out rtl", () => {
      const { container } = render(<ChatCard card={{ kind: 'device_list', lang: 'he', devices }} />)
      expect(chipButton('אור במטבח')).toBeInTheDocument()
      expect(screen.queryByText('Kitchen light')).toBeNull()
      expect(screen.getByText('מטבח')).toBeInTheDocument()
      expect(container.querySelector('.zc-card').getAttribute('dir')).toBe('rtl')
    })

    it("'he' with the generic noun falls back to the real name", () => {
      render(<ChatCard card={{ kind: 'device_list', lang: 'he', devices }} />)
      expect(chipButton('Plug')).toBeInTheDocument()
      expect(screen.queryByText('המכשיר')).toBeNull()
    })

    it('falls back to the UI language when the card carries none', () => {
      render(<ChatCard card={{ kind: 'device_list', devices }} />)
      expect(chipButton('Kitchen light')).toBeInTheDocument()
    })

    it('in-card actions run in the turn language', () => {
      runAction.mockResolvedValueOnce({ ok: true })
      render(<ChatCard card={{ kind: 'device_list', lang: 'he', devices }} />)
      fireEvent.click(chipButton('אור במטבח'))
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

    // ── place_he: "האור במטבח" even when the device is filed elsewhere ────

    describe('Hebrew label with place_he', () => {
      const living = [
        { entity_id: 'light.kitchen', name: 'Kitchen Light', room: 'living_room', room_he: 'סלון', domain: 'light', on: false, he_noun: 'האור', place_he: 'במטבח' },
        { entity_id: 'light.dining', name: 'Dining Light', room: 'living_room', room_he: 'סלון', domain: 'light', on: false, he_noun: 'האור', place_he: 'בפינת האוכל' },
        { entity_id: 'light.main', name: 'Main Light', room: 'living_room', room_he: 'סלון', domain: 'light', on: true, he_noun: 'האור' },
        { entity_id: 'switch.plug', name: 'Plug', room: 'living_room', room_he: 'סלון', domain: 'switch', on: false, he_noun: 'המכשיר', place_he: 'במטבח' },
      ]

      it('label = he_noun + place_he when a place is present, else he_noun', () => {
        expect(deviceLabel(living[0], 'he')).toBe('האור במטבח')
        expect(deviceLabel(living[1], 'he')).toBe('האור בפינת האוכל')
        expect(deviceLabel(living[2], 'he')).toBe('האור')
        expect(deviceLabel({ he_noun: 'האור', place_he: '  ' }, 'he')).toBe('האור')
      })

      it('the generic noun falls back to the real name, place or no place', () => {
        expect(deviceLabel(living[3], 'he')).toBe('Plug')
        expect(deviceLabel({ name: 'Plug', he_noun: 'המכשיר' }, 'he')).toBe('Plug')
      })

      it('English ignores place_he and shows the name', () => {
        expect(deviceLabel(living[0], 'en')).toBe('Kitchen Light')
      })

      it('three "האור" chips in one tile become distinct chips', () => {
        render(<ChatCard card={{ kind: 'device_list', lang: 'he', devices: living }} />)
        expect(chipButton('האור במטבח')).toBeInTheDocument()
        expect(chipButton('האור בפינת האוכל')).toBeInTheDocument()
        expect(chipButton('האור')).toBeInTheDocument()
        expect(chipButton('Plug')).toBeInTheDocument()
        expect(screen.queryByText('המכשיר')).toBeNull()
      })

      it('chips in a tile sort ON first, then by label', () => {
        // ON leads; then the labels collate (Latin before Hebrew, מ before פ).
        expect(sortChips(living, 'he').map((d) => d.entity_id)).toEqual(['light.main', 'switch.plug', 'light.kitchen', 'light.dining'])
        render(<ChatCard card={{ kind: 'device_list', lang: 'he', devices: living }} />)
        const names = screen.getAllByTestId('device-chip').map((c) => c.querySelector('.zc-chip-name').textContent)
        expect(names).toEqual(['האור', 'Plug', 'האור במטבח', 'האור בפינת האוכל'])
      })

      it('English tiles sort ON first, then by name', () => {
        expect(sortChips(living, 'en').map((d) => d.name)).toEqual(['Main Light', 'Dining Light', 'Kitchen Light', 'Plug'])
      })
    })
  })

  // ── device: one large chip + "Open page" ───────────────────────────────────

  describe('device card', () => {
    it('renders one large chip that toggles via control_device', async () => {
      runAction.mockResolvedValueOnce({ ok: true })
      const onAction = vi.fn()
      render(<ChatCard card={SAMPLES.device} onAction={onAction} />)
      const chips = screen.getAllByTestId('device-chip')
      expect(chips).toHaveLength(1)
      expect(chips[0].className).toContain('zc-chip--lg')
      expect(chips[0]).toHaveAttribute('data-on', 'true')
      expect(screen.queryAllByRole('switch')).toHaveLength(0)
      fireEvent.click(chipButton('Desk lamp'))
      expect(runAction).toHaveBeenCalledWith('control_device', { entity_id: 'light.desk_lamp', action: 'off' }, 'en')
      await waitFor(() => expect(onAction).toHaveBeenCalled())
      expect(chipButton('Desk lamp')).toHaveAttribute('aria-pressed', 'false')
      // Toggling does not navigate.
      expect(locPath()).toBe('/chat')
    })

    it('the "Open page" button opens card.path with state.fromChat', () => {
      render(<ChatCard card={SAMPLES.device} />)
      const open = screen.getByTestId('open-page')
      expect(open.textContent).toBe('chat.card.openPage')
      expect(open.style.textDecoration).not.toContain('underline')
      fireEvent.click(open)
      expect(locPath()).toBe('/devices/light.desk_lamp')
      expect(locState()).toEqual({ fromChat: true })
    })

    it('the chip chevron follows card.path too (an IR device lives under /remote)', () => {
      const card = { ...SAMPLES.device, path: '/remote/rm4-tv', device: { ...SAMPLES.device.device, ir: true, ir_id: 'rm4-tv' } }
      render(<ChatCard card={card} />)
      fireEvent.click(within(screen.getByTestId('device-chip')).getByRole('button', { name: 'chat.card.open' }))
      expect(locPath()).toBe('/remote/rm4-tv')
    })

    it('shows the room as the eyebrow and the Hebrew label in a Hebrew turn', () => {
      const { container } = render(<ChatCard card={{ ...SAMPLES.device, lang: 'he' }} />)
      expect(container.querySelector('.z-eyebrow').textContent).toBe('חדר עבודה')
      expect(chipButton('המנורה על השולחן')).toBeInTheDocument()
      expect(container.querySelector('.zc-card').getAttribute('dir')).toBe('rtl')
    })

    it('docks the chat on a wide screen when opening the page', () => {
      const orig = window.matchMedia
      window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
      try {
        render(<ChatCard card={SAMPLES.device} />)
        fireEvent.click(screen.getByTestId('open-page'))
        expect(useChatStore.getState().chatDock).toBe(true)
      } finally { window.matchMedia = orig }
    })
  })

  // ── reading: value pills ───────────────────────────────────────────────────

  describe('reading card', () => {
    it('renders one pill per reading: value, then where', () => {
      render(<ChatCard card={SAMPLES.reading} />)
      const pills = screen.getAllByTestId('reading-pill')
      expect(pills.map((p) => p.textContent)).toEqual(['26°C·Study', '48%·Study', '1.2 kW·Power'])
      expect(pills[0].querySelector('.zc-pill-value').textContent).toBe('26°C')
      // No control, no link: readings are for reading.
      expect(screen.queryAllByRole('button')).toHaveLength(0)
    })

    it('formatReading glues symbol units and spaces word units', () => {
      expect(formatReading(26, '°C')).toBe('26°C')
      expect(formatReading('48', '%')).toBe('48%')
      expect(formatReading(1.2, 'kW')).toBe('1.2 kW')
      expect(formatReading(5, '')).toBe('5')
      expect(formatReading(null, '°C')).toBe('°C')
    })

    it('renders nothing for an empty list', () => {
      const { container } = render(<ChatCard card={{ kind: 'reading', readings: [] }} />)
      expect(container.querySelector('.zc-card')).toBeNull()
    })
  })

  // ── navigate: the receipt ──────────────────────────────────────────────────

  describe('navigate card', () => {
    it('reads "Opened <label>" and "Open again" navigates with state.fromChat', () => {
      render(<ChatCard card={SAMPLES.navigate} />)
      expect(screen.getByTestId('navigate-card').textContent).toContain('chat.card.opened')
      // Rendering the card alone does NOT navigate — AIChat does that once.
      expect(locPath()).toBe('/chat')
      fireEvent.click(screen.getByTestId('open-again'))
      expect(locPath()).toBe('/devices/light.desk_lamp')
      expect(locState()).toEqual({ fromChat: true })
    })

    it('names the screen when no label is given; generic text when neither', () => {
      const t = (k) => k
      expect(navigateLabel({ label: 'Desk lamp', screen: 'device' }, t)).toBe('Desk lamp')
      expect(navigateLabel({ screen: 'alerts' }, t)).toBe('chat.card.screen.alerts')
      expect(navigateLabel({ screen: 'Settings' }, t)).toBe('chat.card.screen.settings')
      expect(navigateLabel({ screen: 'something_else' }, t)).toBe('')
      render(<ChatCard card={{ kind: 'navigate', path: '/settings' }} />)
      expect(screen.getByText('chat.card.openedPage')).toBeInTheDocument()
    })

    it('has no "Open again" without a path', () => {
      render(<ChatCard card={{ kind: 'navigate', label: 'Alerts' }} />)
      expect(screen.queryByTestId('open-again')).toBeNull()
    })

    it('lays out rtl for a Hebrew turn', () => {
      const { container } = render(<ChatCard card={{ ...SAMPLES.navigate, lang: 'he', label: 'המנורה' }} />)
      expect(container.querySelector('.zc-card').getAttribute('dir')).toBe('rtl')
    })
  })

  describe('collapse on the other list cards', () => {
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
    it('the chip chevron opens /devices/<id> with state.fromChat', () => {
      render(<ChatCard card={SAMPLES.device_list} />)
      const [light] = screen.getAllByTestId('device-chip')
      fireEvent.click(within(light).getByRole('button', { name: 'chat.card.open' }))
      expect(locPath()).toBe('/devices/light.kitchen')
      expect(locState()).toEqual({ fromChat: true })
    })

    it('tapping the chip body toggles and does NOT navigate', () => {
      runAction.mockResolvedValueOnce({ ok: true })
      render(<ChatCard card={SAMPLES.device_list} />)
      fireEvent.click(chipButton('Kitchen light'))
      expect(runAction).toHaveBeenCalledWith('control_device', { entity_id: 'light.kitchen', action: 'off' }, 'en')
      expect(locPath()).toBe('/chat')
      expect(locState()).toBeNull()
    })

    it('the room title opens the room the app knows, by id or by slugged name', () => {
      useDeviceStore.setState({ ziggyRooms: [
        { id: 'kitchen', name: 'Kitchen', devices: [] },
        { id: 'hall_1', name: 'Hall', devices: [] },
      ] })
      expect(roomPath('kitchen', useDeviceStore.getState().ziggyRooms)).toBe('/rooms/kitchen')
      expect(roomPath('hall', useDeviceStore.getState().ziggyRooms)).toBe('/rooms/hall_1')
      expect(roomPath('attic', useDeviceStore.getState().ziggyRooms)).toBe('/rooms')
      expect(roomPath('', [])).toBeNull()
      expect(slugifyRoom('  Living  Room ')).toBe('living_room')

      render(<ChatCard card={SAMPLES.device_list} />)
      const [kitchen, hall] = screen.getAllByTestId('room-tile')
      fireEvent.click(within(hall).getByRole('button', { name: 'chat.card.openRoom' }))
      expect(locPath()).toBe('/rooms/hall_1')
      expect(locState()).toEqual({ fromChat: true })
      fireEvent.click(within(kitchen).getByRole('button', { name: 'chat.card.openRoom' }))
      expect(locPath()).toBe('/rooms/kitchen')
    })

    it('an unknown room slug falls back to the Rooms list; Elsewhere is not a link', () => {
      render(<ChatCard card={{ kind: 'device_list', devices: [
        { entity_id: 'light.a', name: 'A', room: 'attic', domain: 'light', on: true },
        { entity_id: 'light.b', name: 'B', room: '', domain: 'light', on: true },
      ] }} />)
      const [attic, elsewhere] = screen.getAllByTestId('room-tile')
      expect(within(elsewhere).queryByRole('button', { name: 'chat.card.openRoom' })).toBeNull()
      fireEvent.click(within(attic).getByRole('button', { name: 'chat.card.openRoom' }))
      expect(locPath()).toBe('/rooms')
    })

    // jsdom ships no matchMedia; stub it per test so the breakpoint is explicit.
    const withViewport = (matches, fn) => {
      const orig = window.matchMedia
      window.matchMedia = vi.fn(() => ({ matches, addEventListener() {}, removeEventListener() {} }))
      try { fn() } finally { window.matchMedia = orig }
    }

    it('does not dock the chat on a narrow screen', () => withViewport(false, () => {
      render(<ChatCard card={SAMPLES.device_list} />)
      fireEvent.click(within(screen.getAllByTestId('device-chip')[0]).getByRole('button', { name: 'chat.card.open' }))
      expect(useChatStore.getState().chatDock).toBe(false)
      expect(locPath()).toBe('/devices/light.kitchen')
    }))

    it('docks the chat when the viewport is wide', () => withViewport(true, () => {
      render(<ChatCard card={SAMPLES.device_list} />)
      fireEvent.click(within(screen.getAllByTestId('device-chip')[0]).getByRole('button', { name: 'chat.card.open' }))
      expect(useChatStore.getState().chatDock).toBe(true)
      expect(locPath()).toBe('/devices/light.kitchen')
    }))

    it('automation chevron opens /actions?focus=<id>, or /actions without one', () => {
      const { unmount } = render(<ChatCard card={SAMPLES.automations} />)
      const [night] = screen.getAllByTestId('automation-chip')
      fireEvent.click(within(night).getByRole('button', { name: 'chat.card.open' }))
      expect(locPath()).toBe('/actions?focus=a1')
      expect(locState()).toEqual({ fromChat: true })
      unmount()

      render(<ChatCard card={{ kind: 'automations', automations: [{ name: 'No id', enabled: true }] }} />)
      fireEvent.click(within(screen.getByTestId('automation-chip')).getByRole('button', { name: 'chat.card.open' }))
      expect(locPath()).toBe('/actions')
    })

    it('automation chip body toggles and does NOT navigate', async () => {
      runAction.mockResolvedValueOnce({ ok: true })
      render(<ChatCard card={SAMPLES.automations} />)
      fireEvent.click(chipButton('Night lights'))
      expect(locPath()).toBe('/chat')
      await waitFor(() => expect(chipButton('Night lights')).toHaveAttribute('aria-pressed', 'false'))
    })

    it('why_not verdict opens the device only when an entity id is known', () => {
      const { unmount } = render(<ChatCard card={SAMPLES.why_not} />)
      // Without an id the verdict is plain text, not a link.
      expect(screen.queryByRole('button', { name: 'chat.card.verdict.deviceUnreachable' })).toBeNull()
      unmount()

      render(<ChatCard card={{ ...SAMPLES.why_not, entity_id: 'light.hall' }} />)
      const link = screen.getByRole('button', { name: 'chat.card.verdict.deviceUnreachable' })
      expect(link.style.textDecoration).not.toContain('underline')
      expect(link.querySelector('.zc-link-go')).toBeTruthy()
      fireEvent.click(link)
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
