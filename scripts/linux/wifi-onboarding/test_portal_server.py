#!/usr/bin/env python3
# =============================================================================
# test_portal_server.py — hardware-free unit + integration tests for the
# Ziggy Wi-Fi captive-portal server. Pure stdlib (unittest); no Wi-Fi, no pip.
#
#   python3 -m unittest scripts/linux/wifi-onboarding/test_portal_server.py -v
#   python3 scripts/linux/wifi-onboarding/test_portal_server.py            (also runs)
# =============================================================================
import os
import sys
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import portal_server as ps  # noqa: E402


class TestParsing(unittest.TestCase):
    def test_parse_basic(self):
        self.assertEqual(ps.parse_credentials(b"ssid=MyHome&password=secret12"),
                         ("MyHome", "secret12"))

    def test_parse_urlencoded_and_spaces(self):
        # '+' -> space, %20 -> space, trailing whitespace trimmed on ssid
        ssid, pw = ps.parse_credentials(b"ssid=My+Home%20Net+&password=p%40ss word")
        self.assertEqual(ssid, "My Home Net")
        self.assertEqual(pw, "p@ss word")

    def test_parse_missing_fields(self):
        self.assertEqual(ps.parse_credentials(b""), ("", ""))
        self.assertEqual(ps.parse_credentials(b"ssid=Only"), ("Only", ""))

    def test_parse_never_crashes_on_garbage(self):
        # invalid utf-8 / stray bytes must not raise
        ssid, pw = ps.parse_credentials(b"ssid=%FF%FE&password=%00%01")
        self.assertIsInstance(ssid, str)
        self.assertIsInstance(pw, str)


class TestSanitize(unittest.TestCase):
    def test_ssid_ok(self):
        self.assertEqual(ps.sanitize_ssid("Home-WiFi 5G"), "Home-WiFi 5G")

    def test_ssid_rejects_empty(self):
        for bad in ("", "   "):
            with self.assertRaises(ps.CredentialError):
                ps.sanitize_ssid(bad)

    def test_ssid_rejects_too_long(self):
        with self.assertRaises(ps.CredentialError):
            ps.sanitize_ssid("x" * 33)

    def test_ssid_rejects_control_chars(self):
        for bad in ("line\nbreak", "tab\tchar", "null\x00here"):
            with self.assertRaises(ps.CredentialError):
                ps.sanitize_ssid(bad)

    def test_password_open_network(self):
        self.assertEqual(ps.sanitize_password(""), "")

    def test_password_length_bounds(self):
        with self.assertRaises(ps.CredentialError):
            ps.sanitize_password("short")           # < 8
        with self.assertRaises(ps.CredentialError):
            ps.sanitize_password("x" * 64)          # > 63
        self.assertEqual(ps.sanitize_password("goodpass"), "goodpass")

    def test_password_rejects_control(self):
        with self.assertRaises(ps.CredentialError):
            ps.sanitize_password("has\x00null1")


class TestArgvInjectionProof(unittest.TestCase):
    """A malicious SSID/password must land as ONE argv element, never a shell
    string. shell=False + list form is the guarantee; assert the shape."""

    def test_shell_metachars_stay_one_element(self):
        evil_ssid = 'x"; rm -rf / #'
        evil_pw = "$(reboot)`id`; :"
        argv = ps.build_connect_argv(evil_ssid, evil_pw, "wlan0", "nmcli")
        self.assertEqual(argv, [
            "nmcli", "device", "wifi", "connect", evil_ssid,
            "password", evil_pw, "ifname", "wlan0",
        ])
        # the dangerous strings are single, discrete tokens
        self.assertIn(evil_ssid, argv)
        self.assertIn(evil_pw, argv)
        # nothing got concatenated into a compound shell word
        self.assertTrue(all("&&" not in tok and "||" not in tok for tok in argv))

    def test_open_network_omits_password_token(self):
        self.assertEqual(
            ps.build_connect_argv("OpenNet", "", "wlan0", "nmcli"),
            ["nmcli", "device", "wifi", "connect", "OpenNet", "ifname", "wlan0"],
        )

    def test_autoconnect_argv(self):
        self.assertEqual(
            ps.build_autoconnect_argv("Home", "nmcli"),
            ["nmcli", "connection", "modify", "Home", "connection.autoconnect", "yes"],
        )

    def test_password_redacted_in_logs(self):
        argv = ps.build_connect_argv("Home", "supersecret", "wlan0", "nmcli")
        self.assertEqual(ps._redact(argv)[argv.index("password") + 1], "***")


class FakeRunner:
    """Records argv passed to nmcli and returns a scripted result."""
    def __init__(self, returncode=0, stdout="full", stderr=""):
        self.calls = []
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr

    def __call__(self, argv, timeout):
        self.calls.append(argv)
        rc = self.returncode
        # first call = connect; subsequent = autoconnect/verify -> always ok
        outer = self

        class R:
            returncode = rc if len(outer.calls) == 1 else 0
            stdout = outer.stdout
            stderr = outer.stderr
        return R()


class TestWifiJoiner(unittest.TestCase):
    def test_successful_join_calls_right_command(self):
        runner = FakeRunner(returncode=0, stdout="full")
        j = ps.WifiJoiner("wlan0", nmcli_bin="nmcli", runner=runner)
        ok, msg = j.connect("MyHome", "hunter2222")
        self.assertTrue(ok, msg)
        # first nmcli invocation is the connect, with the exact argv
        self.assertEqual(runner.calls[0], [
            "nmcli", "device", "wifi", "connect", "MyHome",
            "password", "hunter2222", "ifname", "wlan0",
        ])
        # autoconnect persistence was attempted
        self.assertIn(
            ["nmcli", "connection", "modify", "MyHome", "connection.autoconnect", "yes"],
            runner.calls,
        )

    def test_join_rejects_bad_credentials_before_calling_nmcli(self):
        runner = FakeRunner()
        j = ps.WifiJoiner("wlan0", nmcli_bin="nmcli", runner=runner)
        ok, msg = j.connect("", "whatever12")   # empty SSID
        self.assertFalse(ok)
        self.assertEqual(runner.calls, [])       # nmcli NEVER invoked

    def test_join_reports_nmcli_failure(self):
        runner = FakeRunner(returncode=4, stderr="Error: no network with SSID")
        j = ps.WifiJoiner("wlan0", nmcli_bin="nmcli", runner=runner)
        ok, msg = j.connect("Nope", "password12")
        self.assertFalse(ok)
        self.assertIn("no network", msg)

    def test_injection_argv_via_joiner(self):
        runner = FakeRunner(returncode=0, stdout="full")
        j = ps.WifiJoiner("wlan0", nmcli_bin="nmcli", runner=runner)
        evil = 'net"; touch /pwned; echo "'
        ok, _ = j.connect(evil, "password12")
        self.assertTrue(ok)
        # the evil SSID is a single argv element handed to subprocess
        self.assertEqual(runner.calls[0][4], evil)


class TestRender(unittest.TestCase):
    def test_placeholders_substituted_and_escaped(self):
        page = ps.render_page("Ziggy-Setup-ab12ff", "ab12ff",
                              status_msg="<script>x</script>", status_class="err",
                              prefill_ssid='"><img>')
        self.assertIn("Ziggy-Setup-ab12ff", page)
        self.assertIn("ab12ff", page)
        # user-controlled status + prefill are HTML-escaped (no raw tags)
        self.assertNotIn("<script>x</script>", page)
        self.assertIn("&lt;script&gt;", page)
        self.assertNotIn('"><img>', page)


class TestHttpRoundTrip(unittest.TestCase):
    """Full POST /connect through the real handler with a fake joiner —
    proves the parsed credentials reach WifiJoiner.connect unchanged."""

    def setUp(self):
        received = {}

        class RecordingJoiner:
            def connect(self, ssid, password):
                received["ssid"] = ssid
                received["password"] = password
                return True, "connected"

        self.received = received
        handler = type("H", (ps.PortalHandler,), {
            "ap_ssid": "Ziggy-Setup-test",
            "device_id": "test",
            "joiner": RecordingJoiner(),
            "on_success": None,
        })
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def test_get_serves_portal(self):
        with urllib.request.urlopen("http://127.0.0.1:%d/" % self.port, timeout=5) as r:
            body = r.read().decode("utf-8")
        self.assertEqual(r.status, 200)
        self.assertIn("Ziggy", body)

    def test_post_connect_forwards_credentials(self):
        data = urllib.parse.urlencode({"ssid": "Cafe WiFi", "password": "letmein123"}).encode()
        req = urllib.request.Request("http://127.0.0.1:%d/connect" % self.port,
                                    data=data, method="POST")
        with urllib.request.urlopen(req, timeout=5) as r:
            self.assertEqual(r.status, 200)
        self.assertEqual(self.received["ssid"], "Cafe WiFi")
        self.assertEqual(self.received["password"], "letmein123")


if __name__ == "__main__":
    unittest.main(verbosity=2)
