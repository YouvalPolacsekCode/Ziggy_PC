"""Envelope-encryption primitives for the Ziggy backup pipeline.

Pure cryptographic helpers used by services/backup_engine.py (Chunk #4)
and the future scripts/factory/ziggy-restore-device.sh (Chunk #9). No
I/O, no side effects, no global state — every function is deterministic
given its inputs (modulo os.urandom() inside generate_data_key, wrap,
and encrypt_file).

Full design in DESIGN_BACKUP_DR.md §4. Key shape:

  Master key  ── AES-256-GCM ──►  wrapped blob (stored sealed in relay DB)
   (1Password)        ▲
                      │ wrap() / unwrap()
                      ▼
  data_key (per home, runtime)
       │
       │ derive_file_key(data_key, filename)  ── HKDF-SHA256
       ▼
  file_key (per file)
       │
       │ encrypt_file() / decrypt_file()      ── AES-256-GCM
       ▼
  ciphertext bytes uploaded to B2

Manifest HMAC (sign + verify) does NOT live here — it lands in
services/backup_engine.py with the manifest-building code (Chunk #4),
since it operates on assembled-manifest JSON rather than raw key
material.

Note on wrap() return shape: §13 Chunk #2 specifies `-> bytes` (single
blob: nonce || ciphertext || tag). DESIGN_BACKUP_DR.md §10's relay
schema currently splits these into separate columns; Chunk #6 will
reconcile by storing the single blob in one column.
"""

from __future__ import annotations

import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# Versioned HKDF info string. If the derivation context ever changes
# (different key purpose, schema upgrade), bump this so old and new
# derivations cannot collide — old wraps would then become explicitly
# undecryptable rather than silently producing the wrong key.
_HKDF_INFO_FILE_V1 = b"ziggy-backup-file-v1"

# AES-GCM nonce length per NIST SP 800-38D recommendation.
_NONCE_BYTES = 12
# AES-256 key length.
_KEY_BYTES = 32
# AES-GCM authentication tag length (always 16 bytes in cryptography lib).
_TAG_BYTES = 16


def generate_data_key() -> bytes:
    """Fresh 256-bit per-home data key from the OS CSPRNG."""
    return os.urandom(_KEY_BYTES)


def wrap(master: bytes, data_key: bytes) -> bytes:
    """Wrap `data_key` under `master` using AES-256-GCM.

    Returns a single bytes blob: nonce(12) || ciphertext || tag(16).
    Concatenating nonce + ciphertext at the API boundary makes nonce
    reuse impossible at the use site (you cannot accidentally pair the
    wrong nonce with the wrong ciphertext when they are physically
    glued together).
    """
    _require_key(master, "master")
    _require_key(data_key, "data_key")
    nonce = os.urandom(_NONCE_BYTES)
    ct_with_tag = AESGCM(master).encrypt(nonce, data_key, associated_data=None)
    return nonce + ct_with_tag


def unwrap(master: bytes, wrapped: bytes) -> bytes:
    """Inverse of wrap(). Raises InvalidTag on wrong key or tamper."""
    _require_key(master, "master")
    if not isinstance(wrapped, (bytes, bytearray)):
        raise ValueError(f"wrapped must be bytes, got {type(wrapped).__name__}")
    if len(wrapped) < _NONCE_BYTES + _TAG_BYTES:
        raise ValueError("wrapped blob too short")
    nonce, ct_with_tag = wrapped[:_NONCE_BYTES], bytes(wrapped[_NONCE_BYTES:])
    return AESGCM(master).decrypt(bytes(nonce), ct_with_tag, associated_data=None)


def derive_file_key(data_key: bytes, filename: str) -> bytes:
    """HKDF-SHA256 derive a per-file subkey from the per-home data_key.

    `filename` is the HKDF salt — a leaked single-file key can decrypt
    only that filename's ciphertext, not other files under the same
    data_key. The HKDF info string is versioned so a future derivation
    change cannot accidentally collide with v1 outputs.

    Salt is the UTF-8 encoding of `filename`. Case-sensitive — callers
    must use the same string at encrypt and decrypt time.
    """
    _require_key(data_key, "data_key")
    if not isinstance(filename, str) or not filename:
        raise ValueError("filename must be a non-empty str")
    return HKDF(
        algorithm=hashes.SHA256(),
        length=_KEY_BYTES,
        salt=filename.encode("utf-8"),
        info=_HKDF_INFO_FILE_V1,
    ).derive(data_key)


def encrypt_file(plaintext: bytes, file_key: bytes) -> tuple[bytes, bytes, bytes]:
    """Encrypt `plaintext` under `file_key`. Returns (nonce, ciphertext, tag).

    Three-tuple matches DESIGN_BACKUP_DR.md §13 Chunk #2 signature
    exactly. The manifest stores the three pieces separately so each
    can be independently sized and checksummed.
    """
    _require_key(file_key, "file_key")
    nonce = os.urandom(_NONCE_BYTES)
    ct_with_tag = AESGCM(file_key).encrypt(nonce, plaintext, associated_data=None)
    ciphertext, tag = ct_with_tag[:-_TAG_BYTES], ct_with_tag[-_TAG_BYTES:]
    return nonce, ciphertext, tag


def decrypt_file(
    nonce: bytes,
    ciphertext: bytes,
    tag: bytes,
    file_key: bytes,
) -> bytes:
    """Inverse of encrypt_file(). Raises InvalidTag on wrong key or tamper."""
    _require_key(file_key, "file_key")
    if len(nonce) != _NONCE_BYTES:
        raise ValueError(f"nonce must be {_NONCE_BYTES} bytes, got {len(nonce)}")
    if len(tag) != _TAG_BYTES:
        raise ValueError(f"tag must be {_TAG_BYTES} bytes, got {len(tag)}")
    return AESGCM(file_key).decrypt(bytes(nonce), bytes(ciphertext) + bytes(tag), associated_data=None)


def _require_key(key: bytes, name: str) -> None:
    if not isinstance(key, (bytes, bytearray)):
        raise ValueError(f"{name} must be bytes of length {_KEY_BYTES}, got {type(key).__name__}")
    if len(key) != _KEY_BYTES:
        raise ValueError(f"{name} must be {_KEY_BYTES} bytes, got {len(key)}")
