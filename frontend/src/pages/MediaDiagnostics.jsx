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
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>
      <div className="z-page-head">
        <div>
          <h1 className="z-display" style={{ margin: 0 }}>{t('media.diagnosticsTitle')}</h1>
          <p className="z-footnote">{t('media.diagnosticsSubtitle')}</p>
        </div>
      </div>

      {error && (
        <div className="bg-err-soft" style={{ color: 'var(--err-text)', fontSize: 13, padding: '12px 16px', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)', marginBottom: 16 }}>
          {error}
        </div>
      )}
      {!data && !error && <p className="z-subhead">{t('common.loading')}</p>}

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
              ? <p className="z-body" style={{ color: 'var(--ink-mute)', textAlign: 'center', padding: 32 }}>{t('media.diag.empty')}</p>
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
    <section className="z-card" style={{ marginBottom: 16, padding: 12 }}>
      <h2 className="z-headline" style={{ marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  )
}
function Pre({ children }) {
  return (
    <pre dir="ltr" className="z-code" style={{
      fontSize: 12, lineHeight: '18px', color: 'var(--ink)',
      background: 'var(--surface-2)',
      border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)',
      padding: 12, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {children}
    </pre>
  )
}
