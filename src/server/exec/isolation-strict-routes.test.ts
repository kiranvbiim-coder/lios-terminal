import assert from "node:assert/strict";
import test from "node:test";
import { callPythonService } from "../pythonService";
import { LepSidecarSupervisor } from "../p11SidecarSupervisor";
import { executeAdvancedQuant, type AdvancedQuantEngineCall } from "../advancedQuantExecution";
import { installManagedRuntime } from "../pythonRuntimeManager";

test("strict Python HTTP isolation fails before host sidecar startup", async () => {
  await assert.rejects(
    () => callPythonService("/health", {}, { isolationMode: "strict" }),
    /host-sidecar fallback is refused/,
  );
});

test("strict P11 LEP isolation fails at construction before host process startup", () => {
  assert.throws(
    () => new LepSidecarSupervisor({
      command: process.execPath,
      isolationMode: "strict",
    }),
    /host-sidecar fallback is refused/,
  );
});

test("advanced quant propagates strict isolation intent to its engine transport", async () => {
  let observed: string | undefined;
  const callEngine: AdvancedQuantEngineCall = async (_route, _body, options) => {
    observed = options?.isolationMode;
    return { value: 1 };
  };

  await executeAdvancedQuant(
    "valuation/dcf-sensitivity",
    {
      freeCashFlows: [100],
      wacc: 0.1,
      terminalGrowth: 0.03,
      sharesOutstanding: 10,
    },
    {
      isolationMode: "strict",
      callEngine,
      calculatedAt: "2026-10-04T00:00:00.000Z",
    },
  ).catch(() => undefined);

  assert.equal(observed, "strict");
});


test("strict managed Python provisioning refuses host pip/venv before mutation", async () => {
  await assert.rejects(
    () => installManagedRuntime(["core"], [], { isolationMode: "strict" }),
    /host pip\/venv fallback is refused/,
  );
});
