"""Room custom photos must be raster images — SVG uploads are rejected (stored-XSS risk)."""
import pytest
from fastapi import HTTPException

from backend.routers.ui_prefs_router import SVG_NOT_SUPPORTED, _sanitize_room_custom_photos

JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="


@pytest.mark.parametrize("url", [
    "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "DATA:IMAGE/SVG+XML;charset=utf-8,<svg/>",
    "data:image/svg;base64,PHN2Zy8+",
])
def test_svg_data_url_is_rejected_with_clear_message(url):
    with pytest.raises(HTTPException) as exc:
        _sanitize_room_custom_photos({"kitchen": JPEG, "living": url})
    assert exc.value.status_code == 400
    assert exc.value.detail == SVG_NOT_SUPPORTED == "SVG files are not supported"


def test_raster_photos_still_accepted():
    photos = {
        "a": JPEG,
        "b": "data:image/png;base64,iVBORw0KGgo=",
        "c": "data:image/webp;base64,UklGRg==",
    }
    assert _sanitize_room_custom_photos(photos) == photos


def test_unknown_or_non_image_types_dropped():
    out = _sanitize_room_custom_photos({
        "a": "data:text/html,<script>alert(1)</script>",
        "b": "data:image/x-icon;base64,AAAB",
        "c": "https://evil.example/x.png",
        "d": JPEG,
    })
    assert out == {"d": JPEG}
