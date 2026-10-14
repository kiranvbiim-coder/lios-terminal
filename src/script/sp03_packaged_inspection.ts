import { researchArtifactContentSchema } from "../shared/artifactContracts";
import type { Sp03EvidenceSource } from "./sp03_packaged_contract";

export interface Sp03ArtifactDetailLike {
  artifact: {
    id: string;
    projectId?: number;
    kind?: string;
    origin?: string;
    headVersion?: number;
    title?: string;
  };
  version: {
    version: number;
    content: unknown;
    contentHash: string;
    sourceRefs?: string[];
    dependencyRefs?: string[];
    executionReceiptIds?: string[];
    trustManifest?: unknown;
  };
}

export interface Sp03InteractionLike {
  requestId?: string | null;
  action?: string;
  fromVersion?: number | null;
  toVersion?: number | null;
}

export interface Sp03ExecutionLike {
  id: string;
  status: string;
  events?: unknown[];
}

export interface Sp03Inspection {
  sources: Sp03EvidenceSource[];
  canonicalIdentity: { pass: boolean; detail: string };
  multiSourceEvidence: { pass: boolean; detail: string };
  rightsFreshnessAsOf: { pass: boolean; detail: string };
  contradictionsGapsUnknowns: { pass: boolean; detail: string };
  truthClassification: { pass: boolean; detail: string };
  researchArtifact: { pass: boolean; detail: string };
  lineageInspection: { pass: boolean; detail: string };
  noFakeSuccess: { pass: boolean; detail: string };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sourceHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function quoteTruth(
  blocks: Array<{ type: string; text: string; attrs: Record<string, unknown> }>,
  evidenceId: string,
  sourceRef: string,
): {
  provenance: Record<string, unknown>;
  truth: Record<string, unknown>;
} {
  const quote = blocks.find((block) =>
    block.type === "quote"
    && (
      block.attrs.evidenceId === evidenceId
      || block.attrs.sourceRef === sourceRef
    )
  );
  const attrs = quote?.attrs ?? {};
  return {
    provenance: asRecord(attrs.provenance),
    truth: asRecord(attrs.truth),
  };
}

function mapEntitlement(truth: Record<string, unknown>): Sp03EvidenceSource["entitlement"] {
  const access = asRecord(truth.access);
  const availability = text(access.availability);
  if (availability === "unavailable" || availability === "inaccessible") return "unavailable";
  const entitlement = text(access.entitlement);
  if (entitlement === "entitled") return "permitted";
  if (entitlement === "unentitled") return "unentitled";
  return "unknown";
}

function evidenceSource(
  evidence: {
    id: string;
    sourceRef: string;
    sourceType: string;
    url: string | null;
    observedAt: string | null;
  },
  blocks: Array<{ type: string; text: string; attrs: Record<string, unknown> }>,
): Sp03EvidenceSource {
  const { provenance, truth } = quoteTruth(blocks, evidence.id, evidence.sourceRef);
  const temporal = asRecord(truth.temporal);
  const explicitProvider = text(provenance.provider);
  const host = sourceHost(evidence.url) ?? sourceHost(evidence.sourceRef);
  const provider = explicitProvider ?? (host ? `origin:${host}` : "unknown");
  return {
    sourceRef: evidence.sourceRef,
    provider,
    sourceType: evidence.sourceType,
    retrievedAt: text(provenance.retrievedAt) ?? text(temporal.retrievedAt),
    observedAt: evidence.observedAt ?? text(temporal.observedAt),
    asOf: text(temporal.asOfAt),
    entitlement: mapEntitlement(truth),
  };
}

function hasExplicitTruth(
  evidence: {
    id: string;
    sourceRef: string;
    url: string | null;
    observedAt: string | null;
  },
  blocks: Array<{ type: string; text: string; attrs: Record<string, unknown> }>,
): boolean {
  const { provenance, truth } = quoteTruth(blocks, evidence.id, evidence.sourceRef);
  const temporal = asRecord(truth.temporal);
  const freshness = asRecord(truth.freshness);
  const access = asRecord(truth.access);
  const retrievedAt = text(provenance.retrievedAt) ?? text(temporal.retrievedAt);
  const observedOrAsOf = evidence.observedAt ?? text(temporal.observedAt) ?? text(temporal.asOfAt);
  return retrievedAt !== null
    && observedOrAsOf !== null
    && ["fresh", "stale", "unknown"].includes(text(freshness.state) ?? "")
    && ["available", "unavailable", "inaccessible", "unknown"].includes(text(access.availability) ?? "")
    && ["entitled", "unentitled", "unknown"].includes(text(access.entitlement) ?? "");
}

function sourceIdentity(source: Sp03EvidenceSource): string {
  const host = sourceHost(source.sourceRef);
  if (host && source.provider !== "unknown") return `${source.provider}|${host}`;
  if (host) return host;
  if (source.provider !== "unknown") return source.provider;
  return source.sourceRef;
}

function canonicalIdentityEvidence(events: readonly unknown[]): {
  successful: boolean;
  refs: string[];
} {
  const records = events.map(asRecord);
  const calls = new Set(
    records
      .filter((event) => event.kind === "tool_call_started" && event.toolId === "lios.entity.resolve")
      .map((event) => text(event.toolCallId))
      .filter((value): value is string => value !== null),
  );
  const successful = records.some((event) =>
    event.kind === "tool_call_finished"
    && event.status === "succeeded"
    && typeof event.toolCallId === "string"
    && calls.has(event.toolCallId)
  );
  const refs = records
    .filter((event) => event.kind === "evidence" && event.role === "source")
    .map((event) => text(event.ref))
    .filter((value): value is string => value !== null);
  return { successful, refs: [...new Set(refs)] };
}

function sourceUnknowns(
  evidence: { id: string; sourceRef: string },
  blocks: Array<{ type: string; text: string; attrs: Record<string, unknown> }>,
): string[] {
  const { truth } = quoteTruth(blocks, evidence.id, evidence.sourceRef);
  return stringArray(truth.unknowns);
}

function sourceTruthState(
  evidence: { id: string; sourceRef: string },
  blocks: Array<{ type: string; text: string; attrs: Record<string, unknown> }>,
): { entitlement: string | null; availability: string | null; freshness: string | null; unknowns: string[] } {
  const { truth } = quoteTruth(blocks, evidence.id, evidence.sourceRef);
  const access = asRecord(truth.access);
  const freshness = asRecord(truth.freshness);
  return {
    entitlement: text(access.entitlement),
    availability: text(access.availability),
    freshness: text(freshness.state),
    unknowns: stringArray(truth.unknowns),
  };
}

export function inspectSp03ResearchArtifact(input: {
  detail: Sp03ArtifactDetailLike;
  execution: Sp03ExecutionLike;
  interactions: readonly Sp03InteractionLike[];
  requestId: string;
  identitySourceRefs?: readonly string[];
  identityResolved?: boolean;
}): Sp03Inspection {
  const parsed = researchArtifactContentSchema.safeParse(input.detail.version.content);
  if (!parsed.success) {
    const fail = { pass: false, detail: "Artifact content is not a valid canonical ResearchArtifact." };
    return {
      sources: [],
      canonicalIdentity: fail,
      multiSourceEvidence: fail,
      rightsFreshnessAsOf: fail,
      contradictionsGapsUnknowns: fail,
      truthClassification: fail,
      researchArtifact: fail,
      lineageInspection: fail,
      noFakeSuccess: fail,
    };
  }

  const content = parsed.data;
  const sources = content.evidence.map((item) => evidenceSource(item, content.blocks));
  const identity = canonicalIdentityEvidence(input.execution.events ?? []);
  const gatewayIdentityRefs = [...new Set(input.identitySourceRefs ?? [])]
    .map((ref) => ref.trim())
    .filter(Boolean);
  const uniqueSourceRefs = [...new Set(sources.map((source) => source.sourceRef))];
  const independentSources = new Set(sources.map(sourceIdentity));
  const sourceRefs = new Set(input.detail.version.sourceRefs ?? []);
  const dependencyRefs = new Set(input.detail.version.dependencyRefs ?? []);
  const unknowns = content.evidence.flatMap((item) => sourceUnknowns(item, content.blocks));
  const truthStates = content.evidence.map((item) => sourceTruthState(item, content.blocks));

  const identityRefs = [...new Set([...identity.refs, ...gatewayIdentityRefs])];
  const canonicalIdentity = identity.successful && input.identityResolved === true && identityRefs.length > 0;
  const multiSourceEvidence = uniqueSourceRefs.length >= 2 && independentSources.size >= 2;
  const rightsFreshnessAsOf = content.evidence.length >= 2
    && content.evidence.every((item) => hasExplicitTruth(item, content.blocks));
  const surfacedUnknownOrConflict = content.contradictions.length > 0
    || unknowns.length > 0
    || truthStates.some((state) =>
      state.freshness === "stale"
      || state.freshness === "unknown"
      || state.availability !== "available"
      || state.entitlement !== "entitled"
    )
    || content.blocks.some((block) => /\b(?:contradiction|gap|unknown|stale|unavailable|ambiguous)\b/i.test(block.text));
  const claimsTyped = content.claims.every((claim) =>
    claim.provenance !== "unknown"
    && (claim.provenance !== "source_backed" || claim.sourceRefs.length > 0)
  );
  const truthClassification = content.evidence.length > 0 && claimsTyped && surfacedUnknownOrConflict;
  const researchArtifact = input.detail.artifact.id.startsWith("artifact:")
    && input.detail.artifact.kind === "research"
    && input.detail.artifact.origin === "conversation"
    && Number.isInteger(input.detail.version.version)
    && input.detail.version.version > 0
    && /^[a-f0-9]{64}$/i.test(input.detail.version.contentHash)
    && content.evidence.length >= 2;
  const hasInteraction = input.interactions.some((receipt) => receipt.requestId === input.requestId);
  const lineageInspection = uniqueSourceRefs.every((ref) => sourceRefs.has(ref))
    && uniqueSourceRefs.every((ref) => dependencyRefs.has(ref))
    && content.executionTrail.length > 0
    && content.executionTrail.every((entry) => entry.sourceRefs.every((ref) => sourceRefs.has(ref)))
    && hasInteraction;
  const noFakeSuccess = truthStates.every((state) => {
    if (state.entitlement === "unentitled") return false;
    if (state.availability === "unavailable" || state.availability === "inaccessible") return false;
    if (state.entitlement === "unknown" && !state.unknowns.includes("entitlement")) return false;
    if (state.availability === "unknown" && !state.unknowns.includes("availability")) return false;
    return true;
  });

  return {
    sources,
    canonicalIdentity: {
      pass: canonicalIdentity,
      detail: canonicalIdentity
        ? `canonical lios.entity.resolve explicitly resolved and emitted ${identityRefs.length} canonical identity ref(s) through the run/Gateway evidence path`
        : "the run did not prove an explicitly resolved canonical entity identity; ambiguous/not-found candidate refs cannot pass",
    },
    multiSourceEvidence: {
      pass: multiSourceEvidence,
      detail: `${uniqueSourceRefs.length} distinct source ref(s), ${independentSources.size} independent source/provider identity key(s)`,
    },
    rightsFreshnessAsOf: {
      pass: rightsFreshnessAsOf,
      detail: rightsFreshnessAsOf
        ? "every evidence source preserves retrieval time, observed/as-of time, freshness, availability, and entitlement posture"
        : "one or more evidence sources lacks explicit retrieval/observed-as-of/freshness/access truth",
    },
    contradictionsGapsUnknowns: {
      pass: surfacedUnknownOrConflict,
      detail: `${content.contradictions.length} contradiction(s), ${unknowns.length} explicit source-truth unknown marker(s)`,
    },
    truthClassification: {
      pass: truthClassification,
      detail: truthClassification
        ? `${content.claims.length} claim(s) use explicit provenance while observed evidence and unknown/conflict posture remain distinct`
        : "ResearchArtifact contains an unknown-provenance claim or does not surface missing/conflict truth",
    },
    researchArtifact: {
      pass: researchArtifact,
      detail: researchArtifact
        ? `${input.detail.artifact.id}@v${input.detail.version.version} is a durable conversation-origin ResearchArtifact with ${content.evidence.length} evidence item(s)`
        : "canonical durable ResearchArtifact identity/version/hash/evidence requirements were not met",
    },
    lineageInspection: {
      pass: lineageInspection,
      detail: lineageInspection
        ? "Artifact sourceRefs, dependencyRefs, executionTrail, content hash and request-bound P4 interaction are inspectable"
        : "Artifact evidence does not fully reconcile to canonical source/dependency/execution/request lineage",
    },
    noFakeSuccess: {
      pass: noFakeSuccess,
      detail: noFakeSuccess
        ? "no unentitled or unavailable source was promoted; unknown access posture is explicitly represented as unknown"
        : "an unentitled/unavailable source was promoted or unknown access posture was not surfaced explicitly",
    },
  };
}
