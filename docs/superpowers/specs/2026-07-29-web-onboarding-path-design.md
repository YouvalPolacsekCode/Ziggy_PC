# Web / PWA Onboarding Path — Design

**Date:** 2026-07-29
**Branch:** `feat/unified-bundle-wizards` (fleet baseline `ef151ef` / `main` @ `8a633de`)
**Status:** Approved design — ready for implementation plan

## Problem

Onboarding is native-only. A fresh, owner-less home opened in a **browser or PWA**
lands on the bare `LoginPage` "setup door" (creates an owner, then drops the user on
an empty dashboard) instead of the guided wizard native users get (create owner →
name sensors → starter automations → land on dashboard). This affects every
non-native beta user, including David.

Root cause: `frontend/src/App.jsx` `UnauthenticatedGate` (~line 185) hard-codes
`decision = 'login'` whenever `isNative()` is false. Only the native branch checks
"does this home have an owner yet?" and, if not, renders the rich `MobileOnboarding`
wizard.

## What is already web-safe (no work needed)

- `frontend/src/lib/native.js` `storage` already falls back to `localStorage` when
  Capacitor `Preferences` is absent (web). The handoff's "swap Preferences →
  localStorage" is already done for free.
- `getDeviceInfo()` falls back to `navigator.userAgent`; `requestNotificationPermission()`
  falls back to the Web Notifications API.
- Every onboarding step except QR-scan, background GPS, and motion is a plain
  relative `fetch()`.

## The real constraint (why this isn't a frontend-only fix)

The native first-run path (`POST /api/mobile/pair` claim-tier → `POST
/api/onboarding/claim`) is deliberately **LAN-only** (`require_lan`, at
`backend/routers/mobile_router.py:282` and `backend/routers/onboarding_sensors_router.py:195`),
and `/api/mobile/pair`'s `DeviceInfo.platform` field rejects `"web"`. That gate
exists so nobody can seize `super_admin` on a fresh box **over the Cloudflare
tunnel**. But web onboarding *is* over the tunnel (`https://<home>.ziggy-home.com`).
So the native claim path cannot be reused on web without weakening that gate.

## Chosen approach — reuse `/api/auth/setup` (Spine B)

Decision (approved): create the owner via the **existing, already-tunnel-safe**
`/api/auth/setup` (`backend/routers/auth_router.py:154`) — no device token, no LAN
gate, guarded only by "no owner exists yet." It returns a real `super_admin` session
token. The wizard's later steps (name sensors, starter automations) are extended to
accept that **session token** instead of a device token.

- **No change to the LAN-only device-claim security gate.** The native pair/claim
  path is untouched — still LAN-only, still possession-gated by the box pair code.
- **No new attack surface**: an authenticated owner writing their own home's device
  names + automations is exactly what the rest of the app already permits.
- Pair code stays **native-only**. On web the "possession proof" is whoever first
  reaches the private per-home URL — the same model browsers already use today via
  the LoginPage setup door.

Rejected alternatives:
- *Mirror native (require pair code on web):* would force relaxing `require_lan` on
  the ownership-grant path + loosening the platform regex — widens the ownership
  attack surface. Rejected on security.
- *Hybrid (setup + optional code possession check):* more work for a possession
  factor we judged unnecessary for the beta. Rejected on YAGNI.

## Web wizard step sequence

```
WebSetupStep  → SensorsStep → StarterStep → NotifyStep → WebLocationStep → DoneStep
(create owner)  (name kit     (starter      (browser      (one-time home    (complete +
                 sensors)      automations)   notif perm)   coords)           → dashboard)
```

No PAIR step, no device-token CLAIM, no MOTION step, no background geofencing.

- **WebSetupStep** — username + password → `POST /api/auth/setup` → store returned
  token as `ziggy_token` via `authStore.setToken(token, 'super_admin')`. UI mirrors
  the native `ClaimStep`. On `409` (already configured) → route to `LoginPage`.
- **SensorsStep / StarterStep / NotifyStep / DoneStep** — reused verbatim from the
  native flow (see Component structure).
- **WebLocationStep** — one-time foreground `navigator.geolocation.getCurrentPosition()`
  (works because the tunnel is a secure context) → `POST /api/onboarding/home-location`
  so HA sun/sunrise-sunset/weather are accurate. Copy explains that **automatic
  arrive/leave presence needs the native app**. Fully skippable.

## Component structure (additive; native flow unchanged)

The native step components are already dumb and standalone. Extract the
platform-agnostic ones into a shared module; both entries import them.

- **New** `frontend/src/pages/onboarding/steps.jsx` — move `SensorsStep`,
  `StarterStep`, `NotifyStep`, `DoneStep`, `PermissionScreen`, shared button/input
  styles, and `persistOnboardingPrefs` here (mechanical move — no behavior change).
- **`frontend/src/pages/MobileOnboarding.jsx`** — imports the shared steps. Native
  routing/behavior **identical** to today.
- **New** `frontend/src/pages/WebOnboarding.jsx` — imports the shared steps + adds
  `WebSetupStep` and `WebLocationStep`, composes the web sequence above.

## The auth seam (the one substantive change)

Native steps send the device token (`ziggy_device_token`); web has only the session
token (`ziggy_token`). Bridge it explicitly on both ends:

- **Frontend** — `frontend/src/lib/mobileApi.js`: give `getOnboardingSensors`,
  `confirmSensors`, `getStarterPack`, `setHomeLocation`, `completeOnboarding` an
  explicit optional bearer-token argument. Native passes the device token (default,
  unchanged); web passes the session token. `installAutomation` already takes an
  explicit `userToken`.
- **Backend** — add a shared dependency (e.g. `get_onboarding_principal`) used by
  `/api/onboarding/sensors`, `/sensors/confirm`, `/starter-pack`, `/home-location`,
  `/complete`. It resolves **either** a valid device token **or** a `super_admin`
  session token. `require_lan` is **dropped only in the session-token branch**; the
  device-token branch keeps every existing check (LAN gate, `claim_pending`,
  `user_id`-bound). `/api/onboarding/claim` and `/api/mobile/pair` are **not touched**.

## Secure context & i18n

- Onboarding runs over HTTPS (tunnel) = secure context, so `crypto.*` works. Use the
  existing `safeUuid()` helper for any client-generated id defensively (LAN-safe).
- RTL/Hebrew is already handled by the shared steps via `useT()`.

## Testing

- **Unit (frontend):** web step routing/branching; onboarding API token argument;
  `WebSetupStep` setup→session-token handoff (incl. `409` → login redirect).
- **Backend:** `get_onboarding_principal` accepts a `super_admin` session token and a
  device token; rejects unauth (`401`); device-claim path still `403`s over tunnel;
  session-token branch bypasses `require_lan` while the device branch does not.
- **Integration:** against a **fresh-DB container** (empty `auth.db`) — `/api/auth/status`
  reports `configured:false`, full web sequence runs to dashboard.

## Validation gate (Youval's rule: nothing is "done" until tested on real hardware)

David and Canary are both already claimed, so true fresh-owner-less E2E needs an
**unclaimed box**. A **new hub is being built soon** — the on-hardware end-to-end
validation (open `https://<newhome>.ziggy-home.com` in a browser on a fresh box →
complete onboarding → dashboard) runs on that build. Until then, validation is the
fresh-DB container above.

## Deploy

Per `docs/RUNBOOK_HUB_REMOTE_OPS.md`: commit on `feat/unified-bundle-wizards`,
fast-forward the hub branches, rebuild (git pull + `docker compose up -d --build
ziggy`, `export GIT_SHA` first). Frontend is a local git checkout build, not a baked
image, so the fix ships by pull+rebuild.

## Out of scope

- Background presence/geofencing on web (native-only; deferred, offered later in-app).
- Any change to the native pair/claim security model.
- Multi-home routing on web (home is identified by the tunnel hostname; `home_id` is
  still `None` in the pair response — Phase 2).
