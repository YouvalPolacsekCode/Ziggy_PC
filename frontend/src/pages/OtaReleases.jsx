// Fleet-wide OTA release catalog + cohorts admin (Prompt 10 chunk 2).
//
// Per-home pin lives on CloudAdmin's HomeCard "OTA" tab — that's the
// per-device operation. This page is the fleet-wide write surface:
// publish a new release, define cohorts, assign cohort → release.
//
// Reads via relay client helpers added in commit "feat(api): relay
// client helpers ...". Writes through the same. All admin endpoints
// are gated by relay_admin role at the relay; this page is reachable
// only via /ops/* which is super_admin-gated client-side too.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Plus, Layers } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { useUIStore } from '../stores/uiStore'
import { useT } from '../lib/i18n'
import {
  isRelayConfigured, getRelayUrl,
  relayOtaReleases, relayOtaCreateRelease,
  relayOtaCohorts, relayOtaUpsertCohort,
} from '../lib/api'

function ReleaseRow({ release }) {
  const t = useT()
  const digestEntries = Object.entries(release.image_digests || {})
  return (
    <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)', minHeight: 56 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="z-chip z-mono">#{release.id}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="z-headline">
            HA <span className="z-code">{release.ha_version}</span>
            <span style={{ color: 'var(--ink-faint)', margin: '0 8px' }}>·</span>
            Ziggy <span className="z-code">{release.ziggy_version}</span>
          </p>
          <p className="z-footnote" style={{ marginTop: 2 }}>
            {t('otaPage.publishedBy', { by: release.created_by || t('otaPage.unknown'), when: release.created_at })}
          </p>
        </div>
      </div>
      {release.notes && (
        <p className="z-subhead" style={{ marginTop: 8 }}>{release.notes}</p>
      )}
      {digestEntries.length > 0 && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)' }}>
          {digestEntries.map(([img, dig]) => (
            <p key={img} className="z-code" style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: '18px', wordBreak: 'break-all' }}>
              {img}: {dig}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function CohortRow({ cohort }) {
  const t = useT()
  return (
    <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, minHeight: 56 }}>
      <Layers size={20} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="z-headline">{cohort.cohort_name}</p>
        <p className="z-subhead" style={{ marginTop: 2 }}>
          {t('otaPage.tracksRelease', { id: cohort.release_id, ha: cohort.ha_version || '?', ziggy: cohort.ziggy_version || '?' })}
        </p>
      </div>
      <span className="z-chip z-mono">
        {t('otaPage.homeCount', { n: cohort.home_count ?? 0 })}
      </span>
    </div>
  )
}

function Backdrop({ onClose, children, maxWidth }) {
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-sheet)', border: '0.5px solid var(--line)', width: '100%', maxWidth, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: 'var(--shadow-lg)' }}>
        {children}
      </div>
    </div>
  )
}

function ReleaseModal({ open, onClose, onCreated }) {
  const t = useT()
  const { addToast } = useUIStore()
  const [ha, setHa] = useState('')
  const [ziggy, setZiggy] = useState('')
  const [notes, setNotes] = useState('')
  const [digestsText, setDigestsText] = useState('')
  const [saving, setSaving] = useState(false)

  if (!open) return null

  const save = async () => {
    setSaving(true)
    let image_digests = {}
    if (digestsText.trim()) {
      try { image_digests = JSON.parse(digestsText) }
      catch { addToast(t('otaPage.digestsInvalid'), 'error'); setSaving(false); return }
      if (typeof image_digests !== 'object' || Array.isArray(image_digests)) {
        addToast(t('otaPage.digestsInvalid'), 'error'); setSaving(false); return
      }
    }
    try {
      await relayOtaCreateRelease({
        ha_version: ha.trim(),
        ziggy_version: ziggy.trim(),
        image_digests,
        notes: notes.trim() || undefined,
      })
      addToast(t('otaPage.releasePublished'), 'success')
      setHa(''); setZiggy(''); setNotes(''); setDigestsText('')
      onCreated()
      onClose()
    } catch (e) { addToast(e?.message || t('otaPage.publishFailed'), 'error') }
    finally { setSaving(false) }
  }

  return (
    <Backdrop onClose={onClose} maxWidth={440}>
      <p className="z-title3">{t('otaPage.publishTitle')}</p>
      <Field label={t('otaPage.haVersion')} value={ha} onChange={setHa} placeholder="2026.6.1" />
      <Field label={t('otaPage.ziggyVersion')} value={ziggy} onChange={setZiggy} placeholder="1.4.0" />
      <Field label={`${t('otaPage.notes')} (${t('common.optional')})`} value={notes} onChange={setNotes} placeholder="Bug fixes; cohort=beta first" />
      <div>
        <p className="z-footnote" style={{ marginBottom: 4 }}>{t('otaPage.digestsJson')}</p>
        <textarea value={digestsText} onChange={e => setDigestsText(e.target.value)}
          placeholder='{"ziggy-edge": "sha256:abc...", "homeassistant": "sha256:def..."}'
          dir="ltr"
          className="z-input z-code"
          style={{ minHeight: 96, padding: 12, fontSize: 13, lineHeight: '18px', boxSizing: 'border-box', resize: 'vertical' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button onClick={save} disabled={saving || !ha.trim() || !ziggy.trim()} className="z-btn-primary" style={{ flex: 2 }}>
          {saving ? t('common.saving') : t('otaPage.publish')}
        </button>
      </div>
    </Backdrop>
  )
}

function CohortModal({ open, onClose, onSaved, releases }) {
  const t = useT()
  const { addToast } = useUIStore()
  const [name, setName] = useState('')
  const [releaseId, setReleaseId] = useState('')
  const [saving, setSaving] = useState(false)

  if (!open) return null

  const save = async () => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      addToast(t('otaPage.cohortNameInvalid'), 'error')
      return
    }
    setSaving(true)
    try {
      await relayOtaUpsertCohort({ cohort_name: name.trim(), release_id: Number(releaseId) })
      addToast(t('otaPage.cohortSaved'), 'success')
      setName(''); setReleaseId('')
      onSaved()
      onClose()
    } catch (e) { addToast(e?.message || t('otaPage.cohortFailed'), 'error') }
    finally { setSaving(false) }
  }

  return (
    <Backdrop onClose={onClose} maxWidth={420}>
      <p className="z-title3">{t('otaPage.cohortTitle')}</p>
      <Field label={t('otaPage.cohortName')} value={name} onChange={setName} placeholder="beta" />
      <div>
        <p className="z-footnote" style={{ marginBottom: 4 }}>{t('otaPage.tracksReleaseLabel')}</p>
        <select value={releaseId} onChange={e => setReleaseId(e.target.value)} className="z-input" style={{ cursor: 'pointer' }}>
          <option value="">{t('otaPage.selectRelease')}</option>
          {releases.map(r => (
            <option key={r.id} value={String(r.id)}>#{r.id} · HA {r.ha_version} · Ziggy {r.ziggy_version}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button onClick={save} disabled={saving || !name.trim() || !releaseId} className="z-btn-primary" style={{ flex: 2 }}>
          {saving ? t('common.saving') : t('otaPage.save')}
        </button>
      </div>
    </Backdrop>
  )
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <p className="z-footnote" style={{ marginBottom: 4 }}>{label}</p>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} dir="auto" className="z-input"
        style={{ boxSizing: 'border-box' }} />
    </div>
  )
}

function CardNote({ children }) {
  return <p className="z-body" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-mute)' }}>{children}</p>
}

export default function OtaReleases() {
  const t = useT()
  const { addToast } = useUIStore()
  const [releases, setReleases] = useState([])
  const [cohorts, setCohorts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [releaseModal, setReleaseModal] = useState(false)
  const [cohortModal, setCohortModal] = useState(false)

  const load = useCallback(async () => {
    if (!isRelayConfigured()) {
      setLoading(false); setError(t('otaPage.relayNotConfigured'))
      return
    }
    setLoading(true); setError(null)
    try {
      const [rel, coh] = await Promise.all([relayOtaReleases(), relayOtaCohorts()])
      setReleases(rel.releases || [])
      setCohorts(coh.cohorts || [])
    } catch (e) {
      setError(e?.message || t('otaPage.loadFailed'))
    } finally { setLoading(false) }
  }, [t])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
      <div className="z-page-head" style={{ alignItems: 'center' }}>
        <div>
          <h1 className="z-display" style={{ margin: 0 }}>{t('otaPage.title')}</h1>
          <p className="z-footnote">{t('otaPage.subtitle')}</p>
        </div>
        <button onClick={load} className="z-icon-btn" aria-label={t('common.refresh')} title={t('common.refresh')}>
          <RefreshCw size={18} strokeWidth={1.75} className={loading ? 'z-spin' : undefined} />
        </button>
      </div>

      {!isRelayConfigured() && (
        <div className="z-card-soft" style={{ padding: 16, marginBottom: 16 }}>
          <p className="z-subhead">{t('otaPage.relayNotConfigured')}</p>
        </div>
      )}

      {error && (
        <div className="z-alert-warn" style={{ marginBottom: 16, padding: '12px 16px', border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', fontSize: 15, color: 'var(--warn-text)' }}>
          {error}
        </div>
      )}

      {/* ── Releases ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <p className="z-eyebrow" style={{ flex: 1 }}>{t('otaPage.releasesHeader', { n: releases.length })}</p>
          <button onClick={() => setReleaseModal(true)} className="z-btn-primary" disabled={!isRelayConfigured()}>
            <Plus size={18} strokeWidth={1.75} /> {t('otaPage.publish')}
          </button>
        </div>
        <Card>
          {loading ? (
            <CardNote>{t('otaPage.loading')}</CardNote>
          ) : releases.length === 0 ? (
            <CardNote>{t('otaPage.noReleases')}</CardNote>
          ) : releases.map(r => <ReleaseRow key={r.id} release={r} />)}
        </Card>
      </div>

      {/* ── Cohorts ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <p className="z-eyebrow" style={{ flex: 1 }}>{t('otaPage.cohortsHeader', { n: cohorts.length })}</p>
          <button onClick={() => setCohortModal(true)} className="z-btn-secondary" disabled={!isRelayConfigured() || releases.length === 0}>
            <Plus size={18} strokeWidth={1.75} /> {t('otaPage.cohortNew')}
          </button>
        </div>
        <Card>
          {loading ? (
            <CardNote>{t('otaPage.loading')}</CardNote>
          ) : cohorts.length === 0 ? (
            <CardNote>{t('otaPage.noCohorts')}</CardNote>
          ) : cohorts.map(c => <CohortRow key={c.cohort_name} cohort={c} />)}
        </Card>
      </div>

      <ReleaseModal open={releaseModal} onClose={() => setReleaseModal(false)} onCreated={load} />
      <CohortModal open={cohortModal} onClose={() => setCohortModal(false)} onSaved={load} releases={releases} />
    </div>
  )
}
