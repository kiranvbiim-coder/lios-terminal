import test from "node:test";
import assert from "node:assert/strict";
import { runGbmSimulation, stableSimulationSeed } from "./gbmSimulation";

test("GBM simulation is reproducible for the same seed", () => {
  const input = { initialPrice: 100, annualDrift: 0.08, annualVolatility: 0.2, tradingDays: 30, simulations: 200, seed: 42 };
  const first = runGbmSimulation(input);
  const second = runGbmSimulation(input);
  assert.deepEqual(first, second);
});

test("zero volatility produces deterministic drift path", () => {
  const result = runGbmSimulation({ initialPrice: 100, annualDrift: 0.1, annualVolatility: 0, tradingDays: 10, simulations: 20, seed: 7 });
  assert.equal(result.terminalP10, result.terminalP50);
  assert.equal(result.terminalP50, result.terminalP90);
  assert.equal(result.probabilityPositivePct, 100);
});

test("invalid simulation inputs fail closed", () => {
  assert.throws(() => runGbmSimulation({ initialPrice: 0, annualDrift: 0.1, annualVolatility: 0.2, tradingDays: 10, simulations: 20, seed: 1 }));
  assert.throws(() => runGbmSimulation({ initialPrice: 100, annualDrift: 0.1, annualVolatility: -0.2, tradingDays: 10, simulations: 20, seed: 1 }));
  assert.throws(() => runGbmSimulation({ initialPrice: 100, annualDrift: 0.1, annualVolatility: 0.2, tradingDays: 0, simulations: 20, seed: 1 }));
});

test("stableSimulationSeed changes by symbol, horizon and revision", () => {
  const base = stableSimulationSeed("AAPL", 90, 0);
  assert.equal(base, stableSimulationSeed("AAPL", 90, 0));
  assert.notEqual(base, stableSimulationSeed("MSFT", 90, 0));
  assert.notEqual(base, stableSimulationSeed("AAPL", 180, 0));
  assert.notEqual(base, stableSimulationSeed("AAPL", 90, 1));
});
