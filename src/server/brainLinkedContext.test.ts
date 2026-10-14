import test from "node:test";
import assert from "node:assert/strict";
import {
  attachBrainLinkedContextToPlan,
  normalizeBrainLinkedContext,
  sanitizeBrainTaskInput,
} from "./brainLinkedContext";

test("Brain linked context is rebuilt from an allowlist and strips secrets and raw rows", () => {
  const input = {
    instrument: " aapl ",
    time: { enabled: true, asOfDate: "2026-09-15", mode: "latest", apiKey: "nested-secret" },
    scenarioId: " scenario-1 ",
    portfolioId: " portfolio-1 ",
    benchmarkId: " SPX ",
    apiKey: "secret",
    accessToken: "secret",
    refreshToken: "secret",
    clientSecret: "secret",
    password: "secret",
    authorization: "Bearer secret",
    cookie: "secret",
    cookies: "secret",
    credentials: { apiKey: "secret", password: "secret" },
    rows: [{ account: "client", password: "secret" }],
  };
  const snapshot = structuredClone(input);

  assert.deepEqual(normalizeBrainLinkedContext(input), {
    instrument: "AAPL",
    time: { enabled: true, asOfDate: "2026-09-15", mode: "as-known-on" },
    scenarioId: "scenario-1",
    portfolioId: "portfolio-1",
    benchmarkId: "SPX",
  });
  assert.deepEqual(input, snapshot, "normalization must not mutate the request payload");
});

test("malformed and empty linked context fails closed", () => {
  assert.equal(normalizeBrainLinkedContext(null), null);
  assert.equal(normalizeBrainLinkedContext([]), null);
  assert.equal(normalizeBrainLinkedContext({ apiKey: "secret", rows: [{ value: 1 }] }), null);
  assert.deepEqual(normalizeBrainLinkedContext({ time: { enabled: true, asOfDate: "not-a-date" } }), {
    time: { enabled: false, asOfDate: null, mode: "latest" },
  });
});

test("sanitized linked context propagates through existing Brain task inputs without mutating the plan", () => {
  const plan = [{ key: "market", input: { symbol: "AAPL" } }];
  const snapshot = structuredClone(plan);
  const result = attachBrainLinkedContextToPlan(plan, {
    instrument: " msft ",
    portfolioId: " p-1 ",
    credentials: { apiKey: "must-not-propagate" },
  });

  assert.deepEqual(plan, snapshot);
  assert.deepEqual(result[0].input, {
    symbol: "AAPL",
    linkedContext: { instrument: "MSFT", portfolioId: "p-1" },
  });
  assert.equal(JSON.stringify(result).includes("must-not-propagate"), false);
});

test("task edits preserve the sanitized run context and reject context replacement", () => {
  const existing = {
    symbol: "AAPL",
    linkedContext: { instrument: "AAPL", portfolioId: "p-1" },
  };
  assert.deepEqual(sanitizeBrainTaskInput({ symbol: "MSFT" }, existing), {
    symbol: "MSFT",
    linkedContext: { instrument: "AAPL", portfolioId: "p-1" },
  });
  assert.deepEqual(sanitizeBrainTaskInput({
    symbol: "MSFT",
    linkedContext: { instrument: " nvda ", apiKey: "secret", rows: [{ value: 1 }] },
  }, existing), {
    symbol: "MSFT",
    linkedContext: { instrument: "AAPL", portfolioId: "p-1" },
  });
});
