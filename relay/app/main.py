from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routers.auth import router as auth_router, ensure_relay_admin
from .routers.homes import router as homes_router
from .routers.invites import router as invites_router
from .routers.proxy import router as proxy_router, _proxy_client
from .routers.provision import router as provision_router
from .routers.public_presence import router as public_presence_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await ensure_relay_admin()
    try:
        yield
    finally:
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
# Public presence passthrough — must register BEFORE the catch-all proxy so
# its specific /api/presence/ping route takes precedence.
app.include_router(public_presence_router)
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
