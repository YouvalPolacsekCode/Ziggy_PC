// Motion Lab — decisions store.
//
// Where a reviewer's picks live. Inside the published artifact the page uses
// the artifact's shared `db` capability (`decisions/<demoId>` documents), so
// picks made on a phone can be read back by Claude with the ArtifactData
// tool. Anywhere else (dev server, LAN) it falls back to localStorage and the
// Decisions page offers "Copy as JSON" to hand the picks over by paste.
//
// Document shape (one per demo):
//   { section, demo, title, verdict: 'pick' | 'maybe' | 'reject',
//     variant, variantLabel, knobs, note, updatedAt }

const LS_KEY = 'ziggy_lab_decisions'
let dbPromise = null
const subs = new Set()

export function getDb() {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    try {
      if (typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function') {
        const db = await window.claude.use('db')
        return db || null
      }
    } catch { /* not in a viewer */ }
    return null
  })()
  return dbPromise
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') } catch { return {} }
}
function writeLocal(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch { /* private mode */ }
  subs.forEach(fn => fn(map))
}

export async function saveDecision(demoId, data) {
  const doc = { ...data, demo: demoId, updatedAt: new Date().toISOString() }
  const db = await getDb()
  if (db) {
    await db.doc(`decisions/${demoId}`).set(doc)
    return { where: 'db' }
  }
  const map = readLocal(); map[demoId] = doc; writeLocal(map)
  return { where: 'local' }
}

export async function clearDecision(demoId) {
  const db = await getDb()
  if (db) { await db.doc(`decisions/${demoId}`).delete(); return }
  const map = readLocal(); delete map[demoId]; writeLocal(map)
}

export async function loadDecision(demoId) {
  const db = await getDb()
  if (db) { const s = await db.doc(`decisions/${demoId}`).get(); return s.exists ? s.data() : null }
  return readLocal()[demoId] || null
}

// Subscribe to the whole set. Returns an unsubscribe.
export function subscribeDecisions(cb) {
  let unsub = () => {}
  let alive = true
  getDb().then(db => {
    if (!alive) return
    if (db) {
      unsub = db.collection('decisions').onSnapshot(
        (snap) => { const map = {}; snap.docs.forEach(d => { map[d.id] = d.data() }); cb(map, 'db') },
        () => cb(readLocal(), 'local'),
      )
    } else {
      cb(readLocal(), 'local')
      const fn = (map) => cb(map, 'local')
      subs.add(fn)
      const onStorage = (e) => { if (e.key === LS_KEY) cb(readLocal(), 'local') }
      window.addEventListener('storage', onStorage)
      unsub = () => { subs.delete(fn); window.removeEventListener('storage', onStorage) }
    }
  })
  return () => { alive = false; unsub() }
}

export function exportDecisions(map) {
  return JSON.stringify(Object.values(map).sort((a, b) => (a.section || '').localeCompare(b.section || '')), null, 2)
}

// ── General notes to Claude (free text, one document) ──────────────────
const LS_NOTES = 'ziggy_lab_notes'
export async function saveGeneralNote(text) {
  const db = await getDb()
  const doc = { text, updatedAt: new Date().toISOString() }
  if (db) { await db.doc('notes/general').set(doc); return 'db' }
  try { localStorage.setItem(LS_NOTES, JSON.stringify(doc)) } catch { /* private mode */ }
  return 'local'
}
export async function loadGeneralNote() {
  const db = await getDb()
  if (db) { const s = await db.doc('notes/general').get(); return s.exists ? s.data() : null }
  try { return JSON.parse(localStorage.getItem(LS_NOTES) || 'null') } catch { return null }
}
