import { useEffect, useState, useRef } from 'react'
import { Play, Volume2, AlertCircle } from 'lucide-react'
import { Card } from '../ui/Card'
import { Select } from '../ui/Select'
import { useT } from '../../lib/i18n'
import {
  getTtsVoices,
  setActiveTtsVoices,
  previewTtsVoice,
} from '../../lib/api'

// ─── Voice picker (dropdown form) ────────────────────────────────────────────
// Per-language voice selection independent of the UI language. Dropdown form
// (changed from clickable rows 2026-06-21) — more compact, consistent with
// the Select component used elsewhere in Settings.

const SAMPLE_TEXT = {
  he: 'שלום, אני זיגי. הדלקתי את האור בסלון.',
  en: "Hi, I'm Ziggy. I've turned on the living room light.",
}

const LANG_LABEL = { he: 'עברית', en: 'English' }

function LangPicker({ lang, voices, active, onPickAndSave }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const audioRef = useRef(null)

  const selected = voices.find(v => v.id === active)
  const options = voices.map(v => ({ value: v.id, label: v.name }))

  const preview = async () => {
    if (!active || busy) return
    setBusy(true)
    try {
      // Stop any in-flight preview before starting another.
      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
        audioRef.current = null
      }
      const blob = await previewTtsVoice({
        voice_id: active, text: SAMPLE_TEXT[lang], lang,
      })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => { setBusy(false); URL.revokeObjectURL(url); audioRef.current = null }
      audio.onerror = () => { setBusy(false); URL.revokeObjectURL(url); audioRef.current = null }
      await audio.play()
    } catch (e) {
      console.error('[VoiceSection] preview failed', e)
      setBusy(false)
    }
  }

  // Clean up audio on unmount.
  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.pause()
      URL.revokeObjectURL(audioRef.current.src)
    }
  }, [])

  if (voices.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p className="z-eyebrow">
          {t('voiceSettings.replyLanguageLabel', { lang: LANG_LABEL[lang] })}
        </p>
        <div style={{ fontSize: 13, color: 'var(--ink-mute)', padding: 12,
                      background: 'var(--surface)', border: '0.5px solid var(--line)',
                      borderRadius: 'var(--r-ctl)' }}>
          {t('voiceSettings.noVoicesForLang')}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Select
            label={t('voiceSettings.replyLanguageLabel', { lang: LANG_LABEL[lang] })}
            value={active || ''}
            onChange={(e) => onPickAndSave(e.target.value)}
            options={options}
          />
        </div>
        <button
          onClick={preview}
          disabled={busy || !active}
          title={t('voiceSettings.preview')}
          aria-label={t('voiceSettings.preview')}
          className="z-icon-btn"
          style={{ cursor: busy || !active ? 'wait' : 'pointer' }}
        >
          {busy ? <Volume2 size={18} /> : <Play size={18} />}
        </button>
      </div>
      {selected?.description && (
        <div style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.4 }}>
          {selected.description}
        </div>
      )}
    </div>
  )
}

export default function VoiceSection() {
  const t = useT()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState({ available: [], active: { he: null, en: null }, configured: false })
  const [savingLang, setSavingLang] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await getTtsVoices()
      setData(res)
      setError(null)
    } catch (e) {
      setError(e?.userMessage || e?.message || 'Failed to load voices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const pickAndSave = async (lang, voiceId) => {
    if (data.active[lang] === voiceId) return
    setSavingLang(lang)
    try {
      const res = await setActiveTtsVoices({ [lang]: voiceId })
      setData(d => ({ ...d, active: res.active }))
    } catch (e) {
      console.error('[VoiceSection] save failed', e)
      setError(e?.userMessage || e?.message || 'Failed to save voice')
    } finally {
      setSavingLang(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <div style={{ padding: 24, fontSize: 13, color: 'var(--ink-mute)' }}>
          {t('common.loading')}
        </div>
      </Card>
    )
  }

  const heVoices = (data.available || []).filter(v => (v.languages || []).includes('he'))
  const enVoices = (data.available || []).filter(v => (v.languages || []).includes('en'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!data.configured && (
        <div style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          padding: 12, borderRadius: 'var(--r-ctl)',
          background: 'color-mix(in srgb, var(--warn) 10%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--warn) 50%, var(--line))',
        }}>
          <AlertCircle size={20} strokeWidth={1.75} style={{ color: 'var(--warn)', flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
            {t('voiceSettings.notConfigured')}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          padding: 12, borderRadius: 'var(--r-ctl)', fontSize: 13,
          background: 'color-mix(in srgb, var(--err) 8%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--err) 45%, var(--line))',
          color: 'var(--ink)',
        }}>
          {error}
        </div>
      )}

      <Card>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
              {t('voiceSettings.title')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
              {t('voiceSettings.description')}
            </div>
          </div>

          <LangPicker
            lang="he"
            voices={heVoices}
            active={data.active?.he}
            onPickAndSave={(id) => pickAndSave('he', id)}
          />

          <LangPicker
            lang="en"
            voices={enVoices}
            active={data.active?.en}
            onPickAndSave={(id) => pickAndSave('en', id)}
          />

          {savingLang && (
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center' }}>
              {t('common.saving')}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
