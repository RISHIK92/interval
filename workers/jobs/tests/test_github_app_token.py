"""The GitHub App's JWT, signed with its private key (ADR-0024, Q-P2-44, P2-W12-S02)."""

import base64
import json
from datetime import UTC, datetime

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from interval_jobs.github.app_token import AppKeyError, app_jwt, load_private_key

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PEM = KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.TraditionalOpenSSL,
    serialization.NoEncryption(),
).decode()
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=UTC)


def _part(segment: str) -> dict[str, object]:
    padded = segment + "=" * (-len(segment) % 4)
    loaded: dict[str, object] = json.loads(base64.urlsafe_b64decode(padded))
    return loaded


def test_the_jwt_is_rs256_signed_by_the_app_with_short_claims() -> None:
    token = app_jwt("123456", load_private_key(PEM), NOW)
    header, claims, signature = token.split(".")
    assert _part(header) == {"alg": "RS256", "typ": "JWT"}
    epoch = int(NOW.timestamp())
    # A minute back for clock drift; GitHub refuses more than ten minutes ahead.
    assert _part(claims) == {"iss": "123456", "iat": epoch - 60, "exp": epoch + 540}
    KEY.public_key().verify(
        base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4)),
        f"{header}.{claims}".encode(),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )


@pytest.mark.parametrize(
    "value",
    [
        PEM,
        base64.b64encode(PEM.encode()).decode(),  # as the owner stores it
        PEM.replace("\n", "\\n"),  # one line, escaped
    ],
)
def test_the_key_loads_as_pem_base64_pem_or_escaped_pem(value: str) -> None:
    assert load_private_key(value).key_size == 2048


@pytest.mark.parametrize("value", ["", "not a key", base64.b64encode(b"junk").decode()])
def test_a_placeholder_or_broken_key_is_a_configuration_error(value: str) -> None:
    with pytest.raises(AppKeyError):
        load_private_key(value)
