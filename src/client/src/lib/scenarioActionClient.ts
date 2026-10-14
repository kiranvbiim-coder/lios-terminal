import {
  calculateScenarioActionCandidates,
  type ScenarioActionInput,
  type ScenarioActionResult,
} from "../../../server/scenarioActionEngine";

export type ScenarioActionClientInput = ScenarioActionInput & {
  /** Total changes returned by the existing scenario graph, when available. */
  graphTotalChanges?: Record<string, number>;
};

/**
 * Keeps the Decision Engine's scenario graph as an input without introducing a
 * second client-side scoring implementation. The server module is pure and
 * has no provider, storage, order, or browser side effects.
 */
export function calculateClientScenarioActions(input: ScenarioActionClientInput): ScenarioActionResult {
  const nodeImpacts = input.graphTotalChanges && Object.keys(input.graphTotalChanges).length > 0
    ? input.graphTotalChanges
    : input.nodeImpacts ?? input.scenarioNodeImpacts;
  return calculateScenarioActionCandidates({ ...input, nodeImpacts });
}
