// Audit log viewer (Prompt 10 chunk 3). Reads from the relay's
// /api/admin/audit-log endpoint with server-side filters + offset
// pagination. Row click opens a side panel with the full detail blob
// (matches the DebugPage's EventRow/EventDetail pattern).

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Shield, RefreshCw, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { useT } from '../lib/i18n'
import { isRelayConfigured, relayAuditLog, relayListHomes } from '../lib/api'

const PAGE_SIZE = 100

function fmtTs(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function OkDot({ ok }) {
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      background: ok ? 'var(--ok)' : '#ef4444', flexShrink: 0,
    }} />
  )
}

function Row({ row, selected, onSelect }) {
  return (
    <div
      onClick={() => onSelect(selected?.id === row.id ? null : row)}
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 14px 1fr 160px 110px',
        gap: 10, alignItems: 'center',
        padding: '6px 12px', borderBottom: '0.5px solid var(--line)',
        cursor: 'pointer',
        background: selected?.id === row.id ? 'var(--bg-2)' : 'transparent',
        fontSize: 11, fontFamily: '"IBM Plex Mono", monospace',
      }}
    >
      <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>{fmtTs(row.ts)}</span>
      <OkDot ok={row.ok} />
      <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.event}
        {row.detail && <span style={{ color: 'var(--ink-faint)', marginLeft: 8 }}>{row.detail.length > 80 ? row.detail.slice(0, 80) + '…' : row.detail}</span>}
      </span>
      <span style={{ color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.home_id || '—'}
      </span>
      <span style={{ color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.source_ip || ''}
      </span>
    </div>
  )
}

function DetailPanel({ row, onClose }) {
  const t = useT()
  if (!row) return null
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 420, height: '100dvh',
      background: 'var(--surface)', borderLeft: '0.5px solid var(--line)',
      zIndex: 50, display: 'flex', flexDirection: 'column',
      boxShadow: '-8px 0 32px rgba(0,0,0,0.15)',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <OkDot ok={row.ok} />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: '"IBM Plex Mono", monospace' }}>
          {row.event}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)' }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <Field label={t('auditPage.fieldTime')}    value={fmtTs(row.ts)} />
        <Field label={t('auditPage.fieldId')}      value={row.id} mono />
        <Field label={t('auditPage.fieldHomeId')}  value={row.home_id} mono />
        <Field label={t('auditPage.fieldSourceIp')} value={row.source_ip} mono />
        <Field label={t('auditPage.fieldOk')}      value={String(row.ok)} />
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('auditPage.fieldDetail')}
          </p>
          <pre style={{
            fontSize: 11, color: 'var(--ink)', background: 'var(--bg-2)',
            padding: 10, borderRadius: 8, overflow: 'auto', maxHeight: 360,
            fontFamily: '"IBM Plex Mono", monospace',
            border: '0.5px solid var(--line)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {row.detail || '—'}
          </pre>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 10, color: 'var(--ink-faint)', minWidth: 80, paddingTop: 1, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--ink)', fontFamily: mono ? '"IBM Plex Mono", monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

export default function AuditLog() {
  const t = useT()
  const { addToast } = useUIStore()
  const [rows, setRows]         = useState([])
  const [hasMore, setHasMore]   = useState(false)
  const [offset, setOffset]     = useState(0)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [homes, setHomes]       = useState([])
  const [selected, setSelected] = useState(null)
  // Honour ?home_id=... &event=... &ok=... &since=... &until=... from the
  // URL so deep links (e.g. the per-user "View audit log" link in
  // CloudAdmin) land pre-filtered.
  const [searchParams] = useSearchParams()
  const [filters, setFilters]   = useState({
    event:   searchParams.get('event')   || '',
    home_id: searchParams.get('home_id') || '',
    ok:      searchParams.get('ok')      || '',
    since:   searchParams.get('since')   || '',
    until:   searchParams.get('until')   || '',
  })

  // Load homes once for the home_id dropdown. Failing this is non-fatal —
  // the home_id text input remains usable.
  useEffect(() => {
    if (!isRelayConfigured()) return
    relayListHomes().then(setHomes).catch(() => setHomes([]))
  }, [])

  const load = useCallback(async (nextOffset = 0) => {
    if (!isRelayConfigured()) {
      setError(t('auditPage.relayNotConfigured'))
      return
    }
    setLoading(true); setError(null)
    try {
      const res = await relayAuditLog({
        event:   filters.event || undefined,
        home_id: filters.home_id || undefined,
        ok:      filters.ok || undefined,
        since:   filters.since || undefined,
        until:   filters.until || undefined,
        limit:   PAGE_SIZE,
        offset:  nextOffset,
      })
      setRows(res.rows || [])
      setHasMore(!!res.has_more)
      setOffset(nextOffset)
    } catch (e) {
      setError(e?.message || t('auditPage.loadFailed'))
      addToast(e?.message || t('auditPage.loadFailed'), 'error')
    } finally { setLoading(false) }
  }, [filters, addToast, t])

  useEffect(() => { load(0) }, [load])

  const inputStyle = { height: 30, padding: '0 8px', borderRadius: 7, border: '0.5px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 11 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Shield size={14} style={{ color: 'var(--accent)' }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{t('auditPage.title')}</p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>
            {loading ? t('auditPage.loading') : t('auditPage.subtitle', { n: rows.length, more: hasMore ? '+' : '' })}
          </p>
        </div>
        <button onClick={() => load(0)} disabled={loading} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 7, color: 'var(--ink-faint)', padding: 6, cursor: 'pointer' }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Filters sidebar */}
        <div style={{ width: 220, flexShrink: 0, borderRight: '0.5px solid var(--line)', overflow: 'auto', background: 'var(--bg-2)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              {t('auditPage.filterEvent')}
            </p>
            <input value={filters.event} onChange={e => setFilters(f => ({ ...f, event: e.target.value }))}
              placeholder={t('auditPage.filterEventPh')} dir="auto"
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              {t('auditPage.filterHome')}
            </p>
            <select value={filters.home_id} onChange={e => setFilters(f => ({ ...f, home_id: e.target.value }))}
              style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
              <option value="">{t('auditPage.allHomes')}</option>
              {homes.map(h => <option key={h.id} value={h.id}>{h.name || h.id}</option>)}
            </select>
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              {t('auditPage.filterStatus')}
            </p>
            <select value={filters.ok} onChange={e => setFilters(f => ({ ...f, ok: e.target.value }))}
              style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
              <option value="">{t('auditPage.allStatuses')}</option>
              <option value="true">{t('auditPage.statusOk')}</option>
              <option value="false">{t('auditPage.statusFail')}</option>
            </select>
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              {t('auditPage.filterSince')}
            </p>
            <input type="datetime-local" value={filters.since} onChange={e => setFilters(f => ({ ...f, since: e.target.value ? new Date(e.target.value).toISOString() : '' }))}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              {t('auditPage.filterUntil')}
            </p>
            <input type="datetime-local" value={filters.until} onChange={e => setFilters(f => ({ ...f, until: e.target.value ? new Date(e.target.value).toISOString() : '' }))}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
          </div>
          <button onClick={() => load(0)} disabled={loading} className="z-btn-primary" style={{ height: 32, fontSize: 11, borderRadius: 7, marginTop: 4 }}>
            {t('auditPage.apply')}
          </button>
          <button
            onClick={() => { setFilters({ event: '', home_id: '', ok: '', since: '', until: '' }) }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 10, padding: 4 }}
          >
            {t('auditPage.clear')}
          </button>
        </div>

        {/* Main list */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 14px 1fr 160px 110px',
            gap: 10, padding: '6px 12px', borderBottom: '0.5px solid var(--line)',
            fontSize: 9, fontWeight: 700, color: 'var(--ink-faint)',
            textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0,
          }}>
            <span>{t('auditPage.colTime')}</span>
            <span />
            <span>{t('auditPage.colEvent')}</span>
            <span>{t('auditPage.colHome')}</span>
            <span>{t('auditPage.colSource')}</span>
          </div>

          {error && (
            <div style={{ padding: 12, background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', borderBottom: '0.5px solid var(--line)', fontSize: 12, color: 'var(--warn)' }}>
              {error}
            </div>
          )}

          <div style={{ flex: 1, overflow: 'auto' }}>
            {rows.length === 0 && !loading
              ? <p style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>{t('auditPage.noRows')}</p>
              : rows.map(r => <Row key={r.id} row={r} selected={selected} onSelect={setSelected} />)
            }
          </div>

          {/* Pagination */}
          <div style={{ padding: '8px 12px', borderTop: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ink-faint)', flexShrink: 0 }}>
            <button onClick={() => load(Math.max(0, offset - PAGE_SIZE))} disabled={loading || offset === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 6, padding: '4px 8px', cursor: offset === 0 ? 'default' : 'pointer', color: 'var(--ink-mute)', fontSize: 11 }}>
              <ChevronLeft size={11} /> {t('auditPage.prev')}
            </button>
            <span style={{ flex: 1, textAlign: 'center', fontFamily: '"IBM Plex Mono", monospace', fontSize: 10 }}>
              {t('auditPage.rangeLabel', { from: offset + 1, to: offset + rows.length })}
            </span>
            <button onClick={() => load(offset + PAGE_SIZE)} disabled={loading || !hasMore}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 6, padding: '4px 8px', cursor: hasMore ? 'pointer' : 'default', color: 'var(--ink-mute)', fontSize: 11 }}>
              {t('auditPage.next')} <ChevronRight size={11} />
            </button>
          </div>
        </div>
      </div>

      <DetailPanel row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
