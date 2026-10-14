import { decisionEvidenceBalance, type DecisionObject } from "./terminalDecisionObjects";
import { loadIntelligenceObjects, type IntelligenceObject } from "./terminalIntelligenceObjects";
import { loadScenarios, type TerminalScenario } from "./terminalScenarioUniverse";
import { loadTerminalTimeContext, type TerminalTimeContext } from "./terminalTimeTravel";

export type DecisionCheckpointValue = string | number | boolean | null | undefined;

export interface DecisionCheckpointObjectState {
  objectId: string;
  label: string;
  kind: IntelligenceObject["kind"];
  symbol?: string;
  value: DecisionCheckpointValue;
  status: IntelligenceObject["status"];
  updatedAt: number;
}

export interface DecisionCheckpoint {
  id: string;
  decisionId: string;
  decisionTitle: string;
  decisionStatus: DecisionObject["status"];
  direction: DecisionObject["direction"];
  confidence: number;
  thesis: string;
  evidenceSupport: number;
  evidenceContradiction: number;
  scenarioId?: string;
  scenarioName?: string;
  timeContext: TerminalTimeContext;
  objectStates: DecisionCheckpointObjectState[];
  capturedAt: number;
}

export interface DecisionObjectDrift {
  objectId: string;
  label: string;
  before: DecisionCheckpointValue;
  after: DecisionCheckpointValue;
  statusBefore: IntelligenceObject["status"];
  statusAfter?: IntelligenceObject["status"];
  changed: boolean;
  absoluteDelta?: number;
  percentDelta?: number;
  missing: boolean;
}

export interface DecisionDriftReport {
  decisionId: string;
  checkpointId: string;
  checkpointAt: number;
  confidenceDelta: number;
  evidenceSupportDelta: number;
  evidenceContradictionDelta: number;
  scenarioChanged: boolean;
  thesisChanged: boolean;
  directionChanged: boolean;
  objectDrift: DecisionObjectDrift[];
  changedObjectCount: number;
  missingObjectCount: number;
  materialObjectCount: number;
}

const STORAGE_KEY = "limuria-terminal-decision-checkpoints-v1";
const EVENT_NAME = "lios:decision-checkpoints";
const MAX_CHECKPOINTS = 320;

function makeId(decisionId: string): string {
  return `checkpoint:${decisionId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function cloneCheckpoint(checkpoint: DecisionCheckpoint): DecisionCheckpoint {
  return {
    ...checkpoint,
    timeContext: { ...checkpoint.timeContext },
    objectStates: checkpoint.objectStates.map((state) => ({ ...state })),
  };
}

function linkedObjectIds(decision: DecisionObject): string[] {
  return Array.from(new Set([
    ...decision.evidence.map((item) => item.objectId),
    ...decision.reversalConditions.map((condition) => condition.objectId).filter((id): id is string => Boolean(id)),
    ...decision.modelObjectIds,
  ]));
}

function objectState(object: IntelligenceObject): DecisionCheckpointObjectState {
  return {
    objectId: object.id,
    label: object.label,
    kind: object.kind,
    symbol: object.symbol,
    value: object.value?.raw,
    status: object.status,
    updatedAt: object.updatedAt,
  };
}

export function loadDecisionCheckpoints(): DecisionCheckpoint[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as DecisionCheckpoint[];
    return Array.isArray(parsed) ? parsed.map(cloneCheckpoint).sort((a, b) => b.capturedAt - a.capturedAt) : [];
  } catch { return []; }
}

export function saveDecisionCheckpoints(checkpoints: readonly DecisionCheckpoint[]): void {
  if (typeof window === "undefined") return;
  const next = checkpoints.map(cloneCheckpoint).sort((a, b) => b.capturedAt - a.capturedAt).slice(0, MAX_CHECKPOINTS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
}

export function createDecisionCheckpoint(input: {
  decision: DecisionObject;
  objects: readonly IntelligenceObject[];
  scenarios?: readonly TerminalScenario[];
  timeContext?: TerminalTimeContext;
}): DecisionCheckpoint {
  const balance = decisionEvidenceBalance(input.decision);
  const scenarios = input.scenarios ?? [];
  const scenario = input.decision.scenarioId ? scenarios.find((item) => item.id === input.decision.scenarioId) : undefined;
  const ids = new Set(linkedObjectIds(input.decision));
  return {
    id: makeId(input.decision.id),
    decisionId: input.decision.id,
    decisionTitle: input.decision.title,
    decisionStatus: input.decision.status,
    direction: input.decision.direction,
    confidence: input.decision.confidence,
    thesis: input.decision.thesis,
    evidenceSupport: balance.support,
    evidenceContradiction: balance.contradiction,
    scenarioId: input.decision.scenarioId,
    scenarioName: scenario?.name,
    timeContext: { ...(input.timeContext ?? { enabled: false, asOfDate: null, mode: "latest" }) },
    objectStates: input.objects.filter((object) => ids.has(object.id)).map(objectState),
    capturedAt: Date.now(),
  };
}

export function captureDecisionCheckpoint(decision: DecisionObject): DecisionCheckpoint {
  const checkpoint = createDecisionCheckpoint({
    decision,
    objects: loadIntelligenceObjects(),
    scenarios: loadScenarios(),
    timeContext: loadTerminalTimeContext(),
  });
  saveDecisionCheckpoints([checkpoint, ...loadDecisionCheckpoints()]);
  return checkpoint;
}

export function latestDecisionCheckpoint(decisionId: string): DecisionCheckpoint | null {
  return loadDecisionCheckpoints().find((checkpoint) => checkpoint.decisionId === decisionId) ?? null;
}

export function ensureDecisionActivationCheckpoint(decision: DecisionObject): DecisionCheckpoint | null {
  if (decision.status !== "active" || !decision.decidedAt) return null;
  const existing = loadDecisionCheckpoints().find((checkpoint) => checkpoint.decisionId === decision.id && checkpoint.capturedAt >= decision.decidedAt! - 2_000);
  return existing ?? captureDecisionCheckpoint(decision);
}

function driftObject(before: DecisionCheckpointObjectState, current: IntelligenceObject | undefined): DecisionObjectDrift {
  const after = current?.value?.raw;
  const changed = !current || before.value !== after || before.status !== current.status;
  let absoluteDelta: number | undefined;
  let percentDelta: number | undefined;
  if (typeof before.value === "number" && typeof after === "number") {
    absoluteDelta = after - before.value;
    if (before.value !== 0) percentDelta = absoluteDelta / Math.abs(before.value) * 100;
  }
  return {
    objectId: before.objectId,
    label: before.label,
    before: before.value,
    after,
    statusBefore: before.status,
    statusAfter: current?.status,
    changed,
    absoluteDelta,
    percentDelta,
    missing: !current,
  };
}

export function buildDecisionDriftReport(decision: DecisionObject, checkpoint: DecisionCheckpoint, objects: readonly IntelligenceObject[]): DecisionDriftReport {
  const balance = decisionEvidenceBalance(decision);
  const objectDrift = checkpoint.objectStates.map((before) => driftObject(before, objects.find((object) => object.id === before.objectId)));
  return {
    decisionId: decision.id,
    checkpointId: checkpoint.id,
    checkpointAt: checkpoint.capturedAt,
    confidenceDelta: decision.confidence - checkpoint.confidence,
    evidenceSupportDelta: balance.support - checkpoint.evidenceSupport,
    evidenceContradictionDelta: balance.contradiction - checkpoint.evidenceContradiction,
    scenarioChanged: (decision.scenarioId ?? "") !== (checkpoint.scenarioId ?? ""),
    thesisChanged: decision.thesis !== checkpoint.thesis,
    directionChanged: decision.direction !== checkpoint.direction,
    objectDrift,
    changedObjectCount: objectDrift.filter((item) => item.changed).length,
    missingObjectCount: objectDrift.filter((item) => item.missing).length,
    materialObjectCount: objectDrift.filter((item) => typeof item.percentDelta === "number" && Math.abs(item.percentDelta) >= 5).length,
  };
}

export function subscribeDecisionCheckpoints(listener: (checkpoints: DecisionCheckpoint[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => listener(event instanceof CustomEvent && Array.isArray(event.detail) ? event.detail.map(cloneCheckpoint) : loadDecisionCheckpoints());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
