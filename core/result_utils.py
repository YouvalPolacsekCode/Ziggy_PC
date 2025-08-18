# core/result_utils.py
def render_result(res):
    """
    Convert a Ziggy result (dict or other) into a displayable string.
    """
    if isinstance(res, dict):
        return res.get("message") or str(res.get("data") or res)
    return str(res)
