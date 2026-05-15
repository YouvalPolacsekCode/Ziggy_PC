# backend/server.py — FastAPI app wiring only.
# Business logic lives in backend/routers/*.py.
from __future__ import annotations

import uvicorn
from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
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
from backend.routers.auth_deps import get_current_user
from backend.routers.map_router import router as map_router
from backend.routers.admin_router import router as admin_router
from backend.routers.activity_router import router as activity_router
from backend.routers.health_router import router as health_router
from backend.routers.presence_router import router as presence_router
from backend.routers.camera_router import router as camera_router

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
    import json as _json
    client_id = await manager.connect(websocket)
    log_info(f"[API] WebSocket connected. client_id={client_id} total={manager.count}")
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = _json.loads(raw)
            except Exception:
                continue

            msg_type = msg.get("type")

            if msg_type == "display_hello":
                # Browser display tab announces itself with its name/room
                from services.display_registry import registry
                registry.register(
                    ws_id=client_id,
                    name=msg.get("name", "unknown display"),
                    room=msg.get("room", ""),
                    aliases=msg.get("aliases", []),
                )
                log_info(f"[WS] display registered: '{msg.get('name')}' room='{msg.get('room')}'")

            elif msg_type == "display_heartbeat":
                from services.display_registry import registry
                registry.heartbeat(client_id)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        log_info(f"[API] WebSocket disconnected. client_id={client_id} total={manager.count}")


# ---------------------------------------------------------------------------
# Include routers
# ---------------------------------------------------------------------------

# auth_router is intentionally unprotected — contains login, setup, status
app.include_router(auth_router)

_auth = [Depends(get_current_user)]
app.include_router(intent_router,        dependencies=_auth)
app.include_router(device_router,        dependencies=_auth)
app.include_router(ha_router,            dependencies=_auth)
app.include_router(pairing_router,       dependencies=_auth)
app.include_router(task_router,          dependencies=_auth)
app.include_router(automation_router,    dependencies=_auth)
app.include_router(routine_router,       dependencies=_auth)
app.include_router(event_router,         dependencies=_auth)
app.include_router(capability_router,    dependencies=_auth)
app.include_router(virtual_device_router, dependencies=_auth)
app.include_router(ir_router,            dependencies=_auth)
app.include_router(suggestion_router,    dependencies=_auth)
app.include_router(quick_ask_router,     dependencies=_auth)
app.include_router(status_router,        dependencies=_auth)
app.include_router(map_router,           dependencies=_auth)
app.include_router(admin_router,         dependencies=_auth)
app.include_router(activity_router,      dependencies=_auth)
app.include_router(health_router,        dependencies=_auth)
app.include_router(presence_router,      dependencies=_auth)
app.include_router(camera_router,        dependencies=_auth)


# ---------------------------------------------------------------------------
# Entry point (called from ziggy_main.py)
# ---------------------------------------------------------------------------

def start_api_server():
    port = settings.get("web_interface", {}).get("backend_port", 8001)
    log_info(f"[API] Ziggy API server starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
