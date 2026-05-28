// MobilePresenceBridge — Capacitor-only side effect that listens to the
// ziggy-presence native events (geofence, activity, location) and forwards
// each to the backend via the mobile webhook.
//
// This component renders nothing. It mounts a set of `addListener` handles
// on the ZiggyPresence plugin and tears them down on unmount. Mounted from
// App.jsx so the listeners attach as soon as the native shell finishes
// loading, regardless of whether the user is currently on the onboarding
// screen.
//
// Wire path:
//   ZiggyPresence.geofence → mobileApi.sendLocation({source:'geofence', ...})
//   ZiggyPresence.activity → mobileApi.sendLocation({source:'activity', activity, confidence})
//   ZiggyPresence.location → mobileApi.sendLocation({source:'background'|'gps', lat, lon, accuracy_m})
//
// Backend reads the `source` field on /api/mobile/webhook to decide which
// presence-engine path to invoke (see services/mobile_app.py:_handle_location).

import { useEffect } from 'react'
import { isNative, plugin } from './native'
import { getDeviceToken, sendLocation } from './mobileApi'

export default function MobilePresenceBridge() {
  useEffect(() => {
    if (!isNative()) return
    const Pres = plugin('ZiggyPresence')
    if (!Pres) return  // older bundle without the plugin — no-op

    let handles = []
    let cancelled = false

    const post = async (payload) => {
      // Skip silently if the device hasn't paired yet (no auth token).
      // The plugin's events will be re-delivered the next time they fire.
      try {
        const tok = await getDeviceToken()
        if (!tok) return
        await sendLocation(payload)
      } catch {
        // Webhook failures are non-fatal; the engine has its own dwell +
        // cooldown so a single dropped event won't cause user-visible drift.
      }
    }

    ;(async () => {
      try {
        const geoH = await Pres.addListener('geofence', (ev) => {
          // The mobile_app webhook router currently treats `zone_id` defaulting
          // to 'home', which after the 1c-9 change reads any id directly.
          post({
            source:     'geofence',
            transition: ev?.transition,
            zone_id:    ev?.id,
            lat:        ev?.lat,
            lon:        ev?.lon,
            accuracy_m: ev?.accuracy_m,
            ts:         ev?.ts,
            reason:     ev?.reason,
          })
        })
        const actH = await Pres.addListener('activity', (ev) => {
          post({
            source:     'activity',
            activity:   ev?.activity,
            confidence: ev?.confidence,
            ts:         ev?.ts,
          })
        })
        const locH = await Pres.addListener('location', (ev) => {
          post({
            source:     ev?.background ? 'significant_change' : 'gps',
            lat:        ev?.lat,
            lon:        ev?.lon,
            accuracy_m: ev?.accuracy_m,
            altitude_m: ev?.altitude_m,
            speed_mps:  ev?.speed_mps,
            heading_deg: ev?.heading_deg,
            background: !!ev?.background,
            ts:         ev?.ts,
          })
        })
        if (cancelled) {
          ;[geoH, actH, locH].forEach(h => { try { h?.remove?.() } catch {} })
          return
        }
        handles = [geoH, actH, locH]
      } catch {
        // Plugin not present or listeners failed — nothing to clean up.
      }
    })()

    return () => {
      cancelled = true
      handles.forEach(h => { try { h?.remove?.() } catch {} })
      handles = []
    }
  }, [])

  return null
}
