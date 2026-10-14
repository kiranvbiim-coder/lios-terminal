"""FinRobot V2 audit-package adaptation regression corpus.

Upstream behavior adapted from AI4Finance-Foundation/FinRobot
@ 2717499b8e30f242640af08c4ad9afd1113c2d45 (Apache-2.0), specifically
finrobot_desktop/finrobot/engine/compute/operators/audit and its unit tests.

LiOS owns the data/provider/evidence/engine authorities. These tests exercise only
zero-I/O audit mechanics and fail-closed input behavior.
"""
from __future__ import annotations

import math
import unittest
from datetime import date

from finrobot_audit_challenger import (
    audit_currency_caliber,
    audit_ev_bridge,
    audit_momentum_narrative_hedge,
    audit_narrative_numeric_grounding,
    audit_sector_sign,
    audit_ttm_period,
    compute_momentum_context,
    is_momentum_divergent,
)


def checks(findings):
    return {(item.field_key, item.check, item.severity) for item in findings}


class CurrencyCaliberTests(unittest.TestCase):
    def test_mixed_currency_blocks_cross_currency_ratios(self):
        findings = audit_currency_caliber(
            ticker="TSM",
            reporting_currency="TWD",
            quote_currency="USD",
            pe_ratio=18.0,
            enterprise_value=600e9,
            ev_ebitda=12.0,
            ev_revenue=7.0,
        )
        self.assertEqual(len(findings), 4)
        self.assertTrue(all(item.severity == "blocked_field" for item in findings))
        self.assertTrue(all(item.check == "cross_currency_ratio" for item in findings))

    def test_same_currency_is_clean(self):
        self.assertEqual(
            audit_currency_caliber("AAPL", "USD", "USD", pe_ratio=30.0), []
        )

    def test_foreign_double_usd_without_normalization_is_review(self):
        findings = audit_currency_caliber(
            ticker="BP",
            reporting_currency="USD",
            quote_currency="USD",
            country="United Kingdom",
            adr_status=None,
            fx_normalized=False,
        )
        self.assertIn(("reporting_currency", "foreign_issuer_usd_tags", "review"), checks(findings))

    def test_confirmed_adr_or_fx_normalized_suppresses_double_usd_review(self):
        self.assertEqual(
            audit_currency_caliber("NVS", "USD", "USD", country="Switzerland", adr_status=True), []
        )
        self.assertEqual(
            audit_currency_caliber("BP", "USD", "USD", country="United Kingdom", fx_normalized=True), []
        )


class EvBridgeTests(unittest.TestCase):
    def test_unreported_components_are_review_findings(self):
        findings = audit_ev_bridge("X", enterprise_value=400e9, preferred_stock=None, noncontrolling_interest=None)
        self.assertEqual(len([x for x in findings if x.check == "ev_bridge_unverified"]), 2)
        self.assertTrue(all(x.severity == "review" for x in findings))

    def test_reported_zero_or_value_is_clean(self):
        self.assertEqual(audit_ev_bridge("KO", 400e9, 0.0, 2.1e9), [])

    def test_no_ev_has_nothing_to_verify(self):
        self.assertEqual(audit_ev_bridge("X", None, None, None), [])


class TtmPeriodTests(unittest.TestCase):
    def test_clean_quarterly_and_semiannual_sequences(self):
        self.assertEqual(
            audit_ttm_period("AAPL", [date(2026, 3, 28), date(2025, 12, 27), date(2025, 9, 27), date(2025, 6, 28)]),
            [],
        )
        self.assertEqual(audit_ttm_period("UL", [date(2025, 12, 31), date(2025, 6, 30)]), [])

    def test_missing_overlap_incomplete_and_excess_are_explicit(self):
        missing = audit_ttm_period("X", [date(2026, 3, 31), date(2025, 9, 30), date(2025, 6, 30), date(2025, 3, 31)])
        self.assertIn(("ttm_period", "ttm_quarter_gap", "blocked_field"), checks(missing))
        overlap = audit_ttm_period("X", [date(2026, 3, 31), date(2026, 3, 31), date(2025, 12, 31), date(2025, 9, 30)])
        self.assertIn(("ttm_period", "ttm_quarter_overlap", "blocked_field"), checks(overlap))
        incomplete = audit_ttm_period("X", [date(2026, 3, 31), date(2025, 12, 31), date(2025, 9, 30)])
        self.assertIn(("ttm_period", "ttm_quarters_incomplete", "review"), checks(incomplete))
        excess = audit_ttm_period("X", [date(2026, 3, 31), date(2025, 12, 31), date(2025, 9, 30), date(2025, 6, 30), date(2025, 3, 31)])
        self.assertIn(("ttm_period", "ttm_quarters_excess", "blocked_field"), checks(excess))

    def test_no_period_data_abstains(self):
        self.assertEqual(audit_ttm_period("X", []), [])


class SectorSignTests(unittest.TestCase):
    def test_bank_ev_is_review_but_asset_light_financials_are_not(self):
        bank = audit_sector_sign("JPM", "Banks - Diversified", 10e9, 8e9, 100e9, ev_ebitda=8.0)
        self.assertIn(("ev_ebitda", "financial_sector_ev_meaningless", "review"), checks(bank))
        for industry in ("Insurance - Brokers", "Financial - Credit Services", "Asset Management", "Financial - Capital Markets"):
            result = audit_sector_sign("X", industry, 10e9, 8e9, 100e9, ev_ebitda=12.0)
            self.assertNotIn("financial_sector_ev_meaningless", {x.check for x in result})

    def test_non_operating_earnings_and_loss_maker_are_reviewed(self):
        inflated = audit_sector_sign("GOOGL", "Consumer Electronics", 160e9, 138e9, 422e9)
        self.assertIn(("pe_ratio", "net_income_exceeds_operating_income", "review"), checks(inflated))
        loss = audit_sector_sign("MU", "Semiconductors", -5.8e9, -2e9, 100e9)
        self.assertIn(("pe_ratio", "non_positive_earnings_pe_nm", "review"), checks(loss))


class NarrativeAuditTests(unittest.TestCase):
    def test_momentum_divergence_thresholds_and_warning(self):
        self.assertTrue(is_momentum_divergent("BUY", -20.0))
        self.assertFalse(is_momentum_divergent("BUY", -15.0))
        self.assertTrue(is_momentum_divergent("SELL", 45.0))
        self.assertFalse(is_momentum_divergent("HOLD", -80.0))
        self.assertIsNotNone(audit_momentum_narrative_hedge("BUY", -20.0, None))
        self.assertIsNone(audit_momentum_narrative_hedge("BUY", -20.0, "Temporary inventory correction."))

    def test_momentum_context_is_numeric_and_none_safe(self):
        ctx = compute_momentum_context(80.0, 120.0, 70.0, -20.5)
        self.assertAlmostEqual(ctx.range_position_52w, 0.20)
        self.assertAlmostEqual(ctx.drawdown_from_52w_high_pct, -33.3333333333)
        self.assertEqual(ctx.one_year_return_pct, -20.5)
        missing = compute_momentum_context(None, None, None, None)
        self.assertIsNone(missing.range_position_52w)

    def test_narrative_numeric_grounding_ignores_bare_years_and_ordinals(self):
        warning = audit_narrative_numeric_grounding(
            "In fiscal 2025, the company remained well-positioned.",
            ["Revenue grew 12% YoY."],
            ["The 1st half remains competitive."],
        )
        self.assertIsNotNone(warning)
        self.assertIn("narrative", warning)
        self.assertIn("risks[0]", warning)
        self.assertNotIn("catalysts[0]", warning)
        self.assertIsNone(
            audit_narrative_numeric_grounding(
                "In fiscal 2025, revenue grew 14% YoY.",
                ["Margin reached 34.2%."],
                ["Trades at 18.2x versus 12.4x peers."],
            )
        )


class FailClosedTests(unittest.TestCase):
    def test_non_finite_numeric_inputs_fail_closed(self):
        for value in (math.nan, math.inf, -math.inf):
            with self.assertRaises(ValueError):
                audit_ev_bridge("X", value, 0.0, 0.0)
            with self.assertRaises(ValueError):
                audit_sector_sign("X", "Technology", value, 1.0, 10.0)
            with self.assertRaises(ValueError):
                compute_momentum_context(value, 100.0, 50.0, 1.0)


if __name__ == "__main__":
    unittest.main()
