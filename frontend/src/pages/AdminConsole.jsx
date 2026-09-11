import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../lib/i18n'

function ToolCard({ title, badge, description, bullets, onOpen }) {
  const t = useT()
  return (
    <button
      onClick={onOpen}
      className="z-card"
      style={{
        padding: 24,
        cursor: 'pointer',
        textAlign: 'start',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        transition: 'border-color var(--dur-press) var(--ease-standard)',
        fontFamily: 'inherit',
        color: 'var(--ink)',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--line-2)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className="z-chip">{badge}</span>
        <span className="z-subhead" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {t('adminConsole.open')}
          <ChevronRight size={16} strokeWidth={1.75} className="icon-flip-rtl" />
        </span>
      </div>
      <div>
        <p className="z-headline" style={{ marginBottom: 4 }}>{title}</p>
        <p className="z-subhead" style={{ marginBottom: 12 }}>{description}</p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {bullets.map(b => (
            <li key={b} className="z-footnote" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--ink-faint)', flexShrink: 0 }} />
              {b}
            </li>
          ))}
        </ul>
      </div>
    </button>
  )
}

export default function AdminConsole() {
  const navigate = useNavigate()
  const { role } = useAuthStore()
  const t = useT()

  useEffect(() => {
    document.title = 'Ziggy Admin'
    return () => { document.title = 'Ziggy' }
  }, [])

  if (role !== 'super_admin') {
    return (
      <div style={{ padding: 32, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <p className="z-body" style={{ color: 'var(--ink-mute)' }}>{t('adminConsole.restricted')}</p>
        <button onClick={() => navigate('/')} className="z-btn-secondary">
          <ChevronLeft size={18} strokeWidth={1.75} className="icon-flip-rtl" />
          {t('adminConsole.backToZiggy')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        padding: '0 20px',
        minHeight: 48,
        borderBottom: '0.5px solid var(--line)',
        background: 'var(--bg-2)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--ink-mute)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '0 8px', minHeight: 40, borderRadius: 'var(--r-ctl)',
          }}
        >
          <ChevronLeft size={18} strokeWidth={1.75} className="icon-flip-rtl" />
          Ziggy
        </button>

        <span style={{ color: 'var(--line-2)', fontSize: 15 }}>/</span>

        <span className="z-headline" style={{ flex: 1 }}>
          {t('adminConsole.title')}
        </span>

        <span className="z-chip">{t('adminConsole.superAdminBadge')}</span>
      </header>

      {/* Content */}
      <main style={{
        flex: 1,
        padding: '24px 20px 24px',
        maxWidth: 'var(--page-max-w)',
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}>
        <div className="z-page-head">
          <div>
            <h1 className="z-display" style={{ margin: 0 }}>{t('adminConsole.heading')}</h1>
            <p className="z-subhead" style={{ marginTop: 4 }}>{t('adminConsole.intro')}</p>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 16,
        }}>
          <ToolCard
            badge={t('adminConsole.devToolsBadge')}
            title={t('adminConsole.debugTitle')}
            description={t('adminConsole.debugDesc')}
            bullets={[
              t('adminConsole.debugBullet1'),
              t('adminConsole.debugBullet2'),
              t('adminConsole.debugBullet3'),
              t('adminConsole.debugBullet4'),
            ]}
            onOpen={() => navigate('/ops/debug')}
          />
          <ToolCard
            badge={t('adminConsole.adminBadge')}
            title={t('adminConsole.cloudTitle')}
            description={t('adminConsole.cloudDesc')}
            bullets={[
              t('adminConsole.cloudBullet1'),
              t('adminConsole.cloudBullet2'),
              t('adminConsole.cloudBullet3'),
              t('adminConsole.cloudBullet4'),
            ]}
            onOpen={() => navigate('/ops/cloud')}
          />
          <ToolCard
            badge={t('adminConsole.systemBadge')}
            title={t('adminConsole.featuresTitle')}
            description={t('adminConsole.featuresDesc')}
            bullets={[
              t('adminConsole.featuresBullet1'),
              t('adminConsole.featuresBullet2'),
              t('adminConsole.featuresBullet3'),
            ]}
            onOpen={() => navigate('/ops/features')}
          />
          <ToolCard
            badge={t('adminConsole.haBadge')}
            title={t('adminConsole.haUpdateTitle')}
            description={t('adminConsole.haUpdateDesc')}
            bullets={[
              t('adminConsole.haBullet1'),
              t('adminConsole.haBullet2'),
              t('adminConsole.haBullet3'),
              t('adminConsole.haBullet4'),
              t('adminConsole.haBullet5'),
            ]}
            onOpen={() => navigate('/ops/ha-update')}
          />
          <ToolCard
            badge={t('adminConsole.adminBadge')}
            title={t('adminConsole.otaTitle')}
            description={t('adminConsole.otaDesc')}
            bullets={[
              t('adminConsole.otaBullet1'),
              t('adminConsole.otaBullet2'),
              t('adminConsole.otaBullet3'),
              t('adminConsole.otaBullet4'),
            ]}
            onOpen={() => navigate('/ops/ota')}
          />
          <ToolCard
            badge={t('adminConsole.adminBadge')}
            title={t('adminConsole.auditTitle')}
            description={t('adminConsole.auditDesc')}
            bullets={[
              t('adminConsole.auditBullet1'),
              t('adminConsole.auditBullet2'),
              t('adminConsole.auditBullet3'),
              t('adminConsole.auditBullet4'),
            ]}
            onOpen={() => navigate('/ops/audit')}
          />

          {/* Cards added in the 2026-06 settings refactor — content migrated
              out of the old /admin AdminSettings page into operator-tier ops */}
          <ToolCard
            badge={t('adminConsole.systemBadge')}
            title={t('adminConsole.diagnosticsTitle')}
            description={t('adminConsole.diagnosticsDesc')}
            bullets={[
              t('adminConsole.diagnosticsBullet1'),
              t('adminConsole.diagnosticsBullet2'),
              t('adminConsole.diagnosticsBullet3'),
            ]}
            onOpen={() => navigate('/ops/system-diagnostics')}
          />
          <ToolCard
            badge={t('adminConsole.adminBadge')}
            title={t('adminConsole.apiKeysTitle')}
            description={t('adminConsole.apiKeysDesc')}
            bullets={[
              t('adminConsole.apiKeysBullet1'),
              t('adminConsole.apiKeysBullet2'),
              t('adminConsole.apiKeysBullet3'),
            ]}
            onOpen={() => navigate('/ops/api-keys')}
          />
          <ToolCard
            badge={t('adminConsole.adminBadge')}
            title={t('adminConsole.emailTitle')}
            description={t('adminConsole.emailDesc')}
            bullets={[
              t('adminConsole.emailBullet1'),
              t('adminConsole.emailBullet2'),
              t('adminConsole.emailBullet3'),
            ]}
            onOpen={() => navigate('/ops/email')}
          />
          <ToolCard
            badge={t('adminConsole.systemBadge')}
            title={t('adminConsole.engineTitle')}
            description={t('adminConsole.engineDesc')}
            bullets={[
              t('adminConsole.engineBullet1'),
              t('adminConsole.engineBullet2'),
              t('adminConsole.engineBullet3'),
            ]}
            onOpen={() => navigate('/ops/engine-tuning')}
          />
          <ToolCard
            badge={t('adminConsole.devToolsBadge')}
            title={t('adminConsole.presenceDebugTitle')}
            description={t('adminConsole.presenceDebugDesc')}
            bullets={[
              t('adminConsole.presenceDebugBullet1'),
              t('adminConsole.presenceDebugBullet2'),
              t('adminConsole.presenceDebugBullet3'),
            ]}
            onOpen={() => navigate('/ops/presence-debug')}
          />
        </div>
      </main>
    </div>
  )
}
