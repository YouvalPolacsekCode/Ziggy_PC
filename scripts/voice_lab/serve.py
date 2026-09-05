#!/usr/bin/env python3
"""Local server for the Voice Lab review page. 127.0.0.1 only, stdlib only.

  python scripts/voice_lab/serve.py            # http://127.0.0.1:8765/
  python scripts/voice_lab/serve.py --port 9000

Routes
  GET  /                      review.html
  GET  /api/session?sitting=A corpus, variants on disk, probe pairs, verdicts so far
  GET  /audio/<variant>/<id>.mp3
  GET  /audio/probe/<id>.mp3
  GET  /api/stt_script
  GET  /api/stt_recorded      ids already recorded
  POST /api/verdict           JSON {sitting, mode, line_id, ...} → appended to
                              voice_lab_out/verdicts/<sitting>.jsonl
  POST /api/record?id=s01     raw audio body → voice_lab_out/stt_audio/s01.<ext>
"""
from __future__ import annotations

import argparse
import json
import random
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "voice_lab_out"
VERDICTS = OUT / "verdicts"
STT_AUDIO = OUT / "stt_audio"

# Probe pairs the operator compares blind in sitting A. (left, right, question)
PROBE_PAIRS = [
    ("het1_plain_35", "het1_nikud_35", "nikud", "אותו משפט, פעם בלי ניקוד ופעם עם. איזה נשמע נכון יותר?"),
    ("het2_plain_35", "het2_nikud_35", "nikud", "״הספר ספר את הכסף וסיפר לי״ — בלי/עם ניקוד"),
    ("het1_plain_35", "het1_plain_36", "model", "אותו משפט, מודל 3.5 מול 3.6"),
    ("num_35",        "num_36",        "model", "מספרים ואחוזים, 3.5 מול 3.6"),
    ("name_35",       "name_36",       "model", "שמות ו-Netflix, 3.5 מול 3.6"),
    ("name_35",       "dict_name_35",  "dict",  "אותו משפט, עם/בלי מילון הגייה (רוני, מזגן, Netflix)"),
    ("het1_plain_35", "speed_slow_35", "speed", "אותו משפט, מהירות רגילה מול איטית"),
    ("het1_plain_35", "speed_fast_35", "speed", "אותו משפט, מהירות רגילה מול מהירה"),
]
PROBE_SINGLES = ["time_35", "inline_ipa_35", "het2_nikud_36"]


def _json(handler: BaseHTTPRequestHandler, obj, status: int = 200) -> None:
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _load_verdicts(sitting: str) -> list[dict]:
    p = VERDICTS / f"{sitting}.jsonl"
    if not p.exists():
        return []
    return [json.loads(x) for x in p.read_text().splitlines() if x.strip()]


def _variants_on_disk() -> dict[str, dict]:
    out = {}
    for d in sorted(OUT.iterdir()) if OUT.exists() else []:
        m = d / "manifest.json"
        if d.is_dir() and m.exists():
            out[d.name] = json.loads(m.read_text())
    return out


def _probes() -> dict[str, dict]:
    p = OUT / "probe" / "probes.json"
    if not p.exists():
        return {}
    return {r["id"]: r for r in json.loads(p.read_text()) if r.get("ok") and r.get("file")}


def session_payload(sitting: str, ab: str | None) -> dict:
    corpus = yaml.safe_load((HERE / "corpus.yaml").read_text())["lines"]
    probes = _probes()
    pairs = []
    rnd = random.Random(sitting)  # stable shuffle per sitting so resume matches
    for left, right, kind, q in PROBE_PAIRS:
        if left in probes and right in probes:
            flip = rnd.random() < 0.5
            a, b = (right, left) if flip else (left, right)
            pairs.append({"id": f"{left}__{right}", "kind": kind, "question": q,
                          "a": {"id": a, "url": f"/audio/probe/{a}.mp3"},
                          "b": {"id": b, "url": f"/audio/probe/{b}.mp3"},
                          "text": probes[left]["text"]})
    singles = [{"id": s, "text": probes[s]["text"], "url": f"/audio/probe/{s}.mp3"}
               for s in PROBE_SINGLES if s in probes]
    variants = _variants_on_disk()
    ab_pairs = []
    if ab:
        va, vb = ab.split(",")
        ma, mb = variants.get(va, {}), variants.get(vb, {})
        for line in corpus:
            lid = line["id"]
            if lid in ma and lid in mb and ma[lid].get("ok") and mb[lid].get("ok"):
                flip = rnd.random() < 0.5
                a, b = (vb, va) if flip else (va, vb)
                ab_pairs.append({"id": f"{lid}", "text": line["text"], "bucket": line["bucket"],
                                 "a": {"variant": a, "url": f"/audio/{a}/{lid}.mp3"},
                                 "b": {"variant": b, "url": f"/audio/{b}/{lid}.mp3"}})
    return {
        "sitting": sitting,
        "corpus": corpus,
        "variants": {k: {lid: {"ok": r.get("ok"), "sent": r.get("text"), "duration_s": r.get("duration_s")}
                         for lid, r in v.items()} for k, v in variants.items()},
        "probe_pairs": pairs,
        "probe_singles": singles,
        "ab_pairs": ab_pairs,
        "verdicts": _load_verdicts(sitting),
        "stt_script": yaml.safe_load((HERE / "stt_script.yaml").read_text())["lines"],
        "stt_recorded": sorted(p.stem for p in STT_AUDIO.glob("*")) if STT_AUDIO.exists() else [],
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter
        if "/audio/" not in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def _send_file(self, path: Path, ctype: str) -> None:
        if not path.exists() or not path.is_file():
            _json(self, {"error": "not found", "path": str(path)}, 404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path in ("/", "/review.html"):
            self._send_file(HERE / "review.html", "text/html; charset=utf-8")
        elif u.path == "/api/session":
            _json(self, session_payload(q.get("sitting", ["A"])[0], q.get("ab", [None])[0]))
        elif u.path.startswith("/audio/"):
            rel = u.path[len("/audio/"):]
            if ".." in rel:
                _json(self, {"error": "bad path"}, 400); return
            self._send_file(OUT / rel, "audio/mpeg")
        else:
            _json(self, {"error": "no route"}, 404)

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        if u.path == "/api/verdict":
            rec = json.loads(body.decode("utf-8"))
            rec["ts"] = time.time()
            sitting = rec.get("sitting", "A")
            VERDICTS.mkdir(parents=True, exist_ok=True)
            with (VERDICTS / f"{sitting}.jsonl").open("a", encoding="utf-8") as fp:
                fp.write(json.dumps(rec, ensure_ascii=False) + "\n")
            _json(self, {"ok": True})
        elif u.path == "/api/record":
            lid = q.get("id", [""])[0]
            if not lid or "/" in lid or ".." in lid:
                _json(self, {"error": "bad id"}, 400); return
            ctype = (self.headers.get("Content-Type") or "audio/webm").split(";")[0]
            ext = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav"}.get(ctype, "webm")
            STT_AUDIO.mkdir(parents=True, exist_ok=True)
            for old in STT_AUDIO.glob(f"{lid}.*"):
                old.unlink()
            (STT_AUDIO / f"{lid}.{ext}").write_bytes(body)
            _json(self, {"ok": True, "bytes": len(body), "file": f"{lid}.{ext}"})
        else:
            _json(self, {"error": "no route"}, 404)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Voice Lab: http://127.0.0.1:{a.port}/   (Ctrl-C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
