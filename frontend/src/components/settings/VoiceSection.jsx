import { useEffect, useState, useRef } from 'react'
import { Volume2, Play, Check, AlertCircle } from 'lucide-react'
import { Card } from '../ui/Card'
import { useT } from '../../lib/i18n'
import {
  getTtsVoices,
  setActiveTtsVoices,
  previewTtsVoice,
} from '../../lib/api'

// ─── Voice picker ────────────────────────────────────────────────────────────
// Lets the user pick a separate voice per language for TTS replies. The
// choice is INDEPENDENT of the UI language — someone using a Hebrew UI can
// pick an English voice for their English replies and vice versa.
//
// The curated voice list comes from voice.cartesia.available_voices in
// settings.yaml (operator-controlled). This component just renders what
// the backend says is available.

const SAMPLE_TEXT = {
  he: 'שלום, אני זיגי. הדלקתי את האור בסלון.',
  en: "Hi, I'm Ziggy. I've turned on the living room light.",
}

const LANG_LABEL = { he: 'עברית', en: 'English' }

function VoiceRow({ voice, isActive, isPlaying, onSelect, onPreview }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 12,
        background: isActive ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
        border: `0.5px solid ${isActive ? 'var(--accent)' : 'var(--line)'}`,
        cursor: 'pointer',
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{voice.name}</span>
          {isActive && <Check size={13} style={{ color: 'var(--accent)' }} />}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2, lineHeight: 1.35 }}>
          {voice.description}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onPreview() }}
        disabled={isPlaying}
        title="Preview"
        style={{
          padding: 8, borderRadius: 10,
          background: isPlaying ? 'var(--surface-2)' : 'var(--surface-2)',
          border: '0.5px solid var(--line)', cursor: isPlaying ? 'wait' : 'pointer',
          color: 'var(--ink)', display: 'flex', flexShrink: 0,
        }}
      >
        {isPlaying ? <Volume2 size={14} /> : <Play size={14} />}
      </button>
    </div>
  )
}

function LangColumn({ lang, voices, active, onPickAndSave, busyId, setBusyId }) {
  const t = useT()
  const audioRef = useRef(null)

  const preview = async (voice) => {
    setBusyId(voice.id)
    try {
      // Stop any in-flight preview before starting another.
      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
        audioRef.current = null
      }
      const blob = await previewTtsVoice({
        voice_id: voice.id, text: SAMPLE_TEXT[lang], lang,
      })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => { setBusyId(null); URL.revokeObjectURL(url); audioRef.current = null }
      audio.onerror = () => { setBusyId(null); URL.revokeObjectURL(url); audioRef.current = null }
      await audio.play()
    } catch (e) {
      console.error('[VoiceSection] preview failed', e)
      setBusyId(null)
    }
  }

  // Clean up audio on unmount.
  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.pause()
      URL.revokeObjectURL(audioRef.current.src)
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--ink-mute)',
                    padding: '0 2px' }}>
        {t('voiceSettings.replyLanguageLabel', { lang: LANG_LABEL[lang] })}
      </div>
      {voices.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: 14,
                      background: 'var(--surface)', border: '0.5px solid var(--line)',
                      borderRadius: 12 }}>
          {t('voiceSettings.noVoicesForLang')}
        </div>
      ) : (
        voices.map(v => (
          <VoiceRow
            key={v.id}
            voice={v}
            isActive={v.id === active}
            isPlaying={busyId === v.id}
            onSelect={() => onPickAndSave(v.id)}
            onPreview={() => preview(v)}
          />
        ))
      )}
    </div>
  )
}

export default function VoiceSection() {
  const t = useT()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState({ available: [], active: { he: null, en: null }, configured: false })
  const [busyId, setBusyId] = useState(null)
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
        <div style={{ padding: 24, fontSize: 13, color: 'var(--ink-faint)' }}>
          {t('common.loading')}
        </div>
      </Card>
    )
  }

  const heVoices = (data.available || []).filter(v => (v.languages || []).includes('he'))
  const enVoices = (data.available || []).filter(v => (v.languages || []).includes('en'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!data.configured && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: 14, borderRadius: 12,
          background: 'color-mix(in srgb, var(--warn) 10%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--warn) 50%, var(--line))',
        }}>
          <AlertCircle size={14} style={{ color: 'var(--warn)', marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.5 }}>
            {t('voiceSettings.notConfigured')}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          padding: 12, borderRadius: 10, fontSize: 12,
          background: 'color-mix(in srgb, var(--err) 8%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--err) 45%, var(--line))',
          color: 'var(--ink)',
        }}>
          {error}
        </div>
      )}

      <Card>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
              {t('voiceSettings.title')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
              {t('voiceSettings.description')}
            </div>
          </div>

          <LangColumn
            lang="he"
            voices={heVoices}
            active={data.active?.he}
            onPickAndSave={(id) => pickAndSave('he', id)}
            busyId={busyId}
            setBusyId={setBusyId}
          />

          <LangColumn
            lang="en"
            voices={enVoices}
            active={data.active?.en}
            onPickAndSave={(id) => pickAndSave('en', id)}
            busyId={busyId}
            setBusyId={setBusyId}
          />

          {savingLang && (
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', textAlign: 'center' }}>
              {t('common.saving')}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
