from typing import get_args

import pytest

from interval_db.generated import RightsProfile
from interval_jobs.rights import Operation, allowed

MATRIX: dict[RightsProfile, set[Operation]] = {
    "metadata_only": set(),
    "excerpt": {"fetch_body", "store_excerpt"},
    "full_text_internal": {"fetch_body", "store_full_text", "make_moments"},
    "full_text_display": {"fetch_body", "store_full_text", "make_moments"},
}


def test_matrix_covers_every_profile() -> None:
    assert set(MATRIX) == set(get_args(RightsProfile.__value__))


@pytest.mark.parametrize("profile", list(MATRIX))
@pytest.mark.parametrize("op", list(get_args(Operation.__value__)))
def test_allowed_matches_the_q_p1_01_matrix(
    profile: RightsProfile, op: Operation
) -> None:
    assert allowed(profile, op) is (op in MATRIX[profile])
