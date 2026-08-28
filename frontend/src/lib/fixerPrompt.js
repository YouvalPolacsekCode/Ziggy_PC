/**
 * The words the device page hands to the assistant when the user taps
 * "not responding? fix it".
 *
 * Kept out of the page (and out of t()) on purpose: t() wraps interpolated
 * values in invisible bidi isolates for correct RTL rendering, which is right
 * for UI text and wrong for a string we're about to send to the model as if
 * the user had typed it. The agent also picks its reply language from this
 * text, so the Hebrew phrasing has to be genuinely Hebrew.
 */
const TEMPLATES = {
  he: {
    named: 'למה {name} לא מגיב?',
    anon: 'המכשיר הזה לא מגיב — אפשר לבדוק?',
  },
  en: {
    named: "Why isn't {name} responding?",
    anon: "This device isn't responding — can you check it?",
  },
}

export function buildFixerQuestion(deviceName, lang = 'he') {
  const pack = TEMPLATES[lang] || TEMPLATES.en
  const name = String(deviceName || '').trim()
  if (!name) return pack.anon
  return pack.named.replace('{name}', name)
}
