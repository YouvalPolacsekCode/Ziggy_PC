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
import { AlertTriangle, Pencil, Trash2, X } from 'lucide-react'
import { useFeature } from '../stores/featuresStore'
import { useUIStore } from '../stores/uiStore'
import { useMediaStore } from '../stores/mediaStore'
import { Toggle } from '../components/ui/Toggle'
import {
  patchSpeaker,
  deleteSpeaker,
  spotifyConnectStart,
  spotifyDisconnect,
  ytmusicConnect,
  ytmusicDisconnect,
  listMusicProfiles,
} from '../lib/api'
import { useT, useTranslatedName } from '../lib/i18n'

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
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
      <div className="z-page-head">
        <div>
          <h1 className="z-display" style={{ margin: 0 }}>{t('media.settingsTitle')}</h1>
          <p className="z-footnote">{t('media.settingsSubtitle')}</p>
        </div>
      </div>

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
              <div className="z-headline">{p.name}</div>
              <div className="z-subhead" style={{ marginTop: 2 }}>
                {[
                  p.services?.spotify?.configured && 'Spotify',
                  p.services?.ytmusic?.configured && 'YT Music',
                ].filter(Boolean).join(' · ') || t('media.noServicesConnected')}
              </div>
            </div>
            {/* Connect and disconnect are both secondary here: a page with
                several profiles would otherwise carry several inverted
                buttons, and none of them is *the* action of the screen. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {p.services?.spotify?.configured ? (
                <button className="z-btn-secondary" disabled={busy === `sp-disc:${p.name}`} onClick={() => onDisconnectSpotify(p.name)}>{t('media.disconnectSpotify')}</button>
              ) : (
                <button className="z-btn-secondary" disabled={busy === `sp-conn:${p.name}` || !capabilities?.spotify_app_configured} onClick={() => onConnectSpotify(p.name)}>{t('media.connectSpotify')}</button>
              )}
              {p.services?.ytmusic?.configured ? (
                <button className="z-btn-secondary" disabled={busy === `ytm-disc:${p.name}`} onClick={() => onDisconnectYtm(p.name)}>{t('media.disconnectYtm')}</button>
              ) : (
                <button className="z-btn-secondary" disabled={!capabilities?.ytmusic_app_configured} onClick={() => onConnectYtm(p.name)}>{t('media.connectYtm')}</button>
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
  const rawSpeakerName = sp.display_name || t('media.unnamedSpeaker')
  const speakerName = useTranslatedName(rawSpeakerName)
  const roomName = useTranslatedName(sp.room)
  // Hide raw/unknown HA states; map known ones to friendly i18n labels.
  const friendlyState = sp.state && KNOWN_PLAYER_STATES.has(sp.state)
    ? t(`media.state.${sp.state}`)
    : null
  // An unsupported speaker reads in the muted tokens rather than a dimmed
  // copy of the supported row — the text stays legible, the hierarchy drops.
  const inkColor = isSupported ? 'var(--ink)' : 'var(--ink-mute)'
  return (
    <div style={row}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="z-headline" style={{ color: inkColor }} dir="auto">{speakerName}</div>
        <div className="z-subhead" style={{ marginTop: 2 }} dir="auto">
          <span>{t(CLASS_LABEL[sp.class] || CLASS_LABEL.unsupported)}</span>
          {sp.room && <span> · {roomName}</span>}
          {friendlyState && <span> · {friendlyState}</span>}
        </div>
        {/* Third line earns its place: it says what the speaker can do,
            which neither the name nor the class label already says. */}
        <div className="z-footnote" style={{ marginTop: 2 }}>
          {t(CLASS_HINT[sp.class] || CLASS_HINT.unsupported)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        {sp.enabled && (
          <button className="z-icon-btn" onClick={onRename} aria-label={t('common.rename')} title={t('common.rename')}>
            <Pencil size={20} strokeWidth={1.75} />
          </button>
        )}
        {sp.enabled && (
          <button className="z-icon-btn" onClick={onForget} aria-label={t('common.forget')} title={t('common.forget')} style={{ color: 'var(--err)' }}>
            <Trash2 size={20} strokeWidth={1.75} />
          </button>
        )}
        <Toggle
          checked={!!sp.enabled}
          disabled={!isSupported || busy}
          onCheckedChange={(v) => onToggle(v)}
          aria-label={sp.enabled ? t('media.disableSpeaker') : t('media.enableSpeaker')}
        />
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
          <span className="z-headline">{t('media.ytmConnectTitle', { name: member })}</span>
          <button onClick={onClose} className="z-icon-btn" aria-label={t('common.close')}>
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="bg-warn-soft" style={{
            display: 'flex', gap: 12, alignItems: 'flex-start',
            color: 'var(--warn-text)', padding: '12px 16px', borderRadius: 'var(--r-ctl)', fontSize: 13, lineHeight: '20px',
          }}>
            <AlertTriangle size={20} strokeWidth={1.75} style={{ color: 'var(--warn)', flexShrink: 0 }} />
            <span>{t('media.ytmAdvancedNotice')}</span>
          </div>
          <p className="z-body" style={{ margin: 0 }}>{t('media.ytmHowTo1')}</p>
          <ol className="z-subhead" style={{ margin: 0, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
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
            className="z-input z-code"
            style={{ fontSize: 12, lineHeight: '18px', height: 160, padding: 12, resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="z-btn-secondary" style={{ flex: 1 }} onClick={onClose}>{t('common.cancel')}</button>
            <button className="z-btn-primary" style={{ flex: 2 }} disabled={busy || !text.trim()} onClick={() => onSubmit(member, text.trim())}>
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
    <section className="z-card" style={{ marginBottom: 24, padding: 12 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 className="z-headline">{title}</h2>
        {subtitle && <p className="z-footnote" style={{ marginTop: 2 }}>{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}
function Empty({ text }) {
  return <p className="z-body" style={{ color: 'var(--ink-mute)', textAlign: 'center', padding: 32 }}>{text}</p>
}
function Banner({ kind = 'ok', children }) {
  return <div className={kind === 'ok' ? 'bg-ok-soft' : 'bg-warn-soft'} style={{
    color: kind === 'ok' ? 'var(--ok-text)' : 'var(--warn-text)',
    padding: '12px 16px', borderRadius: 'var(--r-ctl)', fontSize: 13, lineHeight: '20px', marginBottom: 16,
  }}>{children}</div>
}

const row = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', minHeight: 48, borderTop: '0.5px solid var(--line)' }

const overlay = { position: 'fixed', inset: 0, background: 'var(--backdrop)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 220 }
const modal   = { width: '100%', maxWidth: 520, background: 'var(--surface)', borderStartStartRadius: 'var(--r-sheet)', borderStartEndRadius: 'var(--r-sheet)', paddingBottom: 'env(safe-area-inset-bottom, 0)', maxHeight: '90vh', overflow: 'auto' }
const header  = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', minHeight: 68, borderBottom: '0.5px solid var(--line)' }
