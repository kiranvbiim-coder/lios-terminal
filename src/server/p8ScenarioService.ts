import type { ArtifactContent } from "@shared/artifactContracts";
import {
  p8AssumptionMergeRequestSchema,
  p8BranchRequestSchema,
  p8CompareRequestSchema,
  p8DecisionObjectRequestSchema,
  p8FormulaDraftSchema,
  p8FormulaPublishSchema,
  p8ModelDraftRequestSchema,
  type P8ScenarioKind,
} from "@shared/p8ScenarioContracts";
import type { TenantContext } from "./tenantContext";
import {
  createArtifact,
  createArtifactProposal,
  createArtifactReference,
  forkArtifact,
  getArtifact,
  getArtifactVersion,
} from "./artifactStore";
import { appendLedgerEvent } from "./ledgerStore";
import { applyArtifactPatch } from "./artifactDiff";
import {
  buildP8ChangeReview,
  buildP8ScenarioSnapshot,
  buildSelectedAssumptionPatch,
  compareP8ScenarioSnapshots,
  validateP8FormulaDraft,
} from "./p8ScenarioEngine";

const SCENARIO_MODEL_KINDS = new Set(["valuation", "backtest", "strategy", "screen"]);

function inferredScenarioKind(title: string): P8ScenarioKind {
  const normalized = title.toLowerCase();
  if (/\bbull\b/.test(normalized)) return "bull";
  if (/\bbear\b/.test(normalized)) return "bear";
  if (/\bbase\b/.test(normalized)) return "base";
  return "custom";
}

async function artifactRoot(ctx: TenantContext, artifactId: string): Promise<string> {
  let current = await getArtifact(ctx, artifactId);
  const seen = new Set<string>();
  for (let depth = 0; depth < 32; depth += 1) {
    if (seen.has(current.id)) throw new Error("Artifact fork ancestry contains a cycle.");
    seen.add(current.id);
    if (!current.forkedFromArtifactId) return current.id;
    current = await getArtifact(ctx, current.forkedFromArtifactId);
  }
  throw new Error("Artifact fork ancestry exceeds the supported depth.");
}

async function snapshot(ctx: TenantContext, ref: { artifactId: string; version?: number; scenarioKind?: P8ScenarioKind; label?: string }) {
  const artifact = await getArtifact(ctx, ref.artifactId);
  const version = await getArtifactVersion(ctx, artifact.id, ref.version);
  return {
    artifact,
    version,
    snapshot: buildP8ScenarioSnapshot({
      artifactId: artifact.id,
      artifactVersion: version.version,
      title: ref.label ?? artifact.title,
      artifactKind: artifact.kind,
      scenarioKind: ref.scenarioKind ?? inferredScenarioKind(artifact.title),
      contentHash: version.contentHash,
      forkedFromArtifactId: artifact.forkedFromArtifactId,
      forkedFromVersion: artifact.forkedFromVersion,
      content: version.content as ArtifactContent,
    }),
  };
}

export async function branchP8ScenarioArtifact(ctx: TenantContext, artifactId: string, raw: unknown) {
  const input = p8BranchRequestSchema.parse(raw);
  const artifact = await getArtifact(ctx, artifactId);
  if (!SCENARIO_MODEL_KINDS.has(artifact.kind)) throw new Error("Scenario branching is supported only for structured model Artifacts.");
  const label = input.scenarioKind.toUpperCase();
  return forkArtifact(ctx, {
    artifactId,
    version: input.version,
    title: input.title ?? artifact.title + " — " + label,
  });
}

export async function compareP8ScenarioArtifacts(ctx: TenantContext, projectId: number, raw: unknown) {
  const input = p8CompareRequestSchema.parse(raw);
  const base = await snapshot(ctx, { ...input.base, scenarioKind: input.base.scenarioKind ?? "base" });
  if (base.artifact.projectId !== projectId) throw new Error("Base Artifact belongs to a different Project.");
  const rootArtifactId = await artifactRoot(ctx, base.artifact.id);
  const branches = [];
  for (const ref of input.branches) {
    const item = await snapshot(ctx, ref);
    if (item.artifact.projectId !== projectId) throw new Error("Scenario branch belongs to a different Project.");
    if (item.artifact.kind !== base.artifact.kind) throw new Error("Scenario branches must use the same Artifact kind.");
    if (await artifactRoot(ctx, item.artifact.id) !== rootArtifactId) throw new Error("Scenario branches do not share the same Artifact ancestry.");
    branches.push(item.snapshot);
  }
  return compareP8ScenarioSnapshots({ projectId, rootArtifactId, base: base.snapshot, branches });
}

export async function getP8ScenarioSnapshot(ctx: TenantContext, artifactId: string, version?: number, scenarioKind?: P8ScenarioKind) {
  return (await snapshot(ctx, { artifactId, version, scenarioKind })).snapshot;
}

export async function proposeP8AssumptionMerge(ctx: TenantContext, raw: unknown) {
  const input = p8AssumptionMergeRequestSchema.parse(raw);
  const source = await getArtifact(ctx, input.sourceArtifactId);
  const target = await getArtifact(ctx, input.targetArtifactId);
  if (source.projectId !== target.projectId) throw new Error("Source and target Artifacts must belong to the same Project.");
  if (source.kind !== target.kind) throw new Error("Source and target Artifacts must use the same model kind.");
  if (await artifactRoot(ctx, source.id) !== await artifactRoot(ctx, target.id)) throw new Error("Assumption merge requires a shared Artifact ancestry.");
  const sourceVersion = await getArtifactVersion(ctx, source.id, input.sourceVersion);
  const targetVersion = await getArtifactVersion(ctx, target.id, input.targetVersion);
  const patch = buildSelectedAssumptionPatch(sourceVersion.content as ArtifactContent, targetVersion.content as ArtifactContent, input.keys);
  const proposal = await createArtifactProposal(ctx, {
    artifactId: target.id,
    baseVersion: input.targetVersion,
    type: "artifact_patch",
    summary: input.summary ?? "Copy selected assumptions from " + source.title + " into " + target.title,
    patch,
    actorType: "user",
  });
  await appendLedgerEvent(ctx, {
    projectId: target.projectId,
    eventType: "state.changed",
    actorType: "user",
    payload: {
      action: "p8.assumption_merge_proposed",
      proposalId: proposal.id,
      sourceArtifactId: source.id,
      sourceVersion: sourceVersion.version,
      targetArtifactId: target.id,
      targetVersion: targetVersion.version,
      assumptionKeys: input.keys,
    },
    lineage: {
      nodes: [
        { kind: "artifact", ref: source.id, version: String(sourceVersion.version), hash: sourceVersion.contentHash, asOf: null, metadata: {} },
        { kind: "artifact", ref: target.id, version: String(targetVersion.version), hash: targetVersion.contentHash, asOf: null, metadata: {} },
      ],
      edges: [{ from: source.id, to: target.id, relation: "changed" }],
    },
  });
  return { proposal, patch };
}

export async function proposeP8ModelDraft(ctx: TenantContext, artifactId: string, raw: unknown) {
  const input = p8ModelDraftRequestSchema.parse(raw);
  const artifact = await getArtifact(ctx, artifactId);
  const baseVersion = await getArtifactVersion(ctx, artifact.id, input.baseVersion);
  const before = baseVersion.content as ArtifactContent;
  const after = applyArtifactPatch(before, input.patch);
  const review = buildP8ChangeReview(before, after);
  if (!review.changed) throw new Error("Draft does not change the Artifact.");
  const proposal = await createArtifactProposal(ctx, {
    artifactId,
    baseVersion: input.baseVersion,
    type: "artifact_patch",
    summary: input.summary,
    patch: input.patch,
    actorType: input.origin === "ai" ? "conversation" : "user",
  });
  return { proposal, review };
}

export function validateP8Formula(raw: unknown) {
  return validateP8FormulaDraft(p8FormulaDraftSchema.parse(raw));
}

export async function publishP8Formula(ctx: TenantContext, projectId: number, raw: unknown) {
  const input = p8FormulaPublishSchema.parse(raw);
  const validation = validateP8FormulaDraft(input);
  if (validation.status !== "valid") throw new Error("Formula is invalid and cannot be published.");
  if (validation.fingerprint !== input.validationFingerprint) throw new Error("Formula changed after validation; validate the current draft again.");
  if (input.targetArtifactId) {
    const target = await getArtifact(ctx, input.targetArtifactId);
    if (target.projectId !== projectId) throw new Error("Formula target belongs to a different Project.");
  }
  const created = await createArtifact(ctx, {
    projectId,
    title: input.title ?? "Formula · " + input.targetKey,
    origin: "direct",
    content: {
      kind: "strategy",
      language: "rules",
      source: input.expression,
      parameters: {
        p8Formula: {
          schemaVersion: 1,
          targetSurface: input.targetSurface,
          targetKey: input.targetKey,
          targetArtifactId: input.targetArtifactId,
          dependencies: validation.dependencies,
          validationFingerprint: validation.fingerprint,
          approved: true,
          publishedAt: new Date().toISOString(),
        },
      },
      validation: { status: "valid", errors: [] },
    },
    sourceRefs: input.targetArtifactId ? [input.targetArtifactId] : [],
    note: "Validated deterministic Formula Studio publication.",
  });
  if (input.targetArtifactId) {
    await createArtifactReference(ctx, {
      artifactId: created.artifact.id,
      version: created.artifact.headVersion,
      targetType: "artifact",
      targetRef: input.targetArtifactId,
      label: input.targetSurface + ":" + input.targetKey,
    });
  }
  return { ...created, validation };
}

export async function createP8DecisionObject(ctx: TenantContext, projectId: number, raw: unknown) {
  const input = p8DecisionObjectRequestSchema.parse(raw);
  const sourceRefs = [...new Set([
    ...input.linkedRefs.models,
    ...input.linkedRefs.sources,
    ...input.linkedRefs.scenarios,
    ...input.linkedRefs.backtests,
    ...input.linkedRefs.monitors,
  ])];
  return createArtifact(ctx, {
    projectId,
    title: input.title,
    origin: "direct",
    sourceRefs,
    content: {
      kind: "decision",
      objective: input.objective,
      whatChanged: input.whatChanged,
      why: input.why,
      scenarios: input.scenarios,
      constraints: input.constraints,
      assumptions: input.assumptions,
      alternatives: input.alternatives,
      selectedAlternativeId: input.selectedAlternativeId,
      uncertainties: input.uncertainties,
      nextActions: input.nextActions,
      implementation: input.implementation,
      monitoring: input.monitoring,
      linkedRefs: input.linkedRefs,
    },
    note: "P8 prescriptive Decision Object.",
  });
}
