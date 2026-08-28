/**
 * Apply a pushed thread title to the loaded thread list.
 *
 * Returns the SAME array reference when nothing changes (unknown thread, empty
 * title) so a stray push can't churn the drawer's render.
 */
export function applyThreadTitle(threads, threadId, title) {
  const list = threads || []
  if (!threadId || !title) return threads || []
  if (!list.some((t) => t.thread_id === threadId)) return threads || []
  return list.map((t) => (t.thread_id === threadId ? { ...t, title } : t))
}
