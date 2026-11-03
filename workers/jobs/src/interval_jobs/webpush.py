"""Web push for the agent hook (P3-W17-S05b, §7, Q-P3-18; owner, 2026-11-03).

A message is encrypted for one browser subscription with RFC 8291 (the aes128gcm
content coding of RFC 8188), and the request is signed for the push service with VAPID
(RFC 8292). Keys are base64url: a subscription's `p256dh` (its public key) and `auth`
secret; the server's P-256 private key as its raw 32 bytes."""

import base64
import json
import os
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

RECORD_SIZE = 4096  # one record: our messages are a sentence
VAPID_HOURS = 12  # RFC 8292 allows up to 24


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _point(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )


def private_key(raw: str) -> ec.EllipticCurvePrivateKey:
    """A P-256 private key from its base64url 32 bytes."""
    return ec.derive_private_key(int.from_bytes(_unb64(raw), "big"), ec.SECP256R1())


def encrypt(
    plaintext: bytes,
    p256dh: str,
    auth: str,
    *,
    sender: ec.EllipticCurvePrivateKey | None = None,
    salt: bytes | None = None,
) -> bytes:
    """The request body: the aes128gcm header (salt, record size, the sender's public
    key) and one encrypted record. `sender` and `salt` are fresh unless given
    (tests)."""
    key = sender or ec.generate_private_key(ec.SECP256R1())
    salt = salt or os.urandom(16)
    receiver = _unb64(p256dh)
    shared = key.exchange(
        ec.ECDH(),
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), receiver),
    )
    sender_public = _point(key)
    ikm = HKDF(
        hashes.SHA256(),
        32,
        _unb64(auth),
        b"WebPush: info\x00" + receiver + sender_public,
    ).derive(shared)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(
        ikm
    )
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    # The last (and only) record ends with the 0x02 delimiter, no padding.
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = (
        salt
        + RECORD_SIZE.to_bytes(4, "big")
        + bytes([len(sender_public)])
        + sender_public
    )
    return header + ciphertext


def vapid_header(
    endpoint: str, key: ec.EllipticCurvePrivateKey, subject: str, now: datetime
) -> str:
    """`Authorization` for the push service at `endpoint`: an ES256 JWT for its origin,
    and the server's public key."""
    parts = urlsplit(endpoint)
    head = _b64(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    claims = _b64(
        json.dumps(
            {
                "aud": f"{parts.scheme}://{parts.netloc}",
                "exp": int((now + timedelta(hours=VAPID_HOURS)).timestamp()),
                "sub": subject,
            }
        ).encode()
    )
    der = key.sign(f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    signature = _b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"vapid t={head}.{claims}.{signature}, k={_b64(_point(key))}"
