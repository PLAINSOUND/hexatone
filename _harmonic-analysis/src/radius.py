"""Stable degree and collection harmonic-radius calculations."""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from itertools import combinations
from math import exp2, log2
from typing import Iterable, Iterator, Sequence

from monzo import Monzo, factor_integer, monzo_to_fraction, shift_monzo


@dataclass(frozen=True)
class RadiusMeasures:
    """Radius values and stable log2 forms for one interval or collection."""

    partials: tuple[int, ...]
    harmonic_radius: float
    log2_harmonic_radius: float
    odd_radius: float
    log2_odd_radius: float
    prime_limit_radius: float
    log2_prime_limit_radius: float
    odd_prime_limit_radius: float
    log2_odd_prime_limit_radius: float


def _radius_from_log2(value: float) -> float:
    try:
        return exp2(value)
    except OverflowError:
        return float("inf")


def _odd_part(partial: int) -> int:
    while partial % 2 == 0 and partial > 1:
        partial //= 2
    return partial


def _greatest_prime_factor(value: int) -> int:
    factors = factor_integer(value)
    return max(factors, default=1)


def _mean_log2(values: Iterable[int]) -> float:
    values = tuple(values)
    if not values:
        raise ValueError("A radius requires at least one partial")
    return sum(log2(value) for value in values) / len(values)


def measures_from_partials(partials: Iterable[int]) -> RadiusMeasures:
    """Calculate full, odd, and prime-limit measures from positive partials."""
    partials_tuple = tuple(int(value) for value in partials)
    if not partials_tuple or any(value < 1 for value in partials_tuple):
        raise ValueError("Partials must be a non-empty collection of positive integers")

    odd_partials = tuple(_odd_part(value) for value in partials_tuple)
    prime_limit_logs = tuple(
        (log2(value) + log2(_greatest_prime_factor(value))) / 2
        for value in partials_tuple
    )
    odd_prime_limit_logs = tuple(
        (log2(value) + log2(_greatest_prime_factor(value))) / 2
        for value in odd_partials
    )
    full_log = _mean_log2(partials_tuple)
    odd_log = _mean_log2(odd_partials)
    prime_log = sum(prime_limit_logs) / len(prime_limit_logs)
    odd_prime_log = sum(odd_prime_limit_logs) / len(odd_prime_limit_logs)
    return RadiusMeasures(
        partials=partials_tuple,
        harmonic_radius=_radius_from_log2(full_log),
        log2_harmonic_radius=full_log,
        odd_radius=_radius_from_log2(odd_log),
        log2_odd_radius=odd_log,
        prime_limit_radius=_radius_from_log2(prime_log),
        log2_prime_limit_radius=prime_log,
        odd_prime_limit_radius=_radius_from_log2(odd_prime_log),
        log2_odd_prime_limit_radius=odd_prime_log,
    )


def degree_radius(monzo: Monzo, zero_monzo: Monzo | None = None) -> RadiusMeasures:
    """Measure an interval from the assigned zero as its reduced p:q pair."""
    relative = shift_monzo(monzo, zero_monzo or {})
    ratio = monzo_to_fraction(relative)
    return measures_from_partials((ratio.numerator, ratio.denominator))


def collection_partials(monzos: Sequence[Monzo]) -> tuple[int, ...]:
    """Translate a pitch collection to partials above its nearest common root.

    The common prime-exponent offset is removed by subtracting the minimum
    exponent for each prime. This preserves all pairwise intervals while
    making every partial an integer with no shared prime factor.
    """
    if not monzos:
        raise ValueError("A pitch collection must contain at least one monzo")
    primes = sorted({prime for monzo in monzos for prime in monzo})
    minima = {
        prime: min(monzo.get(prime, 0) for monzo in monzos)
        for prime in primes
    }
    partials = []
    for monzo in monzos:
        partial = 1
        for prime in primes:
            exponent = monzo.get(prime, 0) - minima[prime]
            if exponent < 0:  # defensive: minima should make all exponents >= 0
                raise ArithmeticError("Common-fundamental shift produced a negative exponent")
            partial *= prime**exponent
        partials.append(partial)
    return tuple(partials)


def collection_radius(monzos: Sequence[Monzo]) -> RadiusMeasures:
    """Calculate collection radius after translating pitches to a common root."""
    return measures_from_partials(collection_partials(monzos))


def selected_degree_monzos(
    monzos: Sequence[Monzo], degree_indices: Iterable[int] | None = None,
    zero_monzo: Monzo | None = None,
) -> tuple[tuple[int, ...], tuple[Monzo, ...]]:
    """Select zero-based source degrees and express them relative to zero."""
    indices = tuple(range(len(monzos))) if degree_indices is None else tuple(degree_indices)
    if len(set(indices)) != len(indices):
        raise ValueError("Degree selection cannot contain duplicate indices")
    if any(not isinstance(index, int) or index < 0 or index >= len(monzos) for index in indices):
        raise IndexError("Selected degree index is outside the scale")
    return indices, tuple(shift_monzo(monzos[index], zero_monzo or {}) for index in indices)


def combination_count(degree_count: int, subset_size: int) -> int:
    """Return the number of unordered subsets of the requested size."""
    if degree_count < 0:
        raise ValueError("Degree count cannot be negative")
    if subset_size < 1 or subset_size > degree_count:
        return 0
    # Use an integer recurrence so callers need no additional dependency.
    k = min(subset_size, degree_count - subset_size)
    count = 1
    for i in range(1, k + 1):
        count = count * (degree_count - k + i) // i
    return count


def iter_collection_radii(
    monzos: Sequence[Monzo], subset_size: int, *,
    degree_indices: Iterable[int] | None = None,
) -> Iterator[tuple[tuple[int, ...], RadiusMeasures]]:
    """Lazily yield (source-degree indices, radius measures) for each subset."""
    indices = tuple(range(len(monzos))) if degree_indices is None else tuple(degree_indices)
    if len(set(indices)) != len(indices):
        raise ValueError("Degree selection cannot contain duplicate indices")
    if any(not isinstance(index, int) or index < 0 or index >= len(monzos) for index in indices):
        raise IndexError("Selected degree index is outside the scale")
    if subset_size < 1:
        raise ValueError("Subset size must be at least one")
    for chosen in combinations(indices, subset_size):
        yield chosen, collection_radius(tuple(monzos[index] for index in chosen))
