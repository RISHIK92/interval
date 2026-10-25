"""Invite codes for the private beta (Q-P1-24): issued here, redeemed by the web app.

Codes are 10 characters from an alphabet without 0, O, 1 or I, shown as XXXXX-XXXXX.
A code can be personal (max_uses 1) or shared (max_uses N).
"""

import secrets
from datetime import UTC, datetime, timedelta

from interval_db.generated import BetaGroup
from interval_jobs.ports import DuplicateInviteCode, Store

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 10
MAX_COUNT = 500
_ATTEMPTS = 3  # a collision among 32^10 codes is rare; retrying covers it


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def display(code: str) -> str:
    return f"{code[:5]}-{code[5:]}"


def issue_invites(
    store: Store,
    *,
    group: BetaGroup,
    uses: int,
    days: int,
    count: int = 1,
    note: str | None = None,
) -> list[str]:
    if uses < 1 or days < 1 or not 1 <= count <= MAX_COUNT:
        raise ValueError(f"need uses >= 1, days >= 1 and 1 <= count <= {MAX_COUNT}")
    expires_at = datetime.now(UTC) + timedelta(days=days)
    for attempt in range(_ATTEMPTS):
        try:
            return store.invites.issue(
                beta_group=group,
                max_uses=uses,
                expires_at=expires_at,
                note=note,
                codes=[new_code() for _ in range(count)],
            )
        except DuplicateInviteCode:
            if attempt == _ATTEMPTS - 1:
                raise
    raise AssertionError("unreachable")
