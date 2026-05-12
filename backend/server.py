# backend/server.py — FastAPI app wiring only.
# Business logic lives in backend/routers/*.py.
from __future__ import annotations

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.ws_manager import manager
from core.logger_module import log_info
from core.settings_loader import settings

from backend.routers.intent_router import router as intent_router
from backend.routers.device_router import router as device_router
from backend.routers.ha_router import router as ha_router
from backend.routers.pairing_router import router as pairing_router
from backend.routers.task_router import router as task_router
from backend.routers.automation_router import router as automation_router
from backend.routers.routine_router import router as routine_router
from backend.routers.event_router import router as event_router
from backend.routers.capability_router import router as capability_router
from backend.routers.virtual_device_router import router as virtual_device_router
from backend.routers.ir_router import router as ir_router
from backend.routers.suggestion_router import router as suggestion_router
from backend.routers.quick_ask_router import router as quick_ask_router
from backend.routers.status_router import router as status_router
from backend.routers.auth_router import router as auth_router
from backend.routers.map_router import router as map_router
from backend.routers.admin_router import router as admin_router

app = FastAPI(title="Ziggy API", version="1.0")


@app.on_event("startup")
async def _startup():
    import asyncio
    from services.ziggy_scheduler import run_scheduler
    from services.ha_subscriber import run_subscriber
    from services.device_registry import init as dr_init, sync_rooms_to_ha

    # Init device registry synchronously first so it's ready before HTTP traffic.
    dr_init()

    # Ensure every Ziggy room is backed by an HA area.
    # Runs once at startup; creates missing areas and normalizes registry keys.
    asyncio.create_task(sync_rooms_to_ha())

    asyncio.create_task(run_scheduler())
    asyncio.create_task(run_subscriber())


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# WebSocket  /ws  — core infrastructure, lives here not in a router
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    log_info(f"[API] WebSocket connected. Total: {manager.count}")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        log_info(f"[API] WebSocket disconnected. Total: {manager.count}")


# ---------------------------------------------------------------------------
# Include routers
# ---------------------------------------------------------------------------

app.include_router(intent_router)
app.include_router(device_router)
app.include_router(ha_router)
app.include_router(pairing_router)
app.include_router(task_router)
app.include_router(automation_router)
app.include_router(routine_router)
app.include_router(event_router)
app.include_router(capability_router)
app.include_router(virtual_device_router)
app.include_router(ir_router)
app.include_router(suggestion_router)
app.include_router(quick_ask_router)
app.include_router(status_router)
app.include_router(auth_router)
app.include_router(map_router)
app.include_router(admin_router)


# ---------------------------------------------------------------------------
# Entry point (called from ziggy_main.py)
# ---------------------------------------------------------------------------

def start_api_server():
    port = settings.get("web_interface", {}).get("backend_port", 8001)
    log_info(f"[API] Ziggy API server starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
