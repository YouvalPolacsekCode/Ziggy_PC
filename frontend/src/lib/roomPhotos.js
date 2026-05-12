export const ROOM_PHOTOS = {
  living_room: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80',
  bedroom: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=400&q=80',
  kitchen: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=80',
  bathroom: 'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=400&q=80',
  office: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=80',
  garage: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
  hallway: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
  garden: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&q=80',
}

export const DEFAULT_PHOTO = 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80'

export const PHOTO_OPTIONS = [
  { key: 'living_room', label: 'Living Room' },
  { key: 'bedroom', label: 'Bedroom' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'bathroom', label: 'Bathroom' },
  { key: 'office', label: 'Office' },
  { key: 'garage', label: 'Garage' },
  { key: 'hallway', label: 'Hallway' },
  { key: 'garden', label: 'Garden' },
]

export function getRoomPhoto(room) {
  try {
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
