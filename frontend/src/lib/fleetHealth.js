// Fleet traffic-light rules. One file so thresholds are reviewable in one
// place and so DECISIONS.md can point at this module when the founder
// changes a number.
//
// computeHealth() is pure: given the home row from /api/homes/ (Prompt 2
// fields added in commit "feat(relay): GET /homes/ returns ...") and the
// latest telemetry payload object (or null if none), return a
// {level, reasons} pair the UI renders as a colored pill + tooltip.
//
// Reasons are i18n keys + args so callers can localize via t().

export const STALE_MINUTES_RED = 30
export const STALE_MINUTES_YELLOW = 10
export const DISK_PCT_YELLOW = 80
export const CPU_PCT_YELLOW = 90
export const MEM_PCT_YELLOW = 90
export const BATTERY_PCT_YELLOW = 10

// Subscription states that don't trip a yellow billing pill. Mirrors
// relay/app/billing/__init__.py::ACTIVE_SUBSCRIPTION_STATES. Anything
// else (past_due, cancelled, refunded, pending_setup) lights yellow.
const HEALTHY_SUBSCRIPTION_STATES = new Set(['active', 'trialing'])

function minutesSince(iso) {
  if (!iso) return Infinity
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return Infinity
  return (Date.now() - t) / 60000
}

// Pull a sensor list out of the telemetry payload tolerantly. Edge agents
// have been shipping slightly different shapes across versions; the safest
// extraction is "any array under a key that looks like sensors".
function _extractSensors(payload) {
  if (!payload || typeof payload !== 'object') return []
  if (Array.isArray(payload.sensors)) return payload.sensors
  return []
}

function _pct(value) {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function computeHealth(home, latestTelemetry) {
  const reasons = []
  let worst = 'green'

  const bump = (level) => {
    if (level === 'red') worst = 'red'
    else if (level === 'yellow' && worst !== 'red') worst = 'yellow'
  }

  // Operational status from the relay (suspended trips on subscription
  // gating + manual lockout). Always red.
  if (home?.status === 'suspended') {
    bump('red')
    reasons.push({ level: 'red', key: 'fleetHealth.reasonSuspended' })
  }

  // Heartbeat — last_seen_ts is MAX(telemetry_raw.ts) for this home,
  // populated by the relay's list_homes patch. NULL means the hub has
  // never posted — treat as red because the operator can't tell whether
  // the hub is unreachable or simply pre-Prompt-2-edge-agent.
  const minutesStale = minutesSince(home?.last_seen_ts)
  if (minutesStale === Infinity) {
    bump('red')
    reasons.push({ level: 'red', key: 'fleetHealth.reasonNoTelemetry' })
  } else if (minutesStale > STALE_MINUTES_RED) {
    bump('red')
    reasons.push({
      level: 'red',
      key: 'fleetHealth.reasonStaleRed',
      args: { minutes: Math.floor(minutesStale) },
    })
  } else if (minutesStale > STALE_MINUTES_YELLOW) {
    bump('yellow')
    reasons.push({
      level: 'yellow',
      key: 'fleetHealth.reasonStaleYellow',
      args: { minutes: Math.floor(minutesStale) },
    })
  }

  // Subscription state — yellow, not red. A cancelled hub keeps its
  // local kit running (Prompt 9 §E); the dashboard surfaces the billing
  // state so the operator can decide whether to nudge.
  const state = home?.subscription_state
  if (state && !HEALTHY_SUBSCRIPTION_STATES.has(state)) {
    bump('yellow')
    reasons.push({
      level: 'yellow',
      key: 'fleetHealth.reasonSubscription',
      args: { state },
    })
  }

  // Telemetry payload checks — only if a payload is available. Missing
  // payload doesn't add a reason here (the heartbeat check already
  // covered that case).
  if (latestTelemetry && typeof latestTelemetry === 'object') {
    const diskPct = _pct(
      // Edge has shipped two shapes — payload.disk_pct or payload.disk.used_pct.
      latestTelemetry.disk_pct
      ?? latestTelemetry.disk?.used_pct
      ?? latestTelemetry.disk?.pct,
    )
    if (diskPct != null && diskPct > DISK_PCT_YELLOW) {
      bump('yellow')
      reasons.push({
        level: 'yellow',
        key: 'fleetHealth.reasonDisk',
        args: { pct: Math.round(diskPct) },
      })
    }

    const cpuPct = _pct(latestTelemetry.cpu_pct)
    if (cpuPct != null && cpuPct > CPU_PCT_YELLOW) {
      bump('yellow')
      reasons.push({
        level: 'yellow',
        key: 'fleetHealth.reasonCpu',
        args: { pct: Math.round(cpuPct) },
      })
    }

    const memPct = _pct(latestTelemetry.mem_pct)
    if (memPct != null && memPct > MEM_PCT_YELLOW) {
      bump('yellow')
      reasons.push({
        level: 'yellow',
        key: 'fleetHealth.reasonMem',
        args: { pct: Math.round(memPct) },
      })
    }

    // Low-battery sensors — list each affected sensor name (or entity_id
    // if no friendly name). Capped at 3 in the reason to keep the
    // tooltip readable; the drill-in page shows the full list.
    const lowBattery = _extractSensors(latestTelemetry)
      .map(s => ({
        name: s.name || s.friendly_name || s.entity_id || '?',
        battery: _pct(s.battery ?? s.battery_pct ?? s.battery_level),
      }))
      .filter(s => s.battery != null && s.battery < BATTERY_PCT_YELLOW)
    if (lowBattery.length > 0) {
      bump('yellow')
      const names = lowBattery.slice(0, 3).map(s => s.name).join(', ')
      const more = lowBattery.length > 3 ? lowBattery.length - 3 : 0
      reasons.push({
        level: 'yellow',
        key: more > 0 ? 'fleetHealth.reasonBatteryMany' : 'fleetHealth.reasonBattery',
        args: { names, more, count: lowBattery.length },
      })
    }

    // Container health — any container reported as not-running flips yellow.
    const containers = Array.isArray(latestTelemetry.containers) ? latestTelemetry.containers : []
    const down = containers.filter(c => c && c.state && c.state !== 'running')
    if (down.length > 0) {
      bump('yellow')
      reasons.push({
        level: 'yellow',
        key: 'fleetHealth.reasonContainer',
        args: { name: down[0].name || down[0].image || '?', count: down.length },
      })
    }
  }

  return { level: worst, reasons }
}

// Display-side colour mapping. Kept here so a future theme swap is one
// edit. Maps to existing CSS variables — no new tokens.
export const HEALTH_COLORS = {
  green:  { fg: 'var(--ok)',   bg: 'color-mix(in srgb, var(--ok) 14%, var(--surface))',   border: 'color-mix(in srgb, var(--ok) 30%, transparent)' },
  yellow: { fg: 'var(--warn)', bg: 'color-mix(in srgb, var(--warn) 14%, var(--surface))', border: 'color-mix(in srgb, var(--warn) 30%, transparent)' },
  red:    { fg: '#ef4444',     bg: 'color-mix(in srgb, #ef4444 14%, var(--surface))',     border: 'color-mix(in srgb, #ef4444 30%, transparent)' },
}
