import unittest

import advanced_derivatives as ader
import advanced_fixed_income as afi
import derivatives_surface as ds


class AdvancedRatesDerivativesWiringTests(unittest.TestCase):
    def test_key_rate_risk_reports_positive_risk_for_positive_cashflows(self):
        request = afi.KeyRateRiskRequest(
            cashFlows=[afi.CashFlow(timeYears=1, amount=5), afi.CashFlow(timeYears=2, amount=105)],
            curve=[afi.CurveNode(maturityYears=1, zeroRatePct=4), afi.CurveNode(maturityYears=2, zeroRatePct=4.5)],
            keyMaturitiesYears=[1, 2], bumpBps=1,
        )
        out = afi.key_rate_risk(request)
        self.assertGreater(out.basePrice, 0)
        self.assertGreater(out.parallelDurationYears, 0)
        self.assertTrue(all(value > 0 for value in out.keyRateDurations.values()))
        self.assertTrue(all(value > 0 for value in out.keyRateDv01.values()))

    def test_black_scholes_greeks_matches_at_money_reference_price(self):
        out = ader.black_scholes_greeks(ader.BlackScholesRequest(
            spot=100, strike=100, maturityYears=1, ratePct=5, dividendYieldPct=0,
            volatilityPct=20, optionType="call",
        ))
        self.assertAlmostEqual(out.price, 10.4505835722, places=8)
        self.assertAlmostEqual(out.delta, 0.6368306512, places=8)
        self.assertGreater(out.gamma, 0)
        self.assertGreater(out.vegaPerVolPoint, 0)

    def test_interest_rate_swap_is_zero_at_its_forward_par_rate(self):
        out = ader.interest_rate_swap(ader.SwapRequest(
            notional=1_000_000, fixedRatePct=4.5, maturityYears=5, paymentsPerYear=2,
            discountRatePct=4, forwardRatePct=4.5,
        ))
        self.assertAlmostEqual(out.payerSwapPv, 0.0, places=9)
        self.assertAlmostEqual(out.parSwapRatePct, 4.5, places=12)
        self.assertGreater(out.dv01, 0)

    def test_black_swaption_has_positive_at_money_payer_value(self):
        out = ader.black_swaption(ader.SwaptionRequest(
            notional=1_000_000, forwardSwapRatePct=4.5, strikePct=4.5,
            volatilityPct=20, optionExpiryYears=1, swapAnnuity=4.2, payer=True,
        ))
        self.assertGreater(out.price, 0)

    def test_strategy_payoff_reports_long_call_break_even_and_terminal_profit(self):
        out = ds.option_strategy_payoff(ds.OptionStrategyRequest(
            legs=[ds.StrategyLeg(optionType="call", strike=100, quantity=1, premium=5)],
            underlyingMin=50, underlyingMax=150, gridPoints=101,
        ))
        self.assertAlmostEqual(out.netPremiumCashFlow, -5.0, places=12)
        self.assertIn(105.0, out.breakEvenApprox)
        self.assertAlmostEqual(out.maxProfitOnGrid, 45.0, places=12)


if __name__ == "__main__":
    unittest.main()
