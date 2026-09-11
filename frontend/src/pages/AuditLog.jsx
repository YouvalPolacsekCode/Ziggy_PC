// Audit log viewer (Prompt 10 chunk 3). Reads from the relay's
// /api/admin/audit-log endpoint with server-side filters + offset
// pagination. Row click opens a side panel with the full detail blob
// (matches the DebugPage's EventRow/EventDetail pattern).

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useUIStore } from '../stores/uiStore'
import { useT } from '../lib/i18n'
import { isRelayConfigured, relayAuditLog, relayListHomes } from '../lib/api'

const PAGE_SIZE = 100

// Time · dot · event · home · source. The time column is sized for a 13px
// tabular "Sep 11, 09:40:52"; the dot column for an 8px status dot.
const GRID = '150px 16px 1fr 160px 120px'

function fmtTs(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function OkDot({ ok }) {
  return <span className={`z-dot ${ok ? 'z-dot-ok' : 'z-dot-err'}`} />
}

function Row({ row, selected, onSelect }) {
  const isSelected = selected?.id === row.id
  return (
    <div
      onClick={() => onSelect(isSelected ? null : row)}
      style={{
        display: 'grid',
        gridTemplateColumns: GRID,
        gap: 12, alignItems: 'center',
        minHeight: 44,
        padding: '8px 12px', borderBottom: '0.5px solid var(--line)',
        cursor: 'pointer',
        background: isSelected ? 'var(--surface-2)' : 'transparent',
        transition: 'background var(--dur-press) var(--ease-standard)',
      }}
    >
      <span className="z-mono" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{fmtTs(row.ts)}</span>
      <OkDot ok={row.ok} />
      <span style={{ fontSize: 15, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.event}
        {row.detail && (
          <span style={{ fontSize: 13, color: 'var(--ink-mute)', marginInlineStart: 8 }}>
            {row.detail.length > 80 ? row.detail.slice(0, 80) + '…' : row.detail}
          </span>
        )}
      </span>
      <span style={{ fontSize: 13, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.home_id || '—'}
      </span>
      <span className="z-code" style={{ fontSize: 13, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
      position: 'fixed', top: 0, insetInlineEnd: 0, width: 'min(420px, 100vw)', height: '100dvh',
      background: 'var(--surface)', borderInlineStart: '0.5px solid var(--line)',
      zIndex: 50, display: 'flex', flexDirection: 'column',
      boxShadow: 'var(--shadow-lg)',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, minHeight: 68 }}>
        <OkDot ok={row.ok} />
        <span className="z-headline" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.event}
        </span>
        <button onClick={onClose} className="z-icon-btn" aria-label={t('common.close')}>
          <X size={20} strokeWidth={1.75} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <Field label={t('auditPage.fieldTime')}    value={fmtTs(row.ts)} />
        <Field label={t('auditPage.fieldId')}      value={row.id} mono />
        <Field label={t('auditPage.fieldHomeId')}  value={row.home_id} mono />
        <Field label={t('auditPage.fieldSourceIp')} value={row.source_ip} mono />
        <Field label={t('auditPage.fieldOk')}      value={String(row.ok)} />
        <div style={{ marginTop: 16 }}>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>
            {t('auditPage.fieldDetail')}
          </p>
          <pre className="z-code" style={{
            fontSize: 13, lineHeight: '18px', color: 'var(--ink)', background: 'var(--surface-2)',
            padding: 12, borderRadius: 'var(--r-ctl)', overflow: 'auto', maxHeight: 360,
            border: '0.5px solid var(--line)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
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
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'baseline' }}>
      <span className="z-footnote" style={{ minWidth: 88, flexShrink: 0 }}>{label}</span>
      <span className={mono ? 'z-code' : undefined} style={{ fontSize: mono ? 13 : 15, color: 'var(--ink)', wordBreak: 'break-all' }}>{value}</span>
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="z-page-head" style={{ padding: '24px 20px 16px', margin: 0, borderBottom: '0.5px solid var(--line)', background: 'var(--bg)', alignItems: 'center', flexShrink: 0 }}>
        <div>
          <h1 className="z-display" style={{ margin: 0 }}>{t('auditPage.title')}</h1>
          <p className="z-footnote">
            {loading ? t('auditPage.loading') : t('auditPage.subtitle', { n: rows.length, more: hasMore ? '+' : '' })}
          </p>
        </div>
        <button onClick={() => load(0)} disabled={loading} className="z-icon-btn" aria-label={t('common.refresh')} title={t('common.refresh')}>
          <RefreshCw size={18} strokeWidth={1.75} className={loading ? 'z-spin' : undefined} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Filters sidebar */}
        <div style={{ width: 240, flexShrink: 0, borderInlineEnd: '0.5px solid var(--line)', overflow: 'auto', background: 'var(--bg-2)', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>
              {t('auditPage.filterEvent')}
            </p>
            <input value={filters.event} onChange={e => setFilters(f => ({ ...f, event: e.target.value }))}
              placeholder={t('auditPage.filterEventPh')} dir="auto"
              className="z-input" style={{ boxSizing: 'border-box' }} />
          </div>
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>
              {t('auditPage.filterHome')}
            </p>
            <select value={filters.home_id} onChange={e => setFilters(f => ({ ...f, home_id: e.target.value }))}
              className="z-input" style={{ cursor: 'pointer' }}>
              <option value="">{t('auditPage.allHomes')}</option>
              {homes.map(h => <option key={h.id} value={h.id}>{h.name || h.id}</option>)}
            </select>
          </div>
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>
              {t('auditPage.filterStatus')}
            </p>
            <select value={filters.ok} onChange={e => setFilters(f => ({ ...f, ok: e.target.value }))}
              className="z-input" style={{ cursor: 'pointer' }}>
              <option value="">{t('auditPage.allStatuses')}</option>
              <option value="true">{t('auditPage.statusOk')}</option>
              <option value="false">{t('auditPage.statusFail')}</option>
            </select>
          </div>
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>
              {t('auditPage.filterSince')}
            </p>
            <input type="datetime-local" value={filters.since} onChange={e => setFilters(f => ({ ...f, since: e.target.value ? new Date(e.target.value).toISOString() : '' }))}
              className="z-input" style={{ boxSizing: 'border-box' }} />
          </div>
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>
              {t('auditPage.filterUntil')}
            </p>
            <input type="datetime-local" value={filters.until} onChange={e => setFilters(f => ({ ...f, until: e.target.value ? new Date(e.target.value).toISOString() : '' }))}
              className="z-input" style={{ boxSizing: 'border-box' }} />
          </div>
          <button onClick={() => load(0)} disabled={loading} className="z-btn-primary" style={{ width: '100%' }}>
            {t('auditPage.apply')}
          </button>
          <button
            onClick={() => { setFilters({ event: '', home_id: '', ok: '', since: '', until: '' }) }}
            className="z-btn-secondary" style={{ width: '100%' }}
          >
            {t('auditPage.clear')}
          </button>
        </div>

        {/* Main list */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Column headers */}
          <div className="z-eyebrow" style={{
            display: 'grid', gridTemplateColumns: GRID,
            gap: 12, padding: '8px 12px', borderBottom: '0.5px solid var(--line)', flexShrink: 0,
          }}>
            <span>{t('auditPage.colTime')}</span>
            <span />
            <span>{t('auditPage.colEvent')}</span>
            <span>{t('auditPage.colHome')}</span>
            <span>{t('auditPage.colSource')}</span>
          </div>

          {error && (
            <div className="z-alert-warn" style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)', fontSize: 15, color: 'var(--warn-text)' }}>
              {error}
            </div>
          )}

          <div style={{ flex: 1, overflow: 'auto' }}>
            {rows.length === 0 && !loading
              ? <p className="z-body" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-mute)' }}>{t('auditPage.noRows')}</p>
              : rows.map(r => <Row key={r.id} row={r} selected={selected} onSelect={setSelected} />)
            }
          </div>

          {/* Pagination — desktop-only operator rows, so the 36px control size. */}
          <div style={{ padding: '8px 12px', borderTop: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Button variant="secondary" size="sm" onClick={() => load(Math.max(0, offset - PAGE_SIZE))} disabled={loading || offset === 0}>
              <ChevronLeft size={18} strokeWidth={1.75} className="icon-flip-rtl" /> {t('auditPage.prev')}
            </Button>
            <span className="z-mono" style={{ flex: 1, textAlign: 'center', fontSize: 13, color: 'var(--ink-mute)' }}>
              {t('auditPage.rangeLabel', { from: offset + 1, to: offset + rows.length })}
            </span>
            <Button variant="secondary" size="sm" onClick={() => load(offset + PAGE_SIZE)} disabled={loading || !hasMore}>
              {t('auditPage.next')} <ChevronRight size={18} strokeWidth={1.75} className="icon-flip-rtl" />
            </Button>
          </div>
        </div>
      </div>

      <DetailPanel row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
