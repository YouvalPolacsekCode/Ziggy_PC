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
}
