"""The capability catalog must ship inside the hub image.

docs/ is excluded by .dockerignore, so services/data/capability-catalog.json is
the copy production reads. If the generator refreshes docs/ without copying,
this fails before a tag does.
"""
import json
from pathlib import Path

from services import capability_lookup as CL

ROOT = Path(__file__).resolve().parent.parent
SHIPPED = ROOT / "services" / "data" / "capability-catalog.json"
DOCS = ROOT / "docs" / "capability-catalog.json"


def test_shipped_copy_exists_and_loads():
    assert SHIPPED.exists()
    data = json.loads(SHIPPED.read_text(encoding="utf-8"))
    assert len(data.get("capabilities") or []) >= 50


def test_shipped_copy_matches_docs_copy():
    if not DOCS.exists():
        return
    a = json.loads(SHIPPED.read_text(encoding="utf-8"))
    b = json.loads(DOCS.read_text(encoding="utf-8"))
    assert [c["id"] for c in a["capabilities"]] == [c["id"] for c in b["capabilities"]], \
        "services/data/capability-catalog.json is stale — copy docs/capability-catalog.json over it"


def test_capability_tiles_know_where_they_live():
    """A capability whose surfaces include an app screen opens that screen."""
    assert CL.path_for({"surfaces": ["frontend/src/pages/Actions.jsx", "services/x.py"]}) == "/actions"
    assert CL.path_for({"surfaces": ["frontend/src/components/PairingWizard.jsx"]}) == "/devices"
    assert CL.path_for({"surfaces": ["services/presence_engine.py"]}) is None
    items = CL.overview()
    assert all("path" in c and "id" in c for c in items)
    assert any(c["path"] for c in items)


def test_lookup_reads_the_shipped_copy_first():
    assert CL._SHIPPED_PATH == SHIPPED
    assert CL.overview()
