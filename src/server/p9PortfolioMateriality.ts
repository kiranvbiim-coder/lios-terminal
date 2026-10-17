import type { ProjectArtifactVersion, ProjectAutomationRun, ProjectAutomationWorkflow } from "@shared/schema";
import type { P9WorkflowRunResult } from "@shared/p9AutomationContracts";
import {
  p9PortfolioMaterialityActionSchema, p9PortfolioMaterialityOutputSchema, portfolioMaterialityPayload,
  validatePortfolioMaterialityThresholds, type P9PortfolioMaterialityAction, type P9PortfolioMaterialityOutput, type PortfolioMaterialityPayload,
} from "@shared/p9PortfolioMateriality";
import type { TenantContext } from "./tenantContext";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { classifyDecisionMonitorTransition } from "./decisionMonitor";
import { hashLedgerValue } from "./ledgerStore";

type Payload = PortfolioMaterialityPayload;
type Position = P9PortfolioMaterialityOutput["positions"][number];

function assertFresh(payload: Payload, action: P9PortfolioMaterialityAction, now: number): void {
  const age = now - Date.parse(payload.asOf);
  if (!Number.isFinite(age) || age < 0 || age > action.maximumAgeMinutes * 60_000) {
    throw new Error("Portfolio asOf is stale or in the future; save current explicitly valued holdings before monitoring.");
  }
}

function positions(payload: Payload): { positions: Position[]; grossExposure: number } {
  const grossBySymbol = new Map<string, number>();
  let grossExposure = 0;
  for (const holding of payload.holdings) {
    // Payload validation requires marketValue. Gross exposure never nets opposing lots.
    if (holding.marketValue === null) throw new Error("Holding marketValue is required.");
    const value = Math.abs(holding.marketValue);
    const symbol = holding.symbol.toUpperCase();
    grossBySymbol.set(symbol, (grossBySymbol.get(symbol) ?? 0) + value);
    grossExposure += value;
  }
  if (!Number.isFinite(grossExposure) || grossExposure <= 0) throw new Error("Portfolio gross securities exposure must be finite and positive; cash is excluded.");
  return {
    grossExposure,
    positions: [...grossBySymbol].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, grossMarketValue]) => ({ symbol, grossMarketValue, weightPercent: grossMarketValue / grossExposure * 100 })),
  };
}

function sourceIdentity(version: ProjectArtifactVersion): string {
  const { artifact, payload } = portfolioMaterialityPayload(version.content);
  return hashLedgerValue({ portfolioRef: artifact.portfolioRef, portfolioId: payload.portfolioId, name: payload.name, baseCurrency: payload.baseCurrency,
    sourceRefs: [...version.sourceRefs].sort(), dependencyRefs: [...version.dependencyRefs].sort() });
}

async function readSource(ctx: TenantContext, projectId: number, action: P9PortfolioMaterialityAction, accepting: boolean) {
  validatePortfolioMaterialityThresholds(action);
  const artifact = await getArtifact(ctx, action.acceptedArtifact.artifactId);
  if (artifact.projectId !== projectId || artifact.kind !== "portfolio" || artifact.status !== "active") {
    throw new Error("Portfolio monitor requires an active owned PortfolioArtifact in this Project.");
  }
  if (accepting && artifact.headVersion !== action.acceptedArtifact.version) throw new Error("Portfolio head changed; explicitly accept the current saved head.");
  if (artifact.headVersion < action.acceptedArtifact.version) throw new Error("Portfolio head predates its accepted baseline.");
  const baseline = await getArtifactVersion(ctx, artifact.id, action.acceptedArtifact.version);
  if (baseline.contentHash !== action.acceptedArtifact.contentHash || hashLedgerValue(baseline.content) !== baseline.contentHash) {
    throw new Error("Accepted portfolio content hash does not match canonical custody.");
  }
  const current = artifact.headVersion === baseline.version ? baseline : await getArtifactVersion(ctx, artifact.id, artifact.headVersion);
  const baselineIdentity = sourceIdentity(baseline);
  // P4 owns the version chain. Reject a replaced source or a detached revision, including intermediate source drift.
  let child = current;
  while (child.version > baseline.version) {
    if (hashLedgerValue(child.content) !== child.contentHash || sourceIdentity(child) !== baselineIdentity) throw new Error("Portfolio source identity or canonical content custody drifted; explicitly accept a new baseline.");
    const parent = child.version - 1 === baseline.version ? baseline : await getArtifactVersion(ctx, artifact.id, child.version - 1);
    if (child.parentVersionId !== parent.id) throw new Error("Portfolio revision is not descended from the accepted canonical baseline.");
    child = parent;
  }
  const acceptedPayload = portfolioMaterialityPayload(baseline.content).payload;
  const currentPayload = portfolioMaterialityPayload(current.content).payload;
  if (Date.parse(currentPayload.asOf) < Date.parse(acceptedPayload.asOf)) throw new Error("Portfolio asOf regressed before the accepted baseline.");
  assertFresh(currentPayload, action, Date.now());
  if (accepting) positions(acceptedPayload);
  return { artifact, baseline, current, acceptedPayload, currentPayload };
}

/** Called at canonical P9 create/replace admission; the user must accept the exact current P4 head. */
export async function requireP9PortfolioMateriality(ctx: TenantContext, projectId: number, input: P9PortfolioMaterialityAction): Promise<void> {
  const action = p9PortfolioMaterialityActionSchema.parse(input);
  await readSource(ctx, projectId, action, true);
}

/** Read only: retained values are not live prices, trading instructions, or permission to transmit holdings. */
export async function runP9PortfolioMateriality(
  ctx: TenantContext, workflow: ProjectAutomationWorkflow, input: P9PortfolioMaterialityAction, previous: ProjectAutomationRun | null,
): Promise<P9WorkflowRunResult> {
  const action = p9PortfolioMaterialityActionSchema.parse(input);
  if (workflow.ownerUserId !== ctx.userId || workflow.organizationId !== ctx.organizationId) throw new Error("Portfolio workflow owner context no longer matches.");
  const source = await readSource(ctx, workflow.projectId, action, false);
  const actionHash = hashLedgerValue(action);
  let prior: P9PortfolioMaterialityOutput | null = null;
  if (previous) {
    if (previous.workflowId !== workflow.id || previous.ownerUserId !== ctx.userId || previous.organizationId !== ctx.organizationId || previous.projectId !== workflow.projectId || previous.status !== "succeeded") {
      throw new Error("Previous portfolio output is not a successful canonical run owned by this workflow.");
    }
    const parsed = p9PortfolioMaterialityOutputSchema.safeParse(previous.output);
    if (parsed.success && parsed.data.actionHash === actionHash) prior = parsed.data;
    else if (previous.output.kind === "portfolio_materiality" && previous.output.actionHash === actionHash) throw new Error("Previous portfolio materiality evidence is invalid.");
  }
  if (prior) {
    const observed = await getArtifactVersion(ctx, source.artifact.id, prior.currentArtifact.version);
    if (prior.currentArtifact.artifactId !== source.artifact.id || observed.contentHash !== prior.currentArtifact.contentHash || observed.version > source.current.version
      || Date.parse(source.currentPayload.asOf) < Date.parse(prior.asOf)) throw new Error("Current portfolio regressed from its previous canonical P9 observation.");
  }
  const baseline = positions(source.acceptedPayload);
  const current = positions(source.currentPayload);
  const baselineWeights = new Map(baseline.positions.map(position => [position.symbol, position.weightPercent]));
  const currentWeights = new Map(current.positions.map(position => [position.symbol, position.weightPercent]));
  const previousStates = new Map(prior?.states.map(state => [state.symbol, state]) ?? []);
  const symbols = [...new Set([...baselineWeights.keys(), ...currentWeights.keys(), ...previousStates.keys()])].sort();
  const transitions: P9PortfolioMaterialityOutput["transitions"] = [];
  const states: P9PortfolioMaterialityOutput["states"] = [];
  let maximumWeightChangePercentagePoints = 0;
  let maximumConcentrationPercent = 0;
  // With no preceding run, accepted concentrations initialize state, not a spurious new alert.
  for (const symbol of symbols) {
    const baselinePercent = baselineWeights.get(symbol) ?? 0;
    const currentPercent = currentWeights.get(symbol) ?? 0;
    const weightChange = Math.abs(currentPercent - baselinePercent);
    maximumWeightChangePercentagePoints = Math.max(maximumWeightChangePercentagePoints, weightChange);
    maximumConcentrationPercent = Math.max(maximumConcentrationPercent, currentPercent);
    const previousState = previousStates.get(symbol);
    const metrics = [
      { metric: "concentration" as const, value: currentPercent, threshold: action.concentrationPercent, status: previousState?.concentration ?? (baselinePercent >= action.concentrationPercent ? "breached" : "active") },
      { metric: "weight_change" as const, value: weightChange, threshold: action.weightChangePercentagePoints, status: previousState?.weightChange ?? "active" },
    ];
    const state: P9PortfolioMaterialityOutput["states"][number] = { symbol, concentration: "active", weightChange: "active" };
    for (const metric of metrics) {
      const wasBreached = metric.status !== "active";
      // Hysteresis absorbs boundary jitter. Persistent breaches stay quiet; a real recovery re-arms.
      const breached = wasBreached ? metric.value > metric.threshold - action.rearmBufferPercentagePoints : metric.value >= metric.threshold;
      const transition = classifyDecisionMonitorTransition(metric.status, breached);
      if (metric.metric === "concentration") state.concentration = transition.nextStatus;
      else state.weightChange = transition.nextStatus;
      if (transition.emitBreach || transition.emitRecovery) transitions.push({ symbol, metric: metric.metric, transition: transition.emitBreach ? "breached" : "recovered", currentPercent, baselinePercent, threshold: metric.threshold });
    }
    states.push(state);
  }
  const breaches = transitions.filter(transition => transition.transition === "breached");
  const recovered = transitions.filter(transition => transition.transition === "recovered");
  const output = p9PortfolioMaterialityOutputSchema.parse({
    kind: "portfolio_materiality", actionHash, mode: "read_only", units: "percent_of_gross_securities_exposure_cash_excluded",
    acceptedArtifact: action.acceptedArtifact, currentArtifact: { artifactId: source.artifact.id, version: source.current.version, contentHash: source.current.contentHash },
    portfolioId: source.currentPayload.portfolioId, asOf: source.currentPayload.asOf, baseCurrency: source.currentPayload.baseCurrency,
    cashExcluded: source.currentPayload.cash, grossExposure: current.grossExposure, positions: current.positions, states, transitions,
    maximumWeightChangePercentagePoints, maximumConcentrationPercent, baselineEstablished: prior === null,
  });
  // Do not commit evidence against a head or lifecycle that moved during calculation.
  const rechecked = await getArtifact(ctx, source.artifact.id);
  if (rechecked.status !== "active" || rechecked.projectId !== workflow.projectId || rechecked.headVersion !== source.current.version) throw new Error("Portfolio head changed while observing; retry against its current canonical head.");
  assertFresh(source.currentPayload, action, Date.now());
  return {
    summary: breaches.length ? `${breaches.length} new portfolio materiality breach(es): ${breaches.slice(0, 10).map(item => `${item.symbol} ${item.metric}`).join(", ")}${breaches.length > 10 ? "; inspect recorded transitions for all breaches" : ""}. Read-only retained values; no live quote or FX fetch, trade, Decision change, or holdings transmission.`
      : recovered.length ? `${recovered.length} portfolio threshold(s) recovered and re-armed; no new material breach.`
        : prior ? "No new portfolio materiality breach. Immaterial changes and persistent breaches remain quiet."
          : "Accepted portfolio baseline observed; existing concentrations are recorded, not treated as new breaches.",
    changed: breaches.length > 0, conditionMet: breaches.length > 0, relevanceScore: breaches.length ? 0.9 : 0.1,
    sourceRefs: [...new Set([...source.current.sourceRefs, `${source.artifact.id}@v${source.current.version}`, `sha256:${source.current.contentHash}`])],
    engineRefs: ["lios.portfolio-materiality.v1"], artifactRefs: [source.artifact.id], executionReceiptIds: [], output,
  };
}
