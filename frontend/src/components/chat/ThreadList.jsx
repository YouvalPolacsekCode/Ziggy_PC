import { useChatStore } from '../../stores/chatStore'
import { useT } from '../../lib/i18n'
import { formatTime } from '../../lib/utils'

/**
 * Conversation switcher — lists durable threads (newest first), shows which are
 * running in the background, and lets the user start a new one or return to any.
 * Drop into AIChat alongside the useChatThreads() hook:
 *   <ThreadList onNew={threads.newThread} onSwitch={threads.switchThread} />
 *
 * Each row is a real button (keyboard + screen reader), 56px tall: the title
 * as the name of the thing (17/600), one secondary line (the preview, 15
 * ink-mute) and the time as 13px metadata. The active row is the "active
 * filter" treatment — surface-2 fill and a hairline, never inverted.
 */
export default function ThreadList({ onSwitch }) {
  const t = useT()
  const threads = useChatStore((s) => s.threads)
  const activeId = useChatStore((s) => s.threadId)

  return (
    <div className="ziggy-threadlist">
      <ul className="ziggy-thread-items" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(threads || []).map((th) => {
          const active = th.thread_id === activeId
          const when = th.updated_at ? formatTime(th.updated_at) : ''
          return (
            <li key={th.thread_id} className={`ziggy-thread-item${active ? ' active' : ''}`}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onSwitch?.(th.thread_id)}
                style={{
                  width: '100%', minHeight: 56, boxSizing: 'border-box',
                  display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 2,
                  padding: '8px 12px', borderRadius: 'var(--r-ctl)',
                  background: active ? 'var(--surface-2)' : 'transparent',
                  border: `0.5px solid ${active ? 'var(--line)' : 'transparent'}`,
                  color: 'var(--ink)', font: 'inherit', textAlign: 'start', cursor: 'pointer',
                  transition: 'background var(--dur-press) var(--ease-standard)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span
                    className="ziggy-thread-title"
                    dir="auto"
                    style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 600, lineHeight: '22px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {th.title || t('nav.ziggy')}
                  </span>
                  {th.status === 'running' && (
                    <span
                      className="ziggy-thread-running z-dot z-dot-ok"
                      role="img"
                      aria-label={t('chat.thinking')}
                      title={t('chat.thinking')}
                      style={{ flexShrink: 0 }}
                    />
                  )}
                  {when && (
                    <span className="z-footnote" style={{ flexShrink: 0, color: 'var(--ink-faint)', fontVariantNumeric: 'tabular-nums' }} dir="ltr">
                      {when}
                    </span>
                  )}
                </span>
                {th.preview && (
                  <span
                    className="ziggy-thread-preview z-subhead"
                    dir="auto"
                    style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {th.preview}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
