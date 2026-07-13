# Ziggy — Hebrew Style Guide

The goal: Ziggy's Hebrew reads and sounds like a **real, warm, native Israeli** — never translated, textbook, or robotic. Every string in `he.js` (and Ziggy's spoken replies in the backend) follows the rules below. When adding or editing Hebrew, match these.

## 1. Register & gender — "neutral by construction"

We never gender the user, and we never use slash forms (`בחר/י`). We neutralize by *how we phrase*, not by adding `/ה`.

| Surface | Rule | Example |
|---|---|---|
| **Buttons / single-word action labels** | Noun / gerund (שם-פעולה) | `שמירה`, `מחיקה`, `הוספה`, `עריכה`, `כיבוי`, `הדלקה`, `הפעלה`, `סגירה`, `יציאה` — **not** `שמור`, `מחק`, `הוסף` |
| **Instructions / body sentences** | Impersonal / infinitive | `אפשר לבחור חדר`, `יש ללחוץ על +`, `כדי להוסיף…` — **not** `אתה צריך ללחוץ`, `בחר` |
| **Ziggy about himself** | Masculine, 1st person | `בדקתי`, `כיביתי את האור`, `עדיין לא יודע` — זיגי is a named male persona; keep this consistent |
| **Free-form chat (LLM)** | Match the user's gender if known, else neutral | handled by the persona prompt in `chat_handler.py` |

Rationale: nouns aren't gendered, so noun-buttons fix register **and** inclusivity in one move. This is the Apple/Google Hebrew localization convention.

## 2. Brand name

- **`זיגי`** in all Hebrew prose. (`זיגי מצא 3 מכשירים`, `אפשר לבקש מזיגי`.)
- Latin **`Ziggy Home`** only as the literal app/product name a user taps or installs.
- Never `Ziggy` as a sentence subject inside Hebrew, never `ל-Ziggy`.

## 3. The hub is just "זיגי"

The user never learns there's a separate "hub / coordinator / bridge" box. To the user it **is** Ziggy.
- `זיגי לא מחובר כרגע` — not `המרכזייה לא מקוונת`
- `הוסר מזיגי` — not `הוסר מהמרכזייה / מהיחידה`
- Retire from user copy: `מרכזייה`, `רכז`, `קונטרולר`, `מרכזת`, `גשר`, `מתאם`.
- On **advanced/operator** setup screens, technical terms (`בקר`, `Zigbee`) are allowed.

## 4. Typography

- **Maqaf, not hyphen.** A Hebrew prefix glued to a Latin word/number uses the Hebrew maqaf `־`, not ASCII `-`: `ל־22`, `ה־QR`, `ב־{ip}`. Attached vav to a variable drops the connector: `ו{b}`, not `ו-{b}`. Write `על ידי` (space), not `על-ידי`.
- **Gershayim for quotes:** `״…״` — never ASCII `"…"` or German `„…"`. Geresh `׳`/gershayim `״` are reserved for abbreviations/acronyms, not doubled as quotes in the same span.
- **Spelling:** `הכל` (house style — the common modern form).

## 5. Terminology (one word per concept)

| Concept | Use | Retire |
|---|---|---|
| AC / climate | `מזגן` / `מיזוג` | `אקלים` |
| shutter/cover | `תריס` | `וילון` (for the same entity) |
| feature | `תכונה` | `פיצ׳ר` |
| anomaly | `חריגות` | `אנומליות` |
| optional | `לא חובה` | `אופציונלי`, `אופציונליים` |
| email | `אימייל` | `מייל` |
| mobile | `נייד` | `סלולרי`, `נייטיב` |
| trigger | `מתי` (label) / `כש…` | `טריגר` |
| run(s) | `הפעלה` | `ריצה` |
| routine / automation | lead with `שגרה` in prose | — |
| AI | `בינה מלאכותית` (or drop from taglines) | raw `AI` |
| coordinator (operator screens only) | `בקר` | `קונטרולר`, `מתאם` |

The automation triad **`מתי… / אם… / אז…`** is the native model — use it.

**Snooze vs. reject must not collide** (both were `נדחה`): snooze → `נדחה למועד אחר` (status) / `דחייה למועד אחר` (action); reject → `דחייה` / `נדחתה` / `הוסרה`.

## 6. Never leak engine/technical terms to end users

Forbidden in user-facing copy: `entity`/`ישויות`, `Home Assistant`/`HA`, `Zigbee coordinator`, `בלאסטר`/`Broadlink`/raw `IR` (use `משדר אינפרא`), `טוקן` (use `קוד גישה`), `GPS` (use `מיקום`), `push` (use `התראות`), `טריגר`, config file paths (`settings.yaml`, `secrets.yaml`, `api_key` → "פנו למנהל המערכת"), `קנבס`, `צ׳יפ`, `היסטרזה`/`ג׳יטר`. English product names (e.g. "Night Watch" → `שמירת לילה`).

Operator/admin surfaces (behind the admin console — `debug`, `haUpdate`, `otaPage`, `auditPage`, `cloudAdmin`, `fleetHealth`, `mobileDiag`, `adminSettings` engine, `systemStatus`) **may** keep technical terms.

## 7. Israeli conventions

24-hour clock (`20:00`, not `8 בערב`), Celsius (`°C`), shekel (`₪`), dates `DD/MM/YYYY`. Wrap inline numbers/prices in bidi isolation so RTL punctuation doesn't reorder.

## 8. Dugri, not stiff

Warm, short, direct, at eye level. Drop softeners (`נשמח אם תוכלו`, `אנא`, `ברצוני`, `הנך`). Lead with the point. Still polite (`תודה`), just never padded. `לא מצליחים להתחבר לזיגי. הוא דלוק?` beats `לא ניתן להגיע לזיגי. האם הוא פועל?`.

---
*Keep `he.js` free of duplicate keys. When in doubt, read a few neighboring strings and match their voice.*
