"""Tests for services/backup_keys.py — envelope encryption primitives.

Coverage targets:
  - generate_data_key  : shape + randomness
  - wrap / unwrap      : round-trip, non-determinism, tamper, wrong key
  - derive_file_key    : determinism, distinctness across inputs,
                         match against an RFC-5869 reference impl
  - encrypt_file / decrypt_file : round-trip, tamper paths, bad inputs
  - full envelope chain: master → data_key → file_key → ciphertext → back
"""
from __future__ import annotations

import hashlib
import hmac

import pytest
from cryptography.exceptions import InvalidTag

from services import backup_keys as bk


# ---------- fixtures ----------

@pytest.fixture
def master():
    return bytes.fromhex("aa" * 32)


@pytest.fixture
def data_key():
    return bytes.fromhex("bb" * 32)


# ---------- generate_data_key ----------

def test_generate_data_key_is_32_bytes():
    key = bk.generate_data_key()
    assert isinstance(key, bytes)
    assert len(key) == 32


def test_generate_data_key_is_random():
    keys = {bk.generate_data_key() for _ in range(50)}
    assert len(keys) == 50  # collisions effectively impossible


# ---------- wrap / unwrap ----------

def test_wrap_unwrap_roundtrip(master, data_key):
    wrapped = bk.wrap(master, data_key)
    assert bk.unwrap(master, wrapped) == data_key


def test_wrap_blob_shape(master, data_key):
    # 12-byte nonce || 32-byte ciphertext || 16-byte tag = 60 bytes total
    # for a 32-byte plaintext data_key.
    wrapped = bk.wrap(master, data_key)
    assert len(wrapped) == 12 + 32 + 16


def test_wrap_is_nondeterministic(master, data_key):
    a = bk.wrap(master, data_key)
    b = bk.wrap(master, data_key)
    assert a != b
    assert bk.unwrap(master, a) == data_key
    assert bk.unwrap(master, b) == data_key


def test_unwrap_wrong_master_raises(master, data_key):
    wrapped = bk.wrap(master, data_key)
    wrong_master = bytes.fromhex("cc" * 32)
    with pytest.raises(InvalidTag):
        bk.unwrap(wrong_master, wrapped)


def test_unwrap_tampered_ciphertext_raises(master, data_key):
    wrapped = bytearray(bk.wrap(master, data_key))
    wrapped[20] ^= 0x01  # flip a bit inside the ciphertext region
    with pytest.raises(InvalidTag):
        bk.unwrap(master, bytes(wrapped))


def test_unwrap_tampered_tag_raises(master, data_key):
    wrapped = bytearray(bk.wrap(master, data_key))
    wrapped[-1] ^= 0x01  # flip a bit inside the trailing tag
    with pytest.raises(InvalidTag):
        bk.unwrap(master, bytes(wrapped))


def test_unwrap_too_short_raises(master):
    with pytest.raises(ValueError, match="too short"):
        bk.unwrap(master, b"short")


def test_wrap_rejects_short_master(data_key):
    with pytest.raises(ValueError, match="master"):
        bk.wrap(b"x" * 16, data_key)


def test_wrap_rejects_short_data_key(master):
    with pytest.raises(ValueError, match="data_key"):
        bk.wrap(master, b"x" * 16)


def test_wrap_rejects_non_bytes_master(data_key):
    with pytest.raises(ValueError, match="master"):
        bk.wrap("not bytes", data_key)  # type: ignore[arg-type]


# ---------- derive_file_key ----------

def test_derive_file_key_shape(data_key):
    fk = bk.derive_file_key(data_key, "manifest.json")
    assert isinstance(fk, bytes)
    assert len(fk) == 32


def test_derive_file_key_is_deterministic(data_key):
    a = bk.derive_file_key(data_key, "manifest.json")
    b = bk.derive_file_key(data_key, "manifest.json")
    assert a == b


def test_derive_file_key_different_filenames_differ(data_key):
    a = bk.derive_file_key(data_key, "manifest.json")
    b = bk.derive_file_key(data_key, "ha-config.tar.gz")
    assert a != b


def test_derive_file_key_filename_case_sensitive(data_key):
    a = bk.derive_file_key(data_key, "manifest.json")
    b = bk.derive_file_key(data_key, "Manifest.json")
    assert a != b


def test_derive_file_key_different_data_keys_differ():
    dk1 = bytes.fromhex("bb" * 32)
    dk2 = bytes.fromhex("cc" * 32)
    assert bk.derive_file_key(dk1, "f.txt") != bk.derive_file_key(dk2, "f.txt")


def test_derive_file_key_empty_filename_raises(data_key):
    with pytest.raises(ValueError, match="filename"):
        bk.derive_file_key(data_key, "")


def test_derive_file_key_non_string_filename_raises(data_key):
    with pytest.raises(ValueError, match="filename"):
        bk.derive_file_key(data_key, b"bytes-not-str")  # type: ignore[arg-type]


def _rfc5869_hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    """Plain-stdlib reference impl of HKDF-SHA256 per RFC 5869.

    Lives in the test only — its purpose is to verify our cryptography-lib
    HKDF call uses the right parameters. If our derive_file_key ever
    silently drifts (wrong algorithm, wrong info string, wrong output
    length), this comparison breaks loudly.
    """
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    t = b""
    okm = b""
    counter = 1
    while len(okm) < length:
        t = hmac.new(prk, t + info + bytes([counter]), hashlib.sha256).digest()
        okm += t
        counter += 1
    return okm[:length]


def test_derive_file_key_matches_rfc5869_reference(data_key):
    expected = _rfc5869_hkdf_sha256(
        ikm=data_key,
        salt=b"manifest.json",
        info=b"ziggy-backup-file-v1",
        length=32,
    )
    assert bk.derive_file_key(data_key, "manifest.json") == expected


# ---------- encrypt_file / decrypt_file ----------

def test_encrypt_decrypt_roundtrip(data_key):
    fk = bk.derive_file_key(data_key, "f.txt")
    plaintext = b"hello, ziggy backup"
    nonce, ct, tag = bk.encrypt_file(plaintext, fk)
    assert len(nonce) == 12
    assert len(tag) == 16
    assert bk.decrypt_file(nonce, ct, tag, fk) == plaintext


def test_encrypt_decrypt_empty_plaintext(data_key):
    fk = bk.derive_file_key(data_key, "empty")
    nonce, ct, tag = bk.encrypt_file(b"", fk)
    assert ct == b""
    assert bk.decrypt_file(nonce, ct, tag, fk) == b""


def test_encrypt_decrypt_large_plaintext(data_key):
    fk = bk.derive_file_key(data_key, "big")
    plaintext = b"abcdefgh" * 100_000  # 800 KB
    nonce, ct, tag = bk.encrypt_file(plaintext, fk)
    assert len(ct) == len(plaintext)  # GCM is a stream cipher
    assert bk.decrypt_file(nonce, ct, tag, fk) == plaintext


def test_encrypt_file_nondeterministic(data_key):
    fk = bk.derive_file_key(data_key, "f.txt")
    a = bk.encrypt_file(b"plain", fk)
    b = bk.encrypt_file(b"plain", fk)
    assert a != b  # random nonce per call


def test_decrypt_wrong_key_raises(data_key):
    fk = bk.derive_file_key(data_key, "f.txt")
    other_fk = bk.derive_file_key(data_key, "g.txt")
    nonce, ct, tag = bk.encrypt_file(b"plain", fk)
    with pytest.raises(InvalidTag):
        bk.decrypt_file(nonce, ct, tag, other_fk)


def test_decrypt_tampered_ciphertext_raises(data_key):
    fk = bk.derive_file_key(data_key, "f.txt")
    nonce, ct, tag = bk.encrypt_file(b"plaintext", fk)
    tampered = bytearray(ct)
    tampered[0] ^= 0x01
    with pytest.raises(InvalidTag):
        bk.decrypt_file(nonce, bytes(tampered), tag, fk)


def test_decrypt_tampered_tag_raises(data_key):
    fk = bk.derive_file_key(data_key, "f.txt")
    nonce, ct, tag = bk.encrypt_file(b"plaintext", fk)
    tampered_tag = bytearray(tag)
    tampered_tag[0] ^= 0x01
    with pytest.raises(InvalidTag):
        bk.decrypt_file(nonce, ct, bytes(tampered_tag), fk)


def test_decrypt_wrong_nonce_size_raises(data_key):
    fk = bk.derive_file_key(data_key, "f.txt")
    with pytest.raises(ValueError, match="nonce"):
        bk.decrypt_file(b"x" * 11, b"", b"x" * 16, fk)


def test_decrypt_wrong_tag_size_raises(data_key):
    fk = bk.derive_file_key(data_key, "f.txt")
    with pytest.raises(ValueError, match="tag"):
        bk.decrypt_file(b"x" * 12, b"", b"x" * 15, fk)


def test_encrypt_file_rejects_bad_key():
    with pytest.raises(ValueError, match="file_key"):
        bk.encrypt_file(b"hi", b"x" * 16)


# ---------- end-to-end envelope chain ----------

def test_full_envelope_roundtrip():
    """Master wraps data_key → derive file_key → encrypt → decrypt.

    Simulates the real flow: hub generates data_key, founder wraps with
    master key, data_key is forgotten. On restore, founder unwraps and
    the recovered data_key re-derives the per-file key for decryption.
    """
    master = bk.generate_data_key()  # any 32 random bytes works as master
    data_key_plain = bk.generate_data_key()

    wrapped = bk.wrap(master, data_key_plain)
    recovered_dk = bk.unwrap(master, wrapped)
    assert recovered_dk == data_key_plain

    filename = "ha-config.tar.gz.enc"
    fk = bk.derive_file_key(recovered_dk, filename)

    plaintext = b"some-tarball-bytes" * 1000  # ~17 KB
    nonce, ct, tag = bk.encrypt_file(plaintext, fk)

    # On restore, only `wrapped`, `master`, and the ciphertext exist —
    # the original data_key/file_key are gone.
    dk2 = bk.unwrap(master, wrapped)
    fk2 = bk.derive_file_key(dk2, filename)
    assert bk.decrypt_file(nonce, ct, tag, fk2) == plaintext
