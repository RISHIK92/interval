"""The GitHub App's own JWT (ADR-0024, P2-W12-S02): RS256-signed with the App's private
key, exchanged for short-lived installation tokens. Signed with `cryptography`
(Q-P2-44); nothing here is stored."""

import base64
import binascii
import json
from datetime import datetime

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


class AppKeyError(ValueError):
    """The App's private key is missing or isn't an RSA key: configuration, not a
    passing fault."""


def load_private_key(value: str) -> rsa.RSAPrivateKey:
    """PEM text, PEM with its newlines escaped (one env line), or base64 of the PEM."""
    text = value.strip().replace("\\n", "\n")
    if "-----BEGIN" not in text:
        try:
            text = base64.b64decode(text, validate=True).decode()
        except (binascii.Error, UnicodeDecodeError) as error:
            raise AppKeyError("the GitHub App key is neither PEM nor base64") from error
    try:
        key = serialization.load_pem_private_key(text.encode(), password=None)
    except (ValueError, TypeError, UnsupportedAlgorithm) as error:
        raise AppKeyError("the GitHub App key isn't a readable PEM key") from error
    if not isinstance(key, rsa.RSAPrivateKey):
        raise AppKeyError("the GitHub App key isn't an RSA key")
    return key


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def app_jwt(app_id: str, key: rsa.RSAPrivateKey, now: datetime) -> str:
    epoch = int(now.timestamp())
    # A minute back for clock drift; GitHub refuses an expiry over ten minutes ahead.
    header = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = _b64(
        json.dumps({"iss": app_id, "iat": epoch - 60, "exp": epoch + 540}).encode()
    )
    signature = key.sign(
        f"{header}.{claims}".encode(), padding.PKCS1v15(), hashes.SHA256()
    )
    return f"{header}.{claims}.{_b64(signature)}"
