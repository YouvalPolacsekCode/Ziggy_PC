# backend/ws_manager.py
from __future__ import annotations

import uuid
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # ws → assigned client_id
        self._connections: dict[WebSocket, str] = {}

    async def connect(self, ws: WebSocket) -> str:
        await ws.accept()
        client_id = str(uuid.uuid4())
        self._connections[ws] = client_id
        return client_id

    def disconnect(self, ws: WebSocket) -> None:
        client_id = self._connections.pop(ws, None)
        if client_id:
            try:
                from services.display_registry import registry
                registry.unregister(client_id)
            except Exception:
                pass

    async def broadcast(self, data: dict) -> None:
        dead = []
        for ws in list(self._connections):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def push_to_display(self, ws_id: str, payload: dict) -> bool:
        """Send a display_push event to a specific browser display client.
        Returns True if the client was found and the message was sent."""
        for ws, cid in list(self._connections.items()):
            if cid == ws_id:
                try:
                    await ws.send_json({"type": "display_push", **payload})
                    return True
                except Exception:
                    self.disconnect(ws)
                    return False
        return False

    def get_client_id(self, ws: WebSocket) -> str | None:
        return self._connections.get(ws)

    @property
    def count(self) -> int:
        return len(self._connections)


# Singleton — imported by server.py and anywhere that needs to broadcast
manager = ConnectionManager()
