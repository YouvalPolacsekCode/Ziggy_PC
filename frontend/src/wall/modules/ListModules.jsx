// Shopping list + agenda — the two hub-owned modules.
//
// Both are live: every mutation broadcasts `list_changed` / `agenda_changed`
// from the hub, and the wall re-reads on that signal. That is what makes two
// tablets and two phones agree without anyone refreshing anything.
//
// Both are optimistic: ticking a checkbox paints immediately and rolls back if
// the write fails. A shared family list where a tick takes 400ms to appear
// feels broken, and a tick that silently didn't save is worse.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getLists, addListItem, updateListItem, deleteListItem, clearListDone,
  getAgenda, createAgendaEvent, updateAgendaEvent, deleteAgendaEvent,
} from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useWsMessages } from '../../hooks/useWebSocket'

// ─── shared: re-fetch when the hub says something changed ───────────────────

/**
 * Subscribe to a WS message type and re-run `load` when one arrives.
 *
 * Uses the app's existing message buffer + monotonic sequence so a burst
 * (three people adding items at once) triggers one reload, not three, and no
 * message is missed between renders.
 */
function useLiveReload(types, load) {
  const messages = useWsMessages()
  const lastSeq = useRef(0)

  useEffect(() => {
    let hit = false
    for (const m of messages) {
      if (m?._seq != null && m._seq <= lastSeq.current) continue
      if (m?._seq != null) lastSeq.current = Math.max(lastSeq.current, m._seq)
      if (types.includes(m?.type)) hit = true
    }
    if (hit) load()
  }, [messages, load])   // eslint-disable-line react-hooks/exhaustive-deps
}

// ─── Shopping ───────────────────────────────────────────────────────────────

export const ShoppingModule = memo(function ShoppingModule({ mod, ctx }) {
  const t = useT()
  const listId = mod.config?.list_id || 'default'
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await getLists()
      const list = (res?.lists || []).find((l) => l.id === listId) || (res?.lists || [])[0]
      setItems(list?.items || [])
    } catch { /* keep last-good rather than blanking the wall */ }
  }, [listId])

  useEffect(() => { load() }, [load])
  useLiveReload(['list_changed'], load)

  const toggle = useCallback(async (item) => {
    const next = !item.done
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, done: next } : i)))
    try {
      await updateListItem(listId, item.id, { done: next })
    } catch (e) {
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, done: !next } : i)))
      ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err')
    }
  }, [listId, ctx, t])

  const add = useCallback(async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setDraft('')
    // Temporary row so the item appears under the finger instantly; the
    // reload from the broadcast replaces it with the real record.
    const temp = { id: `tmp_${Date.now()}`, text, done: false, _temp: true }
    setItems((cur) => [...cur, temp])
    try {
      await addListItem(listId, text)
    } catch (e) {
      setItems((cur) => cur.filter((i) => i.id !== temp.id))
      ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err')
    } finally { setBusy(false) }
  }, [draft, busy, listId, ctx, t])

  const remove = useCallback(async (item) => {
    const before = items
    setItems((cur) => cur.filter((i) => i.id !== item.id))
    try { await deleteListItem(listId, item.id) }
    catch { setItems(before) }
  }, [items, listId])

  const doneCount = items.filter((i) => i.done).length

  return (
    <>
      <div className="zw-card-head">
        <span className="zw-eyebrow">{t('wall.mod.shopping')}</span>
        {doneCount > 0 && (
          <button
            className="zw-eyebrow"
            style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)' }}
            onClick={() => clearListDone(listId).catch(() => {})}
          >{t('wall.shop.clearDone')}</button>
        )}
      </div>
      <div className="zw-card">
        <div className="zw-card-body" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          {items.length === 0 && <div className="zw-empty">{t('wall.shop.empty')}</div>}
          {items.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <button
                onClick={() => toggle(item)}
                aria-pressed={item.done}
                style={{
                  width: 22, height: 22, borderRadius: 7, flex: 'none', cursor: 'pointer',
                  boxSizing: 'border-box', display: 'grid', placeItems: 'center',
                  border: item.done ? 'none' : '2px solid var(--line-2)',
                  background: item.done ? 'var(--ok)' : 'transparent',
                  color: '#fff', fontSize: 12, fontWeight: 700, padding: 0,
                }}
              >{item.done ? '✓' : ''}</button>
              <span
                onClick={() => toggle(item)}
                style={{
                  flex: 1, minWidth: 0, cursor: 'pointer',
                  fontSize: 'clamp(13px,1.1vw,15px)', fontWeight: 500,
                  color: item.done ? 'var(--ink-faint)' : 'var(--ink)',
                  textDecoration: item.done ? 'line-through' : 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  opacity: item._temp ? 0.55 : 1,
                }}
              >{item.text}</span>
              <button
                onClick={() => remove(item)}
                aria-label={t('common.remove')}
                style={{ background: 'none', border: 'none', color: 'var(--ink-ghost)', cursor: 'pointer', fontSize: 15, padding: '0 4px' }}
              >✕</button>
            </div>
          ))}
        </div>
        <div className="zw-card-foot">
          <input
            className="zw-input"
            value={draft}
            placeholder={t('wall.shop.add')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            onBlur={add}
          />
        </div>
      </div>
    </>
  )
})

// ─── Agenda ─────────────────────────────────────────────────────────────────

export const AgendaModule = memo(function AgendaModule({ mod, ctx }) {
  const t = useT()
  const days = mod.config?.days ?? 2
  const [events, setEvents] = useState([])
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await getAgenda(days)
      setEvents(res?.events || [])
    } catch { /* keep last-good */ }
  }, [days])

  useEffect(() => { load() }, [load])
  useLiveReload(['agenda_changed'], load)

  const add = useCallback(async () => {
    const raw = draft.trim()
    if (!raw) return
    setDraft('')
    // "19:30 dinner" → time + title. A wall keyboard makes structured entry
    // painful, so we accept the way people actually type.
    const m = raw.match(/^(\d{1,2}[:.]\d{2})\s+(.*)$/)
    const time = m ? m[1].replace('.', ':') : null
    const title = m ? m[2] : raw
    try {
      await createAgendaEvent({ title, time })
      load()
    } catch (e) { ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err') }
  }, [draft, load, ctx, t])

  const toggle = useCallback(async (ev) => {
    const next = !ev.done
    setEvents((cur) => cur.map((e) => (e.id === ev.id ? { ...e, done: next } : e)))
    try { await updateAgendaEvent(ev.id, { done: next }) }
    catch { setEvents((cur) => cur.map((e) => (e.id === ev.id ? { ...e, done: !next } : e))) }
  }, [])

  const rows = useMemo(() => events.map((e) => ({
    ...e,
    label: e.day_offset > 0 ? `${t('wall.agenda.tomorrow')} ${e.time || ''}`.trim() : (e.time || '—'),
  })), [events, t])

  return (
    <>
      <div className="zw-card-head">
        <span className="zw-eyebrow">{t('wall.mod.agenda')}</span>
      </div>
      <div className="zw-card">
        <div className="zw-card-body">
          {rows.length === 0 && <div className="zw-empty">{t('wall.agenda.empty')}</div>}
          {rows.map((e) => (
            <div
              key={e.id}
              onClick={() => toggle(e)}
              style={{
                display: 'flex', gap: 13, alignItems: 'center', cursor: 'pointer',
                padding: '11px 16px', borderBottom: '0.5px solid var(--line)',
                opacity: e.done ? 0.45 : 1,
              }}
            >
              <span style={{
                fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                fontSize: 12.5, fontWeight: 600, minWidth: 54, flex: 'none',
                color: e.day_offset > 0 ? 'var(--ink-ghost)' : 'var(--accent)',
              }}>{e.label}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 700, fontSize: 'clamp(12.5px,1.1vw,14.5px)',
                  textDecoration: e.done ? 'line-through' : 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{e.title}</div>
                {e.note && <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{e.note}</div>}
              </div>
              <button
                onClick={(ev) => { ev.stopPropagation(); deleteAgendaEvent(e.id).then(load).catch(() => {}) }}
                aria-label={t('common.remove')}
                style={{ background: 'none', border: 'none', color: 'var(--ink-ghost)', cursor: 'pointer', fontSize: 14 }}
              >✕</button>
            </div>
          ))}
        </div>
        <div className="zw-card-foot">
          <input
            className="zw-input"
            value={draft}
            placeholder={t('wall.agenda.add')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            onBlur={add}
          />
        </div>
      </div>
    </>
  )
})
