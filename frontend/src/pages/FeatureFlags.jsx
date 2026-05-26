import { useEffect, useState } from 'react'
import { Toggle } from '../components/ui/Toggle'
import { useUIStore } from '../stores/uiStore'
import { useFeaturesStore } from '../stores/featuresStore'
import { useT } from '../lib/i18n'

const FEATURE_KEYS = [
  { key: 'smart_home',      label: 'featureFlags.smartHome',     subtitle: 'featureFlags.smartHomeSub' },
  { key: 'voice',           label: 'featureFlags.voice',         subtitle: 'featureFlags.voiceSub' },
  { key: 'task_tracking',   label: 'featureFlags.tasks',         subtitle: 'featureFlags.tasksSub' },
  { key: 'file_management', label: 'featureFlags.files',         subtitle: 'featureFlags.filesSub' },
  { key: 'home_map',        label: 'featureFlags.homeMap',       subtitle: 'featureFlags.homeMapSub' },
  { key: 'buddy_mode',      label: 'featureFlags.buddy',         subtitle: 'featureFlags.buddySub' },
  { key: 'ifttt',           label: 'featureFlags.ifttt',         subtitle: 'featureFlags.iftttSub' },
  { key: 'local_storage',   label: 'featureFlags.localStorage',  subtitle: 'featureFlags.localStorageSub' },
  { key: 'zigbee_support',  label: 'featureFlags.zigbee',        subtitle: 'featureFlags.zigbeeSub' },
]

export default function FeatureFlags() {
  const t = useT()
  const addToast = useUIStore(s => s.addToast)
  // Read from the app-wide store so this page and the rest of the UI (nav,
  // route gate, dashboard) can never show divergent toggle states. Toggling
  // goes through setFeature which is optimistic and persisted via PATCH.
  const features = useFeaturesStore(s => s.features)
  const loaded   = useFeaturesStore(s => s.loaded)
  const refresh  = useFeaturesStore(s => s.fetch)
  const setFeature = useFeaturesStore(s => s.setFeature)
  const [saving, setSaving] = useState(null)

  // Make sure we have fresh state when this page mounts, even if the
  // post-auth fetch landed before navigation.
  useEffect(() => { refresh() }, [refresh])

  const onToggle = async (key, value) => {
    if (typeof setFeature !== 'function') {
      addToast(t('featureFlags.stale'), 'error')
      return
    }
    setSaving(key)
    try {
      await setFeature(key, value)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[FeatureFlags] toggle failed', { key, value, error: e })
      addToast(e?.message || t('featureFlags.failedUpdate'), 'error')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 60px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 6 }}>
          {t('featureFlags.title')}
        </h1>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.55 }}>
          {t('featureFlags.subtitle')}
        </p>
      </div>

      <div style={{
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        {!loaded && (
          <div style={{ padding: '24px 16px', fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center' }}>
            {t('featureFlags.loading')}
          </div>
        )}
        {loaded && FEATURE_KEYS.map(({ key, label, subtitle }, idx, arr) => (
          <div
            key={key}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', gap: 12,
              borderBottom: idx === arr.length - 1 ? 'none' : '0.5px solid var(--line)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t(label)}</p>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{t(subtitle)}</p>
            </div>
            <Toggle
              checked={!!features[key]}
              onCheckedChange={v => onToggle(key, v)}
              disabled={saving === key}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
