import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { domainIcon as _registryDomainIcon, DOMAIN_REGISTRY } from './domainRegistry'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(date) {
  if (!date) return null
  const d = new Date(date)
  const now = new Date()
  const diff = d - now
  if (Math.abs(diff) < 86400000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function capitalize(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function slugToTitle(slug) {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// domainIcon — now sourced from domainRegistry.js so adding a new domain
// just requires updating that one file.
export { _registryDomainIcon as domainIcon }

// Returns a human-friendly state label + optional secondary line
export function formatEntityState(entity) {
  const { domain, state, device_class, unit_of_measurement } = entity

  if (state === 'unavailable') return { primary: 'Unavailable', secondary: null }
  if (state === 'unknown') return { primary: 'Unknown', secondary: null }

  if (domain === 'sensor') {
    if (device_class === 'timestamp') {
      try {
        const d = new Date(state)
        if (!isNaN(d)) {
          const now = new Date()
          const diffMs = now - d
          const diffMin = Math.round(diffMs / 60000)
          if (diffMin < 60) return { primary: `${diffMin}m ago`, secondary: null }
          if (diffMin < 1440) return { primary: `${Math.round(diffMin / 60)}h ago`, secondary: null }
          return { primary: d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), secondary: null }
        }
      } catch {}
    }
    const num = parseFloat(state)
    const val = isNaN(num) ? state : (Number.isInteger(num) ? num : parseFloat(num.toFixed(1)))
    const unit = unit_of_measurement || ''
    const label = device_class
      ? device_class.charAt(0).toUpperCase() + device_class.slice(1)
      : null
    return {
      primary: unit ? `${val}${unit}` : `${val}`,
      secondary: label,
    }
  }

  if (domain === 'binary_sensor') {
    const CLASS_LABELS = {
      motion: ['Motion', 'Clear'],
      door: ['Open', 'Closed'],
      window: ['Open', 'Closed'],
      opening: ['Open', 'Closed'],
      presence: ['Present', 'Away'],
      occupancy: ['Occupied', 'Clear'],
      lock: ['Unlocked', 'Locked'],
      smoke: ['Smoke', 'Clear'],
      moisture: ['Wet', 'Dry'],
      gas: ['Gas', 'Clear'],
      plug: ['Plugged in', 'Unplugged'],
      battery: ['Low', 'Normal'],
      connectivity: ['Connected', 'Disconnected'],
      vibration: ['Vibrating', 'Still'],
    }
    const labels = CLASS_LABELS[device_class]
    if (labels) {
      return { primary: state === 'on' ? labels[0] : labels[1], secondary: null }
    }
    return { primary: state === 'on' ? 'On' : 'Off', secondary: null }
  }

  if (domain === 'climate') {
    const hvac = entity.hvac_mode || state
    const temp = entity.current_temperature != null ? `${entity.current_temperature}°` : null
    return { primary: hvac.replace(/_/g, ' '), secondary: temp ? `Now ${temp}` : null }
  }

  if (domain === 'media_player') {
    if (state === 'playing') return { primary: 'Playing', secondary: entity.media_title || null }
    return { primary: state.charAt(0).toUpperCase() + state.slice(1), secondary: null }
  }

  if (domain === 'cover') {
    const pos = entity.current_position != null ? ` · ${entity.current_position}%` : ''
    return { primary: state.charAt(0).toUpperCase() + state.slice(1) + pos, secondary: null }
  }

  if (domain === 'lock') {
    return { primary: state === 'locked' ? 'Locked' : 'Unlocked', secondary: null }
  }

  if (domain === 'vacuum') {
    return { primary: state.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), secondary: null }
  }

  if (domain === 'fan') {
    if (state !== 'on') return { primary: 'Off', secondary: null }
    const pct = entity.percentage != null ? `${entity.percentage}%` : null
    return { primary: 'On', secondary: pct }
  }

  if (state === 'on') return { primary: 'On', secondary: null }
  if (state === 'off') return { primary: 'Off', secondary: null }

  // For any domain in the registry: look up a human label for the state.
  const meta = DOMAIN_REGISTRY[domain]
  if (meta?.stateLabels?.[state]) {
    return { primary: meta.stateLabels[state], secondary: null }
  }

  return { primary: state.replace(/_/g, ' '), secondary: null }
}

export function greetingByTime() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Good night'
}

// Hebrew U+0590–U+05FF: letters, vowel points, cantillation marks
const HEBREW_RE = /[֐-׿]/

/**
 * Returns true if the string contains Hebrew characters.
 * Use for message bubbles, task names, automation descriptions, etc.
 */
export function isHebrew(text) {
  return HEBREW_RE.test(text || '')
}

/**
 * Returns 'rtl' if the string is Hebrew, otherwise 'ltr'.
 * Use as: dir={textDir(msg.text)}
 */
export function textDir(text) {
  return isHebrew(text) ? 'rtl' : 'ltr'
}
