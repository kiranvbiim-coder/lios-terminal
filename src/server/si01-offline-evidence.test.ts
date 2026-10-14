import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOfflineV2Accepted,
  buildOfflineV2Evidence,
} from "./si01-offline-evidence";

test("offline V2 evidence counts required and optional states honestly", () => {
  const value = buildOfflineV2Evidence({
    baseUrl: "http://127.0.0.1:5052",
    now: "2026-10-04T00:00:00.000Z",
    checks: [
      { id: "home", required: true, status: "pass", detail: "offline" },
      { id: "finance", required: true, status: "pass", detail: "deterministic" },
      { id: "remote-ai", required: false, status: "unavailable", detail: "offline" },
    ],
  });
  assert.deepEqual(value.summary, {
    passed: 2,
    failed: 0,
    unavailable: 1,
    requiredPassed: 2,
    requiredFailed: 0,
  });
  assert.doesNotThrow(() => assertOfflineV2Accepted(value));
});

test("offline V2 refuses non-loopback target even when checks pass", () => {
  const value = buildOfflineV2Evidence({
    baseUrl: "https://runtime.example.com",
    checks: [{ id: "home", required: true, status: "pass", detail: "claimed" }],
  });
  assert.throws(() => assertOfflineV2Accepted(value), /must target Desktop Local loopback/);
});

test("required unavailable/fail checks are not accepted", () => {
  for (const status of ["unavailable", "fail"] as const) {
    const value = buildOfflineV2Evidence({
      baseUrl: "http://localhost:5052",
      checks: [{ id: "deterministic", required: true, status, detail: "not proven" }],
    });
    assert.throws(
      () => assertOfflineV2Accepted(value),
      new RegExp(`deterministic=${status}`),
    );
  }
});
