// Lightweight i18n for Ziggy. Hebrew + English, RTL aware.
//
// Usage:
//   const t = useT()
//   <h1>{t('settings.title')}</h1>
//   <p>{t('tasks.count', { n: 5 })}</p>
//
// Adding a string:
//   1. Add `key: 'English text'` to en.js
//   2. Add `key: 'טקסט בעברית'` to he.js (or it falls back to EN)
//
// Switching language: the user changes it in Settings → General → Language.
// That dispatches setLang(), which:
//   - flips <html dir> + <html lang>
//   - persists to localStorage (ziggy-lang)
//   - patches general settings on the backend (caller's responsibility)
//
// Hebrew strings here cover the WHOLE UI. If a key is missing in he.js the
// English string is shown verbatim — never a raw key.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import en from './en'
import he from './he'
import { translateNamePhrase } from './nameDict'

export { translateName, translateNamePhrase, detectNameLang, SMART_HOME_DICT } from './nameDict'

const DICTS = { en, he }
export const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'he', label: 'עברית' },
]

function applyToDocument(lang) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang === 'he' ? 'he' : 'en'
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'
}

export const useLangStore = create(
  persist(
    (set, get) => ({
      lang: 'en',
      setLang: (lang) => {
        if (lang !== 'en' && lang !== 'he') lang = 'en'
        applyToDocument(lang)
        set({ lang })
      },
    }),
    {
      name: 'ziggy-lang',
      // Re-apply <html dir>/<html lang> on hydration so the page boots with
      // the right direction without a flicker.
      onRehydrateStorage: () => (state) => {
        if (state?.lang) applyToDocument(state.lang)
      },
    },
  ),
)

export function getLang() {
  return useLangStore.getState().lang
}

export function setLang(lang) {
  useLangStore.getState().setLang(lang)
}

// Unicode bidi-isolation wrappers — First Strong Isolate (FSI, U+2068)
// opens an isolated bidi context for the substituted value, Pop Directional
// Isolate (PDI, U+2069) closes it. The browser's bidi algorithm then routes
// the value's direction independently from the surrounding template, which
// is the difference between
//
//   "המכשיר Sonos One נוסף"   ← what users expect
//   "המכשיר Sonos One נוסף"   ← what they actually get without isolation
//                                 (English fragment bleeds into surrounding
//                                  RTL context; trailing punctuation lands
//                                  on the wrong side; numbers can flip)
//
// Both characters are invisible and benign in pure-LTR contexts, so this is
// safe to apply unconditionally to every interpolated value.
const BIDI_FSI = '⁨'
const BIDI_PDI = '⁩'

// Skip wrapping when the value is empty or has no bidi-mixing risk at all
// (e.g. a one-character substitution like "{n}" = "5"). Wrapping a bare
// number is harmless but pollutes copy-to-clipboard with invisible chars, so
// we keep it minimal: only wrap when the value contains a letter from either
// script. Numbers, punctuation, and pure whitespace pass through unwrapped.
const NEEDS_ISO_RE = /[A-Za-z֐-׿]/

function isolateValue(v) {
  const s = String(v)
  if (!s) return s
  if (!NEEDS_ISO_RE.test(s)) return s
  return BIDI_FSI + s + BIDI_PDI
}

function format(template, params) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in params ? isolateValue(params[k]) : `{${k}}`))
}

// Pure translation — usable outside React (toasts emitted from stores, etc.)
export function t(key, params, lang) {
  const useLang = lang || getLang()
  const dict = DICTS[useLang] || DICTS.en
  const value = dict[key] ?? DICTS.en[key] ?? key
  return format(value, params)
}

// React hook — returns a stable-ish function that closes over the current lang
export function useT() {
  const lang = useLangStore((s) => s.lang)
  return (key, params) => t(key, params, lang)
}

export function useLang() {
  return useLangStore((s) => s.lang)
}

export function useIsRTL() {
  return useLangStore((s) => s.lang === 'he')
}

// Helpers for dir="auto" on user-generated content (names, messages) — falls
// back to the active UI language when the text has no Hebrew chars.
const HEBREW_RE = /[֐-׿]/
export function dirOf(text, fallback) {
  if (HEBREW_RE.test(text || '')) return 'rtl'
  if (fallback === 'rtl' || fallback === 'ltr') return fallback
  return 'ltr'
}

// React hook: translate a user-typed name (room, device, automation, quick-
// ask, task, etc.) to the currently-active UI language. Bidirectional —
// English names rendered under HE locale flip to Hebrew via the dictionary,
// and Hebrew names rendered under EN locale flip the other way. Names not
// in the dictionary pass through verbatim with dir="auto" handled at the
// render site.
export function useTranslatedName(text) {
  const lang = useLangStore((s) => s.lang)
  return translateNamePhrase(text, lang)
}
