"""Exact prime-exponent arithmetic for rational tuning intervals."""

from __future__ import annotations

from fractions import Fraction
from math import prod

Monzo = dict[int, int]


def factor_integer(value: int) -> Monzo:
    """Return the prime factorisation of a positive integer as exponents."""
    if value < 1:
        raise ValueError("Only positive integers have tuning monzos")
    factors: Monzo = {}
    divisor = 2
    remainder = value
    while divisor * divisor <= remainder:
        while remainder % divisor == 0:
            factors[divisor] = factors.get(divisor, 0) + 1
            remainder //= divisor
        divisor = 3 if divisor == 2 else divisor + 2
    if remainder > 1:
        factors[remainder] = factors.get(remainder, 0) + 1
    return factors


def ratio_to_monzo(ratio: str | Fraction) -> Monzo:
    """Parse a positive rational ratio and return its exact monzo."""
    value = ratio if isinstance(ratio, Fraction) else Fraction(str(ratio).strip())
    if value <= 0:
        raise ValueError("A tuning ratio must be positive")
    monzo = factor_integer(value.numerator)
    for prime, exponent in factor_integer(value.denominator).items():
        monzo[prime] = monzo.get(prime, 0) - exponent
        if monzo[prime] == 0:
            del monzo[prime]
    return dict(sorted(monzo.items()))


def monzo_to_fraction(monzo: Monzo) -> Fraction:
    """Convert a monzo back to an exact reduced rational."""
    numerator = prod(prime**exponent for prime, exponent in monzo.items() if exponent > 0)
    denominator = prod(prime**-exponent for prime, exponent in monzo.items() if exponent < 0)
    return Fraction(numerator, denominator)


def add_monzos(*monzos: Monzo) -> Monzo:
    """Multiply intervals by adding their prime exponents."""
    result: Monzo = {}
    for monzo in monzos:
        for prime, exponent in monzo.items():
            result[prime] = result.get(prime, 0) + exponent
    return dict(sorted((p, e) for p, e in result.items() if e))


def subtract_monzos(left: Monzo, right: Monzo) -> Monzo:
    """Divide intervals by subtracting their prime exponents."""
    return add_monzos(left, {prime: -exponent for prime, exponent in right.items()})


def shift_monzo(monzo: Monzo, zero_monzo: Monzo) -> Monzo:
    """Express a pitch relative to an assigned zero pitch."""
    return subtract_monzos(monzo, zero_monzo)
