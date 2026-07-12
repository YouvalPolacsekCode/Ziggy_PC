"""Shared test isolation.

`services.auth_db` resolves its SQLite path at import time to the real
`user_files/auth.db`. Several services now consult `auth_db.has_any_user()` as
an authoritative "does this hub have an owner yet?" signal — notably
`services.first_boot.get_claim_qr` / `is_first_boot`, which must hard-refuse the
no-auth first-boot claim mint once an owner exists.

Without isolation, those code paths would read the developer's real auth.db
(which usually has accounts), making otherwise-hermetic first-boot tests
environment-dependent. This autouse fixture points auth_db at a per-test temp
database so every test starts from a clean, owner-less hub unless it explicitly
creates users. Tests that manage their own auth_db (via their own monkeypatch of
`auth_db._DB_PATH`) simply re-point it after this fixture runs — the later
monkeypatch wins, so this is additive and non-conflicting.
"""
from __future__ import annotations

import pytest

from services import auth_db


@pytest.fixture(autouse=True)
def _isolate_auth_db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "_conftest_auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)
    yield
    # Reset the memo so a later test's own _DB_PATH monkeypatch re-inits cleanly.
    monkeypatch.setattr(auth_db, "_initialized", False)
