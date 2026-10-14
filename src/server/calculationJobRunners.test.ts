import assert from "node:assert/strict";
import test from "node:test";
import {
  calculationJobRuntimeStatus,
  resetCalculationJobRunnersForTests,
} from "./calculationJobService";
import {
  FACTOR_RISK_CALCULATION_KIND,
  SCENARIO_PIPELINE_CALCULATION_KIND,
  registerBuiltInCalculationJobRunners,
} from "./calculationJobRunners";

test("production calculation runners are registered for supported durable job kinds", () => {
  resetCalculationJobRunnersForTests();
  registerBuiltInCalculationJobRunners();
  const registered = calculationJobRuntimeStatus().registeredKinds;
  assert.deepEqual(registered.sort(), [FACTOR_RISK_CALCULATION_KIND, SCENARIO_PIPELINE_CALCULATION_KIND].sort());
  resetCalculationJobRunnersForTests();
});
