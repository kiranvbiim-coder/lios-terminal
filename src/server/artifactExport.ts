import { artifactExportFormatsForKind, artifactExportPlanSchema, type ArtifactKind } from "@shared/artifactContracts";
import { recordedBlockedArtifactSources } from "@shared/artifactExportRights";
import { trustManifestSchema } from "@shared/trustContracts";
import type { TenantContext } from "./tenantContext";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { and, eq } from "drizzle-orm";
import { projectArtifactVersions } from "@shared/schema";
import { getDb } from "./db";
import { loadIntegratedModelArtifactSource } from "./integratedModelArtifact";

function filenameStem(title: string): string {
  const clean = title.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return (clean || "lios-artifact").slice(0, 180);
}

export class ArtifactExportRightsError extends Error {
  readonly status = 403;
}

export async function getArtifactExportPlan(ctx: TenantContext, artifactId: string, version?: number) {
  const artifact = await getArtifact(ctx, artifactId);
  const selectedVersion = version ?? artifact.headVersion;
  const [metadata] = await getDb().select({ refreshSpec: projectArtifactVersions.refreshSpec }).from(projectArtifactVersions).where(and(
    eq(projectArtifactVersions.artifactId, artifactId), eq(projectArtifactVersions.version, selectedVersion),
  )).limit(1);
  const engineRef = metadata?.refreshSpec?.engineRef;
  if (typeof engineRef === "string" && engineRef.startsWith("integrated_financial_model:")) {
    const match = /^integrated_financial_model:([^:]+):run:([0-9a-f-]{36})$/.exec(engineRef);
    if (!match) throw new Error("Model export has an unrecognized persisted run identity.");
    await loadIntegratedModelArtifactSource(ctx, match[2], artifact.projectId, false, artifact.owningChatId);
  }
  const resolved = await getArtifactVersion(ctx, artifactId, version);
  if (recordedBlockedArtifactSources(resolved.trustManifest ? trustManifestSchema.parse(resolved.trustManifest) : null) > 0) {
    throw new ArtifactExportRightsError("This revision records denied, revoked or expired source access. Export is blocked pending a source-rights review.");
  }
  return artifactExportPlanSchema.parse({
    artifactId,
    version: resolved.version,
    kind: artifact.kind,
    formats: [...artifactExportFormatsForKind(artifact.kind as ArtifactKind)],
    filenameStem: filenameStem(artifact.title),
    contentHash: resolved.contentHash,
    sourceRefs: resolved.sourceRefs,
  });
}
