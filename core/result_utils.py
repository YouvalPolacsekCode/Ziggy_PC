# core/result_utils.py
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
