import { artifactExportFormatsForKind, artifactExportPlanSchema, type ArtifactKind } from "@shared/artifactContracts";
import type { TenantContext } from "./tenantContext";
import { getArtifact, getArtifactVersion } from "./artifactStore";

function filenameStem(title: string): string {
  const clean = title.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (clean || "lios-artifact").slice(0, 180);
}

export async function getArtifactExportPlan(ctx: TenantContext, artifactId: string, version?: number) {
  const artifact = await getArtifact(ctx, artifactId);
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
