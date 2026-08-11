"""The OTA version must describe the BUNDLE, not the image it shipped in.

This channel failed silently in production for weeks. `_bundle_version()`
preferred `ZIGGY_GIT_SHA` and only looked at the actual files when that env var
said "dev". But a hub gets its frontend patched at runtime — a fresh dist
copied into a running container — far more often than it gets a full image
rebuild, and the SHA does not move when that happens. So the hub kept
advertising the version of a build whose files had already been replaced, every
phone compared that against what it had, concluded it was current, and the new
UI never shipped. The zip served under that id was the new build the whole
time; only the label lied.

The invariant these tests pin down: if the contents of frontend/dist change,
the advertised version changes. Nothing about the image is allowed to override
that.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def bundle_mod(tmp_path, monkeypatch):
    """mobile_router with `_frontend_dist_path` pointed at a temp dist."""
    mod = importlib.import_module("backend.routers.mobile_router")
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    monkeypatch.setattr(mod, "_frontend_dist_path", lambda: dist)
    return mod, dist


def _write_assets(dist, names):
    assets = dist / "assets"
    for p in assets.iterdir():
        p.unlink()
    for n in names:
        (assets / n).write_text("x")


def test_version_changes_when_the_build_changes(bundle_mod, monkeypatch):
    """A new dist under an UNCHANGED image SHA must advertise a new version.

    This is the exact production failure: same container, same ZIGGY_GIT_SHA,
    newly copied-in frontend. Before the fix both calls returned "92fdc68" and
    no phone ever updated.
    """
    mod, dist = bundle_mod
    monkeypatch.setenv("ZIGGY_GIT_SHA", "92fdc68")

    _write_assets(dist, ["index-AAAA.js", "Wall-BBBB.js"])
    before = mod._bundle_version()

    _write_assets(dist, ["index-AAAA.js", "Wall-CCCC.js"])   # rebuilt chunk
    after = mod._bundle_version()

    assert before != after, "a changed bundle must advertise a changed version"


def test_version_is_stable_for_an_unchanged_build(bundle_mod, monkeypatch):
    """Identity must be content-derived, not time- or call-derived.

    A version that changed on every poll would push every phone to re-download
    the same bundle continuously.
    """
    mod, dist = bundle_mod
    monkeypatch.setenv("ZIGGY_GIT_SHA", "92fdc68")
    _write_assets(dist, ["index-AAAA.js", "Wall-BBBB.js"])

    assert mod._bundle_version() == mod._bundle_version()


def test_version_still_names_the_commit_when_the_image_declares_one(bundle_mod, monkeypatch):
    """The SHA stays visible as a prefix — a version should point at a commit."""
    mod, dist = bundle_mod
    monkeypatch.setenv("ZIGGY_GIT_SHA", "92fdc68")
    _write_assets(dist, ["index-AAAA.js"])

    assert mod._bundle_version().startswith("92fdc68-")


def test_runtime_patched_hub_without_a_sha_still_gets_an_identity(bundle_mod, monkeypatch):
    """Local dev / unstamped images: content alone is enough to version by."""
    mod, dist = bundle_mod
    monkeypatch.setenv("ZIGGY_GIT_SHA", "dev")
    _write_assets(dist, ["index-AAAA.js"])

    v = mod._bundle_version()
    assert v.startswith("b-") and v != "dev"


def test_no_dist_falls_back_to_the_image_sha(bundle_mod, monkeypatch):
    """Nothing to describe — don't invent an identity, and don't raise."""
    mod, dist = bundle_mod
    monkeypatch.setenv("ZIGGY_GIT_SHA", "92fdc68")
    # assets dir exists but is empty
    assert mod._bundle_version() == "92fdc68"


def test_download_endpoint_agrees_with_advertised_version(bundle_mod, monkeypatch):
    """/bundles/{sha}.zip 404s anything but the current version.

    If these two ever disagreed, /version would hand out a URL that immediately
    404s and OTA would be dead in a different, louder way.
    """
    mod, dist = bundle_mod
    monkeypatch.setenv("ZIGGY_GIT_SHA", "92fdc68")
    _write_assets(dist, ["index-AAAA.js", "Wall-BBBB.js"])

    import inspect
    src = inspect.getsource(mod)
    # Both sides must route through the one function rather than re-deriving.
    assert src.count("_bundle_version()") >= 2


def test_bundle_carries_the_web_app_and_nothing_else(bundle_mod, tmp_path):
    """An APK parked in the web root must not ride along to every phone.

    This is not hypothetical: hosting an installer at /ziggy.apk for a tablet
    to download grew the OTA bundle from ~2 MB to 29 MB, because the zip is
    built from the whole dist tree. macOS AppleDouble siblings ("._index.html")
    get in the same way when dist is tarred from a Mac.
    """
    mod, dist = bundle_mod
    (dist / "index.html").write_text("<html>")
    (dist / "ziggy.apk").write_bytes(b"\x00" * 4096)
    (dist / "._index.html").write_text("mac junk")
    (dist / ".DS_Store").write_text("mac junk")
    (dist / "assets" / "Wall-AAAA.js").write_text("app")

    out = tmp_path / "bundle.zip"
    mod._build_bundle_zip("v1", dist, out)

    import zipfile
    names = set(zipfile.ZipFile(out).namelist())
    assert "index.html" in names
    assert "assets/Wall-AAAA.js" in names
    assert "ziggy.apk" not in names
    assert "._index.html" not in names
    assert ".DS_Store" not in names
