"""Mutation-sensitive known answers and fail-closed contract tests for P11 SI-05.02."""
import copy
import json
from pathlib import Path
import unittest

from company_fundamentals_snapshot import company_fundamentals_snapshot

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "company_fundamentals_known_answers.json").read_text(encoding="utf-8"))


class CompanyFundamentalsSnapshotTests(unittest.TestCase):
    def request(self):
        return copy.deepcopy(FIXTURE["request"])

    def test_independent_nine_metric_known_answers(self):
        result = company_fundamentals_snapshot(self.request())
        self.assertEqual(set(result["metrics"]), set(FIXTURE["expected"]))
        for name, (value, unit) in FIXTURE["expected"].items():
            metric = result["metrics"][name]
            with self.subTest(name=name):
                self.assertEqual(metric["status"], "computed")
                self.assertEqual(metric["value"], value)
                self.assertEqual(metric["unit"], unit)
                self.assertIsNone(metric["reason"])
                self.assertEqual(metric["missingFacts"], [])
        growth = result["metrics"]["revenueGrowthPct"]
        self.assertEqual(growth["contributingFacts"][0]["sourceRef"], "fixture:revenue-current")
        self.assertEqual(growth["contributingFacts"][1]["sourceRef"], "fixture:revenue-prior")
        self.assertEqual(result["conventions"]["imputation"], "none")
        json.dumps(result, allow_nan=False)

    def test_mutation_sensitivity_of_all_nine_metrics(self):
        baseline = company_fundamentals_snapshot(self.request())["metrics"]
        changes = {
            "prior.revenue": ["revenueGrowthPct"],
            "current.grossProfit": ["grossMarginPct"],
            "current.operatingIncome": ["operatingMarginPct"],
            "current.netIncome": ["netMarginPct"],
            "current.freeCashFlow": ["freeCashFlowMarginPct"],
            "current.currentAssets": ["currentRatio"],
            "current.cashAndEquivalents": ["netDebt", "netDebtToEbitda"],
            "current.ebitda": ["grossDebtToEbitda", "netDebtToEbitda"],
        }
        for path, impacted in changes.items():
            with self.subTest(field=path):
                req = self.request()
                snap, fact = path.split(".")
                req[snap]["facts"][fact]["value"] = "25"
                revised = company_fundamentals_snapshot(req)["metrics"]
                for name in impacted:
                    self.assertNotEqual(revised[name]["value"], baseline[name]["value"])

    def test_missing_fact_does_not_look_like_zero(self):
        req = self.request()
        del req["current"]["facts"]["operatingIncome"]
        out = company_fundamentals_snapshot(req)["metrics"]
        self.assertEqual(out["operatingMarginPct"]["status"], "not_computable")
        self.assertIn("current.operatingIncome", out["operatingMarginPct"]["missingFacts"])
        self.assertIsNone(out["operatingMarginPct"]["value"])
        self.assertEqual(out["grossMarginPct"]["value"], "40")

    def test_zero_and_negative_denominators_fail_closed(self):
        for fact, expected_metric in (("revenue", "grossMarginPct"),
                                      ("currentLiabilities", "currentRatio"),
                                      ("ebitda", "grossDebtToEbitda")):
            for value in ("0", "-5"):
                with self.subTest(fact=fact, value=value):
                    req = self.request()
                    req["current"]["facts"][fact]["value"] = value
                    metric = company_fundamentals_snapshot(req)["metrics"][expected_metric]
                    self.assertEqual(metric["status"], "not_computable")
                    self.assertIn("strictly positive", metric["reason"])
                    self.assertIsNone(metric["value"])
        req = self.request()
        req["prior"]["facts"]["revenue"]["value"] = "0"
        self.assertEqual(company_fundamentals_snapshot(req)["metrics"]["revenueGrowthPct"]["status"], "not_computable")

    def test_currency_unit_mismatch_requires_explicit_conversion(self):
        req = self.request()
        req["current"]["facts"]["cashAndEquivalents"]["unit"] = "EUR_millions"
        for name in ("netDebt", "netDebtToEbitda"):
            self.assertIn("incompatible", company_fundamentals_snapshot(req)["metrics"][name]["reason"])
        req = self.request()
        req["prior"]["facts"]["revenue"]["unit"] = "USD_thousands"
        self.assertEqual(company_fundamentals_snapshot(req)["metrics"]["revenueGrowthPct"]["status"], "not_computable")

    def test_prior_period_must_be_linked_and_comparable(self):
        for mutator in (
            lambda r: r["current"].pop("comparablePriorPeriodId"),
            lambda r: r["prior"].update(periodType="fiscal_quarter"),
            lambda r: r["prior"].update(periodId="FY2025"),
            lambda r: r.update(prior=None),
        ):
            req = self.request()
            mutator(req)
            metric = company_fundamentals_snapshot(req)["metrics"]["revenueGrowthPct"]
            self.assertEqual(metric["status"], "not_computable")
        self.assertEqual(company_fundamentals_snapshot({"current": self.request()["current"]})["metrics"]["grossMarginPct"]["status"], "computed")

    def test_invalid_source_and_numbers_are_rejected(self):
        for field, value in (("value", "NaN"), ("value", "Infinity"), ("value", 25),
                             ("value", "1e309"), ("unit", ""), ("inputClass", "trusted_by_ai")):
            req = self.request()
            req["current"]["facts"]["revenue"][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                company_fundamentals_snapshot(req)
        req = self.request()
        del req["current"]["facts"]["revenue"]["sourceRef"]
        with self.assertRaisesRegex(ValueError, "source_cited requires sourceRef"):
            company_fundamentals_snapshot(req)

    def test_negative_debt_and_cash_fail_closed(self):
        for fact, expected in (("shortTermDebt", "grossDebtToEbitda"),
                               ("cashAndEquivalents", "netDebt")):
            req = self.request()
            req["current"]["facts"][fact]["value"] = "-1"
            self.assertEqual(company_fundamentals_snapshot(req)["metrics"][expected]["status"], "not_computable")

    def test_large_debt_balances_preserve_small_decimal_adjustments(self):
        req = self.request()
        req["current"]["facts"]["shortTermDebt"]["value"] = "123456789012345678901234567890.12345"
        req["current"]["facts"]["longTermDebt"]["value"] = "0.00006"
        req["current"]["facts"]["cashAndEquivalents"]["value"] = "0.00001"
        metric = company_fundamentals_snapshot(req)["metrics"]["netDebt"]
        self.assertEqual(metric["status"], "computed")
        self.assertEqual(metric["value"], "123456789012345678901234567890.1235")

    def test_repeating_decimal_precision_and_negative_net_cash(self):
        req = self.request()
        req["current"]["facts"]["grossProfit"]["value"] = "1"
        req["current"]["facts"]["revenue"]["value"] = "3"
        req["current"]["facts"]["cashAndEquivalents"]["value"] = "500"
        result = company_fundamentals_snapshot(req)["metrics"]
        self.assertEqual(result["grossMarginPct"]["value"], "33.333333333333")
        self.assertEqual(result["netDebt"]["value"], "-100")
        self.assertEqual(result["netDebtToEbitda"]["value"], "-0.25")


if __name__ == "__main__":
    unittest.main()
