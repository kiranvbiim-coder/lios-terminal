import type { ViewMode } from "./terminalTypes";
import type { TerminalScenario } from "./terminalScenarioUniverse";
import type { ScenarioBindingApplicationPlan } from "./terminalAssumptionRegistry";

/**
 * C02/C04: the reviewed approval covers the exact scenario input values and
 * exactly mounted model bindings at the time the user confirmed the preview.
 * A fresh plan from the canonical binding registry is required on apply.
 * This is NOT a signed P11 engine run or an authorized P4 Artifact receipt.
 */
export function scenarioBindingReviewKey(
  scenario: TerminalScenario | null,
  view: ViewMode,
  symbol: string | undefined,
  plan: ScenarioBindingApplicationPlan,
): string | null {
  if (!scenario || plan.matched.length === 0) return null;
  return JSON.stringify([
    scenario.id, scenario.name, scenario.kind, scenario.scope,
    scenario.symbol ?? null, scenario.updatedAt, scenario.assumptions,
    view, symbol ?? null,
    plan.matched, plan.unmatched, plan.skipped,
  ]);
}
