// Motion Lab — a realistic Ziggy home, so prototypes move real content.
// Names, rooms and device kinds mirror what the fleet actually has (Israeli
// homes: Tadiran ACs over IR, Zigbee bulbs, an FP300 presence sensor, a
// SONOFF door sensor, a merged IR+Wi-Fi TV). Copy is bilingual.

export const ROOMS = [
  { id: 'living_room', name: { en: 'Living Room', he: 'סלון' }, icon: 'sofa', occupancy: 'occupied', temp: 24.5, lightsOn: 2, lights: 3, devices: 7 },
  { id: 'kitchen', name: { en: 'Kitchen', he: 'מטבח' }, icon: 'cooking-pot', occupancy: 'empty', temp: 25.1, lightsOn: 0, lights: 2, devices: 4 },
  { id: 'bedroom', name: { en: 'Bedroom', he: 'חדר שינה' }, icon: 'bed-double', occupancy: 'empty', temp: 23.0, lightsOn: 0, lights: 2, devices: 5 },
  { id: 'kids', name: { en: 'Kids Room', he: 'חדר ילדים' }, icon: 'baby', occupancy: 'occupied', temp: 24.0, lightsOn: 1, lights: 2, devices: 4 },
  { id: 'office', name: { en: 'Office', he: 'משרד' }, icon: 'monitor', occupancy: 'unknown', temp: 26.2, lightsOn: 1, lights: 1, devices: 3 },
  { id: 'bathroom', name: { en: 'Bathroom', he: 'אמבטיה' }, icon: 'bath', occupancy: 'empty', temp: null, lightsOn: 0, lights: 1, devices: 2 },
  { id: 'balcony', name: { en: 'Balcony', he: 'מרפסת' }, icon: 'sun', occupancy: 'empty', temp: 29.4, lightsOn: 0, lights: 1, devices: 2 },
]

// card_kind mirrors the app's 3-layer classification: light, switch, climate,
// cover, media, fan, lock, sensor, camera, ir.
export const DEVICES = [
  { id: 'light.living_ceiling', kind: 'light', name: { en: 'Ceiling Light', he: 'תאורת תקרה' }, room: 'living_room', on: true, brightness: 72, colorTemp: 3200, dimmable: true },
  { id: 'light.living_lamp', kind: 'light', name: { en: 'Floor Lamp', he: 'מנורת רצפה' }, room: 'living_room', on: true, brightness: 35, colorTemp: 2700, dimmable: true },
  { id: 'light.living_strip', kind: 'light', name: { en: 'TV Strip', he: 'פס לד' }, room: 'living_room', on: false, brightness: 0, dimmable: true, color: true },
  { id: 'climate.living_ac', kind: 'climate', name: { en: 'Living Room AC', he: 'מזגן סלון' }, room: 'living_room', on: true, mode: 'cool', target: 24, current: 24.5, fan: 'auto', brand: 'Tadiran' },
  { id: 'media.living_tv', kind: 'media', name: { en: 'Living Room TV', he: 'טלוויזיה סלון' }, room: 'living_room', on: false, source: 'Netflix', volume: 18 },
  { id: 'cover.living_blinds', kind: 'cover', name: { en: 'Blinds', he: 'תריס' }, room: 'living_room', position: 65 },
  { id: 'sensor.living_presence', kind: 'sensor', name: { en: 'Presence Sensor', he: 'חיישן נוכחות' }, room: 'living_room', model: 'FP300', occupied: true, lux: 180 },
  { id: 'light.kitchen_main', kind: 'light', name: { en: 'Kitchen Light', he: 'תאורת מטבח' }, room: 'kitchen', on: false, brightness: 0, dimmable: false },
  { id: 'light.kitchen_counter', kind: 'light', name: { en: 'Counter Light', he: 'תאורת דלפק' }, room: 'kitchen', on: false, brightness: 0, dimmable: true },
  { id: 'switch.kitchen_boiler', kind: 'switch', name: { en: 'Water Heater', he: 'דוד' }, room: 'kitchen', on: false, power: 0 },
  { id: 'light.bedroom_main', kind: 'light', name: { en: 'Bedroom Light', he: 'תאורת חדר שינה' }, room: 'bedroom', on: false, brightness: 0, dimmable: true },
  { id: 'light.bedroom_bedside', kind: 'light', name: { en: 'Bedside Lamp', he: 'מנורת לילה' }, room: 'bedroom', on: false, brightness: 0, dimmable: true },
  { id: 'climate.bedroom_ac', kind: 'climate', name: { en: 'Bedroom AC', he: 'מזגן חדר שינה' }, room: 'bedroom', on: false, mode: 'off', target: 23, current: 23.0, fan: 'low', brand: 'Electra' },
  { id: 'binary_sensor.bedroom_door', kind: 'sensor', name: { en: 'Bedroom Door', he: 'דלת חדר שינה' }, room: 'bedroom', model: 'SNZB-04P', open: false },
  { id: 'light.kids_main', kind: 'light', name: { en: 'Kids Light', he: 'תאורת ילדים' }, room: 'kids', on: true, brightness: 40, dimmable: true },
  { id: 'light.office_desk', kind: 'light', name: { en: 'Desk Lamp', he: 'מנורת שולחן' }, room: 'office', on: true, brightness: 100, dimmable: true },
  { id: 'lock.front_door', kind: 'lock', name: { en: 'Front Door', he: 'דלת כניסה' }, room: null, locked: true },
  { id: 'camera.entrance', kind: 'camera', name: { en: 'Entrance Camera', he: 'מצלמת כניסה' }, room: null, online: true },
]

export const PEOPLE = [
  { id: 'youval', name: { en: 'Youval', he: 'יובל' }, home: true, initials: 'Y' },
  { id: 'tslil', name: { en: 'Tslil', he: 'צליל' }, home: true, initials: 'T' },
  { id: 'david', name: { en: 'David', he: 'דוד' }, home: false, initials: 'D' },
]

export const ROUTINES = [
  { id: 'good_night', name: { en: 'Good Night', he: 'לילה טוב' }, icon: 'moon', steps: 4 },
  { id: 'movie', name: { en: 'Movie Time', he: 'זמן סרט' }, icon: 'clapperboard', steps: 3 },
  { id: 'leave', name: { en: 'Leave Home', he: 'יציאה מהבית' }, icon: 'door-open', steps: 6 },
  { id: 'precool', name: { en: 'Pre-cool on Arrival', he: 'קירור לפני הגעה' }, icon: 'snowflake', steps: 2 },
]

export const AUTOMATIONS = [
  { id: 'a1', name: { en: 'Lights off when everyone leaves', he: 'כיבוי אורות כשכולם יוצאים' }, enabled: true, last: '2h ago' },
  { id: 'a2', name: { en: 'Balcony light at sunset', he: 'אור מרפסת בשקיעה' }, enabled: true, last: 'yesterday' },
  { id: 'a3', name: { en: 'Kids room night light', he: 'אור לילה בחדר ילדים' }, enabled: false, last: '3d ago' },
]

export const NAV = [
  { key: 'home', label: { en: 'Home', he: 'בית' }, icon: 'house' },
  { key: 'rooms', label: { en: 'Rooms', he: 'חדרים' }, icon: 'layout-grid' },
  { key: 'devices', label: { en: 'Devices', he: 'מכשירים' }, icon: 'lightbulb' },
  { key: 'actions', label: { en: 'Actions', he: 'פעולות' }, icon: 'zap' },
  { key: 'ziggy', label: { en: 'Ziggy', he: 'זיגי' }, icon: 'sparkles' },
]

export const COPY = {
  greeting: { en: 'Good evening, Youval', he: 'ערב טוב, יובל' },
  homeQuiet: { en: 'Home is quiet', he: 'הבית שקט' },
  someoneHome: { en: '2 people home', he: '2 אנשים בבית' },
  occupied: { en: 'Occupied', he: 'יש מישהו' },
  empty: { en: 'Empty', he: 'ריק' },
  unknown: { en: 'Not sure', he: 'לא בטוח' },
  on: { en: 'On', he: 'דולק' },
  off: { en: 'Off', he: 'כבוי' },
  lightsOn: { en: (n) => `${n} light${n === 1 ? '' : 's'} on`, he: (n) => (n === 1 ? 'אור אחד דולק' : `${n} אורות דולקים`) },
  allOff: { en: 'All off', he: 'הכל כבוי' },
  cooling: { en: 'Cooling to', he: 'מקרר ל־' },
  toastLightOn: { en: 'Living Room lights on', he: 'אורות הסלון נדלקו' },
  toastSaved: { en: 'Automation saved', he: 'האוטומציה נשמרה' },
  toastFailed: { en: "Couldn't reach the Bedroom AC", he: 'לא הצלחתי להגיע למזגן בחדר השינה' },
  toastPhysical: { en: 'Someone turned on the Kitchen Light', he: 'מישהו הדליק את אור המטבח' },
  undo: { en: 'Undo', he: 'ביטול' },
  retry: { en: 'Retry', he: 'נסה שוב' },
  noRooms: { en: 'No rooms yet', he: 'עדיין אין חדרים' },
  noRoomsHint: { en: 'Rooms appear here as you add them. Start with the one you are in.', he: 'חדרים יופיעו כאן כשתוסיף אותם. התחל מהחדר שאתה נמצא בו.' },
  addRoom: { en: 'Add a room', he: 'הוסף חדר' },
  searching: { en: 'Looking for new devices…', he: 'מחפש מכשירים חדשים…' },
  found: { en: 'Found a bulb', he: 'נמצאה נורה' },
  pairing: { en: 'Getting to know it…', he: 'לומד להכיר אותו…' },
  paired: { en: 'Ready', he: 'מוכן' },
  run: { en: 'Run', he: 'הפעל' },
  running: { en: 'Running…', he: 'מפעיל…' },
  done: { en: 'Done', he: 'בוצע' },
  thinking: { en: 'Ziggy is thinking…', he: 'זיגי חושב…' },
}

export const pick = (v, lang) => (typeof v === 'object' && v && ('en' in v) ? v[lang] ?? v.en : v)

export const roomById = (id) => ROOMS.find(r => r.id === id)
export const devicesInRoom = (id) => DEVICES.filter(d => d.room === id)
