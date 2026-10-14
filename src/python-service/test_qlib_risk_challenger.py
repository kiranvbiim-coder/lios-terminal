"""Known-answer and negative-input tests for the isolated P11 Qlib adaptation."""
from __future__ import annotations

import json
import math
import unittest

from pydantic import ValidationError

from qlib_risk_challenger import (
    METHOD,
    SOURCE_COMMIT,
    QlibRiskChallengerRequest,
    calculate_qlib_risk_challenger,
)


def calculate(values, mode="sum", sessions=4):
    return calculate_qlib_risk_challenger(
        QlibRiskChallengerRequest(returns=values, mode=mode, annualizationSessions=sessions)
    )


class QlibRiskChallengerTests(unittest.TestCase):
    def test_source_contract(self):
        self.assertEqual(len(SOURCE_COMMIT), 40)
        self.assertEqual(METHOD, "qlib_risk_analysis_mit_adaptation_v1")

    def test_sum_independent_known_answer(self):
        result = calculate([0.1, -0.1, 0.1, -0.1])
        self.assertAlmostEqual(result.mean, 0)
        self.assertAlmostEqual(result.std, math.sqrt(0.04 / 3))
        self.assertAlmostEqual(result.annualizedReturn, 0)
        self.assertAlmostEqual(result.informationRatio, 0)
        self.assertAlmostEqual(result.maxDrawdown, -0.1)
        self.assertEqual(result.inputTruth, "unknown")

    def test_product_independent_known_answer(self):
        result = calculate([0.1, -0.1, 0.1, -0.1], mode="product")
        self.assertAlmostEqual(result.annualizedReturn, -0.0199)
        self.assertAlmostEqual(result.mean, 0.9801 ** 0.25 - 1)
        high, low = math.log1p(0.1), math.log1p(-0.1)
        mid = (high + low) / 2
        std = math.sqrt((2 * (high - mid) ** 2 + 2 * (low - mid) ** 2) / 3)
        self.assertAlmostEqual(result.std, std)
        self.assertAlmostEqual(result.maxDrawdown, -0.109)
        self.assertAlmostEqual(result.informationRatio, result.mean / std * 2)

    def test_constant_samples_never_fabricate_infinite_ratio(self):
        for mode in ("sum", "product"):
            for value in (0.01, 0.02, 0.1):
                result = calculate([value] * 512, mode=mode, sessions=252)
                self.assertEqual(result.std, 0)
                self.assertIsNone(result.informationRatio)

    def test_finite_and_json_serializable(self):
        for mode in ("sum", "product"):
            req = QlibRiskChallengerRequest(
                returns=[0.001, -0.002, 0.003, 0.004], mode=mode, annualizationSessions=238,
            )
            a = calculate_qlib_risk_challenger(req).model_dump()
            b = calculate_qlib_risk_challenger(req).model_dump()
            self.assertEqual(a, b)
            self.assertFalse(a["inputTruth"] == "observed")
            json.dumps(a, allow_nan=False)

    def test_invalid_observations_rejected_before_calculation(self):
        for bad in ([0.1], [0, -1], [0, float("nan")], [0, float("inf")],
                    [0, 11], [0, "0.1"], [False, 0.1], [0] * 513):
            with self.subTest(bad=repr(bad)), self.assertRaises(ValidationError):
                QlibRiskChallengerRequest(returns=bad, mode="sum", annualizationSessions=238)
        for sessions in (0, -1, 366, 2.5, True, "252"):
            with self.subTest(sessions=sessions), self.assertRaises(ValidationError):
                QlibRiskChallengerRequest(
                    returns=[0, 0.1], mode="sum", annualizationSessions=sessions,
                )
        with self.assertRaises(ValidationError):
            QlibRiskChallengerRequest(
                returns=[0, 0.1], mode="magic", annualizationSessions=252,
            )
        with self.assertRaises(ValidationError):
            QlibRiskChallengerRequest(
                returns=[0, 0.1], mode="sum", annualizationSessions=252,
                providerProof="fabricated",
            )

    def test_compounded_overflow_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "overflow/underflow"):
            calculate([10] * 512, mode="product", sessions=252)


if __name__ == "__main__":
    unittest.main()
