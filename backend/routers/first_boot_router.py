"""First-boot LAN endpoints — Prompt 7 chunk 2.6.

Two no-auth LAN-reachable surfaces a freshly-imaged box exposes:

  GET /pair
    HTML page rendered on the edge. Customer who lost (or never had) the
    box-top sticker QR can open `http://<edge-ip>/pair` from any device
    on the same Wi-Fi and scan from this page instead. Once onboarding
    has completed (first_boot.mark_onboarding_complete) the page shows a
    "this hub is already set up" notice instead of the QR.

  GET /api/onboarding/first-boot/qr.json
    JSON sibling of /pair for diagnostic tools (admin dashboard, mobile
    diagnostics page). Returns the same {device_id, code, expires_at,
    ttl_seconds} dict, or 404 when onboarding is complete.

Both routes are intentionally unauthenticated — the customer has not yet
created an owner account when they hit them. Pattern matches the
sibling LAN no-auth `/health` endpoint (backend/routers/edge_health_router.py).

QR content
----------
The QR encodes:
    ziggy://pair?code=<6char>&device_id=<edge-id>&claim=true&host=<ip:port>

Where host comes from request.base_url so a phone on the same LAN can talk
to the edge directly without going through the cloud relay. Backward
compatible: a mobile app that doesn't yet understand `host` and `claim`
simply uses the existing flow with the code alone.
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import urlsplit, quote

import segno
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from services import first_boot


router = APIRouter()


# ─── helpers ────────────────────────────────────────────────────────────────

def _host_from_request(request: Request) -> str:
    """Return the host:port portion of the URL the request came in on.

    Used inside the QR payload so the mobile app can talk to the edge
    directly on the LAN. Strips scheme + path; preserves :port when present.
    """
    parts = urlsplit(str(request.base_url))
    host = parts.netloc
    return host


def _build_qr_url(code: str, device_id: str, host: str) -> str:
    """Compose the `ziggy://pair?…` deep-link the mobile app scanner expects."""
    return (
        "ziggy://pair?"
        f"code={quote(code, safe='')}"
        f"&device_id={quote(device_id, safe='')}"
        f"&claim=true"
        f"&host={quote(host, safe='')}"
    )


def _qr_svg(payload: str, *, scale: int = 8) -> str:
    """Render a QR code as an inline SVG string with no enclosing <svg> wrapper
    stripped — segno returns valid standalone SVG which embeds cleanly in an
    HTML <div>.

    error="M" — medium ECC, balances size + scan reliability on a phone
    camera at ~30cm distance (the target scan condition for the LAN page).
    """
    qr = segno.make(payload, error="m")
    return qr.svg_inline(scale=scale, dark="#111111", light="#ffffff", border=2)


# ─── /pair (HTML) ───────────────────────────────────────────────────────────

_HTML_TEMPLATE = """<!doctype html>
<html lang="he" dir="auto">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Pair this Ziggy</title>
  <style>
    :root {{
      color-scheme: light dark;
      --bg:     #fafafa;
      --card:   #ffffff;
      --ink:    #111;
      --faint:  #6b6b6b;
      --accent: #ff6f3c;
      --line:   #e6e6e6;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #0e0e10;
        --card: #18181b;
        --ink: #f5f5f5;
        --faint: #a8a8a8;
        --line: #2a2a2e;
      }}
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }}
    .card {{
      width: 100%;
      max-width: 420px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 22px 22px 26px;
      text-align: center;
    }}
    h1 {{
      font-size: 22px;
      margin: 0 0 4px;
      letter-spacing: -0.01em;
    }}
    .lead {{
      font-size: 14px;
      color: var(--faint);
      margin: 0 0 18px;
      line-height: 1.5;
    }}
    .qr {{
      width: 240px;
      height: 240px;
      margin: 0 auto 18px;
      padding: 10px;
      background: #ffffff;
      border-radius: 10px;
      border: 1px solid var(--line);
    }}
    .qr svg {{ width: 100%; height: 100%; display: block; }}
    .code {{
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: 8px;
      color: var(--ink);
      margin: 0 0 6px;
    }}
    .code-hint {{
      font-size: 12px;
      color: var(--faint);
      margin: 0 0 18px;
    }}
    .steps {{
      text-align: start;
      font-size: 13px;
      color: var(--ink);
      line-height: 1.55;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 14px;
    }}
    .steps p {{ margin: 0 0 4px; }}
    .device-id {{
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 11px;
      color: var(--faint);
      margin-top: 14px;
      word-break: break-all;
    }}
    .done {{
      text-align: center;
      padding: 8px 0;
    }}
    .done .icon {{
      font-size: 48px;
      margin-bottom: 6px;
    }}
  </style>
</head>
<body>
  <main class="card">{body}</main>
</body>
</html>
"""

_HTML_BODY_PAIR = """
    <h1>צמדו את הזיגי שלכם</h1>
    <p class="lead">Open the Ziggy Home app and scan this code, or type the 6-character code shown below.</p>
    <div class="qr">{qr_svg}</div>
    <p class="code">{code}</p>
    <p class="code-hint">קוד צימוד · pair code</p>
    <div class="steps">
      <p>1. פתחו את אפליקציית Ziggy Home · Open the Ziggy Home app.</p>
      <p>2. Tap “Scan QR” or paste the code above.</p>
      <p>3. The app will guide you through the rest of setup.</p>
    </div>
    <p class="device-id">device: {device_id}</p>
"""

_HTML_BODY_DONE = """
    <div class="done">
      <div class="icon">✓</div>
      <h1>הזיגי שלכם כבר מוגדר</h1>
      <p class="lead">This Ziggy is already set up. Open the Ziggy Home app to use it.</p>
    </div>
"""


@router.get("/pair", response_class=HTMLResponse)
async def pair_page(request: Request) -> HTMLResponse:
    """No-auth LAN page rendering the first-boot QR.

    Always returns 200 so a customer pointing a browser at the wrong stage
    sees a coherent message rather than a 404. The body itself describes
    the state.
    """
    qr = first_boot.get_claim_qr()
    if qr is None:
        body = _HTML_BODY_DONE
    else:
        host = _host_from_request(request)
        payload = _build_qr_url(qr["code"], qr["device_id"], host)
        body = _HTML_BODY_PAIR.format(
            qr_svg=_qr_svg(payload),
            code=qr["code"],
            device_id=qr["device_id"],
        )
    return HTMLResponse(_HTML_TEMPLATE.format(body=body))


# ─── /api/onboarding/first-boot/qr.json (JSON) ──────────────────────────────

@router.get("/api/onboarding/first-boot/qr.json")
async def pair_qr_json(request: Request) -> dict:
    """JSON sibling of /pair. 404 when onboarding is complete."""
    qr = first_boot.get_claim_qr()
    if qr is None:
        raise HTTPException(status_code=404, detail="Onboarding already complete.")
    host = _host_from_request(request)
    return {
        "device_id":    qr["device_id"],
        "code":         qr["code"],
        "expires_at":   qr["expires_at"],
        "ttl_seconds":  qr["ttl_seconds"],
        "qr_payload":   _build_qr_url(qr["code"], qr["device_id"], host),
        "lan_host":     host,
    }
