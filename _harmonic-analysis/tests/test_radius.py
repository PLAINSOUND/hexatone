import pytest

from monzo import ratio_to_monzo
from radius import (
    collection_partials,
    collection_radius,
    combination_count,
    degree_radius,
    iter_collection_radii,
)


def test_known_dyad_collection_has_hand_checked_partials_and_radii():
    monzos = (ratio_to_monzo("3/2"), ratio_to_monzo("5/4"))
    measures = collection_radius(monzos)
    assert measures.partials == (6, 5)
    assert measures.harmonic_radius == pytest.approx(30**0.5)
    assert measures.odd_radius == pytest.approx(15**0.5)
    # Prime-limit reduced partials: sqrt(6*3)=sqrt(18), sqrt(5*5)=5.
    assert measures.prime_limit_radius == pytest.approx((18 * 25) ** 0.25)
    assert measures.odd_prime_limit_radius == pytest.approx(15**0.5)


def test_degree_radius_is_measured_from_the_assigned_zero():
    interval = ratio_to_monzo("3/2")
    measures = degree_radius(interval)
    assert measures.partials == (3, 2)
    assert measures.harmonic_radius == pytest.approx(6**0.5)
    assert measures.odd_radius == pytest.approx(3**0.5)


def test_collection_partials_have_no_common_prime_factor():
    assert collection_partials(
        (ratio_to_monzo("3/2"), ratio_to_monzo("5/4"), ratio_to_monzo("7/4"))
    ) == (6, 5, 7)


def test_combinations_keep_source_indices_and_are_lazy():
    monzos = tuple(ratio_to_monzo(ratio) for ratio in ("1/1", "3/2", "5/4", "7/4"))
    assert combination_count(4, 2) == 6
    results = list(iter_collection_radii(monzos, 2, degree_indices=(1, 3, 2)))
    assert [indices for indices, _ in results] == [(1, 3), (1, 2), (3, 2)]


def test_invalid_combination_requests_are_rejected_or_empty():
    monzos = (ratio_to_monzo("1/1"), ratio_to_monzo("3/2"))
    assert combination_count(2, 3) == 0
    with pytest.raises(ValueError, match="at least one"):
        list(iter_collection_radii(monzos, 0))
