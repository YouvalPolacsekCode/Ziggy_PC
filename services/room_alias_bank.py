"""
Built-in room alias bank. Maps every natural-language room name Ziggy should
understand automatically → canonical slug used by the device registry and HA.

Resolution order in home_automation.py:
  1. Personal aliases  (settings["room_aliases"])  — user overrides
  2. This bank                                      — built-in knowledge
  3. Pass-through                                   — unknown room, caller decides

Users should never need to configure any name listed here.
"""

from __future__ import annotations

ROOM_ALIAS_BANK: dict[str, str] = {
    # ── Living room ──────────────────────────────────────────────────────────
    "living room":    "living_room",
    "livingroom":     "living_room",
    "lounge":         "living_room",
    "salon":          "living_room",
    "sitting room":   "living_room",
    "front room":     "living_room",
    "main room":      "living_room",
    "family room":    "living_room",
    "reception":      "living_room",
    "reception room": "living_room",
    "den":            "living_room",
    "drawing room":   "living_room",
    "great room":     "living_room",
    "tv room":        "living_room",
    "common room":    "living_room",

    # ── Bedroom (generic) ─────────────────────────────────────────────────────
    "bedroom":        "bedroom",
    "bed room":       "bedroom",
    "sleeping room":  "bedroom",
    "sleep room":     "bedroom",

    # ── Master / primary bedroom ─────────────────────────────────────────────
    "master bedroom":   "master_bedroom",
    "master bed":       "master_bedroom",
    "main bedroom":     "master_bedroom",
    "primary bedroom":  "master_bedroom",
    "parents room":     "master_bedroom",
    "parents bedroom":  "master_bedroom",
    "parent room":      "master_bedroom",
    "parent bedroom":   "master_bedroom",
    "master":           "master_bedroom",

    # ── Guest / spare bedroom ─────────────────────────────────────────────────
    "guest room":       "guest_room",
    "guest bedroom":    "guest_room",
    "spare room":       "guest_room",
    "spare bedroom":    "guest_room",

    # ── Bathroom (generic) ────────────────────────────────────────────────────
    "bathroom":       "bathroom",
    "bath room":      "bathroom",
    "restroom":       "bathroom",
    "rest room":      "bathroom",
    "wc":             "bathroom",
    "w.c.":           "bathroom",
    "toilet":         "bathroom",
    "bath":           "bathroom",
    "loo":            "bathroom",
    "washroom":       "bathroom",
    "lavatory":       "bathroom",
    "powder room":    "bathroom",
    "half bath":      "bathroom",
    "water closet":   "bathroom",

    # ── En suite / master bathroom ────────────────────────────────────────────
    "en suite":           "master_bathroom",
    "ensuite":            "master_bathroom",
    "master bathroom":    "master_bathroom",
    "master bath":        "master_bathroom",
    "main bathroom":      "master_bathroom",
    "parents bathroom":   "master_bathroom",
    "parent bathroom":    "master_bathroom",
    "primary bathroom":   "master_bathroom",

    # ── Kitchen ───────────────────────────────────────────────────────────────
    "kitchen":        "kitchen",
    "kitchenette":    "kitchen",
    "cook room":      "kitchen",

    # ── Office / study ────────────────────────────────────────────────────────
    "office":         "office",
    "study":          "office",
    "work room":      "office",
    "workroom":       "office",
    "home office":    "office",
    "workspace":      "office",

    # ── Corridor / hallway ────────────────────────────────────────────────────
    "corridor":       "corridor",
    "hallway":        "corridor",
    "hall":           "corridor",
    "passage":        "corridor",
    "passageway":     "corridor",
    "entryway":       "corridor",

    # ── Entry / front door ────────────────────────────────────────────────────
    "entry":          "entry",
    "entrance":       "entry",
    "front door":     "entry",
    "foyer":          "entry",
    "vestibule":      "entry",
    "front hall":     "entry",
    "porch":          "entry",
    "doorway":        "entry",

    # ── Stairs ────────────────────────────────────────────────────────────────
    "stairs":         "stairs",
    "staircase":      "stairs",
    "stairway":       "stairs",
    "stairwell":      "stairs",
    "steps":          "stairs",

    # ── Dining room ───────────────────────────────────────────────────────────
    "dining room":    "dining_room",
    "dining":         "dining_room",
    "dining area":    "dining_room",
    "eating area":    "dining_room",
    "eat in":         "dining_room",

    # ── Garage ────────────────────────────────────────────────────────────────
    "garage":         "garage",
    "car park":       "garage",
    "carport":        "garage",

    # ── Garden / outdoor ──────────────────────────────────────────────────────
    "garden":         "garden",
    "yard":           "garden",
    "backyard":       "garden",
    "back yard":      "garden",
    "front yard":     "garden",
    "outdoor":        "garden",
    "outside":        "garden",

    # ── Patio / balcony / terrace ─────────────────────────────────────────────
    "patio":          "patio",
    "terrace":        "terrace",
    "balcony":        "balcony",

    # ── Laundry / utility ────────────────────────────────────────────────────
    "laundry":        "laundry",
    "laundry room":   "laundry",
    "utility room":   "laundry",
    "utility":        "laundry",

    # ── Kids / nursery / playroom ─────────────────────────────────────────────
    "kids room":      "kids_room",
    "children room":  "kids_room",
    "nursery":        "nursery",
    "baby room":      "nursery",
    "playroom":       "playroom",
    "play room":      "playroom",

    # ── Basement / attic ──────────────────────────────────────────────────────
    "basement":       "basement",
    "cellar":         "basement",
    "attic":          "attic",
    "loft":           "attic",

    # ── Storage / closet / pantry ─────────────────────────────────────────────
    "storage":        "storage",
    "storage room":   "storage",
    "closet":         "closet",
    "pantry":         "pantry",
    "cupboard":       "storage",
}


ROOM_ALIAS_BANK_HE: dict[str, str] = {
    # ── סלון / מגורים ──────────────────────────────────────────────────────────
    "סלון":              "living_room",
    "חדר מגורים":        "living_room",
    "חדר אורחים":        "living_room",
    "אזור מגורים":       "living_room",

    # ── חדרי שינה ──────────────────────────────────────────────────────────────
    "חדר שינה":          "bedroom",
    "חדר שינה ראשי":     "master_bedroom",
    "חדר שינה הורים":    "master_bedroom",
    "חדר ההורים":        "master_bedroom",
    "חדר שלנו":          "master_bedroom",
    "חדרנו":             "master_bedroom",
    "חדר אורחים":        "guest_room",
    "חדר שינה לאורחים":  "guest_room",

    # ── אמבטיה / שירותים ───────────────────────────────────────────────────────
    "אמבטיה":            "bathroom",
    "שירותים":           "bathroom",
    "שרותים":            "bathroom",
    "בית שימוש":         "bathroom",
    "מקלחת":             "bathroom",
    "אן סוויט":          "master_bathroom",
    "אמבטיה ראשית":      "master_bathroom",
    "חדר אמבטיה ראשי":   "master_bathroom",
    "אמבטיה של ההורים":  "master_bathroom",

    # ── מטבח ───────────────────────────────────────────────────────────────────
    "מטבח":              "kitchen",

    # ── מסדרון / כניסה ─────────────────────────────────────────────────────────
    "מסדרון":            "corridor",
    "פרוזדור":           "corridor",
    "כניסה":             "entry",
    "אולם כניסה":        "entry",
    "דלת קדמית":         "entry",

    # ── מדרגות ────────────────────────────────────────────────────────────────
    "מדרגות":            "stairs",
    "חדר מדרגות":        "stairs",

    # ── חדר עבודה / משרד ───────────────────────────────────────────────────────
    "חדר עבודה":         "office",
    "משרד":              "office",
    "לימודים":           "office",

    # ── פינת אוכל / חדר אוכל ──────────────────────────────────────────────────
    "פינת אוכל":         "dining_room",
    "חדר אוכל":          "dining_room",

    # ── חניה / מוסך ────────────────────────────────────────────────────────────
    "חניה":              "garage",
    "מוסך":              "garage",

    # ── גינה / מרפסת ───────────────────────────────────────────────────────────
    "גינה":              "garden",
    "חצר":               "garden",
    "מרפסת":             "balcony",
    "טרסה":              "terrace",

    # ── כביסה / שירות ─────────────────────────────────────────────────────────
    "חדר כביסה":         "laundry",
    "חדר שירות":         "laundry",

    # ── ילדים / משחקים ────────────────────────────────────────────────────────
    "חדר ילדים":         "kids_room",
    "חדר הילדים":        "kids_room",
    "חדר משחקים":        "playroom",
    "חדרון":             "nursery",

    # ── מחסן / ארון ────────────────────────────────────────────────────────────
    "מחסן":              "storage",
    "ארון":              "closet",
    "מזווה":             "pantry",

    # ── מרתף / גג ──────────────────────────────────────────────────────────────
    "מרתף":              "basement",
    "עליית גג":          "attic",
}


def resolve_room(room_key: str, personal_aliases: dict[str, str] | None = None) -> str:
    """Resolve a spoken room name → canonical slug.

    Priority: personal aliases > built-in bank > pass-through.
    room_key must already be lowercased and stripped.
    """
    if personal_aliases and room_key in personal_aliases:
        return personal_aliases[room_key]
    return ROOM_ALIAS_BANK.get(room_key, room_key)


def all_known_room_names(personal_aliases: dict[str, str] | None = None) -> list[str]:
    """All room names Ziggy can accept — bank keys + personal alias keys."""
    names = set(ROOM_ALIAS_BANK.keys())
    if personal_aliases:
        names |= set(personal_aliases.keys())
    return sorted(names)
