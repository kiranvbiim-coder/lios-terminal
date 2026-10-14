import json
from pathlib import Path
import unittest

import advanced_valuation as av


FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "dcf_sensitivity_known_answers.json"


class DcfSensitivityKnownAnswerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.tolerance = float(cls.fixture["toleranceAbsolute"])

    def assertClose(self, actual, expected):
        self.assertLessEqual(abs(float(actual) - float(expected)), self.tolerance)

    def test_gordon_known_answer_grid_and_scenarios(self):
        case = self.fixture["gordonCase"]
        output = av.dcf_sensitivity(av.DcfSensitivityRequest(**case["request"]))
        expected = case["expected"]
        for field, value in expected["base"].items():
            self.assertClose(getattr(output.base, field), value)

        self.assertEqual(output.sensitivity.waccPct, [9.0, 10.0, 11.0])
        self.assertEqual(output.sensitivity.terminalGrowthPct, [2.0, 3.0, 4.0])
        for actual_row, expected_row in zip(output.sensitivity.valuePerShareMatrix, expected["valuePerShareMatrix"]):
            for actual, expected_value in zip(actual_row, expected_row):
                self.assertClose(actual, expected_value)

        for name, expected_value in expected["scenarios"].items():
            self.assertClose(getattr(output.scenarios, name).valuePerShare, expected_value)

        self.assertEqual(output.conventions.discountTiming, "year_end")
        self.assertEqual(output.conventions.sensitivityTerminalMethod, "gordon_growth")

    def test_exit_multiple_known_answer_requires_explicit_terminal_metric(self):
        case = self.fixture["exitMultipleCase"]
        output = av.dcf_sensitivity(av.DcfSensitivityRequest(**case["request"]))
        for field, value in case["expected"]["base"].items():
            self.assertClose(getattr(output.base, field), value)
        self.assertEqual(output.base.terminalMethod, "exit_multiple")
        self.assertEqual(output.base.terminalMetric, 150)
        self.assertEqual(output.base.exitMultiple, 8)

    def test_invalid_terminal_growth_is_rejected(self):
        request = dict(self.fixture["gordonCase"]["request"])
        request["terminalGrowthPct"] = 10
        with self.assertRaisesRegex(ValueError, "WACC must exceed terminal growth"):
            av.dcf_sensitivity(av.DcfSensitivityRequest(**request))

    def test_invalid_sensitivity_cell_is_rejected(self):
        request = dict(self.fixture["gordonCase"]["request"])
        request["waccGridPct"] = [3]
        request["terminalGrowthGridPct"] = [3]
        with self.assertRaisesRegex(ValueError, "must exceed terminal growth"):
            av.dcf_sensitivity(av.DcfSensitivityRequest(**request))


    def test_non_finite_bridge_and_terminal_inputs_are_rejected(self):
        request = dict(self.fixture["gordonCase"]["request"])
        request["netDebt"] = float("inf")
        with self.assertRaisesRegex(ValueError, "netDebt must be finite"):
            av.dcf_sensitivity(av.DcfSensitivityRequest(**request))

        exit_request = dict(self.fixture["exitMultipleCase"]["request"])
        exit_request["exitMultiple"] = float("inf")
        with self.assertRaisesRegex(ValueError, "exitMultiple must be a positive finite value"):
            av.dcf_sensitivity(av.DcfSensitivityRequest(**exit_request))

    def test_exit_multiple_without_metric_is_rejected(self):
        request = dict(self.fixture["exitMultipleCase"]["request"])
        request["terminalMetric"] = None
        with self.assertRaisesRegex(ValueError, "requires exitMultiple and terminalMetric"):
            av.dcf_sensitivity(av.DcfSensitivityRequest(**request))


if __name__ == "__main__":
    unittest.main()
