"""JSON Schemas for capability and mechanism records.

Every swarm agent is handed these verbatim so all 72 emit the same shape.
"""

STATUSES = ("live-prod", "canary-only", "flagged", "orphaned", "abandoned")

MECHANISM_KINDS = (
    "trigger", "condition", "action", "alert-channel", "engine", "store", "bridge",
)

AUDIENCES = ("user-facing", "operator", "internal")

CAPABILITY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "id", "name", "pitch", "what_it_does", "layer", "audience",
        "status", "status_evidence", "uses", "surfaces",
    ],
    "properties": {
        "id": {"type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"},
        "name": {"type": "string", "minLength": 2},
        "pitch": {"type": "string", "minLength": 8,
                  "description": "One benefit line in the user's language. No jargon, no entity ids."},
        "what_it_does": {"type": "string", "minLength": 30,
                         "description": "2-4 plain sentences."},
        "layer": {"type": "string"},
        "audience": {"type": "string", "enum": list(AUDIENCES)},
        "status": {"type": "string", "enum": list(STATUSES)},
        "status_evidence": {
            "type": "string", "minLength": 20,
            "description": "Must cite a concrete file path, flag name, or commit. Not a claim.",
        },
        "uses": {"type": "array", "items": {"type": "string"}},
        "surfaces": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "entry_points": {"type": "array", "items": {"type": "string"}},
        "tests": {"type": "array", "items": {"type": "string"}},
        "first_shipped": {"type": "string"},
        "commit": {"type": "string"},
        "known_gaps": {"type": "array", "items": {"type": "string"}},
        "territory": {"type": "string"},
        "angle": {"type": "string", "enum": ["code", "history", "reconciled"]},
        "disagreement": {"type": "string"},
        "composes_with": {"type": "array", "items": {"type": "object"}},
    },
}

MECHANISM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["id", "name", "kind", "what_it_is", "surfaces", "domain_concept"],
    "properties": {
        "id": {"type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"},
        "name": {"type": "string", "minLength": 2},
        "kind": {"type": "string", "enum": list(MECHANISM_KINDS)},
        "what_it_is": {"type": "string", "minLength": 20},
        "surfaces": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "domain_concept": {
            "type": "boolean",
            "description": "True if this owns its own store/engine and survives the 2+ consumer rule alone.",
        },
        "health": {"type": "string",
                   "description": "Known fragility, e.g. 'lan_host is IP-pinned and drifts with DHCP'."},
        "territory": {"type": "string"},
        "used_by": {"type": "array", "items": {"type": "string"}},
    },
}
