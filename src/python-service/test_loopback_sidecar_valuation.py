"""Real loopback sidecar acceptance: process + per-launch auth + numerical HTTP.

This exercises the *source* Python entrypoint on the CI host, not a PyInstaller
binary or an installed Electron app. Existing TestClient tests never open a
socket; existing Node probe mocks do not start the real Python service.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener


SERVICE_DIR = Path(__file__).resolve().parent
# Explicitly bypass host HTTP proxies: the test must exercise only the local process.
LOOPBACK_HTTP = build_opener(ProxyHandler({}))
ROUTE = "/advanced/valuation/reverse-dcf"
KNOWN_INPUT = {
    "currentRevenue": 100,
    "marketEquityValue": 100,
    "years": 1,
    "waccPct": 10,
    "terminalGrowthPct": 0,
    "ebitMarginPct": 20,
    "taxRatePct": 0,
    "reinvestmentPctOfRevenue": 10,
    "solveFor": "revenue_growth",
}


def request_json(port, path, *, token=None, body=None):
    headers = {"Accept": "application/json"}
    if token is not None:
        headers["X-LiOS-Sidecar-Token"] = token
    payload = None
    method = "GET"
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body).encode("utf-8")
        method = "POST"
    request = Request(
        f"http://127.0.0.1:{port}{path}", data=payload,
        headers=headers, method=method,
    )
    try:
        with LOOPBACK_HTTP.open(request, timeout=5) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        with error:
            return error.code, json.load(error)


class RealSidecarLoopbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # The test never binds a public interface; only the local sidecar is used.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            cls.port = port_socket.getsockname()[1]
        cls.token = secrets.token_urlsafe(32)
        env = os.environ.copy()
        env.pop("LIOS_SIDECAR_ALLOW_UNAUTHENTICATED_DEV", None)
        env["PYTHON_SERVICE_PORT"] = str(cls.port)
        env["LIOS_SIDECAR_TOKEN"] = cls.token
        env["LIOS_PARENT_PID"] = str(os.getpid())
        env["LIOS_PYTHON_LOG_LEVEL"] = "warning"
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        cls.child = subprocess.Popen(
            [sys.executable, str(SERVICE_DIR / "sidecar_entry.py")],
            cwd=SERVICE_DIR,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,  # Never echo private worker diagnostics.
        )
        try:
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                if cls.child.poll() is not None:
                    raise AssertionError(
                        "Real Python sidecar process exited before healthy loopback startup."
                    )
                try:
                    status, health = request_json(cls.port, "/health")
                    if status == 200 and health == {"ok": True}:
                        return
                except (OSError, URLError, TimeoutError, ValueError):
                    pass
                time.sleep(0.2)
            raise AssertionError("Real Python sidecar did not serve minimal loopback health within 35s.")
        except BaseException:
            cls._stop_child()
            raise

    @classmethod
    def _stop_child(cls):
        if cls.child.poll() is None:
            cls.child.terminate()
            try:
                cls.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls.child.kill()
                cls.child.wait(timeout=5)

    @classmethod
    def tearDownClass(cls):
        cls._stop_child()

    def test_per_launch_token_is_enforced_on_real_http_route(self):
        self.assertEqual(request_json(self.port, "/health"), (200, {"ok": True}))
        self.assertEqual(request_json(self.port, "/runtime-info")[0], 401)
        self.assertEqual(request_json(self.port, "/runtime-info", token=self.token + "wrong")[0], 401)
        self.assertEqual(request_json(self.port, ROUTE, body=KNOWN_INPUT)[0], 401)
        self.assertEqual(
            request_json(self.port, ROUTE, token=self.token + "wrong", body=KNOWN_INPUT)[0], 401
        )

    def test_real_authenticated_http_route_returns_independent_known_answer(self):
        status, result = request_json(self.port, ROUTE, token=self.token, body=KNOWN_INPUT)
        self.assertEqual(status, 200, "Real loopback valuation route must not be HTTP 502/503.")
        self.assertAlmostEqual(result["impliedRevenueGrowthPct"], 0, places=7)
        self.assertAlmostEqual(result["repricedEquityValue"], 100, places=7)
        self.assertAlmostEqual(result["absoluteError"], 0, places=7)
        status, inventory = request_json(self.port, "/runtime-info", token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(inventory["ok"], True)
        self.assertIn("numpy", inventory["packages"])
        self.assertIn("scipy", inventory["packages"])

    def test_invalid_input_is_rejected_without_reaching_an_unhandled_worker_error(self):
        status, result = request_json(
            self.port, ROUTE, token=self.token,
            body={**KNOWN_INPUT, "currentRevenue": 0},
        )
        self.assertEqual(status, 422)
        self.assertEqual(result["detail"][0]["loc"], ["body", "currentRevenue"])


if __name__ == "__main__":
    unittest.main()
