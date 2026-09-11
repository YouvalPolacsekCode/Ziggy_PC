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
import { Package, RefreshCw, Plus, Layers } from 'lucide-react'
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
    <div style={{ padding: '11px 16px', borderBottom: '0.5px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, fontFamily: '"IBM Plex Mono", monospace',
          color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, var(--surface))',
          padding: '2px 7px', borderRadius: 6,
        }}>#{release.id}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, color: 'var(--ink)' }}>
            HA <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{release.ha_version}</span>
            <span style={{ color: 'var(--ink-faint)', margin: '0 6px' }}>·</span>
            Ziggy <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{release.ziggy_version}</span>
          </p>
          <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>
            {t('otaPage.publishedBy', { by: release.created_by || t('otaPage.unknown'), when: release.created_at })}
          </p>
        </div>
      </div>
      {release.notes && (
        <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 6, paddingLeft: 4 }}>{release.notes}</p>
      )}
      {digestEntries.length > 0 && (
        <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--bg-2)', borderRadius: 6, border: '0.5px solid var(--line)' }}>
          {digestEntries.map(([img, dig]) => (
            <p key={img} style={{ fontSize: 10, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace', lineHeight: 1.5 }}>
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
    <div style={{ padding: '11px 16px', borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <Layers size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: '"IBM Plex Mono", monospace' }}>{cohort.cohort_name}</p>
        <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>
          {t('otaPage.tracksRelease', { id: cohort.release_id, ha: cohort.ha_version || '?', ziggy: cohort.ziggy_version || '?' })}
        </p>
      </div>
      <span style={{ fontSize: 10, color: 'var(--ink-faint)', background: 'var(--bg-2)', padding: '2px 8px', borderRadius: 999 }}>
        {t('otaPage.homeCount', { n: cohort.home_count ?? 0 })}
      </span>
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
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '0.5px solid var(--line)', width: '100%', maxWidth: 440, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{t('otaPage.publishTitle')}</p>
        <Field label={t('otaPage.haVersion')} value={ha} onChange={setHa} placeholder="2026.6.1" />
        <Field label={t('otaPage.ziggyVersion')} value={ziggy} onChange={setZiggy} placeholder="1.4.0" />
        <Field label={`${t('otaPage.notes')} (${t('common.optional')})`} value={notes} onChange={setNotes} placeholder="Bug fixes; cohort=beta first" />
        <div>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('otaPage.digestsJson')}</p>
          <textarea value={digestsText} onChange={e => setDigestsText(e.target.value)}
            placeholder='{"ziggy-edge": "sha256:abc...", "homeassistant": "sha256:def..."}'
            dir="ltr"
            className="z-input"
            style={{ width: '100%', minHeight: 80, padding: 10, fontSize: 11, fontFamily: '"IBM Plex Mono", monospace', boxSizing: 'border-box', resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12 }}>{t('common.cancel')}</button>
          <button onClick={save} disabled={saving || !ha.trim() || !ziggy.trim()} className="z-btn-primary" style={{ flex: 2, height: 38, borderRadius: 10, fontSize: 12 }}>
            {saving ? t('common.saving') : t('otaPage.publish')}
          </button>
        </div>
      </div>
    </div>
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
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '0.5px solid var(--line)', width: '100%', maxWidth: 420, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{t('otaPage.cohortTitle')}</p>
        <Field label={t('otaPage.cohortName')} value={name} onChange={setName} placeholder="beta" />
        <div>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('otaPage.tracksReleaseLabel')}</p>
          <select value={releaseId} onChange={e => setReleaseId(e.target.value)}
            style={{ width: '100%', height: 36, padding: '0 10px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12, cursor: 'pointer' }}>
            <option value="">{t('otaPage.selectRelease')}</option>
            {releases.map(r => (
              <option key={r.id} value={String(r.id)}>#{r.id} · HA {r.ha_version} · Ziggy {r.ziggy_version}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12 }}>{t('common.cancel')}</button>
          <button onClick={save} disabled={saving || !name.trim() || !releaseId} className="z-btn-primary" style={{ flex: 2, height: 38, borderRadius: 10, fontSize: 12 }}>
            {saving ? t('common.saving') : t('otaPage.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{label}</p>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} dir="auto" className="z-input"
        style={{ width: '100%', height: 36, padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }} />
    </div>
  )
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
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Package size={18} style={{ color: 'var(--accent)' }} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{t('otaPage.title')}</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{t('otaPage.subtitle')}</p>
        </div>
        <button onClick={load} className="z-btn-secondary" style={{ height: 32, padding: '0 10px', borderRadius: 8 }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {!isRelayConfigured() && (
        <div style={{ padding: 14, background: 'var(--bg-2)', borderRadius: 10, border: '0.5px solid var(--line)', fontSize: 12, color: 'var(--ink-mute)' }}>
          {t('otaPage.relayNotConfigured')}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: 12, background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--warn) 30%, transparent)', borderRadius: 10, fontSize: 12, color: 'var(--warn)' }}>
          {error}
        </div>
      )}

      {/* ── Releases ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <p className="z-eyebrow" style={{ flex: 1 }}>{t('otaPage.releasesHeader', { n: releases.length })}</p>
          <button onClick={() => setReleaseModal(true)} className="z-btn-primary" disabled={!isRelayConfigured()}
            style={{ height: 30, padding: '0 12px', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Plus size={12} /> {t('otaPage.publish')}
          </button>
        </div>
        <Card>
          {loading ? (
            <p style={{ padding: 14, fontSize: 12, color: 'var(--ink-faint)' }}>{t('otaPage.loading')}</p>
          ) : releases.length === 0 ? (
            <p style={{ padding: 14, fontSize: 12, color: 'var(--ink-faint)' }}>{t('otaPage.noReleases')}</p>
          ) : releases.map(r => <ReleaseRow key={r.id} release={r} />)}
        </Card>
      </div>

      {/* ── Cohorts ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <p className="z-eyebrow" style={{ flex: 1 }}>{t('otaPage.cohortsHeader', { n: cohorts.length })}</p>
          <button onClick={() => setCohortModal(true)} className="z-btn-primary" disabled={!isRelayConfigured() || releases.length === 0}
            style={{ height: 30, padding: '0 12px', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Plus size={12} /> {t('otaPage.cohortNew')}
          </button>
        </div>
        <Card>
          {loading ? (
            <p style={{ padding: 14, fontSize: 12, color: 'var(--ink-faint)' }}>{t('otaPage.loading')}</p>
          ) : cohorts.length === 0 ? (
            <p style={{ padding: 14, fontSize: 12, color: 'var(--ink-faint)' }}>{t('otaPage.noCohorts')}</p>
          ) : cohorts.map(c => <CohortRow key={c.cohort_name} cohort={c} />)}
        </Card>
      </div>

      <ReleaseModal open={releaseModal} onClose={() => setReleaseModal(false)} onCreated={load} />
      <CohortModal open={cohortModal} onClose={() => setCohortModal(false)} onSaved={load} releases={releases} />
    </div>
  )
}
