// Schedule triggers — the `time` trigger with days and several times a day.
// Mirrors services/schedule_trigger.py; see there for the stored shape.
//
//   { type: 'time', time: '07:00' }                                 every day
//   { type: 'time', time: '07:00', times: ['07:00','19:30'],
//     days: ['sun','mon','tue','wed','thu'] }                       Sun–Thu, twice
//
// No `days` = every day (every rule saved before 2026-10-31). `time` always
// holds the first time so anything reading only `time` stays correct.

// Display order: the Israeli week starts on Sunday.
export const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export const WORKWEEK = ['sun', 'mon', 'tue', 'wed', 'thu']
export const WEEKEND = ['fri', 'sat']

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

function hhmm(v) {
  const m = HHMM.exec(String(v ?? '').trim())
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** Every valid HH:MM the trigger fires at, sorted and de-duplicated. */
export function scheduleTimes(trigger) {
  const t = trigger || {}
  const raw = Array.isArray(t.times) && t.times.length ? t.times : [t.time]
  return [...new Set(raw.map(hhmm).filter(Boolean))].sort()
}

/** The raw time slots for the editor — keeps blanks the user is filling in. */
export function scheduleSlots(trigger) {
  const t = trigger || {}
  if (Array.isArray(t.times) && t.times.length) return t.times.map(v => String(v ?? '').slice(0, 5))
  return [String(t.time ?? '').slice(0, 5)]
}

/** null = every day; otherwise the picked days in week order. */
export function scheduleDays(trigger) {
  const d = (trigger || {}).days
  if (d == null) return null
  if (!Array.isArray(d)) return []
  const picked = WEEK.filter(c => d.includes(c))
  return picked.length === 7 ? null : picked
}

const same = (a, b) => a.length === b.length && a.every(x => b.includes(x))

/** 'every' | 'workweek' | 'weekend' | 'custom' */
export function daysPreset(days) {
  if (days == null) return 'every'
  if (same(days, WORKWEEK)) return 'workweek'
  if (same(days, WEEKEND)) return 'weekend'
  return 'custom'
}

/** New trigger with these time slots (blank slots kept while editing). */
export function withSlots(trigger, slots) {
  const next = { ...(trigger || {}), type: 'time' }
  const list = slots.length ? slots : ['']
  next.time = list[0] || ''
  if (list.length > 1) next.times = list
  else delete next.times
  return next
}

/** New trigger with these days; null (or all seven) = every day. */
export function withDays(trigger, days) {
  const next = { ...(trigger || {}), type: 'time' }
  if (days == null || days.length === 7) delete next.days
  else next.days = WEEK.filter(c => days.includes(c))
  return next
}

/** Short localized day name ("Sun" / "א׳"), Sunday-first. */
export function dayShortName(code, lang) {
  // 2023-01-01 was a Sunday.
  const date = new Date(Date.UTC(2023, 0, 1 + WEEK.indexOf(code), 12))
  try {
    // Hebrew "short" is "יום א׳" — too wide for seven chips on a phone; the
    // narrow form ("א׳") is how Israeli calendars label days. English narrow
    // ("S", "S") is ambiguous, so English keeps "Sun".
    return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-US',
      { weekday: lang === 'he' ? 'narrow' : 'short', timeZone: 'UTC' }).format(date)
  } catch {
    return code
  }
}
