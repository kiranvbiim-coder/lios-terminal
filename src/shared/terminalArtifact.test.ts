import assert from "node:assert/strict";
import test from "node:test";
import { encodeTerminalPanelValue, decodeTerminalPanelValue, initialTerminalScreenState } from "./terminalArtifact";
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
