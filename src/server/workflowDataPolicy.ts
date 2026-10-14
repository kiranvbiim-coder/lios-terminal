import { z } from "zod";
import { pointInTimePolicySchema, type PointInTimePolicy, type ProviderObservation } from "@shared/universalDataFabric";

export const governedWorkflowKindSchema = z.enum(["research", "backtest"]);
export type GovernedWorkflowKind = z.infer<typeof governedWorkflowKindSchema>;

export function assertWorkflowPointInTimePolicy(
  workflow: GovernedWorkflowKind,
  raw: PointInTimePolicy,
): PointInTimePolicy {
  const policy = pointInTimePolicySchema.parse(raw);
  if (workflow === "backtest") {
    if (policy.mode === "latest") throw new Error("Backtest data must declare as_known_on or revision_exact; latest-only data risks lookahead bias.");
    if (policy.mode === "as_known_on" && !policy.requirePublicationTime) {
      throw new Error("Backtest as_known_on data must require publication/availability time.");
    }
  }
  if (workflow === "research" && policy.mode === "as_known_on" && !policy.requirePublicationTime) {
    throw new Error("Historical research as_known_on data must require publication/availability time.");
  }
  return policy;
}

export function assertObservationAvailableAsKnownOn(
  policy: PointInTimePolicy,
  observation: ProviderObservation,
): void {
  if (policy.mode !== "as_known_on" || !policy.asKnownOn) return;
  const cutoff = Date.parse(policy.asKnownOn);
  const available = observation.clocks.availableAt ? Date.parse(observation.clocks.availableAt) : NaN;
  const published = observation.clocks.publishedAt ? Date.parse(observation.clocks.publishedAt) : NaN;
  if (policy.requirePublicationTime && !Number.isFinite(available) && !Number.isFinite(published)) {
    throw new Error("Observation lacks publication/availability time required for as-known-on semantics.");
  }
  const knownAt = Number.isFinite(available) ? available : published;
  if (Number.isFinite(knownAt) && knownAt > cutoff) {
    throw new Error("Observation was not available at the requested as-known-on time.");
  }
}
