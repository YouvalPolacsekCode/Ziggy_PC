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
      set({ loading: false, error: e.message })
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
