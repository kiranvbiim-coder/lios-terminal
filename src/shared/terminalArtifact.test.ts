import assert from "node:assert/strict";
import test from "node:test";
import { encodeTerminalPanelValue, decodeTerminalPanelValue, initialTerminalScreenState, boundedTerminalExecutionSlot, terminalExecutionTargetSchema, writeTerminalPanelState } from "./terminalArtifact";
import { artifactContentSchema } from "./artifactContracts";
import { applyTerminalArtifactOperations } from "./terminalArtifactOperations";

test("retained chart overlays and authored worksheet inputs survive real JSON transport independently", () => {
  const one = { overlays: new Set(["SMA20", "BB"]), rows: [{ growth: 4.5, margin: 12 }], unset: undefined };
  const encoded = encodeTerminalPanelValue(one);
  const restored = decodeTerminalPanelValue(JSON.parse(JSON.stringify(encoded))) as typeof one;
  assert.deepEqual(restored, one);
  restored.overlays.add("EMA12"); restored.rows[0].growth = 8;
  const independent = decodeTerminalPanelValue(JSON.parse(JSON.stringify(encoded))) as typeof one;
  assert.deepEqual([...independent.overlays], ["SMA20", "BB"]);
  assert.equal(independent.rows[0].growth, 4.5);
  assert.throws(() => encodeTerminalPanelValue({ action: () => true }), /authored JSON/);
});

test("terminal subject identity cannot silently diverge from its canonical screen", () => {
  const content = { kind: "screen", view: "chart", symbol: "IBM", state: { terminal: initialTerminalScreenState("MSFT") } };
  assert.equal(artifactContentSchema.safeParse(content).success, false);
  assert.equal(artifactContentSchema.safeParse({ ...content, symbol: "MSFT" }).success, true);
});

test("typed scenario and benchmark selections address existing panel controls without source authority", () => {
  const state = initialTerminalScreenState(null);
  const stressed = applyTerminalArtifactOperations("portfolio", state, [{ type: "scenario.select", scenarioId: "rateshock" }]);
  assert.equal(stressed.scenarioId, "rateshock");
  assert.equal((stressed.panelState["PortfolioStressPanel.scenario"] as { id: string }).id, "rateshock");
  assert.equal(stressed.panelState["PortfolioPanel.section"], "stress");
  assert.throws(() => applyTerminalArtifactOperations("portfolio", state, [{ type: "scenario.select", scenarioId: "invented-guaranteed-profit" }]), /existing stress/);
  const benchmark = applyTerminalArtifactOperations("riskreturn", state, [{ type: "benchmark.select", symbol: "SPY" }]);
  assert.equal(benchmark.panelState["RiskReturnScatterPanel.benchmark"], "SPY");
  assert.equal(benchmark.panelState["RiskReturnScatterPanel.customBenchmark"], "");
  assert.throws(() => applyTerminalArtifactOperations("chart", { ...state, sourceScope: "my_data" }, [{ type: "source.settings", sourceScope: "auto" }]), /explicitly/);
});

test("large ordered portfolio baskets retain distinct valid execution slots", () => {
  const assets = Array.from({ length: 300 }, (_, index) => `ASSET${index}`);
  const slot = boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/hrp`);
  assert.ok(slot.length <= 240);
  assert.notEqual(slot, boundedTerminalExecutionSlot(`portfolio.${assets.toReversed().join(",")}.portfolio/hrp`));
  assert.notEqual(slot, boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/risk-budget`));
  assert.doesNotThrow(() => terminalExecutionTargetSchema.parse({ artifactId: "artifact:large-basket", baseVersion: 1, baseHash: "a".repeat(64), slot, authoredState: initialTerminalScreenState(null) }));
});

test("manual benchmark, portfolio and scenario controls cannot drift from the recorded screen posture", () => {
  const base = initialTerminalScreenState(null, "my_data");
  const preset = writeTerminalPanelState(base, "RiskReturnScatterPanel.benchmark", "^NSEI");
  const custom = writeTerminalPanelState(preset, "RiskReturnScatterPanel.customBenchmark", " msft ");
  assert.equal(custom.benchmarkId, "MSFT");
  const cleared = writeTerminalPanelState(custom, "RiskReturnScatterPanel.customBenchmark", "");
  assert.equal(cleared.benchmarkId, "^NSEI");
  const none = writeTerminalPanelState(cleared, "RiskReturnScatterPanel.benchmark", "NONE");
  assert.equal(none.benchmarkId, null);
  const portfolio = writeTerminalPanelState(none, "PortfolioStressPanel.portfolioId", 42);
  assert.equal(portfolio.portfolioId, "42");
  assert.equal(writeTerminalPanelState(portfolio, "PortfolioStressPanel.portfolioId", null).portfolioId, null);
  const scenario = writeTerminalPanelState(portfolio, "PortfolioStressPanel.scenario", { id: "bear", factors: { equity: -0.2 } });
  assert.equal(scenario.scenarioId, "bear");
  assert.equal(scenario.sourceScope, "my_data");
  assert.equal(scenario.marketMode, "live");
  assert.equal(scenario.asOf, null);
  assert.deepEqual(base.panelState, {}, "Updating the screen never mutates another revision's controls.");
});
