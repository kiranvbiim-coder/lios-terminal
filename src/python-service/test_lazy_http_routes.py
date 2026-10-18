"""HTTP and OpenAPI contracts for lazily loaded canonical numerical routes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

os.environ["LIOS_SIDECAR_TOKEN"] = "unit-test-launch-token"
import main  # noqa: E402
import engine_routes  # noqa: E402
from lazy_http_routes import add_engine_routes, install_lazy_openapi  # noqa: E402

SERVICE_DIR = Path(__file__).resolve().parent
HEADERS = {"X-LiOS-Sidecar-Token": "unit-test-launch-token"}
ROUTE = "/advanced/valuation/reverse-dcf"
BODY = {
    "currentRevenue": 100, "marketEquityValue": 100, "years": 1,
    "waccPct": 10, "terminalGrowthPct": 0, "ebitMarginPct": 20,
    "taxRatePct": 0, "reinvestmentPctOfRevenue": 10,
    "solveFor": "revenue_growth",
}


class LazyHttpTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_all_existing_http_paths_are_registered_exactly_once(self):
        paths = [route.path for route in main.app.routes if "POST" in getattr(route, "methods", set())]
        self.assertEqual(set(paths), set(engine_routes.ROUTES_BY_PATH))
        self.assertEqual(len(paths), 157)

    def test_authenticated_advanced_route_uses_known_answer(self):
        response = self.client.post(ROUTE, json=BODY, headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertAlmostEqual(response.json()["repricedEquityValue"], 100, places=8)
        self.assertAlmostEqual(response.json()["impliedRevenueGrowthPct"], 0, places=8)

    def test_request_validation_remains_422_with_original_body_locations(self):
        response = self.client.post(ROUTE, json={**BODY, "currentRevenue": 0}, headers=HEADERS)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"][0]["loc"], ["body", "currentRevenue"])
        self.assertEqual(response.json()["detail"][0]["type"], "greater_than")

    def test_domain_validation_remains_400(self):
        response = self.client.post(ROUTE, json={**BODY, "terminalGrowthPct": 11}, headers=HEADERS)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("WACC must exceed terminal growth", response.json()["detail"])

    def test_missing_pack_is_503_without_breaking_unrelated_route(self):
        original_import = engine_routes.importlib.import_module

        def unavailable(name, *args, **kwargs):
            if name == "fixed_income":
                raise ModuleNotFoundError("Target pack is absent", name="QuantLib")
            return original_import(name, *args, **kwargs)

        with patch.object(engine_routes.importlib, "import_module", side_effect=unavailable):
            missing = self.client.post("/fixed-income/bond-price", json={}, headers=HEADERS)
            working = self.client.post(ROUTE, json=BODY, headers=HEADERS)
        self.assertEqual(missing.status_code, 503, missing.text)
        self.assertIn("QuantLib", missing.json()["detail"])
        self.assertEqual(working.status_code, 200, working.text)

    def test_query_cannot_override_allowlisted_route(self):
        response = self.client.post(
            ROUTE + "?_path=/fixed-income/bond-price", json=BODY, headers=HEADERS,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("repricedEquityValue", response.json())

    def test_openapi_retains_typed_request_and_response_contracts(self):
        # Exercise explicit schema generation on representative base/advanced
        # routes without loading every unrelated installed pack in this test.
        app = FastAPI()
        base_route = engine_routes.ROUTES_BY_PATH["/economics/taylor-rule"]
        advanced_route = engine_routes.ROUTES_BY_PATH[ROUTE]
        add_engine_routes(app, [base_route])
        router = APIRouter(prefix="/advanced")
        add_engine_routes(router, [advanced_route], prefix="/advanced")
        app.include_router(router)
        install_lazy_openapi(app, {base_route.path: base_route, ROUTE: advanced_route})
        schema = TestClient(app).get("/openapi.json").json()
        post = schema["paths"][ROUTE]["post"]
        self.assertTrue(post["requestBody"]["required"])
        self.assertEqual(post["requestBody"]["content"]["application/json"]["schema"]["$ref"], "#/components/schemas/ReverseDcfRequest")
        self.assertEqual(post["responses"]["200"]["content"]["application/json"]["schema"]["$ref"], "#/components/schemas/ReverseDcfResponse")
        self.assertIn("422", post["responses"])
        self.assertIn("503", post["responses"])
        self.assertIn("TaylorRuleRequest", schema["components"]["schemas"])

    def test_openapi_keeps_unavailable_known_paths_without_fake_schemas(self):
        app = FastAPI()
        route = engine_routes.ROUTES_BY_PATH["/fixed-income/bond-price"]
        add_engine_routes(app, [route])
        install_lazy_openapi(app, {route.path: route})
        with patch("lazy_http_routes.resolve_route", side_effect=engine_routes.EngineUnavailableError("pack absent")):
            schema = TestClient(app).get("/openapi.json").json()
        post = schema["paths"][route.path]["post"]
        self.assertIn("503", post["responses"])
        self.assertNotIn("BondPriceRequest", schema.get("components", {}).get("schemas", {}))

    def test_cold_health_does_not_import_any_numerical_engine_or_pack(self):
        script = '''
import importlib.abc
import json
import sys
from engine_routes import ROUTES_BY_PATH
blocked = {route.module for route in ROUTES_BY_PATH.values()} | {'numpy', 'scipy', 'QuantLib', 'statsmodels', 'pandas', 'sklearn'}
class RefuseHeavyImports(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in blocked:
            raise AssertionError('Health eagerly imported ' + fullname)
sys.meta_path.insert(0, RefuseHeavyImports())
import main
from fastapi.testclient import TestClient
client = TestClient(main.app)
health = client.get('/health')
assert health.status_code == 200 and health.json() == {'ok': True}
assert client.get('/openapi.json').status_code == 401
assert client.post('/advanced/valuation/reverse-dcf', json={}).status_code == 401
assert not (blocked & sys.modules.keys())
print(json.dumps(health.json()))
'''
        env = {key: value for key, value in os.environ.items() if key != "LIOS_SIDECAR_PARENT_PID"}
        env["LIOS_SIDECAR_TOKEN"] = "unit-test-launch-token"
        completed = subprocess.run(
            [sys.executable, "-c", script], cwd=SERVICE_DIR, env=env,
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout), {"ok": True})


if __name__ == "__main__":
    unittest.main()
