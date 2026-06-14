// Bidirectional smart-home name dictionary.
//
// Used to translate USER-TYPED names (room names, device names, automation
// names, quick-ask labels, etc.) at render time. Storage stays language-
// neutral — we never rewrite the saved value. The detect→translate happens
// only when displaying.
//
// Add a row: { en: 'Kitchen', he: 'מטבח', aliases: ['cookhouse'] }
// `aliases` are extra English lookup keys for the same Hebrew translation.
//
// Phase 1: dictionary lookup with normalization (lowercase, strip niqqud,
// strip definite article ה, plural-s strip). Phase 2 (future) will fall
// back to a cached /api/translate call for misses.

export const SMART_HOME_DICT = [
  // ── Rooms ────────────────────────────────────────────────────────────
  { en: 'Living Room',     he: 'סלון',                aliases: ['lounge', 'salon', 'family room'] },
  { en: 'Bedroom',         he: 'חדר שינה',            aliases: ['bed room'] },
  { en: 'Master Bedroom',  he: 'חדר שינה ראשי',       aliases: ['main bedroom', 'primary bedroom'] },
  { en: 'Kids Room',       he: 'חדר ילדים',           aliases: ["kid's room", 'children room', 'kids bedroom'] },
  { en: 'Nursery',         he: 'חדר תינוק',           aliases: ['baby room'] },
  { en: 'Bathroom',        he: 'חדר אמבטיה',          aliases: ['bath room', 'wc'] },
  { en: 'Toilet',          he: 'שירותים',             aliases: ['restroom', 'water closet'] },
  { en: 'Kitchen',         he: 'מטבח' },
  { en: 'Dining Room',     he: 'פינת אוכל',           aliases: ['dining area'] },
  { en: 'Office',          he: 'משרד',                aliases: ['home office', 'study'] },
  { en: 'Library',         he: 'ספרייה' },
  { en: 'Hallway',         he: 'מסדרון',              aliases: ['corridor'] },
  { en: 'Entrance',        he: 'כניסה',               aliases: ['foyer', 'entry', 'entryway'] },
  { en: 'Balcony',         he: 'מרפסת',               aliases: ['terrace'] },
  { en: 'Patio',           he: 'פטיו' },
  { en: 'Garden',          he: 'גינה',                aliases: ['backyard'] },
  { en: 'Yard',            he: 'חצר',                 aliases: ['courtyard'] },
  { en: 'Garage',          he: 'חניה',                aliases: ['carport', 'parking'] },
  { en: 'Basement',        he: 'מרתף' },
  { en: 'Attic',           he: 'עליית גג',            aliases: ['loft'] },
  { en: 'Laundry Room',    he: 'חדר כביסה',           aliases: ['utility room', 'washroom'] },
  { en: 'Guest Room',      he: 'חדר אורחים',          aliases: ['guestroom'] },
  { en: 'Playroom',        he: 'חדר משחקים',          aliases: ['game room', 'rec room'] },
  { en: 'Gym',             he: 'חדר כושר',            aliases: ['workout room', 'fitness room'] },
  { en: 'Storage',         he: 'מחסן',                aliases: ['storage room'] },
  { en: 'Closet',          he: 'ארון',                aliases: ['wardrobe'] },
  { en: 'Walk-in Closet',  he: 'חדר הלבשה',           aliases: ['walk in closet', 'dressing room'] },
  { en: 'Pantry',          he: 'מזווה' },
  { en: 'Pool',            he: 'בריכה',               aliases: ['swimming pool'] },
  { en: 'Roof',            he: 'גג',                  aliases: ['rooftop'] },
  { en: 'Shelter',         he: 'ממ״ד',                aliases: ['safe room', 'mamad'] },

  // ── Lights ───────────────────────────────────────────────────────────
  { en: 'Light',           he: 'אור',                 aliases: ['lights'] },
  { en: 'Lamp',            he: 'מנורה',               aliases: ['lamps'] },
  { en: 'Ceiling Light',   he: 'אור תקרה',            aliases: ['ceiling lights', 'ceiling lamp'] },
  { en: 'Main Light',      he: 'אור ראשי',            aliases: ['overhead light'] },
  { en: 'Wall Light',      he: 'אור קיר',             aliases: ['wall lamp', 'sconce'] },
  { en: 'Floor Lamp',      he: 'מנורת רצפה',          aliases: ['standing lamp'] },
  { en: 'Table Lamp',      he: 'מנורת שולחן',         aliases: ['desk lamp'] },
  { en: 'Reading Lamp',    he: 'מנורת קריאה',         aliases: ['reading light'] },
  { en: 'Night Light',     he: 'מנורת לילה',          aliases: ['bedside lamp', 'bedside light'] },
  { en: 'LED Strip',       he: 'רצועת לד',            aliases: ['led strip', 'light strip', 'strip light'] },
  { en: 'Chandelier',      he: 'נברשת' },
  { en: 'Spotlight',       he: 'ספוט',                aliases: ['spot light', 'spot', 'spots'] },
  { en: 'Bulb',            he: 'נורה',                aliases: ['bulbs', 'light bulb'] },
  { en: 'Pendant Light',   he: 'מנורה תלויה',         aliases: ['hanging light'] },
  { en: 'Mood Lighting',   he: 'תאורת אווירה',        aliases: ['ambient lighting', 'accent lighting'] },

  // ── Climate ─────────────────────────────────────────────────────────
  { en: 'AC',              he: 'מזגן',                aliases: ['a/c', 'air conditioner', 'air conditioning', 'aircon'] },
  { en: 'Heater',          he: 'תנור חימום',          aliases: ['space heater'] },
  { en: 'Fan',             he: 'מאוורר',              aliases: ['fans'] },
  { en: 'Ceiling Fan',     he: 'מאוורר תקרה' },
  { en: 'Stand Fan',       he: 'מאוורר עמוד',         aliases: ['pedestal fan', 'standing fan'] },
  { en: 'Tower Fan',       he: 'מאוורר מגדל' },
  { en: 'Air Purifier',    he: 'מטהר אוויר' },
  { en: 'Humidifier',      he: 'מאדה אוויר' },
  { en: 'Dehumidifier',    he: 'מייבש אוויר' },
  { en: 'Thermostat',      he: 'תרמוסטט' },
  { en: 'Radiator',        he: 'רדיאטור' },
  { en: 'Underfloor Heating', he: 'חימום תת רצפתי',   aliases: ['floor heating'] },

  // ── Media ────────────────────────────────────────────────────────────
  { en: 'TV',              he: 'טלוויזיה',            aliases: ['television', 'tv set'] },
  { en: 'Projector',       he: 'מקרן' },
  { en: 'Speaker',         he: 'רמקול',               aliases: ['speakers'] },
  { en: 'Smart Speaker',   he: 'רמקול חכם' },
  { en: 'Soundbar',        he: 'סאונדבר',             aliases: ['sound bar'] },
  { en: 'Subwoofer',       he: 'סאבוופר',             aliases: ['sub'] },
  { en: 'Receiver',        he: 'מקלט' },
  { en: 'Stereo',          he: 'מערכת סטריאו',        aliases: ['hi-fi', 'hifi'] },
  { en: 'Bluetooth Speaker', he: 'רמקול בלוטות׳',     aliases: ['bt speaker'] },
  { en: 'Set Top Box',     he: 'ממיר',                aliases: ['set-top box', 'cable box'] },
  { en: 'Streamer',        he: 'סטרימר',              aliases: ['streaming box'] },

  // ── Kitchen appliances ─────────────────────────────────────────────
  { en: 'Refrigerator',    he: 'מקרר',                aliases: ['fridge'] },
  { en: 'Freezer',         he: 'מקפיא' },
  { en: 'Oven',            he: 'תנור' },
  { en: 'Microwave',       he: 'מיקרוגל' },
  { en: 'Dishwasher',      he: 'מדיח כלים',           aliases: ['dish washer'] },
  { en: 'Coffee Machine',  he: 'מכונת קפה',           aliases: ['espresso machine', 'coffee maker'] },
  { en: 'Kettle',          he: 'קומקום',              aliases: ['electric kettle'] },
  { en: 'Toaster',         he: 'מצנם' },
  { en: 'Cooktop',         he: 'כיריים',              aliases: ['stove', 'range', 'hob'] },
  { en: 'Range Hood',      he: 'קולט אדים',           aliases: ['hood', 'extractor'] },
  { en: 'Wine Fridge',     he: 'מקרר יין',            aliases: ['wine cooler'] },

  // ── Laundry & cleaning ─────────────────────────────────────────────
  { en: 'Washing Machine', he: 'מכונת כביסה',         aliases: ['washer'] },
  { en: 'Dryer',           he: 'מייבש כביסה',         aliases: ['clothes dryer'] },
  { en: 'Vacuum',          he: 'שואב אבק',            aliases: ['vacuum cleaner'] },
  { en: 'Robot Vacuum',    he: 'שואב אבק רובוטי',     aliases: ['roomba', 'robovac'] },
  { en: 'Iron',            he: 'מגהץ' },

  // ── Sensors ─────────────────────────────────────────────────────────
  { en: 'Door Sensor',     he: 'חיישן דלת' },
  { en: 'Window Sensor',   he: 'חיישן חלון' },
  { en: 'Motion Sensor',   he: 'חיישן תנועה',         aliases: ['pir', 'occupancy sensor'] },
  { en: 'Temperature Sensor', he: 'חיישן טמפרטורה' },
  { en: 'Humidity Sensor', he: 'חיישן לחות' },
  { en: 'Smoke Detector',  he: 'גלאי עשן',            aliases: ['smoke alarm'] },
  { en: 'Gas Detector',    he: 'גלאי גז' },
  { en: 'Leak Detector',   he: 'חיישן נזילה',         aliases: ['water leak sensor'] },
  { en: 'Doorbell',        he: 'פעמון',               aliases: ['door bell'] },
  { en: 'Intercom',        he: 'אינטרקום' },
  { en: 'Camera',          he: 'מצלמה' },
  { en: 'Security Camera', he: 'מצלמת אבטחה' },

  // ── Covers / access ─────────────────────────────────────────────────
  { en: 'Curtain',         he: 'וילון',               aliases: ['curtains'] },
  { en: 'Blind',           he: 'תריס',                aliases: ['blinds', 'shutter', 'shutters'] },
  { en: 'Roller Shade',    he: 'וילון רולר',          aliases: ['roller blind'] },
  { en: 'Garage Door',     he: 'שער חניה' },
  { en: 'Gate',            he: 'שער' },
  { en: 'Lock',            he: 'מנעול' },
  { en: 'Smart Lock',      he: 'מנעול חכם' },

  // ── Power ───────────────────────────────────────────────────────────
  { en: 'Outlet',          he: 'שקע',                 aliases: ['socket', 'power outlet'] },
  { en: 'Smart Plug',      he: 'שקע חכם',             aliases: ['plug', 'smart outlet'] },
  { en: 'Switch',          he: 'מתג',                 aliases: ['light switch'] },
  { en: 'Smart Switch',    he: 'מתג חכם' },
  { en: 'Dimmer',          he: 'דימר' },

  // ── Utilities / outdoor ────────────────────────────────────────────
  { en: 'Boiler',          he: 'דוד',                 aliases: ['water heater'] },
  { en: 'Solar Boiler',    he: 'דוד שמש' },
  { en: 'Pool Pump',       he: 'משאבת בריכה' },
  { en: 'Sprinkler',       he: 'ממטרה',               aliases: ['sprinklers', 'irrigation'] },
  { en: 'Pump',            he: 'משאבה' },

  // ── IR remote command labels ───────────────────────────────────────
  { en: 'Power',           he: 'הפעלה',               aliases: ['on/off'] },
  { en: 'Volume Up',       he: 'ווליום למעלה',        aliases: ['vol up', 'vol+', 'volume+'] },
  { en: 'Volume Down',     he: 'ווליום למטה',         aliases: ['vol down', 'vol-', 'volume-'] },
  { en: 'Mute',            he: 'השתקה' },
  { en: 'Channel Up',      he: 'ערוץ למעלה',          aliases: ['ch+', 'channel+'] },
  { en: 'Channel Down',    he: 'ערוץ למטה',           aliases: ['ch-', 'channel-'] },
  { en: 'Play',            he: 'נגן' },
  { en: 'Pause',           he: 'השהה' },
  { en: 'Stop',            he: 'עצור' },
  { en: 'Next',            he: 'הבא' },
  { en: 'Previous',        he: 'הקודם',               aliases: ['prev'] },
  { en: 'Input',           he: 'מקור',                aliases: ['source'] },
  { en: 'Menu',            he: 'תפריט' },
  { en: 'Back',            he: 'חזור' },
  { en: 'Home',            he: 'בית' },
  { en: 'OK',              he: 'אישור' },
  { en: 'Cool',            he: 'קירור' },
  { en: 'Heat',            he: 'חימום' },
  { en: 'Dry',             he: 'יבוש' },
  { en: 'Auto',            he: 'אוטומטי' },
  { en: 'Swing',           he: 'נדנוד' },
  { en: 'Speed Up',        he: 'הגבר מהירות' },
  { en: 'Speed Down',      he: 'הנמך מהירות' },

  // ── Common quick-ask scene names ───────────────────────────────────
  { en: 'Good Morning',    he: 'בוקר טוב' },
  { en: 'Good Night',      he: 'לילה טוב',            aliases: ['goodnight'] },
  { en: 'Bedtime',         he: 'זמן שינה',            aliases: ['sleep'] },
  { en: 'Wake Up',         he: 'השכמה',               aliases: ['wakeup'] },
  { en: 'Movie Time',      he: 'ערב סרט',             aliases: ['movie night', 'movie mode'] },
  { en: 'Going Out',       he: 'יוצא מהבית',          aliases: ['leaving', 'away'] },
  { en: 'Coming Home',     he: 'חוזר הביתה',          aliases: ["i'm home", 'arrived', 'arrived home'] },
  { en: 'All Lights Off',  he: 'כיבוי כל האורות',     aliases: ['lights off', 'turn off all lights'] },
  { en: 'All Lights On',   he: 'הדלקת כל האורות',     aliases: ['lights on', 'turn on all lights'] },
  { en: 'Romantic',        he: 'אווירה רומנטית',      aliases: ['romance', 'dinner mode'] },
  { en: 'Party',           he: 'אווירת מסיבה',        aliases: ['party mode'] },
  { en: 'Focus',           he: 'מצב ריכוז',           aliases: ['work mode', 'study mode'] },
  { en: 'Relax',           he: 'מצב רגיעה',           aliases: ['chill', 'unwind'] },
  { en: 'Morning Routine', he: 'שגרת בוקר' },
  { en: 'Evening Routine', he: 'שגרת ערב' },
  { en: 'Vacation',        he: 'חופשה',               aliases: ['vacation mode', 'holiday'] },
  { en: 'Cleaning',        he: 'ניקיון',              aliases: ['cleaning mode'] },
  { en: 'Cooking',         he: 'בישול',               aliases: ['cooking mode'] },
  { en: 'Dinner',          he: 'ארוחת ערב' },
  { en: 'Breakfast',       he: 'ארוחת בוקר' },
  { en: 'Lunch',           he: 'ארוחת צהריים' },
]

// ── Internals ──────────────────────────────────────────────────────────
const HEBREW_RE = /[֐-׿]/
const LATIN_RE  = /[A-Za-z]/

// Niqqud range (vowel points) — stripped before matching so users who type
// with niqqud match users who don't.
const NIQQUD_RE = /[֑-ׇ]/g

function normalize(s) {
  if (!s || typeof s !== 'string') return ''
  return s
    .toLowerCase()
    .replace(NIQQUD_RE, '')
    // collapse punctuation + whitespace
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Strip Hebrew conjunction/article single-letter prefixes (ה / ו / ב / ל / כ / מ ש)
// only when the remainder is at least 2 chars — keeps "ה" alone, "וי" alone, etc.
function stripHePrefix(s) {
  if (s.length < 3) return s
  const first = s[0]
  if ('הובלכמש'.includes(first) && s[1] !== ' ') return s.slice(1)
  return s
}

function stripEnPlural(s) {
  if (s.endsWith('s') && s.length > 3 && !s.endsWith('ss')) return s.slice(0, -1)
  return s
}

let enToHe = null
let heToEn = null

function buildMaps() {
  enToHe = new Map()
  heToEn = new Map()
  for (const { en, he, aliases } of SMART_HOME_DICT) {
    const enKey = normalize(en)
    const heKey = normalize(he)
    if (enKey && !enToHe.has(enKey)) enToHe.set(enKey, he)
    if (heKey && !heToEn.has(heKey)) heToEn.set(heKey, en)
    for (const alias of aliases || []) {
      const aKey = normalize(alias)
      if (aKey && !enToHe.has(aKey)) enToHe.set(aKey, he)
    }
  }
}

export function detectNameLang(s) {
  if (!s || typeof s !== 'string') return null
  if (HEBREW_RE.test(s)) return 'he'
  if (LATIN_RE.test(s)) return 'en'
  return null
}

// Translate one user-typed name to `targetLang`, or return the original
// string if there's no dictionary hit / already in the target language /
// no detectable language (pure numbers, emoji, etc.).
//
// Phase 2 will accept an async fallback for misses; for now lookup is sync.
export function translateName(text, targetLang) {
  if (!text || typeof text !== 'string') return text
  if (targetLang !== 'en' && targetLang !== 'he') return text
  if (!enToHe) buildMaps()

  const src = detectNameLang(text)
  if (!src || src === targetLang) return text

  const norm = normalize(text)
  if (!norm) return text

  if (targetLang === 'he' && src === 'en') {
    return enToHe.get(norm)
        ?? enToHe.get(stripEnPlural(norm))
        ?? text
  }
  // targetLang === 'en' && src === 'he'
  return heToEn.get(norm)
      ?? heToEn.get(stripHePrefix(norm))
      ?? text
}

// Translate a multi-word name with greedy longest-prefix matching against
// the dictionary. Used for compounds like "Living Room Lamp" / "מנורת מטבח"
// where the whole phrase isn't in the dict but a prefix is. Word order is
// preserved within each language (we don't re-grammar across languages).
//
// Algorithm: walk left-to-right, at each position try the longest run of
// tokens that matches a dictionary entry, emit the translation, advance.
// Unmatched tokens pass through verbatim.
export function translateNamePhrase(text, targetLang) {
  if (!text || typeof text !== 'string') return text
  if (targetLang !== 'en' && targetLang !== 'he') return text

  // Try the whole string first — preserves exact-match casing for entries
  // like "All Lights Off".
  const whole = translateName(text, targetLang)
  if (whole !== text) return whole

  const tokens = text.split(/(\s+)/) // keep whitespace tokens
  const isWs = (t) => /^\s+$/.test(t)
  const out = []
  let changed = false
  let i = 0
  while (i < tokens.length) {
    if (isWs(tokens[i])) { out.push(tokens[i]); i++; continue }
    // Try the longest run of non-whitespace tokens starting at i.
    let matched = false
    let end = tokens.length
    while (end > i) {
      const slice = tokens.slice(i, end).join('')
      if (/\S/.test(slice)) {
        const t = translateName(slice, targetLang)
        if (t !== slice) { out.push(t); i = end; matched = true; changed = true; break }
      }
      // Shrink the window by one non-whitespace token (skip back across ws).
      end--
      while (end > i && isWs(tokens[end - 1])) end--
    }
    if (!matched) { out.push(tokens[i]); i++ }
  }
  return changed ? out.join('') : text
}
