"""
Map renderer — AI-enhanced isometric SVG floor plan generator.

Flow:
  1. Take canvas_rooms layout (room positions in API units = metres × 50)
  2. Generate a precise isometric SVG using the same w2s() projection as the frontend
  3. Call GPT-4o to add furniture + visual polish
  4. Cache the result in home_map.db (map_render table)

The SVG uses identical coordinate math to HomeMapCanvas.jsx so device pin
overlays stay perfectly aligned over each room.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
from pathlib import Path

import aiosqlite

from core.logger_module import log_info, log_error
from core.settings_loader import settings

DB_PATH = Path("user_files/home_map.db")

# ── Isometric projection (mirrors HomeMapCanvas.jsx constants) ──────────────
ISO_X   = 30
ISO_Y   = 15
WALL_PX = 28
API_S   = 50   # metres per API unit (x/y/width/height stored as metres × 50)

# ── Room colour palettes — [top-face, south-wall, east-wall] ────────────────
_COLORS: dict[str, tuple[str, str, str]] = {
    "bedroom":  ("#bfd8f5", "#8eb4e0", "#5e8fc8"),
    "master":   ("#f2c8e0", "#d89ac0", "#be6c9e"),
    "living":   ("#b8f0cc", "#80d4a0", "#50b478"),
    "salon":    ("#b8f0cc", "#80d4a0", "#50b478"),
    "lounge":   ("#b8f0cc", "#80d4a0", "#50b478"),
    "kitchen":  ("#f8f4b0", "#e0d878", "#c8bc48"),
    "bathroom": ("#a8ecf8", "#70cce0", "#48acc0"),
    "toilet":   ("#c8f4f8", "#90d8e8", "#60b8c8"),
    "office":   ("#d8ccf8", "#b0a8e0", "#8880c8"),
    "corridor": ("#f8d8ec", "#e0b0d0", "#c888b0"),
    "hallway":  ("#f8d8ec", "#e0b0d0", "#c888b0"),
    "stairs":   ("#fce8c8", "#e4c498", "#ccaa68"),
    "garage":   ("#dce8f0", "#b4c8d8", "#8ca8c0"),
    "balcony":  ("#c8f8e0", "#90e0b8", "#58c888"),
    "garden":   ("#c8f8e0", "#90e0b8", "#58c888"),
    "default":  ("#e8ecf2", "#c4c8d0", "#a0a8b4"),
}


def _room_colors(name: str) -> tuple[str, str, str]:
    n = (name or "").lower()
    for k, c in _COLORS.items():
        if k in n:
            return c
    return _COLORS["default"]


def _w2s(mx: float, my: float, mz: float = 0.0) -> tuple[float, float]:
    return (mx - my) * ISO_X, (mx + my) * ISO_Y - mz * WALL_PX


def layout_hash(positions: list[dict]) -> str:
    """Stable 16-char SHA-256 prefix of sorted room positions."""
    key = sorted(
        [(p["room_id"], round(p["x"], 2), round(p["y"], 2),
          round(p["width"], 2), round(p["height"], 2))
         for p in positions]
    )
    return hashlib.sha256(json.dumps(key).encode()).hexdigest()[:16]


# ── Database helpers ─────────────────────────────────────────────────────────

async def get_cached_render(h: str) -> dict | None:
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT svg, viewbox_x, viewbox_y, viewbox_w, viewbox_h, model "
                "FROM map_render WHERE layout_hash=?", (h,)
            ) as cur:
                row = await cur.fetchone()
                return dict(row) if row else None
    except Exception:
        return None


async def _store_render(h: str, svg: str, vb: dict, model: str = "gpt-4o") -> None:
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO map_render (layout_hash, svg, viewbox_x, viewbox_y, "
                "viewbox_w, viewbox_h, generated_at, model) "
                "VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(layout_hash) DO UPDATE SET "
                "svg=excluded.svg, viewbox_x=excluded.viewbox_x, viewbox_y=excluded.viewbox_y, "
                "viewbox_w=excluded.viewbox_w, viewbox_h=excluded.viewbox_h, "
                "generated_at=excluded.generated_at, model=excluded.model",
                (h, svg, vb["x"], vb["y"], vb["w"], vb["h"], time.time(), model),
            )
            await db.commit()
    except Exception as e:
        log_error(f"[MapRenderer] Failed to store render: {e}")


# ── Base SVG generator ────────────────────────────────────────────────────────

def _pts(*corners: tuple[float, float]) -> str:
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in corners)


def generate_base_svg(rooms_with_pos: list[dict]) -> tuple[str, dict]:
    """
    Generate an isometric SVG from room layout data.
    rooms_with_pos: list of {room_id, name, x, y, width, height}
                    where x/y/width/height are in API units (metres × 50).
    Returns (svg_string, viewbox_dict).
    """
    # Painter's algorithm: draw back rooms first
    sorted_rooms = sorted(rooms_with_pos, key=lambda r: r["x"] / API_S + r["y"] / API_S)

    # Compute bounding box across all projected corners
    PAD = 24.0
    all_x: list[float] = []
    all_y: list[float] = []
    for r in sorted_rooms:
        mx, my = r["x"] / API_S, r["y"] / API_S
        mw, mh = r["width"] / API_S, r["height"] / API_S
        for cx, cy, cz in [
            (mx,    my,    1), (mx+mw, my,    1),
            (mx,    my+mh, 1), (mx+mw, my+mh, 1),
            (mx,    my+mh, 0), (mx+mw, my+mh, 0), (mx+mw, my, 0),
        ]:
            sx, sy = _w2s(cx, cy, cz)
            all_x.append(sx); all_y.append(sy)

    if not all_x:
        return "<svg xmlns='http://www.w3.org/2000/svg'></svg>", {"x": 0, "y": 0, "w": 400, "h": 300}

    min_x, max_x = min(all_x) - PAD, max(all_x) + PAD
    min_y, max_y = min(all_y) - PAD, max(all_y) + PAD
    vw, vh = max_x - min_x, max_y - min_y

    groups: list[str] = []
    for r in sorted_rooms:
        rid  = r["room_id"]
        name = r.get("name", rid)
        mx, my = r["x"] / API_S, r["y"] / API_S
        mw, mh = r["width"] / API_S, r["height"] / API_S

        tTL = _w2s(mx,    my,    1)
        tTR = _w2s(mx+mw, my,    1)
        tBL = _w2s(mx,    my+mh, 1)
        tBR = _w2s(mx+mw, my+mh, 1)
        bBL = _w2s(mx,    my+mh, 0)
        bBR = _w2s(mx+mw, my+mh, 0)
        bTR = _w2s(mx+mw, my,    0)

        top_c, south_c, east_c = _room_colors(name)

        cx = (tTL[0] + tTR[0] + tBR[0] + tBL[0]) / 4
        cy = (tTL[1] + tTR[1] + tBR[1] + tBL[1]) / 4

        groups.append(f"""
  <g data-room-id="{rid}" data-room-name="{name}">
    <polygon class="east-wall"  points="{_pts(tTR,tBR,bBR,bTR)}" fill="{east_c}"  stroke="rgba(255,255,255,0.25)" stroke-width="0.8"/>
    <polygon class="south-wall" points="{_pts(tBL,tBR,bBR,bBL)}" fill="{south_c}" stroke="rgba(255,255,255,0.25)" stroke-width="0.8"/>
    <polygon class="top-face"   points="{_pts(tTL,tTR,tBR,tBL)}" fill="{top_c}"   stroke="rgba(255,255,255,0.55)" stroke-width="1"/>
    <text x="{cx:.1f}" y="{cy:.1f}" text-anchor="middle" dominant-baseline="middle"
      font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="11" font-weight="600"
      fill="rgba(0,0,0,0.62)">{name}</text>
  </g>""")

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{min_x:.1f} {min_y:.1f} {vw:.1f} {vh:.1f}">\n'
        f'  <rect x="{min_x:.1f}" y="{min_y:.1f}" width="{vw:.1f}" height="{vh:.1f}" fill="#e8edf4"/>\n'
        + "".join(groups)
        + "\n</svg>"
    )
    vb = {"x": min_x, "y": min_y, "w": vw, "h": vh}
    return svg, vb


# ── AI enhancement ────────────────────────────────────────────────────────────

def _enhance_svg_sync(base_svg: str, room_descriptions: list[str]) -> str:
    """
    Blocking call to GPT-4o. Run in a thread executor to avoid blocking the event loop.
    Returns enhanced SVG, or base_svg on any error.
    """
    api_key = settings.get("openai", {}).get("api_key", "")
    if not api_key:
        log_error("[MapRenderer] No OpenAI API key — returning base SVG")
        return base_svg

    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    rooms_list = "\n".join(f"- {d}" for d in room_descriptions)

    prompt = f"""You are an SVG artist specialising in premium architectural floor plan visualisations.

The SVG below is an isometric floor plan. Each room is represented by three polygons:
  • .top-face   — the visible floor surface (parallelogram shape)
  • .south-wall — the front/bottom wall
  • .east-wall  — the right wall

ROOMS IN THIS PLAN:
{rooms_list}

YOUR TASK — enhance the SVG to look like a premium smart-home app floor plan:
1. Add appropriate furniture inside each room as simple SVG shapes drawn INSIDE the .top-face polygon:
   • bedroom → bed (rounded-rect) + two small nightstand circles
   • living/salon/lounge → sofa (rounded-rect) + TV unit (thin rect on opposite wall)
   • kitchen → L-shaped counter rects + small island rect
   • bathroom/toilet → bathtub or shower rect + small basin circle
   • office/study → desk (L-shape) + chair (small circle)
   • corridor/hallway/stairs → leave mostly clear, maybe a small mat rect
2. Add a subtle linear gradient to each .top-face polygon (lighter at top-left, slightly darker at bottom-right)
3. Add tiny door gaps on shared walls: a 6px white arc or gap on one edge of the south-wall or east-wall polygon
4. Keep furniture fills as a lighter tint (+40% lightness) of the room's top-face colour
5. Keep furniture simple — 2-4 shapes per room, not complex

HARD CONSTRAINTS:
• DO NOT modify any "points" attribute on any <polygon> element — the geometry is mathematically precise
• DO NOT remove any existing element or attribute
• Preserve every data-room-id and data-room-name attribute exactly as-is
• Return ONLY valid SVG markup — start with <svg, end with </svg>, nothing else

BASE SVG:
{base_svg}"""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=8000,
        )
        raw = resp.choices[0].message.content.strip()

        # Strip markdown fences if present
        if raw.startswith("```"):
            lines = raw.split("\n")
            start = 1
            end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
            raw = "\n".join(lines[start:end]).strip()

        # Basic validation
        if "<svg" in raw and "</svg>" in raw and "polygon" in raw:
            log_info("[MapRenderer] AI enhancement complete")
            return raw

        log_error("[MapRenderer] AI returned invalid SVG — falling back to base")
        return base_svg

    except Exception as e:
        log_error(f"[MapRenderer] GPT call failed: {e}")
        return base_svg


# ── Public async entry point ──────────────────────────────────────────────────

async def generate_render(h: str, positions: list[dict], rooms: list[dict]) -> None:
    """
    Background task: generate and cache an AI-enhanced SVG for the given layout.
    positions: raw rows from canvas_rooms (room_id, x, y, width, height)
    rooms: [{id, name}] from the frontend rooms summary
    """
    try:
        name_map = {r["id"]: r.get("name", r["id"]) for r in rooms}
        enriched = [{**p, "name": name_map.get(p["room_id"], p["room_id"])} for p in positions]

        base_svg, vb = generate_base_svg(enriched)
        room_descriptions = [f"{r.get('name', r['id'])}" for r in rooms]

        loop = asyncio.get_event_loop()
        enhanced_svg = await loop.run_in_executor(
            None, _enhance_svg_sync, base_svg, room_descriptions
        )

        await _store_render(h, enhanced_svg, vb)
        log_info(f"[MapRenderer] Render stored — hash {h}")

    except Exception as e:
        log_error(f"[MapRenderer] generate_render failed: {e}")
