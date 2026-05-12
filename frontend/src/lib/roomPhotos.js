export const ROOM_PHOTOS = {
  living_room:  'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80',
  bedroom:      'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=400&q=80',
  kitchen:      'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=80',
  bathroom:     'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=400&q=80',
  office:       'https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=80',
  garage:       'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
  hallway:      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
  garden:       'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&q=80',
  dining_room:  'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=400&q=80',
  kids_room:    'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=400&q=80',
  laundry:      'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?w=400&q=80',
  balcony:      'https://images.unsplash.com/photo-1567684014761-b65e2e3b0ac4?w=400&q=80',
  gym:          'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=80',
  basement:     'https://images.unsplash.com/photo-1604754742629-3e5728249d73?w=400&q=80',
  nursery:      'https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=400&q=80',
  attic:        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
}

export const DEFAULT_PHOTO = 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80'

export const PHOTO_OPTIONS = [
  { key: 'living_room', label: 'Living Room' },
  { key: 'bedroom',     label: 'Bedroom' },
  { key: 'kitchen',     label: 'Kitchen' },
  { key: 'bathroom',    label: 'Bathroom' },
  { key: 'office',      label: 'Office' },
  { key: 'dining_room', label: 'Dining' },
  { key: 'kids_room',   label: "Kids Room" },
  { key: 'nursery',     label: 'Nursery' },
  { key: 'garage',      label: 'Garage' },
  { key: 'hallway',     label: 'Hallway' },
  { key: 'garden',      label: 'Garden' },
  { key: 'balcony',     label: 'Balcony' },
  { key: 'laundry',     label: 'Laundry' },
  { key: 'gym',         label: 'Gym' },
  { key: 'basement',    label: 'Basement' },
  { key: 'attic',       label: 'Attic' },
]

const CUSTOM_KEY = 'ziggy_room_custom_photos'

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
  } catch {}
}

export function removeCustomPhoto(roomId) {
  try {
    const data = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}')
    delete data[roomId]
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(data))
  } catch {}
}

// Resize + compress a File to a JPEG data URL (max 800px, 0.82 quality).
// Keeps storage footprint small enough for localStorage.
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
    const overrides = JSON.parse(localStorage.getItem('ziggy_room_photos') || '{}')
    overrides[roomId] = photoKey
    localStorage.setItem('ziggy_room_photos', JSON.stringify(overrides))
  } catch {}
}
