from fractions import Fraction

import pytest

from monzo import add_monzos, factor_integer, monzo_to_fraction, ratio_to_monzo


def test_ratio_factorisation_round_trips_exactly():
    ratio = "129140163/67108864"
    monzo = ratio_to_monzo(ratio)
    assert monzo == {2: -26, 3: 17}
    assert monzo_to_fraction(monzo) == Fraction(ratio)


def test_multiplication_adds_exponents():
    assert add_monzos(ratio_to_monzo("3/2"), ratio_to_monzo("5/4")) == {
        2: -3,
        3: 1,
        5: 1,
    }


def test_factor_integer_requires_positive_input():
    with pytest.raises(ValueError, match="positive"):
        factor_integer(0)


@pytest.mark.parametrize("ratio", ["0/1", "-3/2", "not a ratio"])
def test_invalid_ratios_are_rejected(ratio):
    with pytest.raises((ValueError, ZeroDivisionError)):
        ratio_to_monzo(ratio)
