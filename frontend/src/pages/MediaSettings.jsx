// MediaSettings (v2).
//
// Two sections only:
//   1. Speakers — auto-discovered + auto-classified HA media_players; the user
//      just flips a toggle per row to mark it usable. Read-only class label
//      tells the user what each speaker can do. Unsupported speakers are
//      greyed out with a one-line "why not".
//   2. Music profiles — per-household-member Spotify + YT Music connect.
//
// No favorites. No "now playing" widget. No room cards. Playback only happens
// from automations and from the tablet hub widget.
import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useFeature } from '../stores/featuresStore'
import { useUIStore } from '../stores/uiStore'
import { useMediaStore } from '../stores/mediaStore'
import {
  patchSpeaker,
  deleteSpeaker,
  spotifyConnectStart,
  spotifyDisconnect,
  ytmusicConnect,
  ytmusicDisconnect,
  listMusicProfiles,
} from '../lib/api'
import { useT } from '../lib/i18n'

const CLASS_LABEL = {
  cast:            'media.class.cast',
  sonos:           'media.class.sonos',
  spotify_connect: 'media.class.spotifyConnect',
  smart_tv_app:    'media.class.smartTvApp',
  unsupported:     'media.class.unsupported',
}

const CLASS_HINT = {
  cast:            'media.classHint.cast',
  sonos:           'media.classHint.sonos',
  spotify_connect: 'media.classHint.spotifyConnect',
  smart_tv_app:    'media.classHint.smartTvApp',
  unsupported:     'media.classHint.unsupported',
}


export default function MediaSettings() {
  const enabled        = useFeature('media_music')
  const [searchParams] = useSearchParams()
  const t              = useT()
  const addToast       = useUIStore(s => s.addToast)

  const ensureLoaded = useMediaStore(s => s.ensureLoaded)
  const reload       = useMediaStore(s => s.reload)
  const speakers     = useMediaStore(s => s.speakers)
  const capabilities = useMediaStore(s => s.capabilities)

  const [profiles, setProfiles] = useState([])
  const [busy, setBusy]         = useState(null)
  const [ytmOpen, setYtmOpen]   = useState(null)   // member name when paste box is open

  useEffect(() => {
    if (!enabled) return
    ensureLoaded()
    listMusicProfiles().then(r => setProfiles(r?.profiles || [])).catch(() => setProfiles([]))
  }, [enabled, ensureLoaded])

  if (!enabled) return <Navigate to="/settings" replace />

  const justConnected = searchParams.get('spotify') === 'connected'

  const refreshProfiles = () =>
    listMusicProfiles().then(r => setProfiles(r?.profiles || [])).catch(() => {})

  // ---- Speakers --------------------------------------------------------
  const onToggleSpeaker = async (sp, value) => {
    if (sp.class === 'unsupported' && value) return
    setBusy(`sp:${sp.entity_id}`)
    try {
      await patchSpeaker(sp.entity_id, { enabled: value })
      await reload()
    } catch (e) {
      addToast(e?.userMessage || e?.message || String(e), 'error')
    } finally { setBusy(null) }
  }
  const onRenameSpeaker = async (sp) => {
    const next = window.prompt(t('media.renameSpeaker'), sp.display_name || '')
    if (!next || next === sp.display_name) return
    setBusy(`sp:${sp.entity_id}`)
    try {
      await patchSpeaker(sp.entity_id, { display_name: next })
      await reload()
    } catch (e) {
      addToast(e?.userMessage || e?.message || String(e), 'error')
    } finally { setBusy(null) }
  }
  const onForgetSpeaker = async (sp) => {
    if (!window.confirm(t('media.confirmForgetSpeaker'))) return
    try {
      await deleteSpeaker(sp.entity_id)
      await reload()
    } catch (e) {
      addToast(e?.userMessage || e?.message || String(e), 'error')
    }
  }

  // ---- Spotify ---------------------------------------------------------
  const onConnectSpotify = async (member) => {
    setBusy(`sp-conn:${member}`)
    try {
      const r = await spotifyConnectStart(member)
      if (r?.authorize_url) { window.location.href = r.authorize_url; return }
      addToast(t('media.spotifyConnectFailedGeneric'), 'error')
    } catch (e) {
      const msg = e?.userMessage || e?.message || String(e)
      if (/spotify_app_not_configured/i.test(msg)) addToast(t('media.spotifyAppNotConfigured'), 'error')
      else addToast(`${t('media.spotifyConnectFailedGeneric')} (${msg})`, 'error')
    } finally { setBusy(null) }
  }
  const onDisconnectSpotify = async (member) => {
    setBusy(`sp-disc:${member}`)
    try { await spotifyDisconnect(member); await refreshProfiles() }
    catch (e) { addToast(e?.userMessage || e?.message || String(e), 'error') }
    finally  { setBusy(null) }
  }

  // ---- YouTube Music ---------------------------------------------------
  const onConnectYtm = (member) => setYtmOpen(member)
  const onSubmitYtm = async (member, headersJson) => {
    setBusy(`ytm:${member}`)
    try {
      await ytmusicConnect(member, headersJson)
      setYtmOpen(null)
      await refreshProfiles()
      addToast(t('media.ytmConnected'), 'success')
    } catch (e) {
      addToast(e?.userMessage || e?.message || String(e), 'error')
    } finally { setBusy(null) }
  }
  const onDisconnectYtm = async (member) => {
    setBusy(`ytm-disc:${member}`)
    try { await ytmusicDisconnect(member); await refreshProfiles() }
    catch (e) { addToast(e?.userMessage || e?.message || String(e), 'error') }
    finally  { setBusy(null) }
  }

  // ---- Render ----------------------------------------------------------
  const enabledCount = speakers.filter(s => s.enabled).length

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 60px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
        {t('media.settingsTitle')}
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 18 }}>
        {t('media.settingsSubtitle')}
      </p>

      {justConnected && <Banner kind="ok">{t('media.spotifyConnectedBanner')}</Banner>}
      {capabilities && !capabilities.spotify_app_configured && (
        <Banner kind="warn">{t('media.spotifyAppNotConfigured')}</Banner>
      )}
      {capabilities && !capabilities.ytmusic_app_configured && (
        <Banner kind="warn">{t('media.ytmAppNotConfigured')}</Banner>
      )}

      {/* ── Speakers ──────────────────────────────────────────── */}
      <Section title={t('media.speakersSection')} subtitle={t('media.speakersSubtitle', { n: enabledCount, total: speakers.length })}>
        {speakers.length === 0 && <Empty text={t('media.noMediaPlayers')} />}
        {speakers.map(sp => (
          <SpeakerRow
            key={sp.entity_id}
            sp={sp}
            t={t}
            busy={busy === `sp:${sp.entity_id}`}
            onToggle={(v) => onToggleSpeaker(sp, v)}
            onRename={() => onRenameSpeaker(sp)}
            onForget={() => onForgetSpeaker(sp)}
          />
        ))}
      </Section>

      {/* ── Profiles ─────────────────────────────────────────── */}
      <Section title={t('media.profilesSection')} subtitle={t('media.profilesSubtitle')}>
        {profiles.length === 0 && <Empty text={t('media.noProfiles')} />}
        {profiles.map(p => (
          <div key={p.name} style={row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={rowTitle}>{p.name}</div>
              <div style={rowSub}>
                {[
                  p.services?.spotify?.configured && 'Spotify',
                  p.services?.ytmusic?.configured && 'YT Music',
                ].filter(Boolean).join(' · ') || t('media.noServicesConnected')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {p.services?.spotify?.configured ? (
                <button style={btnGhost} disabled={busy === `sp-disc:${p.name}`} onClick={() => onDisconnectSpotify(p.name)}>{t('media.disconnectSpotify')}</button>
              ) : (
                <button style={btnPrimarySm} disabled={busy === `sp-conn:${p.name}` || !capabilities?.spotify_app_configured} onClick={() => onConnectSpotify(p.name)}>{t('media.connectSpotify')}</button>
              )}
              {p.services?.ytmusic?.configured ? (
                <button style={btnGhost} disabled={busy === `ytm-disc:${p.name}`} onClick={() => onDisconnectYtm(p.name)}>{t('media.disconnectYtm')}</button>
              ) : (
                <button style={btnPrimarySm} disabled={!capabilities?.ytmusic_app_configured} onClick={() => onConnectYtm(p.name)}>{t('media.connectYtm')}</button>
              )}
            </div>
          </div>
        ))}
      </Section>

      <YtmPasteSheet
        open={!!ytmOpen}
        member={ytmOpen}
        onClose={() => setYtmOpen(null)}
        onSubmit={onSubmitYtm}
        busy={ytmOpen ? busy === `ytm:${ytmOpen}` : false}
        t={t}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_PLAYER_STATES = new Set(['playing', 'paused', 'idle', 'off', 'unavailable', 'unknown'])

function SpeakerRow({ sp, t, busy, onToggle, onRename, onForget }) {
  const isSupported = sp.class !== 'unsupported'
  const speakerName = sp.display_name || t('media.unnamedSpeaker')
  // Hide raw/unknown HA states; map known ones to friendly i18n labels.
  const friendlyState = sp.state && KNOWN_PLAYER_STATES.has(sp.state)
    ? t(`media.state.${sp.state}`)
    : null
  return (
    <div style={{ ...row, opacity: isSupported ? 1 : 0.55 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={rowTitle} dir="auto">{speakerName}</div>
        <div style={rowSub} dir="auto">
          <span>{t(CLASS_LABEL[sp.class] || CLASS_LABEL.unsupported)}</span>
          {sp.room && <span> · {sp.room}</span>}
          {friendlyState && <span> · {friendlyState}</span>}
        </div>
        <div style={{ ...rowSub, marginTop: 2, fontStyle: 'italic' }}>
          {t(CLASS_HINT[sp.class] || CLASS_HINT.unsupported)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {sp.enabled && <button style={btnTiny} onClick={onRename}>{t('common.rename')}</button>}
        {sp.enabled && <button style={btnTiny} onClick={onForget}>{t('common.forget')}</button>}
        <button
          type="button"
          disabled={!isSupported || busy}
          onClick={() => onToggle(!sp.enabled)}
          style={{
            width: 44, height: 26, borderRadius: 13,
            background: sp.enabled ? 'var(--accent)' : 'var(--line)',
            border: 'none', position: 'relative', cursor: isSupported ? 'pointer' : 'not-allowed',
            transition: 'background 120ms',
          }}
          aria-label={sp.enabled ? t('media.disableSpeaker') : t('media.enableSpeaker')}
        >
          <span style={{
            position: 'absolute', top: 2,
            [sp.enabled ? 'right' : 'left']: 2,
            width: 22, height: 22, borderRadius: 11, background: 'white',
            transition: 'all 120ms',
          }} />
        </button>
      </div>
    </div>
  )
}

function YtmPasteSheet({ open, member, onClose, onSubmit, busy, t }) {
  const [text, setText] = useState('')
  useEffect(() => { if (open) setText('') }, [open])
  if (!open) return null
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <span>{t('media.ytmConnectTitle', { name: member })}</span>
          <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            background: 'rgba(220,150,40,0.10)', color: '#a06a18',
            padding: '8px 12px', borderRadius: 8, fontSize: 11,
          }}>
            ⚠ {t('media.ytmAdvancedNotice')}
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{t('media.ytmHowTo1')}</p>
          <ol style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: 'var(--ink-mute)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>{t('media.ytmStep1')}</li>
            <li>{t('media.ytmStep2')}</li>
            <li>{t('media.ytmStep3')}</li>
            <li>{t('media.ytmStep4')}</li>
          </ol>
          <textarea
            dir="ltr"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder='{"cookie": "...", "x-goog-authuser": "0", ...}'
            spellCheck={false}
            style={{
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              fontSize: 11, height: 160, padding: 10,
              background: 'var(--surface-elev, var(--surface))',
              border: '0.5px solid var(--line)', borderRadius: 10, color: 'var(--ink)',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnGhost} onClick={onClose}>{t('common.cancel')}</button>
            <button style={btnPrimary} disabled={busy || !text.trim()} onClick={() => onSubmit(member, text.trim())}>
              {busy ? t('common.saving') : t('media.ytmSaveHeaders')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <section style={{ marginBottom: 24, background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 14, padding: 14 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}
function Empty({ text }) {
  return <div style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center', padding: 16 }}>{text}</div>
}
function Banner({ kind = 'ok', children }) {
  return <div style={{
    background: kind === 'ok' ? 'rgba(60,164,80,0.12)' : 'rgba(220,150,40,0.12)',
    color: kind === 'ok' ? '#3ca450' : '#a06a18',
    padding: '10px 14px', borderRadius: 10, fontSize: 12, marginBottom: 14,
  }}>{children}</div>
}

const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '0.5px solid var(--line)' }
const rowTitle = { fontSize: 13, fontWeight: 600, color: 'var(--ink)' }
const rowSub = { fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }
const btnPrimary = { padding: '10px 14px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: 'pointer', flex: 1 }
const btnPrimarySm = { padding: '6px 10px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 12, cursor: 'pointer' }
const btnGhost = { padding: '6px 10px', background: 'transparent', color: 'var(--ink-mute)', border: '0.5px solid var(--line)', borderRadius: 10, fontSize: 12, cursor: 'pointer' }
const btnTiny = { padding: '4px 8px', background: 'transparent', color: 'var(--ink-faint)', border: '0.5px solid var(--line)', borderRadius: 8, fontSize: 10, cursor: 'pointer' }

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 220 }
const modal   = { width: '100%', maxWidth: 520, background: 'var(--surface)', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 'env(safe-area-inset-bottom, 0)', maxHeight: '90vh', overflow: 'auto' }
const header  = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '0.5px solid var(--line)', fontWeight: 700, color: 'var(--ink)' }
const closeBtn = { background: 'transparent', border: 'none', fontSize: 24, color: 'var(--ink-mute)', cursor: 'pointer' }
