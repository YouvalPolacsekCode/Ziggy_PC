from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .billing.admin import router as billing_admin_router
from .billing.public import router as billing_public_router
from .billing.webhooks import router as billing_webhooks_router
from .database import init_db
from .routers.audit_log import router as audit_log_router
from .routers.mobile_admin import router as mobile_admin_router
from .routers.support_session import router as support_session_router
from .routers.auth import router as auth_router, ensure_relay_admin
from .routers.backup_keys import router as backup_keys_router
from .routers.fleet import router as fleet_router
from .routers.homes import router as homes_router
from .routers.invites import router as invites_router
from .routers.ota import router as ota_router
from .routers.proxy import router as proxy_router, _proxy_client
from .routers.provision import router as provision_router
from .routers.public_presence import router as public_presence_router
from .routers.telemetry import router as telemetry_router
from .telemetry_retention import run_retention_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await ensure_relay_admin()
    # Telemetry retention runs once a day in the background. Cancellation on
    # shutdown is best-effort — the loop awaits sleep(86400) most of its
    # life, so a cancel during sleep is the common case and tidy.
    retention_task = asyncio.create_task(run_retention_loop())
    try:
        yield
    finally:
        retention_task.cancel()
        try:
            await retention_task
        except (asyncio.CancelledError, Exception):
            pass
        await _proxy_client.aclose()


app = FastAPI(title="Ziggy Relay", version="1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router,      prefix="/api")
app.include_router(homes_router,     prefix="/api")
app.include_router(invites_router,   prefix="/api")
app.include_router(provision_router, prefix="/api")
# Backup-keys endpoints register under /api/homes/* — must come BEFORE
# the catch-all proxy router so /api/homes/{id}/seal-key etc. are not
# accidentally proxied to a hub. Order matters in FastAPI route matching.
app.include_router(backup_keys_router, prefix="/api")
# OTA router owns its own absolute paths (/api/devices/* + /api/admin/ota/*
# + /api/admin/homes/*/ota-pin) so it mounts WITHOUT a prefix. Must also
# come BEFORE the catch-all proxy.
app.include_router(ota_router)
# Telemetry router same pattern — absolute paths under /api/devices/* +
# /api/admin/homes/*/telemetry, no router prefix, mounted before proxy.
app.include_router(telemetry_router)
# Audit log read endpoint (Prompt 10 chunk 3). Absolute path
# /api/admin/audit-log, no prefix, must mount before the catch-all proxy.
app.include_router(audit_log_router)
# Support session endpoint (Prompt 10 chunk 3). Absolute path
# /api/admin/homes/{id}/support-session, no prefix, before catch-all proxy.
app.include_router(support_session_router)
# Mobile devices admin proxy (Prompt 10 chunk 3). Absolute path
# /api/admin/homes/{id}/mobile-devices, no prefix, before catch-all proxy.
app.include_router(mobile_admin_router)
# Fleet admin (Phase 4 of Oracle->mini-PC). Absolute path /api/admin/fleet/homes,
# specific route, must mount before the catch-all proxy.
app.include_router(fleet_router, prefix="/api")
# Public presence passthrough — must register BEFORE the catch-all proxy so
# its specific /api/presence/ping route takes precedence.
app.include_router(public_presence_router)
# Stripe webhook (Prompt 9). Specific path, must mount before the catch-all
# proxy. Signature verification happens inside the handler.
app.include_router(billing_webhooks_router, prefix="/api")
# Billing admin endpoints (Prompt 9). PATCH /api/admin/homes/{id}/kit-received
# and friends — specific paths under /api/admin/*, must mount before proxy.
app.include_router(billing_admin_router, prefix="/api")
# Public + customer-facing billing (Prompt 9 chunk 3).
#   GET  /api/billing/founder-slots/remaining   no auth, rate-limited
#   POST /api/billing/checkout                  user JWT, reserves slot
app.include_router(billing_public_router, prefix="/api")
# Proxy last — catch-all pattern
app.include_router(proxy_router,     prefix="/api")


@app.get("/health")
async def health():
    return {"ok": True, "service": "ziggy-relay"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "relay.app.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        log_level="info",
    )
