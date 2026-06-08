// System health banner — renders the layered failure status from
// /api/health `system_health` (services/ha_health.py). Replaces the two
// hard-coded inline banners that lived in Dashboard ("HA offline" + the
// "{n} devices offline" one) with a single banner whose copy & actions
// match the actual problem.
//
// States (driven by `primary` from the backend):
//   - ok                                 → renders nothing
//   - ha_unreachable                     → red, "Smart home system offline"  + [Retry]
//   - coordinator_loading                → amber, "Zigbee connection problem…" (spinner)
//   - coordinator_setup_failed           → red, "Zigbee connection problem"    + (spinner while in_progress)
//   - coordinator_devices_unavailable    → red, same as setup_failed
//   - devices_offline_many               → amber, "{n} devices offline"        + [Review] [It's OK, I know]
//   - devices_offline                    → grey, "{n} device offline"          + [Review]
//
// Recovery banner overlay: when `recovery.manual_action` is set, the manual-
// action title/body replaces the primary one and the only action is [Retry].
// This is what surfaces after the auto-reload of the Zigbee coordinator
// failed — i.e. the dongle needs a physical replug.
//
// The component is intentionally style-self-contained (inline styles, same
// tokens as the rest of the dashboard) so it can be dropped anywhere and
// the diff for adopting it stays small.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../../lib/i18n'
import { recoverHealth, acknowledgeOffline } from '../../lib/api'

const SEVERITY_BY_PRIMARY = {
  ha_unreachable:                  'err',
  coordinator_loading:             'warn',
  coordinator_setup_failed:        'err',
  coordinator_devices_unavailable: 'err',
  devices_offline_many:            'warn',
  devices_offline:                 'info',
}

// Banner palette. Maps to the global CSS vars used elsewhere on the dashboard.
const PALETTE = {
  err:  { bg: 'color-mix(in srgb, var(--err)  10%, var(--surface))', border: 'color-mix(in srgb, var(--err)  30%, transparent)', dot: 'var(--err)',  cta: 'var(--err)'  },
  warn: { bg: 'color-mix(in srgb, var(--warn) 10%, var(--surface))', border: 'color-mix(in srgb, var(--warn) 30%, transparent)', dot: 'var(--warn)', cta: 'var(--warn)' },
  info: { bg: 'color-mix(in srgb, var(--ink-mute) 8%, var(--surface))', border: 'color-mix(in srgb, var(--ink-mute) 20%, transparent)', dot: 'var(--ink-mute)', cta: 'var(--accent)' },
}

// i18n key naming convention: the singular/plural is baked into the key name
// (`.devicesOfflineOne.title` vs `.devicesOfflineMany.title`), so we pick the
// whole key based on count rather than building a suffix.
function devicesOfflineKeys(offline) {
  const flavor = offline === 1 ? 'One' : 'Many'
  return {
    titleKey: `health.devicesOffline${flavor}.title`,
    bodyKey:  `health.devicesOffline${flavor}.body`,
  }
}

function copyFor(systemHealth, t) {
  const primary = systemHealth?.primary || 'ok'
  const manual  = systemHealth?.recovery?.manual_action
  // Manual-action overlay wins: this only appears after auto-recovery has
  // tried and failed, so it's strictly more specific than the primary issue.
  if (manual?.code) {
    return {
      title: t(manual.title_key),
      body:  t(manual.body_key),
      sev:   'err',
    }
  }
  const offline = systemHealth?.devices?.offline ?? 0
  switch (primary) {
    case 'ha_unreachable':
      return { title: t('health.haUnreachable.title'),       body: t('health.haUnreachable.body'),       sev: 'err' }
    case 'coordinator_loading':
      return { title: t('health.coordinatorLoading.title'),  body: t('health.coordinatorLoading.body'),  sev: 'warn' }
    case 'coordinator_setup_failed':
      return { title: t('health.coordinatorFailed.title'),   body: t('health.coordinatorFailed.body'),   sev: 'err' }
    case 'coordinator_devices_unavailable':
      return { title: t('health.coordinatorDevsGone.title'), body: t('health.coordinatorDevsGone.body'), sev: 'err' }
    case 'devices_offline_many': {
      const { titleKey, bodyKey } = devicesOfflineKeys(offline)
      return { title: t(titleKey, { n: offline }), body: t(bodyKey), sev: 'warn' }
    }
    case 'devices_offline': {
      const { titleKey, bodyKey } = devicesOfflineKeys(offline)
      return { title: t(titleKey, { n: offline }), body: t(bodyKey), sev: 'info' }
    }
    default:
      return null
  }
}

export function SystemHealthBanner({ health, onRefresh }) {
  const t        = useT()
  const navigate = useNavigate()
  const [busy,   setBusy]   = useState(false)
  const [errMsg, setErrMsg] = useState(null)

  const sh      = health?.system_health
  const copy    = sh ? copyFor(sh, t) : null
  if (!copy) return null

  const sev = SEVERITY_BY_PRIMARY[sh.primary] || copy.sev || 'info'
  const pal = PALETTE[sev]
  const inProgress  = !!sh.recovery?.in_progress
  const manual      = sh.recovery?.manual_action
  const canAck      = !!sh.ack?.can_acknowledge && !manual
  const isOffline   = sh.primary === 'ha_unreachable'
  const isCoordIssue = ['coordinator_setup_failed', 'coordinator_devices_unavailable',
                        'coordinator_loading'].includes(sh.primary)

  const handleRetry = async () => {
    setBusy(true); setErrMsg(null)
    try {
      await recoverHealth()
      onRefresh && onRefresh()
    } catch (e) {
      setErrMsg(e?.message || t('common.tryAgain'))
    } finally {
      setBusy(false)
    }
  }

  const handleAck = async () => {
    setBusy(true); setErrMsg(null)
    try {
      // No body → server snapshots the current offline set. Simpler than
      // serializing the device list and risking a stale snapshot.
      await acknowledgeOffline([])
      onRefresh && onRefresh()
    } catch (e) {
      setErrMsg(e?.message || t('common.tryAgain'))
    } finally {
      setBusy(false)
    }
  }

  const handleReview = () => navigate('/devices?filter=offline')

  // Show retry whenever there's an actionable system-level issue OR when
  // the manual-action overlay is up. For pure "N devices offline" we use
  // Review instead — retrying doesn't help a flat-battery sensor.
  const showRetry  = isOffline || isCoordIssue || !!manual
  const showReview = sh.primary === 'devices_offline' || sh.primary === 'devices_offline_many'

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 14px', borderRadius: 12,
        background: pal.bg,
        border: `0.5px solid ${pal.border}`,
        fontSize: 12, color: 'var(--ink)',
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0, marginTop: 4,
          width: 8, height: 8, borderRadius: '50%',
          background: pal.dot,
          // pulse when actively recovering so the user sees it's working
          animation: inProgress ? 'ziggy-health-pulse 1.4s ease-in-out infinite' : 'none',
        }}
      />
      <style>{`@keyframes ziggy-health-pulse {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.35; }
      }`}</style>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{copy.title}</div>
        <div style={{ color: 'var(--ink-mute)', marginTop: 2 }}>{copy.body}</div>
        {errMsg && (
          <div style={{ color: 'var(--err)', marginTop: 4, fontSize: 11 }}>{errMsg}</div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {showReview && (
          <button
            onClick={handleReview}
            disabled={busy}
            style={btnStyle(pal.cta, /*ghost*/ true)}
          >
            {t('health.action.review')}
          </button>
        )}
        {canAck && (
          <button
            onClick={handleAck}
            disabled={busy}
            style={btnStyle(pal.cta, /*ghost*/ true)}
          >
            {t('health.action.itsOk')}
          </button>
        )}
        {showRetry && (
          <button
            onClick={handleRetry}
            disabled={busy || inProgress}
            style={btnStyle(pal.cta, /*ghost*/ false)}
          >
            {(busy || inProgress) ? t('health.action.retrying') : t('health.action.retry')}
          </button>
        )}
      </div>
    </div>
  )
}

function btnStyle(cta, ghost) {
  return ghost
    ? {
        padding: '4px 10px', borderRadius: 7,
        background: 'transparent', color: 'var(--ink)',
        border: `0.5px solid color-mix(in srgb, ${cta} 40%, transparent)`,
        cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
      }
    : {
        padding: '4px 10px', borderRadius: 7,
        background: cta, color: 'var(--on-accent)',
        border: 'none', cursor: 'pointer',
        fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
      }
}

export default SystemHealthBanner
