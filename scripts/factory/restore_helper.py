#!/usr/bin/env python3
"""Crypto + B2 + manifest helpers for ziggy-restore-device.sh.

Single-file utility invoked by the bash restore script for the operations
that need real crypto (AES-GCM, HKDF, HMAC), JSON parsing, B2 downloads,
and atomic key-file writes. The bash script handles prompts, docker
compose, and filesystem moves.

Why split this way: pure-bash restore would need shelling to openssl
for AES-GCM and a reimplementation of HKDF — much riskier than reusing
services/backup_keys.py and services/backup_engine.py. The bash script
stays the named entry point per DESIGN_BACKUP_DR.md §13 Chunk #9; this
helper lives alongside it in scripts/factory/.

Subcommands:
  decrypt-manifest        decrypt + HMAC-verify + schema-check the manifest
  decrypt-file            decrypt one ciphertext blob to stdout / file
  download-b2             fetch one B2 object by key
  verify-coordinator      check the manifest's coordinator_type vs the new hub
  write-keys              persist data_key + b2_credentials to /etc/ziggy/

Schema-version impl flag (DESIGN_BACKUP_DR.md §13 Chunk #9): decrypt-manifest
aborts with a clear message if the manifest's schema_version > the KNOWN
value, BEFORE any extraction can happen.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys


# Make sibling repo imports work from any cwd (script may run via absolute path).
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(os.path.dirname(_HERE))
if _REPO not in sys.path:
    sys.path.insert(0, _REPO)

# Lazy imports inside command handlers — keeps `--help` fast and lets the
# script run when only some sub-deps are installed (e.g. yaml not needed
# for decrypt-manifest).


# ---------- decrypt-manifest ----------

def cmd_decrypt_manifest(args) -> int:
    """Read encrypted manifest from stdin, write decrypted JSON to stdout.

    Three things must be true before we return success:
      1. AES-GCM tag verifies (data_key is correct, ciphertext untampered)
      2. HMAC over the inner manifest verifies (data_key matches)
      3. schema_version <= SCHEMA_VERSION (this agent can interpret it)

    If any fails, exit non-zero with a clear stderr message — the bash
    script aborts the restore.
    """
    from services import backup_keys
    from services.backup_engine import (
        SCHEMA_VERSION, parse_manifest, verify_manifest_signature,
    )

    data_key = _read_data_key(args.data_key_file)
    blob = sys.stdin.buffer.read()
    if len(blob) < 12 + 16:
        _die("manifest blob too short — expected nonce(12)+ct+tag(16)")

    nonce = blob[:12]
    body = blob[12:]
    ct, tag = body[:-16], body[-16:]
    fk = backup_keys.derive_file_key(data_key, "manifest.json.enc")
    try:
        signed_bytes = backup_keys.decrypt_file(nonce, ct, tag, fk)
    except Exception as e:
        _die(f"manifest decryption failed ({type(e).__name__}); "
             "wrong data_key or corrupted blob")

    try:
        bundle = json.loads(signed_bytes)
        manifest_bytes = base64.b64decode(bundle["manifest"])
        signature = base64.b64decode(bundle["hmac"])
    except Exception as e:
        _die(f"signed-manifest envelope malformed: {e}")

    if not verify_manifest_signature(manifest_bytes, signature, data_key):
        _die("manifest HMAC verification FAILED — refusing to restore "
             "(either data_key is wrong or the bundle was tampered with)")

    try:
        parsed = parse_manifest(manifest_bytes)
    except ValueError as e:
        # parse_manifest already includes the "schema_version > KNOWN" guard.
        _die(f"manifest schema check failed: {e}")

    sys.stderr.write(
        f"manifest ok — schema_version={parsed.get('schema_version')}, "
        f"files={len(parsed.get('files') or [])}, "
        f"coordinator={parsed.get('coordinator_type')!r}\n"
    )
    json.dump(parsed, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


# ---------- decrypt-file ----------

def cmd_decrypt_file(args) -> int:
    """Decrypt one ciphertext blob from stdin → stdout (or args.output)."""
    from services import backup_keys

    data_key = _read_data_key(args.data_key_file)
    blob = sys.stdin.buffer.read()
    if len(blob) < 12 + 16:
        _die(f"blob for {args.filename} too short")

    nonce = blob[:12]
    body = blob[12:]
    ct, tag = body[:-16], body[-16:]
    fk = backup_keys.derive_file_key(data_key, args.filename)
    try:
        plaintext = backup_keys.decrypt_file(nonce, ct, tag, fk)
    except Exception as e:
        _die(f"decrypt failed for {args.filename}: {type(e).__name__}")

    out = sys.stdout.buffer if args.output == "-" else open(args.output, "wb")
    try:
        out.write(plaintext)
    finally:
        if args.output != "-":
            out.close()
    return 0


# ---------- download-b2 ----------

def cmd_download_b2(args) -> int:
    """Fetch one B2 object using the per-home credentials we just unsealed."""
    import boto3

    try:
        creds = json.loads(args.b2_credentials_json)
    except Exception as e:
        _die(f"b2_credentials_json is not valid JSON: {e}")

    endpoint = creds.get("b2_endpoint", "https://s3.eu-central-003.backblazeb2.com")
    key_id = creds.get("b2_key_id")
    app_key = creds.get("b2_app_key")
    if not key_id or not app_key:
        _die("b2_credentials_json must contain b2_key_id and b2_app_key")

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=app_key,
    )
    try:
        resp = client.get_object(Bucket=args.bucket, Key=args.key)
    except Exception as e:
        _die(f"B2 download failed for {args.bucket}/{args.key}: {e}")

    body = resp["Body"].read()
    if args.output == "-":
        sys.stdout.buffer.write(body)
    else:
        with open(args.output, "wb") as f:
            f.write(body)
    return 0


# ---------- verify-coordinator ----------

def cmd_verify_coordinator(args) -> int:
    """Compare the manifest's coordinator_type against the new hub's kit manifest.

    Exit modes:
      match → exit 0
      mismatch + --allow-switch → warn on stderr, exit 0
      mismatch + no flag → exit 1
      kit_manifest missing → exit 1 unless --allow-missing
    """
    if not os.path.isfile(args.kit_manifest):
        if args.allow_missing:
            sys.stderr.write(
                f"WARNING: kit manifest not found at {args.kit_manifest} — "
                "proceeding under --allow-missing\n"
            )
            return 0
        _die(
            f"kit manifest not found at {args.kit_manifest} — cannot verify "
            "coordinator. Pass --allow-missing if intentional (advanced)."
        )

    import yaml
    try:
        kit = yaml.safe_load(open(args.kit_manifest).read()) or {}
    except Exception as e:
        _die(f"kit manifest malformed: {e}")

    hub_coord = kit.get("coordinator_type")
    if not hub_coord:
        _die("kit manifest missing coordinator_type")

    if hub_coord != args.manifest_coord:
        if not args.allow_switch:
            _die(
                f"coordinator mismatch: backup is {args.manifest_coord!r}, "
                f"new hub is {hub_coord!r}. Pass --allow-coordinator-switch "
                "if you intend to cross-restore (advanced — see DESIGN_BACKUP_DR.md §8)."
            )
        sys.stderr.write(
            f"WARNING: coordinator switch — backup={args.manifest_coord} → "
            f"hub={hub_coord}. Sensors will adopt the network key seamlessly.\n"
        )
    else:
        sys.stderr.write(
            f"coordinator match: {hub_coord}\n"
        )
    return 0


# ---------- write-keys ----------

def cmd_write_keys(args) -> int:
    """Persist data_key (raw 32 bytes) and b2_credentials (JSON) to disk, mode 0600.

    The hub's runtime backup engine reads data_key from
    settings.backup.data_key_path (defaults /etc/ziggy/data_key) and the
    B2 credentials from settings.backup.b2_credentials_path. Both files
    are root-owned, mode 0600, and intentionally OUTSIDE the backup
    bundle to avoid circular dependency on restore.
    """
    try:
        data_key = base64.b64decode(args.data_key_b64, validate=True)
    except Exception as e:
        _die(f"data_key_b64 is not valid base64: {e}")
    if len(data_key) != 32:
        _die(f"data_key must decode to 32 bytes, got {len(data_key)}")

    try:
        b2_creds = json.loads(args.b2_credentials_json)
    except Exception as e:
        _die(f"b2_credentials_json is not valid JSON: {e}")
    if not isinstance(b2_creds, dict):
        _die("b2_credentials_json must be a JSON object")

    # Write atomically: write to a temp file in the same dir, then rename.
    _write_atomic(args.data_key_path, data_key, mode=0o600)
    _write_atomic(
        args.b2_credentials_path,
        json.dumps(b2_creds, indent=2).encode("utf-8") + b"\n",
        mode=0o600,
    )
    sys.stderr.write(
        f"wrote {args.data_key_path} (mode 0600) + "
        f"{args.b2_credentials_path} (mode 0600)\n"
    )
    return 0


# ---------- internals ----------

def _read_data_key(path: str) -> bytes:
    """Read a base64-encoded 32-byte data_key from a file."""
    try:
        raw = open(path).read().strip()
    except FileNotFoundError:
        _die(f"data_key file not found at {path}")
    try:
        key = base64.b64decode(raw, validate=True)
    except Exception as e:
        _die(f"data_key file at {path} is not valid base64: {e}")
    if len(key) != 32:
        _die(f"data_key at {path} must decode to 32 bytes, got {len(key)}")
    return key


def _write_atomic(path: str, content: bytes, *, mode: int) -> None:
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    # Open with the right mode from the start (avoids a window where the
    # tmp file has 644 before chmod).
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        os.write(fd, content)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)
    # Re-chmod the final path in case the rename inherited prior perms
    # (filesystems vary on this).
    os.chmod(path, mode)


def _die(msg: str) -> None:
    sys.stderr.write(f"restore_helper: {msg}\n")
    raise SystemExit(1)


# ---------- CLI ----------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="restore_helper",
        description="Crypto + B2 + manifest helpers invoked by ziggy-restore-device.sh.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    dm = sub.add_parser("decrypt-manifest",
                        help="Decrypt + HMAC-verify + schema-check manifest from stdin.")
    dm.add_argument("--data-key-file", required=True,
                    help="Path to a file containing the base64 data_key.")
    dm.set_defaults(func=cmd_decrypt_manifest)

    df = sub.add_parser("decrypt-file",
                        help="Decrypt one ciphertext blob from stdin.")
    df.add_argument("--data-key-file", required=True)
    df.add_argument("--filename", required=True,
                    help="Filename used as the HKDF salt (e.g. 'ha-config.tar.gz.enc').")
    df.add_argument("--output", default="-",
                    help="Output path, or '-' for stdout (default).")
    df.set_defaults(func=cmd_decrypt_file)

    db = sub.add_parser("download-b2",
                        help="Download one B2 object.")
    db.add_argument("--b2-credentials-json", required=True,
                    help="JSON string with b2_key_id, b2_app_key, optional b2_endpoint.")
    db.add_argument("--bucket", required=True)
    db.add_argument("--key", required=True)
    db.add_argument("--output", required=True, help="Output path, or '-' for stdout.")
    db.set_defaults(func=cmd_download_b2)

    vc = sub.add_parser("verify-coordinator",
                        help="Compare backup's coordinator vs new hub's kit manifest.")
    vc.add_argument("--kit-manifest", required=True)
    vc.add_argument("--manifest-coord", required=True,
                    help="The coordinator_type from the backup's manifest.")
    vc.add_argument("--allow-switch", action="store_true",
                    help="Permit cross-coordinator restore (advanced).")
    vc.add_argument("--allow-missing", action="store_true",
                    help="Permit restore when no kit manifest exists on the new hub.")
    vc.set_defaults(func=cmd_verify_coordinator)

    wk = sub.add_parser("write-keys",
                        help="Atomically write data_key + b2_credentials to disk (mode 0600).")
    wk.add_argument("--data-key-b64", required=True)
    wk.add_argument("--b2-credentials-json", required=True)
    wk.add_argument("--data-key-path", required=True)
    wk.add_argument("--b2-credentials-path", required=True)
    wk.set_defaults(func=cmd_write_keys)

    return p


def main(argv=None) -> int:
    args = _build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
