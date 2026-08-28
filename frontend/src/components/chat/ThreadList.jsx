import { useChatStore } from '../../stores/chatStore'

/**
 * Conversation switcher — lists durable threads (newest first), shows which are
 * running in the background, and lets the user start a new one or return to any.
 * Drop into AIChat alongside the useChatThreads() hook:
 *   <ThreadList onNew={threads.newThread} onSwitch={threads.switchThread} />
 */
export default function ThreadList({ onNew, onSwitch }) {
  const threads = useChatStore((s) => s.threads)
  const activeId = useChatStore((s) => s.threadId)

  return (
    <div className="ziggy-threadlist" dir="rtl">
      <button type="button" className="ziggy-thread-new" onClick={onNew}>
        + שיחה חדשה
      </button>
      <ul className="ziggy-thread-items">
        {(threads || []).map((t) => (
          <li
            key={t.thread_id}
            className={`ziggy-thread-item${t.thread_id === activeId ? ' active' : ''}`}
            onClick={() => onSwitch?.(t.thread_id)}
          >
            <span className="ziggy-thread-title">{t.title || 'שיחה'}</span>
            {t.status === 'running' && (
              <span className="ziggy-thread-running" title="עובד ברקע">•••</span>
            )}
            {t.preview && <span className="ziggy-thread-preview">{t.preview}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
