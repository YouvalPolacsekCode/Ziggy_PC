// MediaDiagnostics — admin-only inspector for the audio-device registry and
// profile state. Read-only summary; per-entry overrides ship in Phase 3.
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useFeature } from '../stores/featuresStore'
import { useAuthStore } from '../stores/authStore'
import { mediaDiagnostics } from '../lib/api'
import { useT } from '../lib/i18n'

export default function MediaDiagnostics() {
  const enabled = useFeature('media_music')
  const role = useAuthStore(s => s.role)
  const t = useT()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled || role !== 'super_admin') return
    mediaDiagnostics().then(setData).catch(e => setError(e?.message || String(e)))
  }, [enabled, role])

  if (!enabled) return <Navigate to="/" replace />
  if (role !== 'super_admin') return <Navigate to="/" replace />

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 60px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
        {t('media.diagnosticsTitle')}
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 18 }}>
        {t('media.diagnosticsSubtitle')}
      </p>

      {error && <div style={errBox}>{error}</div>}
      {!data && !error && <div style={{ color: 'var(--ink-mute)', fontSize: 12 }}>{t('common.loading')}</div>}

      {data && (
        <>
          <Section title={t('media.diag.flags')}>
            <Pre>{JSON.stringify({
              feature_enabled:        data.feature_enabled,
              spotify_app_configured: data.spotify_app_configured,
              ytmusic_app_configured: data.ytmusic_app_configured,
            }, null, 2)}</Pre>
          </Section>

          <Section title={t('media.diag.speakers')}>
            {(data.speakers || []).length === 0
              ? <div style={emptyState}>{t('media.diag.empty')}</div>
              : <Pre>{JSON.stringify(data.speakers, null, 2)}</Pre>}
          </Section>

          <Section title={t('media.diag.profiles')}>
            <Pre>{JSON.stringify(data.profiles, null, 2)}</Pre>
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 18, background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 12, padding: 14 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  )
}
function Pre({ children }) {
  return (
    <pre dir="ltr" style={{
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontSize: 11, color: 'var(--ink)',
      background: 'var(--surface-elev, var(--surface))',
      border: '0.5px solid var(--line)', borderRadius: 8,
      padding: 12, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {children}
    </pre>
  )
}
const errBox = { color: '#c1452f', fontSize: 12, padding: '8px 12px', background: 'rgba(193,69,47,0.08)', borderRadius: 8, marginBottom: 12 }
const emptyState = { fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center', padding: 12 }
