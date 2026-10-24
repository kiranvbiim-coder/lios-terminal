import type { ArtifactRefreshSpec } from "@shared/artifactContracts";
import type { TrustManifest } from "@shared/trustContracts";
import type { ProjectArtifactVersionRecord } from "./useArtifacts";

export function buildArtifactDependencyRefs(input: {
  sourceRefs: readonly string[];
  trustManifest?: TrustManifest | null;
  capabilityIds?: readonly string[];
}): string[] {
  return [...new Set([
    ...input.sourceRefs,
    ...(input.trustManifest?.evidence.map((item) => item.sourceRef) ?? []),
    ...(input.capabilityIds ?? []).map((id) => `capability:${id}`),
  ].filter(Boolean))];
}

export interface ArtifactReplayDraft {
  message: string;
  sourceScope: ArtifactRefreshSpec["sourceScope"];
  executionMode: ArtifactRefreshSpec["executionMode"];
}

export function artifactReplayDraft(
  title: string,
  spec: ArtifactRefreshSpec,
): ArtifactReplayDraft {
  return {
    message: spec.message?.trim()
      || `Rerun Artifact "${title}" using its governed dependencies and preserve prior assumptions unless new evidence requires a reviewed change.`,
    sourceScope: spec.sourceScope,
    executionMode: spec.executionMode,
  };
}

function normalizedRefs(values: readonly string[]): string {
  return [...new Set(values)].sort().join("\n");
}

export interface ArtifactVersionMetadataDelta {
  trustChanged: boolean;
  dependenciesChanged: boolean;
  replayChanged: boolean;
  receiptsChanged: boolean;
  assumptionsChanged: boolean;
  sourceRefsChanged: boolean;
}

export function compareArtifactVersionMetadata(
  left: Pick<ProjectArtifactVersionRecord, "trustManifest" | "dependencyRefs" | "refreshSpec" | "executionReceiptIds" | "assumptionRefs" | "sourceRefs">,
  right: Pick<ProjectArtifactVersionRecord, "trustManifest" | "dependencyRefs" | "refreshSpec" | "executionReceiptIds" | "assumptionRefs" | "sourceRefs">,
): ArtifactVersionMetadataDelta {
  return {
    trustChanged: (left.trustManifest?.trustId ?? null) !== (right.trustManifest?.trustId ?? null)
      || JSON.stringify(left.trustManifest?.summary ?? null) !== JSON.stringify(right.trustManifest?.summary ?? null),
    dependenciesChanged: normalizedRefs(left.dependencyRefs) !== normalizedRefs(right.dependencyRefs),
    replayChanged: JSON.stringify(left.refreshSpec ?? null) !== JSON.stringify(right.refreshSpec ?? null),
    receiptsChanged: normalizedRefs(left.executionReceiptIds) !== normalizedRefs(right.executionReceiptIds),
    assumptionsChanged: normalizedRefs(left.assumptionRefs) !== normalizedRefs(right.assumptionRefs),
    sourceRefsChanged: normalizedRefs(left.sourceRefs) !== normalizedRefs(right.sourceRefs),
  };
}

export function metadataDeltaLabels(delta: ArtifactVersionMetadataDelta): string[] {
  return [
    delta.trustChanged ? "trust" : null,
    delta.dependenciesChanged ? "dependencies" : null,
    delta.replayChanged ? "replay" : null,
    delta.receiptsChanged ? "receipts" : null,
    delta.assumptionsChanged ? "assumptions" : null,
    delta.sourceRefsChanged ? "sources" : null,
  ].filter((value): value is string => Boolean(value));
}
