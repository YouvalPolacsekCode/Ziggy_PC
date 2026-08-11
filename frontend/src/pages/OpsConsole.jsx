import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import FleetOps from '../components/admin/ops/FleetOps'
import { getOpsWhoami } from '../lib/api'

/**
 * The ops console, full-bleed and on its own.
 *
 * This page used to be Cloud Admin: a 720px column with the fleet console at the
 * top and a second, older home-management list under it. Two consoles stacked on
 * one page meant the fleet table had ~400px to render eight columns in, so home
 * names truncated to "C…". The console is the page now.
 *
 * Access is founder-only. Gating on super_admin is not enough — every customer
 * is super_admin of their OWN hub, which would put a fleet console on David's
 * and Tslil's boxes. The hub answers /api/ops/whoami; the real enforcement is
 * server-side on every ops endpoint, and this check only decides whether to
 * render or redirect.
 */
export default function OpsConsole() {
  const [allowed, setAllowed] = useState(null)   // null = still asking
  const navigate = useNavigate()

  useEffect(() => {
    document.title = 'Ziggy Ops'
    let cancelled = false
    getOpsWhoami()
      .then(r => { if (!cancelled) setAllowed(!!r?.data?.founder) })
      .catch(() => { if (!cancelled) setAllowed(false) })
    return () => { cancelled = true; document.title = 'Ziggy' }
  }, [])

  if (allowed === false) return <Navigate to="/" replace />
  if (allowed === null) {
    return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', padding: '18px 20px 40px' }}>
      <div style={{ maxWidth: 1480, margin: '0 auto' }}>
        <FleetOps onExit={() => navigate('/ops')} />
      </div>
    </div>
  )
}
