"""No-network unit coverage for the release image's numerical admission gate."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from quant_smoke import verify_core_numerical_runtime


class QuantSmokeTests(unittest.TestCase):
    def test_independent_known_reverse_dcf_is_reproduced(self):
        result = verify_core_numerical_runtime()
        self.assertAlmostEqual(result["impliedRevenueGrowthPct"], 0.0, delta=1e-7)
        self.assertAlmostEqual(result["repricedEquityValue"], 100.0, delta=1e-7)

    def test_bad_compiled_solver_result_fails_image_admission(self):
        with patch("quant_smoke.brentq", return_value=0.1):
            with self.assertRaisesRegex(RuntimeError, "reverse-DCF numerical admission"):
                verify_core_numerical_runtime()

    def test_nonfinite_solver_result_fails_image_admission(self):
        with patch("quant_smoke.brentq", return_value=float("nan")):
            with self.assertRaisesRegex(RuntimeError, "reverse-DCF numerical admission"):
                verify_core_numerical_runtime()


if __name__ == "__main__":
    unittest.main()
