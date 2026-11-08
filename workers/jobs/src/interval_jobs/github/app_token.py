"""The GitHub App's own JWT (ADR-0024, P2-W12-S02): RS256-signed with the App's private
key, exchanged for short-lived installation tokens. Signed with `cryptography`
(Q-P2-44); nothing here is stored."""

import base64
import binascii
from datetime import datetime

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from interval_jobs.jwt import rs256


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


def app_jwt(app_id: str, key: rsa.RSAPrivateKey, now: datetime) -> str:
    epoch = int(now.timestamp())
    # A minute back for clock drift; GitHub refuses an expiry over ten minutes ahead.
    return rs256({"iss": app_id, "iat": epoch - 60, "exp": epoch + 540}, key)
