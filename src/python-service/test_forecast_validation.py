import math
import unittest

import numpy as np

from forecast_validation import SarimaxBacktestRequest, sarimax_rolling_backtest


class ForecastValidationTests(unittest.TestCase):
    def test_rolling_origin_backtest_is_lookahead_safe_and_finite(self):
        # Stable AR(1)-like process with a mild deterministic forcing term.
        values = [100.0]
        for i in range(1, 80):
            values.append(20.0 + 0.8 * values[-1] + 0.5 * math.sin(i / 4.0))

        result = sarimax_rolling_backtest(SarimaxBacktestRequest(
            series=values,
            order=[1, 0, 0],
            initialTrainSize=55,
            horizon=1,
            step=4,
            maxOrigins=6,
            benchmark="naive",
            minimumSkillPct=-100,
            minimumWinRate=0,
        ))

        self.assertTrue(result.lookaheadSafe)
        self.assertGreaterEqual(result.originsEvaluated, 3)
        self.assertTrue(math.isfinite(result.modelMetrics.rmse))
        self.assertTrue(math.isfinite(result.benchmarkMetrics.rmse))
        self.assertTrue(math.isfinite(result.skillRmsePct))
        for fold in result.folds:
            self.assertLessEqual(fold.trainEndExclusive, fold.testStart)
            self.assertEqual(fold.testStart, fold.origin)
            self.assertEqual(len(fold.actual), 1)
            self.assertEqual(len(fold.forecast), 1)

    def test_strict_skill_gate_blocks_a_model_that_does_not_clear_required_edge(self):
        # A near-flat series makes naive forecasting difficult to beat by a
        # large required margin.  The test asserts gate semantics, not that a
        # particular sophisticated model is intrinsically weak.
        values = [100.0 + 0.01 * math.sin(i) for i in range(70)]
        result = sarimax_rolling_backtest(SarimaxBacktestRequest(
            series=values,
            order=[1, 0, 0],
            initialTrainSize=50,
            horizon=1,
            step=3,
            maxOrigins=6,
            benchmark="naive",
            minimumSkillPct=99.0,
            minimumWinRate=1.0,
        ))
        self.assertFalse(result.decisionGradeEligible)
        self.assertTrue(any("skill" in blocker.lower() or "wins only" in blocker.lower() for blocker in result.blockers))

    def test_seasonal_naive_requires_a_period(self):
        values = [float(i) for i in range(50)]
        with self.assertRaisesRegex(ValueError, "seasonalPeriod is required"):
            sarimax_rolling_backtest(SarimaxBacktestRequest(
                series=values,
                order=[1, 0, 0],
                benchmark="seasonal_naive",
            ))

    def test_non_finite_input_fails_closed(self):
        values = [float(i) for i in range(50)]
        values[25] = float("nan")
        with self.assertRaisesRegex(ValueError, "NaN or infinite"):
            sarimax_rolling_backtest(SarimaxBacktestRequest(
                series=values,
                order=[1, 0, 0],
            ))

    def test_expanding_window_does_not_mutate_or_shuffle_source_series(self):
        values = [50.0 + 0.2 * i + math.sin(i / 3) for i in range(65)]
        original = list(values)
        result = sarimax_rolling_backtest(SarimaxBacktestRequest(
            series=values,
            order=[1, 1, 0],
            initialTrainSize=45,
            horizon=2,
            step=4,
            maxOrigins=5,
            benchmark="drift",
            minimumSkillPct=-100,
            minimumWinRate=0,
        ))
        self.assertEqual(values, original)
        self.assertEqual([fold.origin for fold in result.folds], sorted(fold.origin for fold in result.folds))
        self.assertTrue(np.all(np.isfinite([v for fold in result.folds for v in fold.forecast])))


if __name__ == "__main__":
    unittest.main()
