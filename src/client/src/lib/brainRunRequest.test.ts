import test from "node:test";
import assert from "node:assert/strict";
import { withActiveBrainLinkedContext } from "./brainRunRequest";

test("Brain run request includes only normalized canonical linked context", () => {
  const body = withActiveBrainLinkedContext(
    "POST",
    "/api/brain/runs",
    { question: "Should we invest in AAPL over the next 12 months?", primaryEntity: "AAPL" },
    {
      instrument: " aapl ",
      time: { enabled: true, asOfDate: "2026-09-15", mode: "latest" },
      scenarioId: " scenario-1 ",
      portfolioId: " portfolio-1 ",
      benchmarkId: " SPX ",
    },
  );

  assert.deepEqual(body, {
    question: "Should we invest in AAPL over the next 12 months?",
    primaryEntity: "AAPL",
    linkedContext: {
      instrument: "AAPL",
      time: { enabled: true, asOfDate: "2026-09-15", mode: "as-known-on" },
      scenarioId: "scenario-1",
      portfolioId: "portfolio-1",
      benchmarkId: "SPX",
    },
  });
});

test("non-Brain requests are not modified", () => {
  const input = { symbol: "AAPL" };
  assert.equal(withActiveBrainLinkedContext("POST", "/api/finance/quote", input, { instrument: "MSFT" }), input);
});
