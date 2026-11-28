"""The only copy of the Q-P1-01 rights matrix (ING-2).

Every pipeline step asks here before touching body text.
"""

from typing import Literal

from interval_db.generated import RightsProfile

type Operation = Literal["fetch_body", "store_excerpt", "store_full_text"]

# Full-text display (partners) waits for its own ADR (ADR-0010): no display ops.
_MATRIX: dict[RightsProfile, frozenset[Operation]] = {
    "metadata_only": frozenset(),
    "excerpt": frozenset({"fetch_body", "store_excerpt"}),
    "full_text_internal": frozenset({"fetch_body", "store_full_text"}),
    "full_text_display": frozenset({"fetch_body", "store_full_text"}),
}

EXCERPT_MAX_CHARS = 300


def allowed(profile: RightsProfile, op: Operation) -> bool:
    return op in _MATRIX[profile]
