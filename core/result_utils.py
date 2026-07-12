# core/result_utils.py
from __future__ import annotations


def current_language() -> str:
    """Resolve the configured UI/response language → 'he' or 'en'.

    Reads system.language first (canonical, matches services/home_context.py),
    then the top-level `language` key, defaulting to English. Any value that
    starts with 'he' (he, he-IL, hebrew) is treated as Hebrew; everything
    else falls back to English so we never regress the English experience on
    an unexpected value. Never raises — settings may be unreadable mid-boot.
    """
    try:
        from core.settings_loader import settings
        sys_block = settings.get("system") if isinstance(settings.get("system"), dict) else {}
        raw = (sys_block or {}).get("language") or settings.get("language") or "en"
    except Exception:
        raw = "en"
    return "he" if str(raw).strip().lower().startswith("he") else "en"


def L(en: str, he: str, lang: str | None = None) -> str:
    """Pick the locale-appropriate string.

    Additive helper for handler confirmation strings. Pass the English text
    (existing behavior) plus a Hebrew rendering; when the home is configured
    for Hebrew (language=he) the Hebrew string is returned, otherwise English.
    `lang` can be forced by callers that already resolved the language.

    Israel-first: Hebrew is a first-class response language, but English stays
    the default so mixed / unset deployments keep working unchanged.
    """
    if lang is None:
        lang = current_language()
    return he if lang == "he" else en


def render_result(res):
    """
    Convert a Ziggy result (dict or other) into a displayable string.

    The empty-string case matters: `ok("")` is how handlers signal
    "intentionally no user-facing reply" (e.g. empty input short-circuit).
    The old `res.get("message") or ...` treated "" as missing and fell
    through to stringifying the whole result dict, leaking "{'ok': True,
    'message': '', 'data': {}}" into the UI. Distinguish key-present-empty
    from key-absent.
    """
    if isinstance(res, dict):
        if "message" in res:
            return res["message"] or ""
        return str(res.get("data") or res)
    return str(res)
