import { artifactExportFormatsForKind, artifactExportPlanSchema, type ArtifactKind } from "@shared/artifactContracts";
import type { TenantContext } from "./tenantContext";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { and, eq } from "drizzle-orm";
import { projectArtifactVersions } from "@shared/schema";
import { getDb } from "./db";
import { loadIntegratedModelArtifactSource } from "./integratedModelArtifact";

function filenameStem(title: string): string {
  const clean = title.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (clean || "lios-artifact").slice(0, 180);
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
