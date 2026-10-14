import importlib
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

TOKEN = "unit-test-launch-token"
os.environ["LIOS_SIDECAR_TOKEN"] = TOKEN

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from sidecar_auth import SidecarTokenMissing, load_token  # noqa: E402

HEADER = "X-LiOS-Sidecar-Token"
SERVICE_DIR = Path(__file__).resolve().parent
ROUTE = "/stats/descriptive-diagnostics"
BODY = {"data": [1, 2, 3, 4, 5]}


class SidecarAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_missing_token_is_rejected_on_routes_and_docs(self):
        for method, path in (("POST", ROUTE), ("GET", "/docs"), ("GET", "/openapi.json"), ("GET", "/runtime-info")):
            response = self.client.request(method, path, json=BODY if method == "POST" else None)
            self.assertEqual(response.status_code, 401, path)
            self.assertEqual(response.json(), {"detail": "Unauthorized"})

    def test_wrong_token_is_rejected(self):
        for wrong in ("wrong", TOKEN + "x", TOKEN[:-1], ""):
            response = self.client.post(ROUTE, json=BODY, headers={HEADER: wrong})
            self.assertEqual(response.status_code, 401, wrong)

    def test_bearer_authorization_is_not_a_substitute(self):
        response = self.client.post(ROUTE, json=BODY, headers={"Authorization": f"Bearer {TOKEN}"})
        self.assertEqual(response.status_code, 401)

    def test_correct_token_is_accepted(self):
        response = self.client.post(ROUTE, json=BODY, headers={HEADER: TOKEN})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertAlmostEqual(response.json()["result"]["mean"], 3.0)
        self.assertEqual(self.client.get("/docs", headers={HEADER: TOKEN}).status_code, 200)
        info = self.client.get("/runtime-info", headers={HEADER: TOKEN})
        self.assertEqual(info.status_code, 200)
        self.assertIn("packages", info.json())

    def test_health_is_open_and_minimal(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_health_exception_is_get_only(self):
        self.assertEqual(self.client.post("/health").status_code, 401)


class SidecarStartupTests(unittest.TestCase):
    def test_load_token_refuses_when_unset(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SidecarTokenMissing) as ctx:
                load_token()
        self.assertIn("LIOS_SIDECAR_TOKEN", str(ctx.exception))

    def test_explicit_dev_override_disables_authentication(self):
        with patch.dict(os.environ, {"LIOS_SIDECAR_ALLOW_UNAUTHENTICATED_DEV": "1"}, clear=True):
            self.assertIsNone(load_token())
        with patch.dict(os.environ, {"LIOS_SIDECAR_TOKEN": "  "}, clear=True):
            with self.assertRaises(SidecarTokenMissing):
                load_token()

    def test_importing_main_without_token_fails(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith("LIOS_SIDECAR_")}
        env["PYTHONPATH"] = str(SERVICE_DIR)
        result = subprocess.run(
            [sys.executable, "-c", "import main"],
            cwd=SERVICE_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("LIOS_SIDECAR_TOKEN", result.stderr)


if __name__ == "__main__":
    unittest.main()
