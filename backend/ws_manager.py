# backend/ws_manager.py
from __future__ import annotations

import asyncio
import json
import uuid
from fastapi import WebSocket

# Per-client send budget. A slow tab on weak Wi-Fi must not stall broadcasts
# to every other client behind a sequential await loop. 0.5 s is plenty for a
# healthy client over LAN; anything slower gets evicted.
_BROADCAST_TIMEOUT_S = 0.5


class ConnectionManager:
    def __init__(self):
        # ws → assigned client_id
        self._connections: dict[WebSocket, str] = {}
        # ws → {"types": set[str] | None, "entities": set[str] | None}
        # A None set means "no filter on this dimension" → receive all.
        # The default for a fresh connection is no filter at all (legacy
        # full-firehose behaviour); the client can opt in to narrower
        # subscriptions by sending a `subscribe` message over the WS.
        self._filters: dict[WebSocket, dict] = {}

    async def connect(self, ws: WebSocket) -> str:
        await ws.accept()
        client_id = str(uuid.uuid4())
        self._connections[ws] = client_id
        self._filters[ws] = {"types": None, "entities": None}
        return client_id

    def disconnect(self, ws: WebSocket) -> None:
        client_id = self._connections.pop(ws, None)
        self._filters.pop(ws, None)
        if client_id:
            try:
                from services.display_registry import registry
                registry.unregister(client_id)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Subscription management
    # ------------------------------------------------------------------

    def set_subscription(self, ws: WebSocket, *, types=None, entities=None) -> None:
        """Replace the client's subscription filter.

        `types`: iterable of message-type strings (e.g. ["state_changed",
                 "presence_transition"]). None or empty list means "all types".
        `entities`: iterable of entity_id strings. Applies only to state_changed
                    / entity_removed broadcasts. None means "all entities".
        """
        if ws not in self._filters:
            return
        self._filters[ws] = {
            "types":    set(types)    if types    else None,
            "entities": set(entities) if entities else None,
        }

    def handle_client_message(self, ws: WebSocket, msg: dict) -> None:
        """Handle inbound WS protocol messages used to manage subscriptions.

        Recognized shapes:
          {"action": "subscribe",   "types": [...], "entities": [...]}
          {"action": "unsubscribe"}   # clears filters → resume full firehose
        Unknown messages are ignored (other handlers in server.py may consume
        them).
        """
        if not isinstance(msg, dict):
            return
        action = msg.get("action")
        if action == "subscribe":
            self.set_subscription(
                ws,
                types=msg.get("types"),
                entities=msg.get("entities"),
            )
        elif action == "unsubscribe":
            self.set_subscription(ws, types=None, entities=None)

    # ------------------------------------------------------------------
    # Broadcast
    # ------------------------------------------------------------------

    def _matches(self, ws: WebSocket, data: dict) -> bool:
        flt = self._filters.get(ws)
        if not flt:
            return True
        msg_type = data.get("type")
        if flt["types"] is not None and msg_type not in flt["types"]:
            return False
        if flt["entities"] is not None:
            # Entity-scoped filter applies only to messages that carry an
            # entity_id (state_changed, entity_removed). Non-entity messages
            # pass through unconditionally.
            eid = data.get("entity_id")
            if eid is not None and eid not in flt["entities"]:
                return False
        return True

    async def broadcast(self, data: dict) -> None:
        # Fan out in parallel and bound each client to _BROADCAST_TIMEOUT_S.
        # Sequential awaits previously meant one slow client blocked every
        # other receiver (and the event loop) until its TCP buffer drained.
        #
        # Per-client filter check (cheap dict lookups + set membership) lets
        # callers ride on the existing broadcast() entry point; targeted
        # delivery falls out naturally from each client's subscription state.
        conns = [(ws, cid) for ws, cid in self._connections.items() if self._matches(ws, data)]
        if not conns:
            return

        # Serialize the payload exactly once. send_json() would otherwise
        # JSON-encode the same dict N times per broadcast — wasted CPU on
        # every state_changed event multiplied by client count.
        try:
            payload = json.dumps(data, default=str)
        except Exception:
            # Fall back to per-client send_json if dumps fails (e.g. non-JSON
            # value sneaks through). Keeps behaviour bug-compatible.
            payload = None

        async def _send(ws: WebSocket) -> WebSocket | None:
            try:
                if payload is None:
                    await asyncio.wait_for(ws.send_json(data), timeout=_BROADCAST_TIMEOUT_S)
                else:
                    await asyncio.wait_for(ws.send_text(payload), timeout=_BROADCAST_TIMEOUT_S)
                return None
            except Exception:
                return ws

        results = await asyncio.gather(*(_send(ws) for ws, _ in conns), return_exceptions=False)
        for ws in results:
            if ws is not None:
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
