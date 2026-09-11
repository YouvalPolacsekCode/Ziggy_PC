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
  { key: 'media_music',     label: 'featureFlags.media',         subtitle: 'featureFlags.mediaSub' },
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
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
      <div className="z-page-head">
        <div>
          <h1 className="z-display" style={{ margin: 0 }}>{t('featureFlags.title')}</h1>
          <p className="z-subhead" style={{ marginTop: 4 }}>{t('featureFlags.subtitle')}</p>
        </div>
      </div>

      <div style={{
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        borderRadius: 'var(--r-card)',
        overflow: 'hidden',
      }}>
        {!loaded && (
          <div style={{ padding: '24px 16px', fontSize: 15, color: 'var(--ink-mute)', textAlign: 'center' }}>
            {t('featureFlags.loading')}
          </div>
        )}
        {loaded && FEATURE_KEYS.map(({ key, label, subtitle }, idx, arr) => (
          <div
            key={key}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              minHeight: 56, padding: '12px 16px', gap: 12,
              borderBottom: idx === arr.length - 1 ? 'none' : '0.5px solid var(--line)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>{t(label)}</p>
              <p style={{ fontSize: 15, color: 'var(--ink-mute)', marginTop: 2 }}>{t(subtitle)}</p>
            </div>
            <Toggle
              checked={!!features[key]}
              onCheckedChange={v => onToggle(key, v)}
              disabled={saving === key}
              aria-label={t(label)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
