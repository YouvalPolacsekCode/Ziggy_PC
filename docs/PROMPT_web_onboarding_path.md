# New-session prompt — Web onboarding path

Copy everything below the line into a fresh Claude Code session in the `ziggy_pc` repo.

---

Build a **web/PWA onboarding path** for Ziggy. Right now onboarding is **native-only**, so every iPhone/PWA/browser beta user silently misses the guided setup — this affects every non-native user, including David.

**Start by reading memory** (auto-loaded) and these specifically: `project_fleet_baseline_alignment`, `project_secure_context_http_lan`, `project_mobile_architecture`, `reference_home_access`, `feedback_ziggy_product_surface`, `feedback_narrow_scope_additive_changes`. Then **use the brainstorming skill before writing any code** — this is new functionality on a working flow, so nail the design + get Youval's input first.

**Root cause (confirmed):** `frontend/src/components/automations/... ` no — it's in `frontend/src/App.jsx`, `UnauthenticatedGate` (~line 185): when `isNative()` is false, `decision` is hard-coded to `'login'`, so browser/PWA users **always** get `<LoginPage />` and never the guided wizard. Only the native app checks "does this home have an owner yet?" and, if not, shows the rich `MobileOnboarding` (pair → claim → sensors → starter). A fresh owner-less home opened in a browser lands on the bare LoginPage "setup door" instead.

**Why it's not a one-liner:** `frontend/src/pages/MobileOnboarding.jsx` (~1045 lines) is **deeply native-coupled** — QR scan via `@capacitor/barcode-scanner`, background geolocation via the `ziggy-presence` plugin + `@capacitor/geolocation`, state in Capacitor `Preferences`, and it **bails to `/` if `!isNative()`** (~line 92). It cannot just be shown on web.

**Design targets for the web path:**
- Replace QR scan with **manual pairing-code entry** (there's already a 6-char code path in the native scanner — reuse it).
- **Skip or defer the presence/geofence step** on web (background GPS isn't available in a PWA); offer it later as an in-app setting.
- Use **`localStorage`** instead of Capacitor `Preferences` for web state.
- **Additive** — do NOT regress the native onboarding. Ideally factor the shared step-flow so native + web share logic and differ only at the platform-specific edges (scanner vs manual code, GPS vs skip, Preferences vs localStorage).

**Context that matters:** the fleet baseline is `ef151ef`; both homes reach the hub via a **friendly HTTPS tunnel URL** (e.g. `https://david.ziggy-home.com`) under the **always-tunnel** model. Onboarding therefore happens in the browser over **HTTPS = a secure context**, so `crypto.randomUUID` etc. work there — but be aware LAN `http://<ip>` is a NON-secure context where they throw (see `project_secure_context_http_lan`; use the existing `safeUuid()` helper pattern if you need ids).

**Deliverable:** a working web onboarding flow a PWA user on a fresh, owner-less home is routed into (pair via code → claim owner → basic device/room setup → land on dashboard), tested end-to-end. Deploy + validate per `docs/RUNBOOK_HUB_REMOTE_OPS.md` (git pull + rebuild on the hub; nothing is "done" until tested on real hardware — Youval's rule). Commit on `feat/unified-bundle-wizards`, fast-forward the hub branches, rebuild both homes.
