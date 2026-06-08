# System Health Failure — Manual Test Plan

Covers the layered failure flow introduced by [services/ha_health.py](../services/ha_health.py)
and surfaced by [SystemHealthBanner.jsx](../frontend/src/components/ui/SystemHealthBanner.jsx).
Run these on the real mini PC against a real HA + Zigbee dongle. Automated
unit coverage lives in [tests/test_ha_health.py](../tests/test_ha_health.py).

For each scenario, capture: (a) the dashboard banner title, (b) the body
copy, (c) which action button(s) appear, and (d) what Settings → Advanced →
System status shows for `Coordinator state` and `Last recovery`.

---

## 1. HA process down

**Setup**
- Stop the HA VM (or kill the HA container).

**Expected — within ~30 s**
- Dashboard banner: **"Smart home system is offline"** (red dot).
- Body: "Ziggy can't reach your smart home hub. Retrying automatically."
- Action: **Retry**.
- Settings → Advanced: `Bridge: Offline`. `Coordinator: state=unknown` (last-known
  cache returned if HA was reachable in the last 30 s, otherwise no row).
- Logs: `[HASubscriber] Connecting (attempt N)…` and
  `ha_subscriber_disconnected` events at `BASIC` level.

**Recover**
- Restart HA. Within ~5–10 s the banner clears once HA's WS handshake
  succeeds (`ha_connected` flips true and the next 20 s `/api/health` poll
  observes it).

---

## 2. HA returns but Zigbee coordinator is wedged

**Setup**
- After step 1, HA is up but the dongle didn't enumerate (the actual
  incident this work was designed for). HA's `/api/config/config_entries`
  reports the ZHA entry with `state="setup_retry"` or `"setup_error"`.

**Expected — within ~30 s of HA coming back**
- Banner: **"Zigbee connection problem"** (red dot, animated pulse while
  recovery is in progress).
- Body: "Ziggy is trying to reconnect the Zigbee hub…"
- Auto-recovery fires once: backend logs `auto_recover_started` and calls
  `homeassistant.reload_config_entry`.
- After 10 s post-verify, HA's entry state should be re-read.
- Settings → Advanced: `Coordinator state=setup_retry` (red), then
  `Last recovery: <seconds> ago · failed` if the reload didn't fix it.

---

## 3. Zigbee reload works (transient blip)

**Setup**
- Force the coordinator into `setup_retry` by briefly disabling the
  integration in HA, or simulate by using a flaky Zigbee link.

**Expected**
- Banner appears, "Zigbee connection problem" with a pulsing dot.
- After ~15 s (10 s verify wait + reload latency), banner clears.
- Settings → Advanced: `Last recovery: just now · success`.
- Logs: `auto_recover_result ok=True` event in the debug bus.

---

## 4. Zigbee reload fails — manual USB replug required

**Setup**
- Physically unplug the Zigbee USB dongle (so HA's reload won't bring it
  back).

**Expected**
- Banner first shows "Zigbee connection problem" (auto-recovery attempted).
- ~15 s later, banner escalates to:
  - Title: **"Manual action needed"**
  - Body: "Ziggy couldn't reconnect the Zigbee hub. Please unplug the Zigbee
    USB dongle from your Ziggy device, wait 5 seconds, plug it back in, then
    tap Retry."
  - Action: **Retry**.
- Settings → Advanced: `Coordinator state=setup_retry`, `Last recovery: failed`.
- Logs: `manual_action="replug_zigbee_dongle"` field on the `auto_recover_result` event.

**Recover**
- Re-plug the dongle, wait ~5 s, tap **Retry** on the banner.
- Backend force-refreshes the coordinator entry; if `state=="loaded"`, the
  banner clears and `Last recovery` flips to `success`.

**Verify auto-recovery does not re-fire**
- Without tapping Retry, leave the dongle unplugged for 6+ minutes. The
  `RECOVERY_COOLDOWN_S` (5 min) elapses but because `manual_action_code` is
  set, auto-recovery is gated off. Logs should show no further
  `auto_recover_started` events.

---

## 5. Only one real device is offline

**Setup**
- Yank the battery on one Zigbee sensor (or just power-cycle one Wi-Fi
  light) while the rest of the home is healthy.

**Expected**
- System banner: **"1 device offline"** (grey/info dot — not red).
- Body: "One device isn't responding. Tap to review."
- Action: **Review** → navigates to `/devices?filter=offline`.
- NO auto-recovery is triggered (this is a per-device issue, not a
  coordinator issue).
- Settings → Advanced: `Coordinator state=loaded` (green).

---

## 6. Many devices offline, user acknowledges

**Setup**
- Power down 5 of 10 Zigbee devices (e.g. you're leaving the house for the
  week and you know they're off).

**Expected**
- Banner: **"5 devices offline"** (amber/warn dot).
- Body: "Several devices stopped responding. Tap to review, or acknowledge
  if you know."
- Actions: **Review** and **It's OK, I know**.
- Tap **It's OK, I know** → banner disappears. `/api/health` still reports
  the 5 offline devices, but `system_health.primary = "ok"`,
  `system_health.ack.active = true`.
- Power down a 6th device → banner re-appears (new device exceeded the
  acked set, ack invalidated).
- Acknowledge again, then power down 3 more (total 8/10 = 80%): banner
  re-escalates to **"Zigbee connection problem"** because share crossed
  `ERROR_OFFLINE_SHARE` (80%).

---

## 7. Auto-recovery disabled

**Setup**
- `ZIGGY_HEALTH_AUTORECOVER=0` in the Ziggy environment. Restart Ziggy.

**Expected**
- Coordinator failure → banner shows "Zigbee connection problem" but NO
  reload is auto-triggered.
- Settings → Advanced shows:
  `Auto-recovery disabled (ZIGGY_HEALTH_AUTORECOVER=0)`.
- Tapping **Retry** still works (the user-explicit recover endpoint is
  always available — see [services/ha_health.py:trigger_recover_now](../services/ha_health.py)).

---

## What to grep when something is wrong

- `[Health]` prefix in `logs/ziggy.log` — every state transition this module
  logs (`auto-recover started`, `auto-recover OK`, `auto-recover FAILED`).
- Debug bus channel `health` at `BASIC` level — structured events for the
  same transitions, with `entry_id`, `latency_ms`, `manual_action`.
- HA's own log under `homeassistant.config_entries` — the integration's view
  of why it can't load.
