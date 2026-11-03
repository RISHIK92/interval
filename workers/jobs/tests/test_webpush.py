"""P3-W17-S05b (Q-P3-18): web push's message encryption (RFC 8291, aes128gcm) and the
VAPID signature (RFC 8292), checked against RFC 8291's Appendix A and by verifying."""

import base64
import json
from datetime import UTC, datetime

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from interval_jobs.webpush import encrypt, private_key, vapid_header


def b64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# RFC 8291, Appendix A.
PLAINTEXT = b"When I grow up, I want to be a watermelon"
AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
UA_PUBLIC = (
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNto"
    "IAiw4"
)
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
SALT = "DGv6ra1nlYgDCS1FRnbzlw"
EXPECTED = (
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCY"
    "LocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWy"
    "ouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
)


def test_rfc_8291_appendix_a() -> None:
    body = encrypt(
        PLAINTEXT, UA_PUBLIC, AUTH, sender=private_key(AS_PRIVATE), salt=b64(SALT)
    )
    assert body == b64(EXPECTED)


def test_a_fresh_message_decrypts_as_the_browser_would() -> None:
    body = encrypt(PLAINTEXT, UA_PUBLIC, AUTH)
    salt, keyid_len = body[:16], body[20]
    sender_public = body[21 : 21 + keyid_len]
    ciphertext = body[21 + keyid_len :]
    ua = private_key(UA_PRIVATE)
    shared = ua.exchange(
        ec.ECDH(),
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), sender_public),
    )
    ikm = HKDF(
        hashes.SHA256(),
        32,
        b64(AUTH),
        b"WebPush: info\x00" + b64(UA_PUBLIC) + sender_public,
    ).derive(shared)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(
        ikm
    )
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    record = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert record == PLAINTEXT + b"\x02"


def test_vapid_signs_the_push_service_origin_for_a_day_at_most() -> None:
    key = private_key(AS_PRIVATE)
    now = datetime(2031, 1, 1, tzinfo=UTC)
    header = vapid_header(
        "https://fcm.googleapis.com/fcm/send/abc123",
        key,
        "mailto:owner@example.test",
        now,
    )
    assert header.startswith("vapid t=")
    token = header.removeprefix("vapid t=").split(", k=")[0]
    sent_key = header.split(", k=")[1]
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    assert b64(sent_key) == public
    head, claims, signature = token.split(".")
    assert json.loads(b64(head)) == {"typ": "JWT", "alg": "ES256"}
    body = json.loads(b64(claims))
    assert body["aud"] == "https://fcm.googleapis.com"
    assert body["sub"] == "mailto:owner@example.test"
    assert 0 < body["exp"] - int(now.timestamp()) <= 24 * 3600
    raw = b64(signature)
    assert len(raw) == 64
    der = encode_dss_signature(
        int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")
    )
    key.public_key().verify(der, f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))
