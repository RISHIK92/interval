"""Signed JWTs, the one place the worker builds them: web push's VAPID (ES256), the
GitHub App's (RS256), and native push's APNs (ES256) and FCM (RS256) tokens."""

import base64
import json

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _signing_input(header: dict[str, object], claims: dict[str, object]) -> str:
    return (
        f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(claims).encode())}"
    )


def es256(
    header: dict[str, object],
    claims: dict[str, object],
    key: ec.EllipticCurvePrivateKey,
) -> str:
    signed = _signing_input({"alg": "ES256", **header}, claims)
    r, s = decode_dss_signature(key.sign(signed.encode(), ec.ECDSA(hashes.SHA256())))
    return f"{signed}.{b64url(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


def rs256(claims: dict[str, object], key: rsa.RSAPrivateKey) -> str:
    signed = _signing_input({"alg": "RS256", "typ": "JWT"}, claims)
    signature = key.sign(signed.encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{signed}.{b64url(signature)}"
