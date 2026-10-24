"""Offline protocol tests for the real-worker admission fixture."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from worker_smoke import _read_worker_envelope, verify_worker_smoke


class WorkerSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lios-worker-smoke-test-")
        self.addCleanup(self.temp.cleanup)
        self.result = Path(self.temp.name) / "result.json"

    def test_fails_closed_on_malformed_or_oversized_protocol(self):
        for payload in (b"", b"not json", b"[]", b"{}", b'{"ok":true,"result":NaN}', b"x" * 17000):
            self.result.write_bytes(payload)
            with self.subTest(payload=payload[:40]), self.assertRaises(RuntimeError):
                _read_worker_envelope(self.result)

    def test_valid_and_refusal_envelopes(self):
        for value in ({"ok": True, "result": {"repricedEquityValue": 100.0}},
                      {"ok": False, "error": {"kind": "input", "message": "invalid"}}):
            self.result.write_text(json.dumps(value))
            self.assertEqual(_read_worker_envelope(self.result), value)

    def test_smoke_rejects_incorrect_or_forged_worker_values(self):
        good = {"ok": True, "result": {
            "impliedRevenueGrowthPct": 0.0, "repricedEquityValue": 100.0, "absoluteError": 0.0,
        }}
        rejected = {"ok": False, "error": {"kind": "input", "message": "rejected"}}
        with patch("worker_smoke._one_shot", side_effect=[good, rejected, rejected]):
            self.assertTrue(verify_worker_smoke(Path("dummy.py"), "python"))
        for field, value in (("repricedEquityValue", 101.0), ("impliedRevenueGrowthPct", "0"),
                             ("absoluteError", float("nan"))):
            result = {"ok": True, "result": {**good["result"], field: value}}
            with self.subTest(field=field), patch("worker_smoke._one_shot", return_value=result):
                with self.assertRaisesRegex(RuntimeError, "acceptance value"):
                    verify_worker_smoke(Path("dummy.py"), "python")
        with patch("worker_smoke._one_shot", side_effect=[good, rejected, good]):
            with self.assertRaisesRegex(RuntimeError, "route-allowlist"):
                verify_worker_smoke(Path("dummy.py"), "python")


if __name__ == "__main__":
    unittest.main()
