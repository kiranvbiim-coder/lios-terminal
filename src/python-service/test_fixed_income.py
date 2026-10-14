import unittest

from fixed_income import BondPriceRequest, price_bond


class FixedIncomeInstitutionalTests(unittest.TestCase):
    def test_explicit_dates_make_pricing_reproducible(self):
        request = BondPriceRequest(
            faceValue=1_000_000,
            couponRatePct=5.0,
            frequency=2,
            yearsToMaturity=5,
            marketYieldPct=5.0,
            dayCount="30/360",
            valuationDate="2026-08-26",
            scheduleStartDate="2021-08-26",
            maturityDate="2031-08-26",
            settlementDays=0,
        )
        first = price_bond(request)
        second = price_bond(request)
        self.assertEqual(first.model_dump(), second.model_dump())
        self.assertEqual(first.valuationDateUsed, "2026-08-26")
        self.assertEqual(first.maturityDate, "2031-08-26")
        self.assertAlmostEqual(first.cleanPricePct, 100.0, places=8)

    def test_seasoned_bond_has_real_accrued_interest(self):
        request = BondPriceRequest(
            faceValue=100_000,
            couponRatePct=6.0,
            frequency=2,
            yearsToMaturity=5,
            marketYieldPct=5.5,
            dayCount="30/360",
            valuationDate="2026-09-15",
            scheduleStartDate="2021-01-01",
            maturityDate="2031-01-01",
            settlementDays=0,
        )
        result = price_bond(request)
        self.assertGreater(result.accruedInterestPct, 0)
        self.assertGreater(result.dirtyPricePct, result.cleanPricePct)
        self.assertAlmostEqual(
            result.dirtyPricePct,
            result.cleanPricePct + result.accruedInterestPct,
            places=10,
        )

    def test_bump_and_reprice_cross_checks_analytic_risk(self):
        request = BondPriceRequest(
            faceValue=1_000_000,
            couponRatePct=4.25,
            frequency=2,
            yearsToMaturity=10,
            marketYieldPct=5.0,
            dayCount="ACT/ACT",
            valuationDate="2026-08-26",
            scheduleStartDate="2024-02-26",
            maturityDate="2036-08-26",
            settlementDays=1,
            calendar="US_GOVT",
            businessDayConvention="MODIFIED_FOLLOWING",
        )
        result = price_bond(request)
        expected_dv01 = (result.priceDown1bpPct - result.priceUp1bpPct) / 2 * request.faceValue / 100
        self.assertAlmostEqual(result.dv01Amount, expected_dv01, places=8)
        self.assertLess(result.durationCrossCheckAbs, 1e-4)
        self.assertLess(result.convexityCrossCheckRelativeError, 1e-3)
        self.assertGreater(result.priceDown1bpPct, result.cleanPricePct)
        self.assertLess(result.priceUp1bpPct, result.cleanPricePct)

    def test_exact_maturity_overrides_approximate_year_count(self):
        request = BondPriceRequest(
            faceValue=1000,
            couponRatePct=3.0,
            frequency=2,
            yearsToMaturity=99,
            marketYieldPct=4.0,
            valuationDate="2026-08-26",
            maturityDate="2030-03-17",
        )
        result = price_bond(request)
        self.assertEqual(result.maturityDate, "2030-03-17")

    def test_invalid_schedule_fails_closed(self):
        request = BondPriceRequest(
            faceValue=1000,
            couponRatePct=3.0,
            frequency=2,
            yearsToMaturity=5,
            marketYieldPct=4.0,
            valuationDate="2026-08-26",
            scheduleStartDate="2032-01-01",
            maturityDate="2031-01-01",
        )
        with self.assertRaisesRegex(ValueError, "scheduleStartDate must be before maturityDate"):
            price_bond(request)


if __name__ == "__main__":
    unittest.main()
