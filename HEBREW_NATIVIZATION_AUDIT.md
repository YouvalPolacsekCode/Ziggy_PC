# Ziggy — Hebrew Nativization Audit

**Goal:** make Ziggy's Hebrew read/sound like a real, warm, native Israeli — not translated, textbook, or robotic.
**Scope audited:** `frontend/src/lib/i18n/he.js` (3,778 keys), `devices.js`, `domainRegistry.js`, and the backend spoken layer (`response_templates.py`, `chat_handler.py`, `automation_catalog.py`, `automation_templates.py`, `orchestra_designer.py`, blueprints, starter automations).
**Method:** 6 parallel native-speaker audit passes + structural/grep analysis. Done in an isolated worktree; nothing merged or deployed.

The current Hebrew is **decent** — better than most localized products. The problems are *systemic consistency* issues, a handful of real *bugs*, and *jargon leaks*. Fixing them is high-leverage and mostly mechanical once we lock the style decisions.

---

## A. Six systemic problems (quantified)

### 1. Register is split down the middle — imperative vs. noun/gerund
- **367** action labels use masculine-imperative (`הוסף`, `הפעל`, `בחר`, `שמור`, `כבה`, `הדלק`…)
- **281** labels use noun/gerund (`הוספה`, `שמירה`, `כיבוי`, `עריכה`…)

The same screens can't decide. Example collisions:
- `common.save: 'שמירה'` sits right above `common.close: 'סגור'`
- `settings.edit: 'עריכה'` vs `settings.lanEdit: 'ערוך'` (same action)
- `routines.create` exists twice: `'יצירת שגרה'` and `'צור שגרה'`

**All three UI agents independently recommended the same fix: standardize buttons/labels to the noun/gerund style** (`שמירה`, `מחיקה`, `כיבוי`, `הדלקה`). This is the Apple/Google Hebrew convention — and it fixes the gender problem for free (nouns aren't gendered).

### 2. Gender — masculine-default everywhere, with stray exceptions
Nearly every string that addresses the user is masculine (`אתה`, `בחר`, `הקלד`, `צור`, `שלך`). A consumer product addresses women too. Worse, it's *inconsistent*: a lone `בחר/י` (slash) appears amid bare-masculine copy, and some strings switched to plural (`השתמשו`, `הוסיפו`) while their neighbors stayed singular.

**Consensus fix (all agents):** don't use slashes. Neutralize by construction:
- Buttons → nouns (`הוספה`, not `הוסף`)
- Instructions → impersonal/infinitive (`אפשר לבחור`, `יש ללחוץ`, not `אתה צריך ללחוץ`)
- Ziggy about himself → masculine first-person, always (`בדקתי`, `כיביתי`) — this is correct, it's a named male persona
- Free-form chat → LLM matches the user's gender when known, else neutral

### 3. Brand rendered two ways: `זיגי` vs `Ziggy`
- **100** values use `זיגי`, **61** use Latin `Ziggy` — often adjacent (`ברוך הבא ל-Ziggy Home` next to `צמד את הטלפון לזיגי שלך`).
- `Ziggy מצא…` (Latin as a Hebrew sentence subject) reads like a rendering bug.

**Recommendation:** `זיגי` in all Hebrew prose; reserve Latin `Ziggy Home` only as the literal app/product name a user taps.

### 4. Typography — three inconsistencies
- **ASCII hyphen `-` vs. Hebrew maqaf `־`**: 70 glued ASCII forms (`ל-Ziggy`, `ה-QR`, `ל-22`) vs 47 correct maqaf (`ל־`, `סוף־סוף`). Marketing copy uses the correct maqaf; the app body mostly doesn't. The straight hyphen is the #1 tell of un-typeset Hebrew.
- **Quotes**: mix of correct gershayim `״…״`, ASCII `"…"`, and even German low-quote `„…״` (in `automations.proCard`).
- **`הכל` (45) vs `הכול` (4)** — ktiv-maleh inconsistency.

### 5. Terminology not standardized (same concept, many words)
| Concept | Competing forms seen | Recommend |
|---|---|---|
| AC / climate | `אקלים` (calque), `מיזוג`, `מזגן` | `מזגן` / `מיזוג`; retire `אקלים` |
| cover | `תריס`/`תריסים`, `וילון` | `תריס` (shutter); never `וילון` for the same entity |
| feature | `פיצ׳ר`, `תכונה` | `תכונה` |
| hub / coordinator | `מרכזייה`, `רכז`, `קונטרולר`, `בקר`, `מתאם`, `גשר`, `מרכזת` | pick one friendly word (see Decision 3) |
| trigger | `טריגר`, `מתי` | `מתי` / `כש…`; kill `טריגר` |
| run(s) | `ריצה`, `הפעלה` | `הפעלה` |
| snooze vs reject | **both = `נדחה`** (ambiguous — bug) | snooze → `נדחה למועד אחר` / `הושהה`; reject → `נדחתה` / `הוסרה` |
| done/completed | `הושלם`, `בוצע` | pick one |
| anomaly | `אנומליות` (calque), `חריגות` | `חריגות` |
| optional | `אופציונלי`, `אופציונליים`, `לא חובה`, `רשות` | `לא חובה` |
| email | `אימייל`, `מייל` | `אימייל` |
| mobile | `נייד`, `סלולרי`, `נייטיב` | `נייד` |
| AI | `בינה מלאכותית`, raw `AI` | `בינה מלאכותית` (or drop from taglines) |
| routine vs automation | `שגרה`, `אוטומציה` | lead with `שגרה` in what Ziggy says |

The good `מתי… / אם… / אז…` triad already exists in automations (lines 716–718) — propagate it, retire `טריגר`.

### 6. ~97 duplicate keys — two generations of copy coexisting
Whole namespaces are defined 2–3× (JS "last wins", so ~half is dead weight *and* the surviving version is sometimes the worse one). Affected: `invite`, `mobile`/`mobileOnboard`, `adminConsole`, `mobileDiag`, `mobileDevices`, `suggestions` (×3), `routines`, `quickAsks` (×3), `automations.suggested` vs `suggestions`, `devices.unassigned*`. These have already drifted in wording, gender, number, and brand spelling. **Must dedupe** — beyond copy quality, QA edits keep landing on the dead version.

---

## B. Concrete bugs (verified, not stylistic)

1. **English device categories leak raw to the Hebrew UI.** `domainRegistry.js` labels are English (`Light`, `Switch`, `Climate`, `Water Heater`, `Media Player`, `Vacuum`, `Lock`…), plus action labels (`Turn On`, `Mode`, `Preset`, `Swing`) and state labels (`Heating`, `Cooling`, `Eco`). Components render `meta.label` / `g.label` raw (BlastersSection.jsx:32, QuickControlsPicker.jsx:149, PairingWizard.jsx:502, IRWizard.jsx:474, Remote.jsx, DeviceRemote.jsx — uppercased). **Hebrew users literally see `CLIMATE`, `Media Player`, `Covers & Blinds`.** Fix: route domain/group/action/state labels through i18n with Hebrew mappings. *(Highest-impact item; violates the "no English leaks" product rule.)*
2. **`connection_error` leaks "Home Assistant"** to the user (`response_templates.py:71`: `…ל-Home Assistant כרגע`). → `אין לי חיבור לבית כרגע. תכף אנסה שוב.`
3. **`dashboard.haUpdateBadge` leaks "HA"** (`'HA {version} · סיכון {risk}'`). → `עדכון מערכת {version} …`
4. **RTL arrow points the wrong way.** `invite.goHome: 'עבור לבית שלי →'` — the `→` points away from the target in RTL. (Its duplicate `invite.goToHome` correctly uses `←`.) Kill the `→` version.
5. **Broken string.** `wizard.pairing.errorIntegrationDefault: 'הנדרשת'` — a dangling adjective fragment, not a sentence.
6. **Config paths shown to homeowners.** `voiceSettings.noVoicesForLang` and `voiceSettings.notConfigured` tell a homeowner to edit `settings.yaml` / `config/secrets.yaml` / `voice.cartesia.api_key`. Also `media.spotifyAppNotConfiguredAdmin`. → "הקול עדיין לא מוגדר — פנו למנהל המערכת."
7. **Engineering jargon in a homeowner tooltip.** `settings.zoneSaveTip` / `homeSensing.zoneTip` say `היסטרזה` / `ג׳יטר` / `סף הסטוריזיס ל־GPS` (and "הסטוריזיס" is misspelled). Drop the clause entirely.
8. **Spelling:** `צרוף` → `צירוף` (missing yod) ×3 in `adminConsole.cloud*`.
9. **English product name in Hebrew copy:** "Night Watch" surfaces to Hebrew users (`automation_templates.py:851/899`). Localize to `שמירת לילה`.
10. **Gender-agreement bugs:** subject `הצעה` (fem) with masculine status (`אושר`→`אושרה`, `פעיל`→`פעילה`, `התקבל`→`התקבלה`).

---

## C. Jargon leaking to end users (product rule: users never see HA/technical terms)

**In end-user surfaces (should be fixed/hidden):**
`ישויות`/entity, `רכז Zigbee`, `קואורדינטור`, `בלאסטר Broadlink`, `טוקן`, `פולסים`, `קנבס`, `צ׳יפ`, raw `IR`, `GPS`, `push`, `טריגרים`, config file paths, `Home Assistant`/`HA`, `היסטרזה`/`ג׳יטר`, `מרכזייה` (literally "telephone switchboard").

**In operator/installer surfaces (jargon is acceptable — leave):**
`debug.*` (WS, req_id, callback), `haUpdate.*`, `otaPage.*` (image digests, relay, cohort), `auditPage.*`, `cloudAdmin.*` (SSH, cloudflared, APNs/FCM), `adminSettings` engine (Ollama, SMTP, LLM), `fleetHealth.*`, `mobileDiag.*`. These sit behind the admin console, flagged "לא נראה למשתמשים רגילים."

---

## D. Ziggy's spoken voice — the highest-leverage lever

The chat persona prompt (`chat_handler.py:192`) has excellent *shape* rules but the entire Hebrew *voice* is one line ("respond in Hebrew"). No guidance on warmth, gender, register, or Israeli conventions — so the model defaults to textbook/masculine Hebrew. It even instructs "use imperative/past tense the same way you would in English" (a calque instruction), and its Hebrew example is masculine-locked (`אתה ומאיה בבית`).

**Proposed persona block to add** (gated on Hebrew input):
```
כשאתה עונה בעברית, דבר כמו ישראלי אמיתי — חם, קצר, ישיר, בגובה העיניים.
לא עברית ספרותית ולא מתורגמת. בלי "הנך", "ברצוני", "אנא", "עלייך". משפט אחד, לעניין.
פנייה למשתמש: אם ידוע המגדר — פנה בהתאם. אם לא בטוח — נסח בלי מגדר
("אפשר…", "רוצה שאמשיך?", "בטוח?"). אתה, זיגי, מדבר על עצמך בלשון זכר.
מוסכמות ישראליות: שעון 24 שעות, מעלות צלזיוס, שקלים, תאריך יום/חודש/שנה.
בלי מונחים טכניים: מדברים על אור, מזגן, תריס, שגרה — לא entity/טריגר/אינטגרציה.
דוגרי אבל מנומס.
```
Plus rewrites of the canned replies in `response_templates.py` to be gender-free and warmer (e.g. `אתה בטוח? אמור…` → `בטוח? להגיד 'כן' לאישור…`; `זה משהו שאני לא יכול לעשות כרגע` → `את זה אני עדיין לא יודע לעשות`), and killing `תומך`/`על בסיס`/`טריגר` calques in `automation_catalog.py`.

---

## E. Proposed execution plan (after the other session finishes)

1. **Lock the style decisions** (Section F below) — needs your call on 4 points.
2. **Write a one-page Hebrew style guide** into the repo so this doesn't drift again.
3. **Dedupe the ~97 duplicate keys**, keeping the better version.
4. **Standardize** register (nouns for buttons), gender (neutral-by-construction), brand (`זיגי`), typography (maqaf, gershayim, `הכל`/`הכול`), terminology.
5. **Fix the code bugs** — domain-label i18n routing, RTL arrow, broken/leaky strings, config-path leaks.
6. **Upgrade the spoken layer** — persona block + `response_templates.py` rewrites.
7. **Re-verify** against whatever the other session added (new pairing/onboarding copy), then request review.

Nothing here is merged or deployed. All work stays in the isolated worktree until you say go.
