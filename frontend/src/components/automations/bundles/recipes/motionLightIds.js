// Motion Light instance ids.
//
// A Motion Light "instance" is one independent automation the user created.
// Multiple instances coexist so "Add" makes a NEW one instead of overwriting
// the first (the pre-2026-07-29 behaviour, which reused the single fixed id
// `ziggy_motion_light` and clobbered in place).
//
// Id scheme (backward compatible, and matches the backend's paired fan-out
// which builds stage ids as `{base_id}_{key}` — services/ha_automations.py):
//   instance base    : `ziggy_motion_light`      → the first / legacy instance
//                      `ziggy_motion_light_<N>`  → N = 2,3,… for extra instances
//   1st-instance stage: `ziggy_motion_light_<roomSlug>`   (room slug never a
//                       bare number, so it can't look like a `_<N>` base)
//   Nth-instance stage: `ziggy_motion_light_<N>_<roomSlug>`
export const ML_FAMILY = 'ziggy_motion_light'

const NUM_INSTANCE = /^ziggy_motion_light_\d+$/

// Any id in the Motion Light family (base, numbered instance, or stage).
export const isMotionLightId = (id) =>
  id === ML_FAMILY || String(id).startsWith(ML_FAMILY + '_')

// An instance base — one card in the Actions list.
export const isInstanceBaseId = (id) =>
  id === ML_FAMILY || NUM_INSTANCE.test(String(id))

// A stage row — hidden from the list; it belongs to an instance card.
export const isStageId = (id) =>
  isMotionLightId(id) && !isInstanceBaseId(id)

// Which instance a given (base or stage) id belongs to.
export const instanceBaseOf = (id) => {
  const s = String(id)
  if (!isMotionLightId(s)) return s // not ours — leave it untouched
  if (isInstanceBaseId(s)) return s
  const rest = s.slice(ML_FAMILY.length + 1) // after `ziggy_motion_light_`
  const m = rest.match(/^(\d+)_/) // numbered-instance stage: `<N>_<roomSlug>`
  if (m) return `${ML_FAMILY}_${m[1]}`
  return ML_FAMILY // first-instance stage: `<roomSlug>`
}

// The distinct instance bases present among a set of automation ids.
export const instanceBases = (ids) =>
  [...new Set((ids || []).filter(isMotionLightId).map(instanceBaseOf))]

// All ids (base + its stages) that make up one instance.
export const instanceMemberIds = (base, ids) =>
  (ids || []).filter((id) => instanceBaseOf(id) === base)

// The next free instance base, given the ids already in use.
export const freshInstanceBase = (ids) => {
  const used = new Set(instanceBases(ids))
  if (!used.has(ML_FAMILY)) return ML_FAMILY
  let n = 2
  while (used.has(`${ML_FAMILY}_${n}`)) n += 1
  return `${ML_FAMILY}_${n}`
}

// A paired-stage id under a given instance base (single underscore — matches
// the backend fan-out `{base_id}_{key}`).
export const stageId = (base, roomSlug) => `${base}_${roomSlug}`
