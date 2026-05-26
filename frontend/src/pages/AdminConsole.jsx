import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../lib/i18n'

function ToolCard({ title, badge, description, bullets, path, onOpen }) {
  const t = useT()
  return (
    <button
      onClick={onOpen}
      style={{
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        borderRadius: 16,
        padding: 24,
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        transition: 'border-color 0.12s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ink-mute)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.09em',
          fontFamily: '"IBM Plex Mono", monospace',
          color: 'var(--ink-faint)',
          border: '0.5px solid var(--line)',
          padding: '2px 7px', borderRadius: 4,
          textTransform: 'uppercase',
        }}>
          {badge}
        </span>
        <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>{t('adminConsole.open')}</span>
      </div>
      <div>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>{title}</p>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.6, marginBottom: 10 }}>{description}</p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {bullets.map(b => (
            <li key={b} style={{ fontSize: 11, color: 'var(--ink-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--ink-faint)', flexShrink: 0 }} />
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
      <div style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: 'var(--ink-faint)', fontSize: 14 }}>{t('adminConsole.restricted')}</p>
        <button
          onClick={() => navigate('/')}
          style={{ marginTop: 16, fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          ← {t('adminConsole.backToZiggy')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        padding: '0 20px',
        height: 52,
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
            color: 'var(--ink-faint)', fontSize: 12, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', borderRadius: 6,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          Ziggy
        </button>

        <span style={{ color: 'var(--line)', fontSize: 16 }}>/</span>

        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>
          {t('adminConsole.title')}
        </span>

        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.09em',
          fontFamily: '"IBM Plex Mono", monospace',
          color: 'var(--ink-faint)',
          border: '0.5px solid var(--line)',
          padding: '2px 7px', borderRadius: 4,
          textTransform: 'uppercase',
        }}>
          {t('adminConsole.superAdminBadge')}
        </span>
      </header>

      {/* Content */}
      <main style={{
        flex: 1,
        padding: '40px 20px 60px',
        maxWidth: 760,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}>
        <div style={{ marginBottom: 36 }}>
          <h1 style={{
            fontSize: 24, fontWeight: 700,
            color: 'var(--ink)', marginBottom: 8,
            letterSpacing: '-0.01em',
          }}>
            {t('adminConsole.heading')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.6 }}>
            {t('adminConsole.intro')}
          </p>
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
        </div>
      </main>
    </div>
  )
}
