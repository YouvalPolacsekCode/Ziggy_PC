// MediaPlayActionEditor — the per-step editor for the "Play media" automation
// action. Plugged into Automations.jsx (and any other action-row consumer)
// when `action.type === 'media_play'`.
//
// Shape of the action object this editor reads/writes:
//   { type: 'media_play',
//     speaker_entity: 'media_player.kitchen_chromecast',
//     service:        'spotify' | 'ytmusic',
//     profile:        'youval',
//     mode:           'uri' | 'search' | 'open_app',
//     uri:            'spotify:playlist:...' | 'https://music.youtube.com/...',
//     query:          'Lovely Day',
//     volume:         35,
//   }
//
// The editor enforces compatibility:
//   - Speaker dropdown lists only enabled speakers
//   - Service tabs filter by (speaker's class capabilities) ∩ (profile's connected services)
//   - Mode picker offers only modes the (speaker × service) combo supports
//   - "My playlists" mode loads live playlists from the picked profile's account
import { useEffect, useMemo, useState } from 'react'
import { useMediaStore } from '../../stores/mediaStore'
import {
  spotifyPlaylists, spotifySearch,
  ytmusicPlaylists, ytmusicSearch,
} from '../../lib/api'
import { useT } from '../../lib/i18n'

const MODE_OPTIONS = [
  { value: 'playlist', labelKey: 'media.action.modePlaylist' },
  { value: 'search',   labelKey: 'media.action.modeSearch' },
  { value: 'uri',      labelKey: 'media.action.modeUri' },
  { value: 'open_app', labelKey: 'media.action.modeOpenApp' },
]

export default function MediaPlayActionEditor({ action, onChange }) {
  const t = useT()
  const ensureLoaded = useMediaStore(s => s.ensureLoaded)
  const speakers     = useMediaStore(s => s.speakers)
  const profiles     = useMediaStore(s => s.profiles)

  useEffect(() => { ensureLoaded() }, [ensureLoaded])

  const enabledSpeakers = useMemo(() => speakers.filter(s => s.enabled), [speakers])
  const speaker = useMemo(
    () => enabledSpeakers.find(s => s.entity_id === action.speaker_entity) || null,
    [enabledSpeakers, action.speaker_entity],
  )
  const profile = useMemo(
    () => profiles.find(p => p.name === action.profile) || null,
    [profiles, action.profile],
  )

  // Which services are usable for this (speaker × profile) combo?
  const services = useMemo(() => {
    if (!speaker) return []
    const caps = speaker.capabilities || {}
    const out = []
    if (caps.spotify_play_uri && profile?.services?.spotify?.configured) out.push('spotify')
    if (caps.ytmusic_play     && profile?.services?.ytmusic?.configured) out.push('ytmusic')
    if (caps.open_app)                                                    out.push('open_app_only')
    return out
  }, [speaker, profile])

  // Which modes are usable for the current (speaker × service)?
  const modes = useMemo(() => {
    if (!speaker) return []
    const caps = speaker.capabilities || {}
    const out = []
    if (action.service === 'spotify') {
      if (caps.spotify_playlists) out.push('playlist')
      if (caps.spotify_search)    out.push('search')
      if (caps.spotify_play_uri)  out.push('uri')
    } else if (action.service === 'ytmusic') {
      if (caps.ytmusic_play) {
        out.push('playlist'); out.push('search'); out.push('uri')
      }
    } else if (action.service === 'open_app_only') {
      out.push('open_app')
    }
    return out
  }, [speaker, action.service])

  // Auto-correct: if the chosen service/mode is no longer valid after a speaker/profile
  // change, snap to the first valid option so the user can never save garbage.
  useEffect(() => {
    if (!speaker) return
    if (services.length && !services.includes(action.service)) {
      onChange({ ...action, service: services[0], mode: undefined, uri: undefined, query: undefined })
      return
    }
    if (modes.length && !modes.includes(action.mode)) {
      onChange({ ...action, mode: modes[0], uri: undefined, query: undefined })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaker?.entity_id, action.service, profile?.name, modes.join('|'), services.join('|')])

  // Default profile to first one with any music service connected.
  useEffect(() => {
    if (action.profile) return
    const candidate = profiles.find(p => p.services?.spotify?.configured || p.services?.ytmusic?.configured)
    if (candidate) onChange({ ...action, profile: candidate.name })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Speaker */}
      <Field label={t('media.action.speaker')}>
        {enabledSpeakers.length === 0 ? (
          <Note>{t('media.action.noEnabledSpeakers')}</Note>
        ) : (
          <select value={action.speaker_entity || ''} onChange={e => onChange({ ...action, speaker_entity: e.target.value })} style={input}>
            <option value="">—</option>
            {enabledSpeakers.map(s => (
              <option key={s.entity_id} value={s.entity_id}>
                {s.display_name || t('media.unnamedSpeaker')}{s.room ? ` · ${s.room}` : ''}
              </option>
            ))}
          </select>
        )}
      </Field>

      {/* Profile */}
      <Field label={t('media.action.profile')}>
        {profiles.length === 0 ? (
          <Note>{t('media.noProfiles')}</Note>
        ) : (
          <select value={action.profile || ''} onChange={e => onChange({ ...action, profile: e.target.value })} style={input}>
            <option value="">—</option>
            {profiles.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        )}
      </Field>

      {/* Service (filtered) */}
      {speaker && profile && (
        <Field label={t('media.action.service')}>
          {services.length === 0 ? (
            <Note>{t('media.action.noServicesForCombo')}</Note>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {services.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange({ ...action, service: s, mode: undefined, uri: undefined, query: undefined })}
                  style={s === action.service ? chipActive : chip}
                >
                  {t(`media.action.service.${s}`)}
                </button>
              ))}
            </div>
          )}
        </Field>
      )}

      {/* Mode (filtered) */}
      {action.service && modes.length > 1 && (
        <Field label={t('media.action.mode')}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {modes.map(m => {
              const def = MODE_OPTIONS.find(o => o.value === m)
              return (
                <button key={m} type="button"
                  onClick={() => onChange({ ...action, mode: m, uri: undefined, query: undefined })}
                  style={m === action.mode ? chipActive : chip}>
                  {def ? t(def.labelKey) : m}
                </button>
              )
            })}
          </div>
        </Field>
      )}

      {/* Mode-specific picker */}
      {action.mode === 'playlist' && (
        <PlaylistPicker
          service={action.service}
          profile={action.profile}
          value={action.uri || ''}
          onPick={(uri) => onChange({ ...action, uri, query: undefined })}
          t={t}
        />
      )}
      {action.mode === 'search' && (
        <SearchPicker
          service={action.service}
          profile={action.profile}
          value={action.query || ''}
          onPick={({ query, uri }) => onChange({ ...action, query, uri })}
          t={t}
        />
      )}
      {action.mode === 'uri' && (
        <Field label={t('media.action.uri')}>
          <input dir="ltr" type="text" placeholder="spotify:playlist:… or https://music.youtube.com/…"
            value={action.uri || ''} onChange={e => onChange({ ...action, uri: e.target.value })} style={input} />
        </Field>
      )}
      {action.mode === 'open_app' && (
        <Note>{t('media.action.openAppExplain')}</Note>
      )}

      {/* Volume */}
      <Field label={t('media.action.volumeOptional')}>
        <input type="number" min={0} max={100} placeholder="—"
          value={action.volume ?? ''} onChange={e => {
            const v = e.target.value
            onChange({ ...action, volume: v === '' ? undefined : Math.max(0, Math.min(100, parseInt(v))) })
          }} style={input} />
      </Field>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function PlaylistPicker({ service, profile, value, onPick, t }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!service || !profile) return
    setLoading(true); setErr(null)
    const fetcher = service === 'spotify' ? spotifyPlaylists(profile) : ytmusicPlaylists(profile)
    fetcher
      .then(resp => {
        if (service === 'spotify') setRows((resp?.items || []).map(p => ({ uri: p.uri, title: p.name, sub: p.owner?.display_name, art: p.images?.[0]?.url })))
        else                       setRows((resp?.playlists || []).map(p => ({ uri: `https://music.youtube.com/playlist?list=${p.playlistId}`, title: p.title, sub: p.count ? `${p.count} songs` : '', art: p.art })))
      })
      .catch(e => setErr(e?.userMessage || e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [service, profile])

  if (loading) return <Note>{t('common.loading')}…</Note>
  if (err)     return <Note error>{err}</Note>
  if (!rows || rows.length === 0) return <Note>{t('media.action.noPlaylists')}</Note>

  return (
    <Field label={t('media.action.pickPlaylist')}>
      <select value={value} onChange={e => onPick(e.target.value)} style={input}>
        <option value="">—</option>
        {rows.map(r => <option key={r.uri} value={r.uri}>{r.title}{r.sub ? ` — ${r.sub}` : ''}</option>)}
      </select>
    </Field>
  )
}

function SearchPicker({ service, profile, value, onPick, t }) {
  const [query, setQuery] = useState(value || '')
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  const run = async () => {
    if (!query.trim() || !service || !profile) return
    setLoading(true); setErr(null)
    try {
      if (service === 'spotify') {
        const r = await spotifySearch(profile, query.trim(), 'track', 10)
        setRows((r?.tracks?.items || []).map(i => ({ uri: i.uri, title: i.name, sub: i.artists?.map(a=>a.name).join(', '), art: i.album?.images?.[0]?.url })))
      } else {
        const r = await ytmusicSearch(profile, query.trim(), 10)
        setRows((r?.songs || []).map(s => ({ uri: `https://music.youtube.com/watch?v=${s.videoId}`, title: s.title, sub: s.artist, art: s.art })))
      }
    } catch (e) { setErr(e?.userMessage || e?.message || String(e)) }
    finally { setLoading(false) }
  }

  return (
    <>
      <Field label={t('media.action.searchQuery')}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input dir="auto" type="text" value={query}
            onChange={e => { setQuery(e.target.value); onPick({ query: e.target.value, uri: undefined }) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); run() } }}
            placeholder={t('media.action.searchPh')} style={{ ...input, flex: 1 }} />
          <button type="button" onClick={run} disabled={loading || !query.trim()} style={btnSecondary}>
            {loading ? '…' : t('media.action.preview')}
          </button>
        </div>
      </Field>
      {err && <Note error>{err}</Note>}
      {rows && rows.length > 0 && (
        <Field label={t('media.action.previewResults')}>
          <select onChange={e => onPick({ query, uri: e.target.value })} style={input}>
            <option value="">{t('media.action.useTopHit')}</option>
            {rows.map(r => <option key={r.uri} value={r.uri}>{r.title}{r.sub ? ` — ${r.sub}` : ''}</option>)}
          </select>
          <Note>{t('media.action.searchNote')}</Note>
        </Field>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}
function Note({ children, error }) {
  return <div style={{ fontSize: 11, color: error ? '#c1452f' : 'var(--ink-faint)', padding: '4px 0' }}>{children}</div>
}

const input = { width: '100%', padding: '8px 10px', border: '0.5px solid var(--line)', borderRadius: 8, background: 'var(--surface-elev, var(--surface))', color: 'var(--ink)', fontSize: 13 }
const chip = { padding: '6px 12px', borderRadius: 14, border: '0.5px solid var(--line)', background: 'transparent', color: 'var(--ink)', fontSize: 12, cursor: 'pointer' }
const chipActive = { ...chip, background: 'var(--accent)', color: 'white', border: '0.5px solid var(--accent)' }
const btnSecondary = { padding: '6px 12px', background: 'transparent', border: '0.5px solid var(--line)', color: 'var(--ink)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }
