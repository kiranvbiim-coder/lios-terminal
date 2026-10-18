"""Behavioral contracts for canonical lazy numerical execution and file transport."""
import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import engine_routes
import engine_worker

SERVICE_DIR = Path(__file__).resolve().parent
REVERSE_ROUTE = "/advanced/valuation/reverse-dcf"
REVERSE_BODY = {
    "currentRevenue": 100, "marketEquityValue": 100, "years": 1,
    "waccPct": 10, "terminalGrowthPct": 0, "ebitMarginPct": 20,
    "taxRatePct": 0, "reinvestmentPctOfRevenue": 10,
    "solveFor": "revenue_growth",
}
# Simulate the immutable image's actual pack boundary, not the developer host.
PACK_BOUNDARY = '''
import importlib.abc
import sys
class MissingPacks(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {
            'fastapi', 'uvicorn', 'QuantLib', 'statsmodels', 'pandas',
            'linearmodels', 'sklearn', 'arch', 'ruptures', 'networkx',
            'pymoo', 'SALib', 'asteval', 'edgar', 'yfinance',
        }:
            raise ModuleNotFoundError('Unavailable target pack', name=fullname)
sys.meta_path.insert(0, MissingPacks())
'''


class EngineRouteDeclarationTests(unittest.TestCase):
    def test_all_existing_routes_have_literal_symbols_in_current_engines(self):
        self.assertEqual(len(engine_routes.BASE_ROUTES), 72)
        self.assertEqual(len(engine_routes.ADVANCED_ROUTES), 85)
        self.assertEqual(len(engine_routes.ROUTES_BY_PATH), 157)
        for route in (*engine_routes.BASE_ROUTES, *engine_routes.ADVANCED_ROUTES):
            with self.subTest(route=route.path):
                tree = ast.parse((SERVICE_DIR / f"{route.module}.py").read_text())
                names = {node.name for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))}
                self.assertTrue({route.request_model, route.response_model, route.function} <= names)

    def test_malicious_route_never_selects_an_import(self):
        for route in ("../../os", "os.system", "__import__('os').system('id')", "/api/quant/advanced/valuation/reverse-dcf"):
            with self.subTest(route=route), patch.object(engine_routes.importlib, "import_module") as import_module:
                with self.assertRaisesRegex(engine_routes.EngineInputError, "Unknown numerical route"):
                    engine_routes.dispatch(route, {})
                import_module.assert_not_called()

    def test_schema_errors_do_not_echo_customer_values_in_worker_message(self):
        with self.assertRaises(engine_routes.EngineInputError) as caught:
            engine_routes.dispatch(REVERSE_ROUTE, {**REVERSE_BODY, "currentRevenue": "private-customer-value"})
        self.assertIn("float_parsing", caught.exception.worker_message)
        self.assertNotIn("private-customer-value", caught.exception.worker_message)
        self.assertIsNotNone(caught.exception.validation_errors)

    def test_nonfinite_inputs_are_refused(self):
        for value in (float("nan"), float("inf"), -float("inf")):
            with self.subTest(value=value), self.assertRaisesRegex(engine_routes.EngineInputError, "finite"):
                engine_routes.dispatch(REVERSE_ROUTE, {**REVERSE_BODY, "currentRevenue": value})

    def test_numerical_domain_classifier_does_not_import_optional_packs(self):
        with patch.object(engine_routes.importlib, "import_module") as import_module:
            self.assertFalse(engine_routes._is_numerical_domain_error(RuntimeError("broken engine")))
        import_module.assert_not_called()

    def test_unexpected_engine_errors_are_not_classified_as_domain_failures(self):
        import advanced_valuation

        for error in (RuntimeError("broken engine"), TypeError("bug"), KeyError("missing internal key")):
            with self.subTest(error=type(error).__name__), patch.object(
                advanced_valuation, "reverse_dcf", side_effect=error,
            ):
                with self.assertRaises(type(error)):
                    engine_routes.dispatch(REVERSE_ROUTE, REVERSE_BODY)


class EngineWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.request = Path(self.temporary.name) / "request.json"
        self.result = Path(self.temporary.name) / "result.json"

    def write_request(self, route=REVERSE_ROUTE, body=None):
        self.request.write_text(json.dumps({"route": route, "body": REVERSE_BODY if body is None else body}))

    def subprocess_worker(self, route=REVERSE_ROUTE, body=None):
        self.write_request(route, body)
        code = PACK_BOUNDARY + "\nimport engine_worker\nraise SystemExit(engine_worker.main(sys.argv[1:]))\n"
        env = {key: value for key, value in os.environ.items() if not key.startswith("LIOS_SIDECAR_")}
        return subprocess.run(
            [sys.executable, "-c", code, str(self.request), str(self.result)],
            cwd=SERVICE_DIR, env=env, capture_output=True, text=True, timeout=60,
        )

    def test_reverse_dcf_runs_with_only_immutable_image_numerical_packs(self):
        completed = self.subprocess_worker()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        envelope = json.loads(self.result.read_text())
        self.assertTrue(envelope["ok"])
        self.assertAlmostEqual(envelope["result"]["impliedRevenueGrowthPct"], 0, places=8)
        self.assertAlmostEqual(envelope["result"]["repricedEquityValue"], 100, places=8)

    def test_base_route_uses_same_worker_without_http_dependencies(self):
        completed = self.subprocess_worker("/economics/taylor-rule", {"inflationPct": 2})
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(self.result.read_text())["result"]["targetRatePct"], 4)

    def test_missing_target_pack_is_explicit_unavailable_not_input(self):
        completed = self.subprocess_worker("/fixed-income/bond-price", {})
        self.assertEqual(completed.returncode, 0, completed.stderr)
        envelope = json.loads(self.result.read_text())
        self.assertFalse(envelope["ok"])
        self.assertEqual(envelope["error"]["kind"], "unavailable")
        self.assertIn("QuantLib", envelope["error"]["message"])

    def test_domain_failure_is_input_envelope_with_successful_protocol_exit(self):
        self.write_request(body={**REVERSE_BODY, "terminalGrowthPct": 11})
        self.assertEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        envelope = json.loads(self.result.read_text())
        self.assertFalse(envelope["ok"])
        self.assertEqual(envelope["error"]["kind"], "input")

    def test_statsmodels_perfect_separation_and_missing_data_remain_input_errors(self):
        from statsmodels.discrete.discrete_model import Logit
        from statsmodels.tools.sm_exceptions import MissingDataError, PerfectSeparationError

        for error_type in (PerfectSeparationError, MissingDataError):
            with self.subTest(error=error_type.__name__):
                self.write_request("/stats/logistic", {"y": [0, 0, 1, 1], "x": [[-2, -1, 1, 2]]})
                with patch.object(Logit, "fit", side_effect=error_type("private-customer-value")):
                    self.assertEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
                envelope = json.loads(self.result.read_text())
                self.assertFalse(envelope["ok"])
                self.assertEqual(envelope["error"]["kind"], "input")
                self.assertNotIn("private-customer-value", self.result.read_text())
                self.result.unlink()

    def test_statsmodels_perfect_separation_retains_http_400(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from lazy_http_routes import add_engine_routes
        from statsmodels.discrete.discrete_model import Logit
        from statsmodels.tools.sm_exceptions import PerfectSeparationError

        app = FastAPI()
        add_engine_routes(app, [engine_routes.ROUTES_BY_PATH["/stats/logistic"]])
        with patch.object(Logit, "fit", side_effect=PerfectSeparationError("Perfect separation detected")):
            response = TestClient(app).post("/stats/logistic", json={"y": [0, 0, 1, 1], "x": [[-2, -1, 1, 2]]})
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json(), {"detail": "Perfect separation detected"})

    def test_scipy_nonconvergence_remains_an_input_error(self):
        from scipy.optimize import NoConvergence

        self.write_request()
        import advanced_valuation
        with patch.object(advanced_valuation, "reverse_dcf", side_effect=NoConvergence("failed to converge")):
            self.assertEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        envelope = json.loads(self.result.read_text())
        self.assertFalse(envelope["ok"])
        self.assertEqual(envelope["error"]["kind"], "input")

    def test_runtime_inventory_runs_without_numerical_or_http_imports(self):
        self.write_request("/runtime-info", {})
        script = PACK_BOUNDARY + '''
import engine_routes
blocked = {route.module for route in engine_routes.ROUTES_BY_PATH.values()} | {'numpy', 'scipy'}
class RefuseNumericalImports(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in blocked:
            raise AssertionError('Runtime inventory imported ' + fullname)
sys.meta_path.insert(0, RefuseNumericalImports())
import engine_worker
status = engine_worker.main(sys.argv[1:])
assert not (blocked & sys.modules.keys())
raise SystemExit(status)
'''
        completed = subprocess.run(
            [sys.executable, "-c", script, str(self.request), str(self.result)],
            cwd=SERVICE_DIR, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        envelope = json.loads(self.result.read_text())
        self.assertTrue(envelope["ok"])
        inventory = envelope["result"]
        self.assertEqual(set(inventory), {"ok", "python", "packages"})
        self.assertTrue(inventory["ok"])
        self.assertIsInstance(inventory["python"], str)
        self.assertIn("numpy", inventory["packages"])
        self.assertIn("QuantLib", inventory["packages"])
        self.assertNotIn("/runtime-info", engine_routes.ROUTES_BY_PATH)

    def test_runtime_inventory_reports_missing_distribution_metadata(self):
        from importlib.metadata import PackageNotFoundError

        def installed_version(package):
            if package == "numpy":
                return "test-installed-version"
            raise PackageNotFoundError(package)

        with patch("importlib.metadata.version", side_effect=installed_version):
            inventory = engine_routes.runtime_inventory()
        self.assertEqual(inventory["packages"]["numpy"], "test-installed-version")
        self.assertEqual(inventory["packages"]["QuantLib"], "unavailable")

    def test_runtime_inventory_refuses_nonempty_body_without_dispatch(self):
        self.write_request("/runtime-info", {"module": "os"})
        with patch.object(engine_worker, "dispatch") as dispatch:
            self.assertEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        dispatch.assert_not_called()
        self.assertEqual(json.loads(self.result.read_text())["error"]["kind"], "input")

    def test_validation_failure_is_input_and_does_not_echo_body(self):
        self.write_request(body={**REVERSE_BODY, "currentRevenue": "private-customer-value"})
        self.assertEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        envelope = json.loads(self.result.read_text())
        self.assertEqual(envelope["error"]["kind"], "input")
        self.assertNotIn("private-customer-value", self.result.read_text())

    def test_unknown_route_is_refused_without_engine_import(self):
        self.write_request(route="../../os")
        with patch.object(engine_routes.importlib, "import_module") as import_module:
            self.assertEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        import_module.assert_not_called()
        self.assertEqual(json.loads(self.result.read_text())["error"]["kind"], "input")

    def test_broken_protocol_has_nonzero_exit_and_no_result(self):
        for payload in (
            '{"route":"/economics/taylor-rule","body":{},"code":"ignored"}',
            '{"route":"/economics/taylor-rule","body":{},"body":{}}',
            '{"route":"/economics/taylor-rule","body":{"inflationPct":NaN}}',
            '{"route":4,"body":{}}',
            '[]', '{broken',
        ):
            with self.subTest(payload=payload):
                self.request.write_text(payload)
                self.assertNotEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
                self.assertFalse(self.result.exists())

    def test_oversized_input_is_refused_before_dispatch(self):
        self.request.write_bytes(b" " * (engine_worker.MAX_JSON_BYTES + 1))
        with patch.object(engine_worker, "dispatch") as dispatch:
            self.assertNotEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        dispatch.assert_not_called()
        self.assertFalse(self.result.exists())

    def test_nonfinite_and_oversized_output_never_create_result(self):
        self.write_request()
        for result in ({"bad": float("nan")}, {"bad": float("inf")}, {"large": "x" * engine_worker.MAX_JSON_BYTES}):
            with self.subTest(keys=list(result)), patch.object(
                engine_worker, "dispatch", return_value=SimpleNamespace(model_dump=lambda **kwargs: result),
            ):
                self.assertNotEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
                self.assertFalse(self.result.exists())

    def test_unexpected_engine_failure_is_not_mislabeled_user_input(self):
        self.write_request()
        with patch.object(engine_worker, "dispatch", side_effect=RuntimeError("broken engine")):
            self.assertNotEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        self.assertFalse(self.result.exists())

    def test_existing_output_is_not_overwritten(self):
        self.write_request()
        self.result.write_text("preserve existing output")
        self.assertNotEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        self.assertEqual(self.result.read_text(), "preserve existing output")

    @unittest.skipIf(os.name == "nt", "Creating symlinks requires optional Windows privileges")
    def test_input_and_output_symlinks_are_refused(self):
        actual = Path(self.temporary.name) / "actual.json"
        actual.write_text(json.dumps({"route": REVERSE_ROUTE, "body": REVERSE_BODY}))
        self.request.symlink_to(actual)
        self.assertNotEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        self.assertFalse(self.result.exists())
        self.request.unlink()
        self.write_request()
        self.result.symlink_to(actual)
        before = actual.read_text()
        self.assertNotEqual(engine_worker.main([str(self.request), str(self.result)]), 0)
        self.assertEqual(actual.read_text(), before)


if __name__ == "__main__":
    unittest.main()
