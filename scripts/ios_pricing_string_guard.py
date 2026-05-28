#!/usr/bin/env python3
"""iOS pricing-string guard (Prompt 9 chunk 3).

Enforces Apple Guideline 3.1.3(a) — the "reader app" rule. An app
that gives users access to content/services purchased outside the
app is allowed to skip Apple IAP, PROVIDED the binary does NOT
mention pricing, do upsells, or offer in-app purchase of those
services.

Run this from the repo root BEFORE building the frontend for an
iOS Capacitor bundle:

    python scripts/ios_pricing_string_guard.py

Exits non-zero on first banned-string hit. The error message names
the file, line, matched pattern, and matched text so it's obvious
which UI shipped a price.

The guard scans frontend/src/ only — the iOS bundle is built from
that tree. Relay code, backend code, docs, this script itself, and
the runbook are all excluded (they never make it into the iOS
binary). Founder must invoke this manually pre-Archive; tying it
into CI happens when CI exists.

Patterns are intentionally narrow — they target obvious price text
(\\$5/mo, \\$89/yr, "Founder Lifetime"). Common Hebrew words like
"מנוי" (subscription) appear in legitimate informational copy
(e.g. the SubscriptionGateBanner from C3.9) and would false-positive.
The right defense for those is human review in PRs touching
pricing-adjacent UI.

Update WHITELIST when you legitimately need a price-shaped string
in a non-iOS-bundled file path.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SCAN_DIR = REPO_ROOT / "frontend" / "src"

# Patterns that MUST NOT appear in iOS-bundled UI.
# Patterns are deliberately narrow — they target only obvious user-facing
# pricing / upsell text. Generic verbs like "subscribe" alone are too
# broad and false-positive on WebSocket / store-subscription code.
BANNED_PATTERNS: list[tuple[str, re.Pattern]] = [
    # USD prices: $5/mo, $9/mo, $89/yr, $9.99/month, etc.
    ("USD price w/ interval", re.compile(r"\$\s?\d+(?:\.\d+)?\s?/\s?(?:mo|yr|month|year)\b", re.I)),
    # NIS prices: 18 ₪, ₪33, ₪325/yr
    ("NIS price",             re.compile(r"(?:₪\s?\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?₪)")),
    # Plan names — billing-specific marketing labels.
    ("plan: Founder Lifetime", re.compile(r"\bFounder\s+Lifetime\b", re.I)),
    ("plan: Standard Monthly", re.compile(r"\bStandard\s+Monthly\b", re.I)),
    ("plan: Standard Annual",  re.compile(r"\bStandard\s+Annual\b", re.I)),
    # Explicit purchase CTAs. "Subscribe Now" + "Buy Now" + "Sign up now"
    # are Apple's canonical reader-app rejection triggers; the generic
    # "subscribe to" form is intentionally NOT included because pubsub
    # / WebSocket / store-subscription code legitimately uses it.
    ("CTA: Subscribe Now",     re.compile(r"\bSubscribe\s+Now\b", re.I)),
    ("CTA: Buy Now",           re.compile(r"\bBuy\s+Now\b", re.I)),
    ("CTA: Sign up now",       re.compile(r"\bSign\s+up\s+now\b", re.I)),
    ("CTA: Start free trial",  re.compile(r"\bStart\s+(?:your\s+)?free\s+trial\b", re.I)),
    ("upsell: Upgrade to <plan>", re.compile(r"\bUpgrade\s+to\s+(?:Founder|Standard|Premium|Pro|Plus)\b", re.I)),
]

# Paths within SCAN_DIR that are exempt. Keep narrow — every entry
# is a place where the app could ship pricing text without iOS noticing.
WHITELIST: set[str] = {
    # Add legitimate exemptions here as relative paths from SCAN_DIR.
    # Example: "pages/AdminConsole.jsx" if an admin-only page needs to
    # show plan internals for support workflows (admin UI is gated by
    # role, not shipped to end-users via the iOS App Store flow).
}


def _should_scan(path: Path) -> bool:
    if path.suffix not in {".js", ".jsx", ".ts", ".tsx", ".html", ".vue"}:
        return False
    rel = path.relative_to(SCAN_DIR).as_posix()
    if rel in WHITELIST:
        return False
    # Skip vendored deps and build output that may have ended up in src
    if any(part in {"node_modules", "dist", "build"} for part in path.parts):
        return False
    return True


def scan() -> int:
    hits: list[tuple[Path, int, str, str]] = []
    for root, _, files in os.walk(SCAN_DIR):
        for fname in files:
            path = Path(root) / fname
            if not _should_scan(path):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for lineno, line in enumerate(text.splitlines(), 1):
                for pname, pat in BANNED_PATTERNS:
                    m = pat.search(line)
                    if m:
                        hits.append((path, lineno, pname, m.group(0)))

    if not hits:
        print(f"OK: scanned {SCAN_DIR} — no banned pricing strings found.")
        return 0

    print(
        "FAIL: pricing-shaped text found in iOS-bundled UI.\n"
        "Apple Guideline 3.1.3(a) requires reader apps to omit "
        "pricing / upsells inside the app binary.\n"
        "Move the offending text to a web-only surface, or add the "
        "file to WHITELIST in this guard with justification.\n"
    )
    for path, lineno, pname, matched in hits:
        rel = path.relative_to(REPO_ROOT)
        print(f"  {rel}:{lineno}  [{pname}]  matched {matched!r}")
    print(f"\n{len(hits)} hit(s) across {len({h[0] for h in hits})} file(s).")
    return 1


if __name__ == "__main__":
    sys.exit(scan())
