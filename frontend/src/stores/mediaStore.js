// Media / music store (v2). Used by:
//   - Settings → Music page (speakers + profiles)
//   - Tablet hub widget (state + transport)
//
// Lazy: nothing fetches until ensureLoaded() is called by a mounted gated
// component. When media_music is off, components don't mount, so this store
// stays inert and never hits the backend.
import { create } from 'zustand'
import {
  getMediaCapabilities,
  listSpeakers,
  listMusicProfiles,
  getMediaState,
} from '../lib/api'

export const useMediaStore = create((set, get) => ({
  enabled:      false,
  loaded:       false,
  loading:      false,
  capabilities: null,        // { enabled, spotify_app_configured, ytmusic_app_configured }
  speakers:     [],          // [{entity_id, display_name, class, capabilities, enabled, state, room}, ...]
  profiles:     [],          // [{name, services: {spotify, ytmusic}, ...}]
  items:        [],          // hub-widget live state per enabled speaker
  error:        null,

  ensureLoaded: async () => {
    if (get().loading || get().loaded) return
    await get()._fetchAll()
  },

  reload: async () => { await get()._fetchAll() },

  _fetchAll: async () => {
    set({ loading: true, error: null })
    try {
      const caps = await getMediaCapabilities()
      if (!caps?.enabled) {
        set({ enabled: false, capabilities: caps, loaded: true, loading: false })
        return
      }
      const [speakersResp, profilesResp, stateResp] = await Promise.all([
        listSpeakers().catch(() => ({ speakers: [] })),
        listMusicProfiles().catch(() => ({ profiles: [] })),
        getMediaState().catch(() => ({ items: [] })),
      ])
      set({
        enabled:      true,
        capabilities: caps,
        speakers:     speakersResp?.speakers || [],
        profiles:     profilesResp?.profiles || [],
        items:        stateResp?.items || [],
        loaded:       true,
        loading:      false,
      })
    } catch (e) {
      const reason = e?.code === 'http_404' ? 'feature_disabled' : (e?.message || 'unknown')
      set({ enabled: false, loaded: true, loading: false, error: reason })
    }
  },

  refreshState: async () => {
    if (!get().enabled) return
    try {
      const resp = await getMediaState()
      set({ items: resp?.items || [] })
    } catch { /* keep last-known */ }
  },

  // Patch one item from a HA state_changed event without a full refetch.
  mergeFromWs: (msg) => {
    if (!get().enabled) return
    const entId = msg?.entity_id
    if (!entId || !entId.startsWith('media_player.')) return
    const ns = msg?.new_state || {}
    const attrs = msg?.attributes || ns.attributes || {}
    set((s) => ({
      items: s.items.map(it => it.entity_id !== entId ? it : {
        ...it,
        state:  ns.state ?? it.state,
        title:  attrs.media_title ?? it.title,
        artist: attrs.media_artist ?? it.artist,
        album:  attrs.media_album_name ?? it.album,
        art:    attrs.entity_picture ?? it.art,
        volume: attrs.volume_level ?? it.volume,
        muted:  attrs.is_volume_muted ?? it.muted,
      }),
    }))
  },
}))

export const useMediaEnabled = () => useMediaStore(s => s.enabled)
