import { create } from 'zustand'
import { getTasks, createTask, updateTask, deleteTask } from '../lib/api'

export const useTaskStore = create((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  fetch: async () => {
    set({ loading: true, error: null })
    try {
      const res = await getTasks()
      set({ tasks: res.tasks || [], loading: false })
    } catch (e) {
      // Store the whole error so consumers (DataState, describeError) can
      // render a localized string + retryable signal instead of raw text.
      set({ loading: false, error: e })
    }
  },

  add: async (data) => {
    await createTask(data)
    const res = await getTasks()
    set({ tasks: res.tasks || [] })
  },

  update: async (id, data) => {
    if (!id) throw new Error('Task has no ID — restart the backend to backfill IDs')
    const updated = await updateTask(id, data)
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updated } : t)) }))
  },

  remove: async (id) => {
    if (!id) throw new Error('Task has no ID — restart the backend to backfill IDs')
    await deleteTask(id)
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
  },

  setTasks: (tasks) => set({ tasks }),
}))
