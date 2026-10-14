"""Regression corpus for the bounded FinRobot V2 result-validator adaptation.

Upstream source: AI4Finance-Foundation/FinRobot
commit 2717499b8e30f242640af08c4ad9afd1113c2d45 (Apache-2.0)
Primary upstream tests: finrobot_desktop/tests/unit/test_validators.py

These tests intentionally exercise pure result/structure validation only. They do
not authorize provider data, LLM output, Artifact publication, or finance values.
"""
from __future__ import annotations

import math
import unittest

from finrobot_result_validators import (
    FinancialSnapshot,
    OwnershipGovernanceStatus,
    TechnicalStatus,
    validate_dcf_output,
    validate_financial_snapshot,
    validate_has_comps_table,
    validate_has_fields,
    validate_has_peers,
    validate_has_thesis,
    validate_is_non_empty,
    validate_ownership_governance_status,
    validate_report_format,
    validate_technical_status,
)


class TextContractTests(unittest.TestCase):
    def test_non_empty_contract(self) -> None:
        self.assertTrue(validate_is_non_empty("hello").passed)
        self.assertFalse(validate_is_non_empty("").passed)
        self.assertFalse(validate_is_non_empty("   \n\t").passed)

    def test_required_fields_are_case_and_spacing_tolerant(self) -> None:
        self.assertTrue(
            validate_has_fields(
                "PRICE HISTORY and NET INCOME shown", ["price_history", "net_income"]
            ).passed
        )
        bad = validate_has_fields("revenue is 100B", ["revenue", "ebitda"])
        self.assertFalse(bad.passed)
        self.assertIn("ebitda", (bad.error or "").lower())

    def test_peer_tickers_exclude_financial_acronyms(self) -> None:
        self.assertTrue(validate_has_peers("MSFT, GOOGL, META with EBITDA and WACC").passed)
        self.assertFalse(validate_has_peers("WACC DCF EBITDA GAAP IFRS").passed)
        self.assertFalse(validate_has_peers("Only MSFT is discussed").passed)

    def test_thesis_requires_multiple_argument_categories(self) -> None:
        self.assertTrue(
            validate_has_thesis(
                "We rate the stock Buy. Key catalyst: launch. Primary risk: regulation."
            ).passed
        )
        self.assertFalse(validate_has_thesis("Buy the stock.").passed)

    def test_comps_requires_tickers_multiples_and_statistics(self) -> None:
        good = (
            "MSFT: EV/EBITDA 20x, P/E 30x\n"
            "GOOGL: EV/EBITDA 18x, P/E 25x\n"
            "META: EV/EBITDA 15x, P/E 22x\nMedian EV/EBITDA: 18x"
        )
        self.assertTrue(validate_has_comps_table(good).passed)
        bad = validate_has_comps_table(
            "MSFT EV/EBITDA 20x, P/E 30x, GOOGL, META multiple comparison"
        )
        self.assertFalse(bad.passed)
        self.assertIn("stat", (bad.error or "").lower())

    def test_dcf_requires_three_distinct_components(self) -> None:
        self.assertTrue(
            validate_dcf_output(
                "WACC 10%; terminal value $500B; free cash flow projections; sensitivity range"
            ).passed
        )
        self.assertFalse(validate_dcf_output("DCF analysis completed.").passed)


class ReportFormatTests(unittest.TestCase):
    def test_structured_english_report_passes(self) -> None:
        report = "## Executive Summary\n\nWe rate AAPL Buy, target $250. " + "word " * 70
        report += "\n\n## Valuation\n\nDCF implies $240 at a 9% WACC. " + "word " * 50
        report += "\n\n## Risks\n\nFX exposure ~15% of revenue. " + "word " * 30
        self.assertTrue(validate_report_format(report).passed)

    def test_chinese_report_passes_without_english_keyword_dependency(self) -> None:
        report = (
            "## 执行摘要\n\n我们给予 AAPL 买入评级,目标价 250 美元。"
            "DCF、同业可比与 DDM 三种方法交叉验证后给出该结论。" * 8
            + "\n\n## 估值分析\n\n基于 9% 的 WACC,DCF 隐含价值约 240 美元。" * 8
            + "\n\n## 风险因素\n\n外汇敞口约占收入 15%,宏观波动构成主要下行风险。" * 8
        )
        self.assertTrue(validate_report_format(report).passed)

    def test_stub_no_headers_and_no_numbers_fail(self) -> None:
        stub = validate_report_format("## Summary\n## Risk\n## Peer\nshort")
        self.assertFalse(stub.passed)
        self.assertIn("short", (stub.error or "").lower())

        no_headers = validate_report_format("The stock is worth $250. " + "word " * 100)
        self.assertFalse(no_headers.passed)
        self.assertIn("header", (no_headers.error or "").lower())

        no_numbers = (
            "## Summary\n\n" + "word " * 80 + "\n\n## Risk\n\n" + "word " * 80
            + "\n\n## Outlook\n\n" + "word " * 60
        )
        no_numbers_result = validate_report_format(no_numbers)
        self.assertFalse(no_numbers_result.passed)
        self.assertIn("numeric", (no_numbers_result.error or "").lower())

    def test_structurally_valid_but_thin_report_passes_with_warning(self) -> None:
        report = (
            "## Summary\n\nTarget $100. " + "word " * 18
            + "\n\n## Valuation\n\nWACC 9%. " + "word " * 18
            + "\n\n## Risks\n\nDownside 15%. " + "word " * 18
        )
        result = validate_report_format(report)
        self.assertTrue(result.passed)
        self.assertTrue(result.warnings)
        self.assertTrue(any("thin" in warning.lower() for warning in result.warnings))

    def test_numeric_presence_is_explicitly_only_structural(self) -> None:
        report = (
            "## Summary\n\nFabricated-looking 999 is still structurally numeric. " + "word " * 20
            + "\n\n## Valuation\n\nAnother 123. " + "word " * 20
            + "\n\n## Risks\n\nRisk 42. " + "word " * 20
        )
        result = validate_report_format(report)
        self.assertTrue(result.passed)
        self.assertIn("not evidence", " ".join(result.warnings).lower())


class FinancialSnapshotTests(unittest.TestCase):
    def test_basic_financial_sanity(self) -> None:
        self.assertTrue(
            validate_financial_snapshot(
                FinancialSnapshot(revenue=100.0, market_cap=500.0, ebitda=30.0, pe_ratio=25.0)
            ).passed
        )
        self.assertFalse(
            validate_financial_snapshot(FinancialSnapshot(revenue=0.0, market_cap=500.0)).passed
        )
        self.assertFalse(
            validate_financial_snapshot(FinancialSnapshot(revenue=100.0, market_cap=0.0)).passed
        )
        self.assertFalse(
            validate_financial_snapshot(
                FinancialSnapshot(revenue=100.0, market_cap=500.0, pe_ratio=-5.0)
            ).passed
        )

    def test_missing_ebitda_is_not_zero(self) -> None:
        self.assertTrue(
            validate_financial_snapshot(
                FinancialSnapshot(revenue=100.0, market_cap=500.0, ebitda=None)
            ).passed
        )

    def test_ebitda_margin_band_is_preserved(self) -> None:
        self.assertTrue(
            validate_financial_snapshot(
                FinancialSnapshot(revenue=100.0, market_cap=500.0, ebitda=-400.0)
            ).passed
        )
        self.assertFalse(
            validate_financial_snapshot(
                FinancialSnapshot(revenue=100.0, market_cap=500.0, ebitda=95.0)
            ).passed
        )

    def test_non_finite_financial_numbers_fail_closed(self) -> None:
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value):
                self.assertFalse(
                    validate_financial_snapshot(
                        FinancialSnapshot(revenue=value, market_cap=500.0)
                    ).passed
                )
                self.assertFalse(
                    validate_financial_snapshot(
                        FinancialSnapshot(revenue=100.0, market_cap=value)
                    ).passed
                )
                self.assertFalse(
                    validate_financial_snapshot(
                        FinancialSnapshot(revenue=100.0, market_cap=500.0, ebitda=value)
                    ).passed
                )
                self.assertFalse(
                    validate_financial_snapshot(
                        FinancialSnapshot(revenue=100.0, market_cap=500.0, pe_ratio=value)
                    ).passed
                )


class HonestDegradeTests(unittest.TestCase):
    def test_technical_status_passes_when_any_branch_exists(self) -> None:
        self.assertTrue(validate_technical_status(TechnicalStatus(monte_carlo_available=True)).passed)

    def test_technical_dcf_unavailable_is_honest_degrade(self) -> None:
        result = validate_technical_status(
            TechnicalStatus(dcf_unavailable_degraded=True, warnings=("DCF unavailable",))
        )
        self.assertTrue(result.passed)
        self.assertTrue(result.warnings)

    def test_technical_empty_without_degrade_fails(self) -> None:
        result = validate_technical_status(TechnicalStatus(warnings=("no diagnostics",)))
        self.assertFalse(result.passed)
        self.assertIn("failed", (result.error or "").lower())

    def test_ownership_data_or_explicit_degradation_passes(self) -> None:
        self.assertTrue(
            validate_ownership_governance_status(
                OwnershipGovernanceStatus(insider_transactions=1)
            ).passed
        )
        degraded = validate_ownership_governance_status(
            OwnershipGovernanceStatus(degraded_sections=("proxy_compensation",))
        )
        self.assertTrue(degraded.passed)
        self.assertTrue(degraded.warnings)

    def test_ownership_empty_without_degrade_fails(self) -> None:
        result = validate_ownership_governance_status(OwnershipGovernanceStatus())
        self.assertFalse(result.passed)
        self.assertIn("no data", (result.error or "").lower())

    def test_negative_counts_fail_closed(self) -> None:
        result = validate_ownership_governance_status(
            OwnershipGovernanceStatus(insider_transactions=-1)
        )
        self.assertFalse(result.passed)


if __name__ == "__main__":
    unittest.main()
