"""Calendar-passage charm: continuous yields, annual rates, 365 days/year.

The two known answers were independently obtained by central differences of
spot delta and reconciled with installed QuantLib 1.43 (BSD-3-Clause), using
BlackCalculator.delta at T +/- 1e-5 years. Reference implementation:
https://github.com/lballabio/QuantLib/blob/6b57206e04598f092efee66e3b367efc84771995/ql/pricingengines/blackcalculator.cpp
QuantLib is a reference validator only, not a dependency of these regressions.
"""
import math

import pytest

from advanced_derivatives import BlackScholesRequest, black_scholes_greeks
from derivatives_surface import OptionPosition, PortfolioGreeksRequest, portfolio_greeks


TERMS = dict(spot=100, strike=100, maturityYears=1, ratePct=5,
             dividendYieldPct=10, volatilityPct=20)
KNOWN_CHARM_PER_DAY = {
    "call": 0.00018251483140659466,
    "put": -0.00006538583105698805,
}


def _independent_delta(option_type, maturity, dividend_yield_pct):
    # Differentiate the delta definition numerically, not the charm formula.
    rate, dividend, volatility = 0.05, dividend_yield_pct / 100.0, 0.20
    d1 = (rate - dividend + volatility * volatility / 2) * math.sqrt(maturity) / volatility
    normal_probability = 0.5 * math.erfc(-d1 / math.sqrt(2))
    return math.exp(-dividend * maturity) * (normal_probability - (option_type == "put"))


@pytest.mark.parametrize("option_type", ["call", "put"])
def test_dividend_charm_matches_independent_known_answer(option_type):
    result = black_scholes_greeks(BlackScholesRequest(**TERMS, optionType=option_type))
    # The old dividend term reversed the sign for both of these positions.
    assert result.charmPerDay == pytest.approx(KNOWN_CHARM_PER_DAY[option_type], abs=1e-12)


@pytest.mark.parametrize("option_type", ["call", "put"])
@pytest.mark.parametrize("dividend_yield_pct", [-2.0, 0.0, 2.0, 10.0])
@pytest.mark.parametrize("maturity", [1.0 / 365.0, 1.0])
def test_charm_matches_calendar_passage_of_independent_delta(option_type, dividend_yield_pct, maturity):
    step = maturity * 1e-5
    expected = (
        _independent_delta(option_type, maturity - step, dividend_yield_pct)
        - _independent_delta(option_type, maturity + step, dividend_yield_pct)
    ) / (2 * step * 365)
    terms = {**TERMS, "maturityYears": maturity, "dividendYieldPct": dividend_yield_pct}
    result = black_scholes_greeks(BlackScholesRequest(**terms, optionType=option_type))
    assert result.charmPerDay == pytest.approx(expected, abs=2e-11)


@pytest.mark.parametrize("dividend_yield_pct", [-2.0, 0.0, 10.0])
def test_charm_put_call_parity_uses_calendar_time(dividend_yield_pct):
    terms = {**TERMS, "dividendYieldPct": dividend_yield_pct}
    call = black_scholes_greeks(BlackScholesRequest(**terms, optionType="call"))
    put = black_scholes_greeks(BlackScholesRequest(**terms, optionType="put"))
    dividend = dividend_yield_pct / 100.0
    # Delta_call - delta_put = exp(-q*T); calendar passage gives +q*exp(-q*T).
    expected = dividend * math.exp(-dividend * terms["maturityYears"]) / 365
    assert call.charmPerDay - put.charmPerDay == pytest.approx(expected, abs=1e-15)


def test_portfolio_charm_preserves_known_answer_with_signed_contract_scaling():
    result = portfolio_greeks(PortfolioGreeksRequest(positions=[
        OptionPosition(**TERMS, name="long_calls", optionType="call", quantity=2, contractMultiplier=100),
        OptionPosition(**TERMS, name="short_put", optionType="put", quantity=-1, contractMultiplier=100),
    ]))
    expected_call = 200 * KNOWN_CHARM_PER_DAY["call"]
    expected_put = -100 * KNOWN_CHARM_PER_DAY["put"]
    assert result.byPosition["long_calls"]["charmPerDay"] == pytest.approx(expected_call, abs=2e-10)
    assert result.byPosition["short_put"]["charmPerDay"] == pytest.approx(expected_put, abs=1e-10)
    assert result.charmPerDay == pytest.approx(expected_call + expected_put, abs=3e-10)
