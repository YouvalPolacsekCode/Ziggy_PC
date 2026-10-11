// Waitlist submission for the in-app marketing page (/welcome).
//
// The form POSTs to the Desk's lead endpoint — the same pipeline the public
// site feeds (dedupe, attribution, HubSpot/Brevo sync happen there). When the
// Desk is unreachable the browser falls back to a mailto so a real person's
// interest is never dropped on the floor. Self-contained on purpose: no
// dependency on the app's api.js / auth — this page renders before login.

export const DESK_LEADS_URL = 'https://ziggy-desk.fly.dev/api/leads'
export const WAITLIST_EMAIL = 'hello@ziggy-home.com'

export function detectLanguage(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const tag = (nav?.language || (nav?.languages || [])[0] || '').toLowerCase()
  return tag.startsWith('he') || tag.startsWith('iw') ? 'he' : 'en'
}

export function buildLeadBody(email, { language } = {}) {
  return {
    email: String(email || '').trim(),
    intent: 'waitlist',
    form: 'welcome',
    language: language || detectLanguage(),
    consent_marketing: false,
    website: 'app',
    hp: '', // honeypot — the Desk rejects anything non-empty
  }
}

export function mailtoFallback(email, to = WAITLIST_EMAIL) {
  const subject = encodeURIComponent('Ziggy waitlist')
  const body = encodeURIComponent(`Please add me to the Ziggy waitlist: ${email}`)
  return `mailto:${to}?subject=${subject}&body=${body}`
}

/**
 * POST the lead; on any failure open the mailto fallback.
 * Returns {ok: true, lead_id} on success, {ok: false, fallback: true} otherwise.
 */
export async function submitWaitlistLead(email, {
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  navigate = (url) => { window.location.href = url },
  language,
  timeoutMs = 8000,
} = {}) {
  const body = buildLeadBody(email, { language })
  let result = null
  if (fetchImpl) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
    try {
      const res = await fetchImpl(DESK_LEADS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl?.signal,
      })
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data && data.ok !== false) {
          result = { ok: true, lead_id: data.lead_id ?? null }
        }
      }
    } catch {
      // network / CORS / abort — fall through to mailto
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  if (result) return result
  navigate(mailtoFallback(body.email))
  return { ok: false, fallback: true }
}
