#!/usr/bin/env python3
# =============================================================================
# portal_server.py — stdlib-only captive-portal server for Ziggy Wi-Fi
# onboarding on a headless Ubuntu 24.04 hub (NetworkManager / nmcli).
#
# Serves a bilingual (he/en, RTL) setup page over the onboarding AP, collects
# the customer's home SSID + password, then joins via `nmcli device wifi
# connect`, verifies connectivity, marks the connection autoconnect=yes (so it
# survives reboot), and exits 0 on success so wifi-onboard.sh can tear the AP
# down. If the join fails it stays up and lets the customer retry.
#
# NO third-party deps (http.server, urllib, subprocess only) — this must run on
# a box with no internet and no pip. Every nmcli call is argv-only (a Python
# list handed straight to subprocess with shell=False) so a customer SSID or
# password can never inject a shell command, regardless of its contents.
#
# Testable without Wi-Fi hardware:
#   * pure functions parse_credentials / sanitize_ssid / sanitize_password /
#     build_connect_argv have no side effects — unit-tested in test_portal_server.py
#   * WifiJoiner takes an injectable `runner` (default subprocess.run); tests
#     pass a fake runner that records argv and returns a canned result.
#   * --dry-run prints the nmcli plan and never mutates the system.
#
# USAGE
#   portal_server.py --iface wlan0 --ssid-ap Ziggy-Setup-ab12ff
#   portal_server.py --iface wlan0 --dry-run          # print plan, no mutation
#   portal_server.py --self-test                      # run built-in assertions
#   ZIGGY_NMCLI_BIN=/path/to/mock portal_server.py --iface wlan0
#
# EXIT: 0 joined home Wi-Fi (AP can be torn down); 2 bad args; 130 interrupted.
# =============================================================================
import argparse
import html
import logging
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = logging.getLogger("wifi-portal")

# --- constants ---------------------------------------------------------------
SSID_MAX = 32          # IEEE 802.11 SSID max length (octets)
PSK_MIN = 8            # WPA2-PSK minimum
PSK_MAX = 63           # WPA2-PSK maximum (passphrase form)
NMCLI_BIN = os.environ.get("ZIGGY_NMCLI_BIN", "nmcli")
HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(HERE, "portal.html")

# Common OS captive-portal probe paths; answering them nudges phones/laptops to
# pop the "sign in to network" sheet straight onto our page.
PROBE_PATHS = {
    "/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
    "/ncsi.txt", "/connecttest.txt", "/redirect", "/canonical.html", "/success.txt",
}


# --- pure, unit-tested helpers ----------------------------------------------
class CredentialError(ValueError):
    """Raised when submitted SSID/password fail validation."""


def parse_credentials(body: bytes):
    """Parse an application/x-www-form-urlencoded POST body into (ssid, password).

    Returns raw (unsanitised) strings; callers must pass them through
    sanitize_ssid / sanitize_password. Never raises on malformed input — returns
    empty strings for missing fields.
    """
    data = urllib.parse.parse_qs(body.decode("utf-8", "replace"), keep_blank_values=True)
    ssid = (data.get("ssid", [""])[0] or "").strip()
    password = data.get("password", [""])[0] or ""
    return ssid, password


def sanitize_ssid(ssid: str) -> str:
    """Validate an SSID. Length 1..32, no control chars. Returns it unchanged.

    We do NOT escape or rewrite the SSID — it is handed to nmcli as a single
    argv element (shell=False), so metacharacters are inert. We only reject
    values that can't be a valid SSID at all.
    """
    if ssid is None:
        raise CredentialError("missing ssid")
    ssid = ssid.strip()
    if not ssid:
        raise CredentialError("empty ssid")
    if len(ssid.encode("utf-8")) > SSID_MAX:
        raise CredentialError("ssid too long")
    if any(ord(c) < 0x20 or ord(c) == 0x7f for c in ssid):
        raise CredentialError("ssid has control characters")
    return ssid


def sanitize_password(password: str) -> str:
    """Validate a WPA2 passphrase. Empty == open network. Else 8..63 chars.

    Like the SSID, the passphrase is passed as a lone argv element, so no
    escaping is needed or done — validation only enforces WPA2 length rules and
    rejects control characters.
    """
    if password is None:
        return ""
    if password == "":
        return ""  # open network
    if any(ord(c) < 0x20 or ord(c) == 0x7f for c in password):
        raise CredentialError("password has control characters")
    if not (PSK_MIN <= len(password) <= PSK_MAX):
        raise CredentialError("password must be 8..63 characters")
    return password


def build_connect_argv(ssid: str, password: str, iface: str, nmcli_bin: str = NMCLI_BIN):
    """Build the argv list for `nmcli device wifi connect`.

    Injection-proof by construction: ssid/password/iface are discrete list
    elements. An open network (empty password) omits the `password` token.
    """
    argv = [nmcli_bin, "device", "wifi", "connect", ssid]
    if password:
        argv += ["password", password]
    if iface:
        argv += ["ifname", iface]
    return argv


def build_autoconnect_argv(ssid: str, nmcli_bin: str = NMCLI_BIN):
    """argv to persist the joined connection across reboots."""
    return [nmcli_bin, "connection", "modify", ssid, "connection.autoconnect", "yes"]


def build_connectivity_argv(nmcli_bin: str = NMCLI_BIN):
    return [nmcli_bin, "networking", "connectivity", "check"]


# --- Wi-Fi joiner (side-effecting, but runner is injectable for tests) -------
class WifiJoiner:
    def __init__(self, iface, nmcli_bin=NMCLI_BIN, dry_run=False, runner=None,
                 connect_timeout=45):
        self.iface = iface
        self.nmcli_bin = nmcli_bin
        self.dry_run = dry_run
        self.connect_timeout = connect_timeout
        # runner(argv, timeout) -> object with .returncode, .stdout, .stderr
        self.runner = runner or self._default_runner

    def _default_runner(self, argv, timeout):
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout)

    def _run(self, argv):
        if self.dry_run:
            LOG.info("[dry-run] %s", " ".join(argv))
            class _Fake:  # minimal CompletedProcess stand-in
                returncode, stdout, stderr = 0, "full", ""
            return _Fake()
        LOG.info("exec: %s", " ".join(_redact(argv)))
        return self.runner(argv, self.connect_timeout)

    def connect(self, ssid, password):
        """Validate + join. Returns (ok: bool, message: str). Never raises."""
        try:
            ssid = sanitize_ssid(ssid)
            password = sanitize_password(password)
        except CredentialError as exc:
            return False, str(exc)

        argv = build_connect_argv(ssid, password, self.iface, self.nmcli_bin)
        try:
            res = self._run(argv)
        except subprocess.TimeoutExpired:
            return False, "connect timed out"
        except FileNotFoundError:
            return False, "nmcli not found"
        if res.returncode != 0:
            return False, (res.stderr or "join failed").strip()[:200]

        # Persist across reboot (best-effort — join already succeeded).
        try:
            self._run(build_autoconnect_argv(ssid, self.nmcli_bin))
        except Exception:  # noqa: BLE001 - persistence is best-effort
            LOG.warning("could not set autoconnect on %s", ssid)

        if not self.verify():
            return False, "joined but no connectivity"
        return True, "connected"

    def verify(self):
        """True when NetworkManager reports full/limited connectivity."""
        try:
            res = self._run(build_connectivity_argv(self.nmcli_bin))
        except Exception:  # noqa: BLE001
            return False
        out = (res.stdout or "").strip().lower()
        return out in ("full", "limited") or res.returncode == 0 and out == ""


def _redact(argv):
    """Copy of argv with the WPA2 passphrase masked for logs."""
    out = list(argv)
    for i, tok in enumerate(out):
        if tok == "password" and i + 1 < len(out):
            out[i + 1] = "***"
    return out


# --- HTML rendering ----------------------------------------------------------
def _fallback_template():
    return (
        "<!doctype html><meta charset=utf-8><title>Ziggy Wi-Fi</title>"
        "<body dir=rtl><h1>Ziggy · הגדרת Wi-Fi</h1>"
        "<div>{{STATUS_MSG}}</div>"
        "<form method=POST action=/connect>"
        "<p>SSID <input name=ssid maxlength=32 required value=\"{{PREFILL_SSID}}\"></p>"
        "<p>Password <input name=password type=password maxlength=63></p>"
        "<button>Connect / התחבר</button></form>"
        "<p>{{SSID}} · {{DEVICE_ID}}</p></body>"
    )


def render_page(ap_ssid, device_id, status_msg="", status_class="", prefill_ssid=""):
    try:
        with open(TEMPLATE_PATH, "r", encoding="utf-8") as fh:
            tpl = fh.read()
    except OSError:
        tpl = _fallback_template()
    repl = {
        "{{SSID}}": html.escape(ap_ssid),
        "{{DEVICE_ID}}": html.escape(device_id),
        "{{STATUS_MSG}}": html.escape(status_msg),
        "{{STATUS_CLASS}}": status_class,          # controlled vocab, not user text
        "{{PREFILL_SSID}}": html.escape(prefill_ssid, quote=True),
    }
    for k, v in repl.items():
        tpl = tpl.replace(k, v)
    return tpl


# --- HTTP handler ------------------------------------------------------------
class PortalHandler(BaseHTTPRequestHandler):
    server_version = "ZiggyWifiPortal/1.0"

    # injected by the server factory
    ap_ssid = "Ziggy-Setup"
    device_id = "unknown"
    joiner = None
    on_success = None  # callable() -> None to signal wifi-onboard.sh

    def log_message(self, fmt, *args):  # route access logs through logging
        LOG.info("%s - %s", self.address_string(), fmt % args)

    def _send_html(self, body, code=200, extra_headers=None):
        payload = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _portal(self, status_msg="", status_class="", prefill=""):
        self._send_html(render_page(self.ap_ssid, self.device_id, status_msg,
                                    status_class, prefill))

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        # Captive-portal probes → redirect the OS onto the setup page.
        if path in PROBE_PATHS:
            self.send_response(302)
            self.send_header("Location", "/")
            self.end_headers()
            return
        # Everything else serves the portal (a naive captive catch-all).
        self._portal()

    do_HEAD = do_GET

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path != "/connect":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 0 or length > 4096:  # setup form is tiny; cap it
            self._portal("Bad request", "err")
            return
        body = self.rfile.read(length)
        ssid, password = parse_credentials(body)
        LOG.info("join request for ssid=%r (pw %d chars)", ssid, len(password))

        ok, msg = self.joiner.connect(ssid, password)
        if ok:
            self._portal(
                "מחובר! ניתן לנתק מרשת ההתקנה. / Connected — you can leave the setup network.",
                "ok")
            if callable(self.on_success):
                # Let the response flush before the AP is torn down.
                threading.Thread(target=self._delayed_success, daemon=True).start()
        else:
            LOG.warning("join failed: %s", msg)
            self._portal(
                "החיבור נכשל: %s · נסה שוב. / Connection failed: %s — please retry." % (msg, msg),
                "err", prefill=ssid)

    def _delayed_success(self):
        time.sleep(1.5)
        try:
            self.on_success()
        except Exception:  # noqa: BLE001
            LOG.exception("on_success hook failed")


# --- server driver -----------------------------------------------------------
def serve(iface, ap_ssid, device_id, host="0.0.0.0", port=80, dry_run=False,
          nmcli_bin=NMCLI_BIN, once=True):
    """Run the portal until a successful join (when once=True) or forever."""
    joiner = WifiJoiner(iface=iface, nmcli_bin=nmcli_bin, dry_run=dry_run)
    stop = threading.Event()

    handler = type("BoundPortalHandler", (PortalHandler,), {
        "ap_ssid": ap_ssid,
        "device_id": device_id,
        "joiner": joiner,
        "on_success": (lambda: stop.set()) if once else None,
    })

    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.timeout = 1
    LOG.info("captive portal listening on http://%s:%d (AP %s, iface %s)",
             host, port, ap_ssid, iface)
    try:
        while not stop.is_set():
            httpd.handle_request()
    except KeyboardInterrupt:
        LOG.info("interrupted")
        return 130
    finally:
        httpd.server_close()
    if stop.is_set():
        LOG.info("home Wi-Fi joined — portal shutting down")
        return 0
    return 0


# --- self-test (no network, no pip) -----------------------------------------
def _self_test():
    # parse
    s, p = parse_credentials(b"ssid=Home-WiFi&password=hunter22")
    assert s == "Home-WiFi" and p == "hunter22", (s, p)
    # sanitize rejects
    for bad in ["", "x" * 40, "ab\ncd"]:
        try:
            sanitize_ssid(bad); assert False, "should reject %r" % bad
        except CredentialError:
            pass
    for bad in ["short", "x" * 64, "has\x00null"]:
        try:
            sanitize_password(bad); assert False, "should reject %r" % bad
        except CredentialError:
            pass
    assert sanitize_password("") == ""  # open ok
    # injection stays a single argv element
    evil = 'evil"; rm -rf /; echo "'
    argv = build_connect_argv(evil, "pw; reboot #", "wlan0", "nmcli")
    assert evil in argv and "pw; reboot #" in argv
    assert argv == ["nmcli", "device", "wifi", "connect", evil,
                    "password", "pw; reboot #", "ifname", "wlan0"]
    # open network omits the password token
    assert build_connect_argv("Open", "", "wlan0", "nmcli") == \
        ["nmcli", "device", "wifi", "connect", "Open", "ifname", "wlan0"]
    # redaction
    assert _redact(argv)[6] == "***"
    # joiner with fake runner records the right argv
    calls = []
    def fake_runner(a, timeout):
        calls.append(a)
        class R: returncode, stdout, stderr = 0, "full", ""
        return R()
    j = WifiJoiner("wlan0", nmcli_bin="nmcli", runner=fake_runner)
    ok, msg = j.connect("Home", "password1")
    assert ok, msg
    assert calls[0] == ["nmcli", "device", "wifi", "connect", "Home",
                        "password", "password1", "ifname", "wlan0"]
    # render substitutes and escapes
    pg = render_page("Ziggy-Setup-ab12", "ab12", "<x>", "err", '"><b>')
    assert "Ziggy-Setup-ab12" in pg and "<x>" not in pg and "&lt;x&gt;" in pg
    print("self-test OK")
    return 0


# --- CLI ---------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="Ziggy Wi-Fi captive portal")
    ap.add_argument("--iface", default=os.environ.get("ZIGGY_WIFI_IFACE", ""),
                    help="Wi-Fi interface to join with (e.g. wlan0)")
    ap.add_argument("--ssid-ap", default=os.environ.get("ZIGGY_AP_SSID", "Ziggy-Setup"),
                    help="the onboarding AP SSID (shown on the page)")
    ap.add_argument("--device-id", default=os.environ.get("ZIGGY_DEVICE_ID", "unknown"))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=int(os.environ.get("ZIGGY_PORTAL_PORT", "80")))
    ap.add_argument("--nmcli-bin", default=NMCLI_BIN)
    ap.add_argument("--dry-run", action="store_true", help="print the plan; no mutation")
    ap.add_argument("--keep-serving", action="store_true",
                    help="do not exit after a successful join (debug)")
    ap.add_argument("--self-test", action="store_true", help="run built-in assertions and exit")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)sZ [%(levelname)-5s] wifi-portal: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    if args.self_test:
        return _self_test()

    if args.dry_run:
        LOG.info("dry-run: would serve captive portal on %s:%d for AP %s (iface %s)",
                 args.host, args.port, args.ssid_ap, args.iface or "<auto>")
        LOG.info("dry-run: on submit would exec: %s",
                 " ".join(_redact(build_connect_argv("<home-ssid>", "<pw>",
                          args.iface or "wlan0", args.nmcli_bin))))
        return 0

    return serve(iface=args.iface, ap_ssid=args.ssid_ap, device_id=args.device_id,
                 host=args.host, port=args.port, dry_run=args.dry_run,
                 nmcli_bin=args.nmcli_bin, once=not args.keep_serving)


if __name__ == "__main__":
    sys.exit(main())
