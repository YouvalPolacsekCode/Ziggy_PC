// ONE home, rendered by all ten directions.
//
// Fixed on purpose, down to the clock. If two concepts showed different rooms,
// different device counts or a live timestamp, you would be comparing content
// and calling it design. Everything here is frozen so the only variable left
// between two screens is the design itself.
//
// The vocabulary is Ziggy's real one, because a palette that looks good on
// invented copy is not evidence. Occupancy is occupied / empty / unknown and
// `unknown` is NEVER collapsed into `empty` — "I don't know" and "nobody is
// here" are different facts, and a design that cannot show the difference has
// failed a requirement rather than made a simplification.

export const NOW = '20:40'
export const GREETING = 'Good evening'
export const HEADLINE = 'Home is awake'

export const ROOMS = [
  {
    id: 'living', name: 'Living Room', occupancy: 'occupied',
    temp: 21.5, activeCount: 3, deviceCount: 9,
    reason: 'Motion 2 min ago, and the TV is on',
    summary: '3 active · Living Room Light on',
  },
  {
    id: 'kitchen', name: 'Kitchen', occupancy: 'occupied',
    temp: 22.0, activeCount: 2, deviceCount: 7,
    reason: 'Motion 40 s ago',
    summary: '2 active · Kettle on',
  },
  {
    id: 'bedroom', name: 'Bedroom', occupancy: 'empty',
    temp: 20.0, activeCount: 1, deviceCount: 8,
    reason: 'No motion for 51 min, door closed',
    summary: '1 active · Bedroom Lamp on',
  },
  {
    id: 'office', name: 'Office', occupancy: 'unknown',
    temp: 21.0, activeCount: 1, deviceCount: 6,
    reason: 'Sensor has not reported since 18:02',
    summary: '1 active · Office Light on',
  },
  {
    id: 'bathroom', name: 'Bathroom', occupancy: 'empty',
    temp: 23.0, activeCount: 0, deviceCount: 5,
    reason: 'Door open, no motion for 12 min',
    summary: 'Idle',
  },
  {
    id: 'balcony', name: 'Balcony', occupancy: 'empty',
    temp: 17.5, activeCount: 0, deviceCount: 3,
    reason: 'No sensors assigned',
    summary: 'Idle',
  },
]

export const DEVICES = [
  { id: 'living-light', room: 'Living Room', name: 'Living Room Light', kind: 'light', on: true, level: 72, sub: 'On · 72%' },
  { id: 'tv', room: 'Living Room', name: 'Living Room TV', kind: 'tv', on: true, sub: 'Playing · HDMI 2' },
  { id: 'ac-living', room: 'Living Room', name: 'Living Room AC', kind: 'climate', on: true, level: 22, sub: 'Cooling to 22°' },
  { id: 'kettle', room: 'Kitchen', name: 'Kettle', kind: 'plug', on: true, sub: 'On · 1.8 kW' },
  { id: 'kitchen-light', room: 'Kitchen', name: 'Kitchen Light', kind: 'light', on: false, level: 0, sub: 'Off' },
  { id: 'bed-lamp', room: 'Bedroom', name: 'Bedroom Lamp', kind: 'light', on: true, level: 18, sub: 'On · 18%' },
  { id: 'office-light', room: 'Office', name: 'Office Light', kind: 'light', on: true, level: 80, sub: 'On · 80%' },
  { id: 'blind', room: 'Living Room', name: 'Living Room Blind', kind: 'cover', on: false, level: 0, sub: 'Closed' },
  { id: 'lock', room: 'Entry', name: 'Front Door', kind: 'lock', on: false, sub: 'Locked' },
  { id: 'boiler', room: 'Bathroom', name: 'Boiler', kind: 'water', on: false, sub: 'Off · 42°' },
]

// The device the Device screen opens on.
export const FOCUS_DEVICE = DEVICES[0]

export const ACTIVITY = [
  { t: 'just now', text: 'Living Room Light · on', by: 'You' },
  { t: '4 min', text: 'Kettle · on', by: 'Kitchen switch' },
  { t: '12 min', text: 'Bathroom · empty', by: 'Ziggy' },
  { t: '38 min', text: 'Evening Lights ran', by: 'Automation' },
  { t: '51 min', text: 'Bedroom · empty', by: 'Ziggy' },
  { t: '1 h', text: 'Office sensor stopped reporting', by: 'Ziggy' },
]

export const ACTIONS = [
  { id: 'goodnight', name: 'Good night', kind: 'on-demand', icon: 'moon', sub: 'Lights off, door checked, AC to 24°' },
  { id: 'evening', name: 'Evening Lights', kind: 'automatic', icon: 'sun', sub: 'At sunset, if someone is home' },
  { id: 'leave', name: 'Leave Home', kind: 'automatic', icon: 'exit', sub: 'When everyone has left' },
  { id: 'movie', name: 'Movie time', kind: 'on-demand', icon: 'play', sub: 'Dim to 20%, blinds down, TV on' },
]

export const CHAT = [
  { who: 'user', text: 'Is anyone in the office?' },
  {
    who: 'ziggy',
    text: "I can't tell right now. The Office sensor stopped reporting at 18:02, so I don't know whether it's empty or someone is in there.",
    card: { kind: 'room', room: 'Office', state: 'unknown', reason: 'No sensor data since 18:02' },
  },
  { who: 'user', text: 'Turn the living room down a bit' },
  {
    who: 'ziggy',
    text: 'Living Room Light is now at 40%.',
    card: { kind: 'device', device: 'Living Room Light', state: 'on', reason: 'Dimmed from 72% to 40%' },
  },
]

export const SUGGESTIONS = ['Good night', 'Who is home?', 'Turn off the kitchen', 'Why is the AC on?']

export const OCCUPANCY_LABEL = { occupied: 'Occupied', empty: 'Empty', unknown: 'Unknown' }

export const STATS = { active: 8, total: 38, rooms: ROOMS.length, alerts: 1 }
