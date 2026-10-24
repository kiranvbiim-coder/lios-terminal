"""Release-image admission test of the actual canonical one-shot Python worker.

The release builder copies only engine_worker.py, engine_routes.py, and
advanced_valuation.py into this image. The subprocess executes the same fixed
reverse DCF route as strict LiOS, never imports a request-selected module,
uses a private bounded /tmp request/result pair and needs no network or host
Python. This checks in-image engine execution; it is not proof of GM-11
workspace transfer, packaged Electron runtime, or native P14 qualification.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile

REVERSE_ROUTE = "/advanced/valuation/reverse-dcf"
REVERSE_BODY = {
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
MAX_ENVELOPE_BYTES = 16 * 1024


def _reject_constant(_value):
    raise ValueError("Worker returned a non-JSON numeric value.")


def _read_worker_envelope(result_path: Path):
    if not result_path.is_file() or result_path.is_symlink():
        raise RuntimeError("Sandbox numerical worker produced no regular result.")
    if result_path.stat().st_size > MAX_ENVELOPE_BYTES:
        raise RuntimeError("Sandbox numerical worker result exceeded admission limit.")
    payload = result_path.read_bytes()
    if not payload or len(payload) > MAX_ENVELOPE_BYTES:
        raise RuntimeError("Sandbox numerical worker returned an invalid result size.")
    try:
        result = json.loads(payload.decode("utf-8"), parse_constant=_reject_constant)
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError("Sandbox numerical worker returned malformed JSON.") from exc
    if not isinstance(result, dict) or set(result) not in ({"ok", "result"}, {"ok", "error"}):
        raise RuntimeError("Sandbox numerical worker returned an invalid envelope.")
    return result


def _one_shot(worker: Path, executable: str, route: str, body: dict):
    # Do not execute anything from customer input or interpolate data into argv.
    with tempfile.TemporaryDirectory(prefix="lios-worker-smoke-") as root:
        request_path = Path(root) / "request.json"
        result_path = Path(root) / "result.json"
        request_path.write_text(json.dumps({"route": route, "body": body}, allow_nan=False), encoding="utf-8")
        try:
            completed = subprocess.run(
                [executable, str(worker), str(request_path), str(result_path)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("Sandbox numerical worker failed to finish.") from exc
        if completed.returncode != 0:
            raise RuntimeError("Sandbox numerical worker exited unsuccessfully.")
        return _read_worker_envelope(result_path)


def verify_worker_smoke(worker: Path | None = None, executable: str | None = None):
    worker = worker or Path(__file__).resolve().parent / "worker-smoke" / "engine_worker.py"
    executable = executable or sys.executable
    actual = _one_shot(worker, executable, REVERSE_ROUTE, REVERSE_BODY)
    if actual.get("ok") is not True or set(actual) != {"ok", "result"}:
        raise RuntimeError("Sandbox numerical worker refused the valid reverse DCF.")
    value = actual["result"]
    if not isinstance(value, dict):
        raise RuntimeError("Sandbox numerical worker returned an invalid result body.")
    for field, expected, tolerance in (
        ("impliedRevenueGrowthPct", 0.0, 1e-7),
        ("repricedEquityValue", 100.0, 1e-7),
        ("absoluteError", 0.0, 1e-7),
    ):
        number = value.get(field)
        if type(number) is not float or not (abs(number - expected) <= tolerance):
            raise RuntimeError(f"Sandbox numerical worker failed the {field} acceptance value.")

    for route, body, label in (
        (REVERSE_ROUTE, {**REVERSE_BODY, "terminalGrowthPct": 11}, "invalid-domain"),
        ("/unregistered/private-route", {}, "route-allowlist"),
    ):
        rejected = _one_shot(worker, executable, route, body)
        if (rejected.get("ok") is not False or set(rejected) != {"ok", "error"} or
                not isinstance(rejected["error"], dict) or
                rejected["error"].get("kind") != "input"):
            raise RuntimeError(f"Sandbox numerical worker failed {label} refusal.")
    return True


if __name__ == "__main__":
    verify_worker_smoke()
    print("PASS sandbox canonical Python worker: reverse DCF, input refusal, route allowlist")
