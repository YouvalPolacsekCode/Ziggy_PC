// Curated Unsplash room photos.
// Every photo is a clean interior/exterior shot — no people prominently featured.
// To swap a photo: change the Unsplash photo ID (the part after "photo-").
export const ROOM_PHOTOS = {
  living_room:     'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80', // green sofa
  bedroom:         'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=400&q=80', // warm toned bedroom
  master_bedroom:  'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=400&q=80', // minimal master
  kitchen:         'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=400&q=80', // marble island kitchen
  bathroom:        'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=400&q=80', // bright modern bathroom
  office:          'https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=80', // home office
  dining_room:     'https://images.unsplash.com/photo-1604578762246-41134e37f9cc?w=400&q=80', // plant-filled dining area
  kids_room:       'https://images.unsplash.com/photo-1616046229478-9901c5536a45?w=400&q=80', // children's bedroom
  nursery:         'https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=400&q=80', // nursery
  hallway:         'https://images.unsplash.com/photo-1600210492493-0946911123ea?w=400&q=80', // bright interior hallway
  entrance:        'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&q=80', // house front entrance
  balcony:         'https://images.unsplash.com/photo-1567684014761-b65e2e3b0ac4?w=400&q=80', // balcony with plants
  garden:          'https://images.unsplash.com/photo-1558904541-efa843a96f01?w=400&q=80', // garden/backyard
  garage:          'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80', // garage
  laundry:         'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?w=400&q=80', // laundry room
  gym:             'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=80', // home gym
  basement:        'https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=400&q=80', // finished basement
  attic:           'https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=400&q=80', // attic with skylight
}

export const DEFAULT_PHOTO = ROOM_PHOTOS.living_room

export const PHOTO_OPTIONS = [
  { key: 'living_room',    label: 'Living Room' },
  { key: 'bedroom',        label: 'Bedroom' },
  { key: 'master_bedroom', label: 'Master Bedroom' },
  { key: 'kitchen',        label: 'Kitchen' },
  { key: 'bathroom',       label: 'Bathroom' },
  { key: 'office',         label: 'Office' },
  { key: 'dining_room',    label: 'Dining Room' },
  { key: 'kids_room',      label: 'Kids Room' },
  { key: 'nursery',        label: 'Nursery' },
  { key: 'hallway',        label: 'Hallway' },
  { key: 'entrance',       label: 'Entrance' },
  { key: 'balcony',        label: 'Balcony' },
  { key: 'garden',         label: 'Garden' },
  { key: 'garage',         label: 'Garage' },
  { key: 'laundry',        label: 'Laundry' },
  { key: 'gym',            label: 'Gym' },
  { key: 'basement',       label: 'Basement' },
  { key: 'attic',          label: 'Attic' },
]

const CUSTOM_KEY = 'ziggy_room_custom_photos'
const OVERRIDE_KEY = 'ziggy_room_photos'

// Server sync: every write hits the server too via putUiPrefs so room photos
// survive PWA cache evictions, multiple devices, and "clear site data" — same
// reason we did this for the Dashboard pins. Import is lazy to avoid a circular
// dep at module load (api.js → ... → roomPhotos.js in some entry points).
function _syncToServer(patch) {
  import('./api.js').then(({ putUiPrefs }) => {
    putUiPrefs(patch).catch(() => {})
  }).catch(() => {})
}

export function getCustomPhoto(roomId) {
  try {
    const data = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}')
    return data[roomId] || null
  } catch { return null }
}

export function storeCustomDataUrl(roomId, dataUrl) {
  try {
    const data = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}')
    data[roomId] = dataUrl
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(data))
    _syncToServer({ roomCustomPhotos: data })
  } catch {}
}

export function removeCustomPhoto(roomId) {
  try {
    const data = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}')
    delete data[roomId]
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(data))
    _syncToServer({ roomCustomPhotos: data })
  } catch {}
}

// Resize + compress a File to a JPEG data URL (max 800px, 0.82 quality).
export function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 800
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}

export function getRoomPhoto(room) {
  try {
    const custom = getCustomPhoto(room.id)
    if (custom) return custom
    const overrides = JSON.parse(localStorage.getItem('ziggy_room_photos') || '{}')
    const key = overrides[room.id] || room.id
    return ROOM_PHOTOS[key] || DEFAULT_PHOTO
  } catch {
    return ROOM_PHOTOS[room.id] || DEFAULT_PHOTO
  }
}

export function saveRoomPhoto(roomId, photoKey) {
  try {
    const overrides = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}')
    overrides[roomId] = photoKey
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides))
    _syncToServer({ roomPhotos: overrides })
  } catch {}
}
