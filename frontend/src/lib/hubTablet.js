// Hub-tablet identity stored in localStorage.
//
// A device becomes a "paired tablet" the moment it has a tablet_id here.
// Until then it's just a logged-in user visiting /hub — the page falls back
// to the default layout and shows a "Pair this tablet" banner.
//
// Single source of truth so Hub.jsx, hubStore, and the pairing flow agree.

const KEY = 'ziggy_hub_tablet_id'

export function getTabletId() {
  try { return localStorage.getItem(KEY) || null }
  catch { return null }
}

export function setTabletId(id) {
  try {
    if (id) localStorage.setItem(KEY, id)
    else    localStorage.removeItem(KEY)
  } catch {}
}

export function clearTabletId() {
  setTabletId(null)
  setTabletToken(null)
}

// ── Tablet credential ───────────────────────────────────────────────────────
// Issued once at pairing. The wall authenticates AS this tablet rather than
// borrowing the session of whoever paired it, so the hub can bind the tablet's
// capability policy to the credential. Identity asserted by a header instead
// would be worthless — anyone wanting more privilege would simply omit it.

const TOKEN_KEY = 'ziggy_wall_tablet_token'

export function getTabletToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null }
  catch { return null }
}

export function setTabletToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else       localStorage.removeItem(TOKEN_KEY)
  } catch {}
}
