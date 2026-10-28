import { artifactExportFormatsForKind, artifactExportPlanSchema, type ArtifactKind } from "@shared/artifactContracts";
import { recordedBlockedArtifactSources } from "@shared/artifactExportRights";
import { trustManifestSchema } from "@shared/trustContracts";
import type { TenantContext } from "./tenantContext";
import { getArtifact, getArtifactIncludingTrash, getArtifactVersion } from "./artifactStore";
import { and, eq, isNull, sql } from "drizzle-orm";
import { datasetSnapshots, projectArtifactVersions, users, financialModelRuns } from "@shared/schema";
import { getDb } from "./db";
import { loadIntegratedModelArtifactSource } from "./integratedModelArtifact";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { canAccessDatasetSnapshot } from "./columnarArtifactStore";
import { z } from "zod";

const modelBindingSchema = z.object({
  datasetSnapshotId:z.string(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),
  modelRunId:z.string(),resultHash:z.string().regex(/^[a-f0-9]{64}$/),
  entitlementPolicyRef:z.string().startsWith("entitlement-policy:"),
});
const childBindingSchema = z.object({
  artifactId:z.string(),version:z.number().int().positive(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),
});
type ExportAuthorityGroup = {
  sourceRefs:string[];dependencyRefs:string[];contentHash:string;refreshSpec:Record<string,unknown>|null;
  modelBindings:z.infer<typeof modelBindingSchema>[];
};

/** Select custody identifiers only: never raw cells, embedded sourceContent or model values. */
async function readExportAuthorityGroups(ctx:TenantContext,artifactId:string,version:number) {
  const groups:ExportAuthorityGroup[]=[];
  const visited=new Set<string>();
  const visit=async(id:string,selected:number,expectedHash?:string,ancestors=new Set<string>()):Promise<Set<string>>=>{
    const key=`${id}@v${selected}`;
    if (ancestors.has(key)) throw new ArtifactExportRightsError("Retained source bindings contain a cycle.");
    if (visited.size>=128) throw new ArtifactExportRightsError("Retained source graph exceeds the bounded export limit.");
    await getArtifactIncludingTrash(ctx,id);
    const [row]=await getDb().select({
      sourceRefs:projectArtifactVersions.sourceRefs,dependencyRefs:projectArtifactVersions.dependencyRefs,
      contentHash:projectArtifactVersions.contentHash,refreshSpec:projectArtifactVersions.refreshSpec,
      children:sql<unknown>`coalesce((select jsonb_agg(distinct jsonb_build_object(
        'artifactId',item->'sourceArtifactId','version',item->'sourceVersion','contentHash',item->'sourceHash'))
        from jsonb_path_query(${projectArtifactVersions.content},'$.blocks[*].attrs') item
        where item ? 'sourceArtifactId' and item ? 'sourceVersion' and item ? 'sourceHash'),'[]'::jsonb)`,
      models:sql<unknown>`coalesce((select jsonb_agg(distinct jsonb_build_object(
        'datasetSnapshotId',item->'datasetSnapshotId','contentHash',item->'contentHash',
        'modelRunId',item->'modelRunId','resultHash',item->'resultHash','entitlementPolicyRef',item->'entitlementPolicyRef'))
        from jsonb_path_query(${projectArtifactVersions.content},'$.sheets[*].cells.*.lineage') item
        where item->>'custody'='server_projection'),'[]'::jsonb)`,
    }).from(projectArtifactVersions).where(and(eq(projectArtifactVersions.artifactId,id),eq(projectArtifactVersions.version,selected))).limit(1);
    if (!row || expectedHash!==undefined && row.contentHash!==expectedHash)
      throw new ArtifactExportRightsError("Exact retained source revision is unavailable or hash-mismatched.");
    const own=new Set([...row.sourceRefs,...row.dependencyRefs]);
    const full=new Set(own);
    if (visited.has(key)) return full;
    visited.add(key);
    const index=groups.push({...row,modelBindings:z.array(modelBindingSchema).parse(row.models)})-1;
    const next=new Set(ancestors);next.add(key);
    for (const child of z.array(childBindingSchema).max(128).parse(row.children)) {
      const inherited=await visit(child.artifactId,child.version,child.contentHash,next);
      for(const ref of inherited) own.delete(ref);
    }
    groups[index]={...groups[index],sourceRefs:[...own],dependencyRefs:[]};
    return full;
  };
  await visit(artifactId,version);
  return groups;
}

async function assertCurrentExportSourceRights(ctx: TenantContext, groups: readonly ExportAuthorityGroup[]) {
  await getDb().transaction(async tx => {
    const [actor] = await tx.select({id:users.id}).from(users).where(and(eq(users.id,ctx.userId),eq(users.active,true),
      eq(users.role,ctx.role),ctx.organizationId===null?isNull(users.organizationId):eq(users.organizationId,ctx.organizationId))).for("share").limit(1);
    if (!actor) throw new ArtifactExportRightsError("Current export owner authority changed.");
    const now = new Date();
    const permit = (policy: Awaited<ReturnType<typeof getEntitlementPolicyById>>) => {
      if (!policy || policy.licenseType === "unknown" || policy.effectiveFrom > now ||
          policy.effectiveTo !== null && policy.effectiveTo <= now ||
          !["display", "export", "derived_output"].every(use => policy.permittedUses.includes(use)) ||
          policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_"))
        throw new ArtifactExportRightsError("Current linked source rights do not permit export of this retained revision.");
    };
    for (const group of groups) {
      const refs=[...group.sourceRefs,...group.dependencyRefs];
      const policyIds=new Set(refs.filter(ref=>ref.startsWith("entitlement-policy:")).map(ref=>ref.slice("entitlement-policy:".length)));
      const snapshots=new Set(refs.filter(ref=>ref.startsWith("dataset-snapshot:")).map(ref=>ref.slice("dataset-snapshot:".length)));
      const admittedHashes=new Map<string,string>();
      for (const id of snapshots) {
        const [source] = await tx.select({
          createdByUserId: datasetSnapshots.createdByUserId, organizationId: datasetSnapshots.organizationId,
          provider: datasetSnapshots.provider, dataClass: datasetSnapshots.dataClass,contentHash:datasetSnapshots.contentHash,
          entitlementPolicyId: datasetSnapshots.entitlementPolicyId, availableAt: datasetSnapshots.availableAt,
          expiresAt: datasetSnapshots.expiresAt,
        }).from(datasetSnapshots).where(eq(datasetSnapshots.id, id)).for("share").limit(1);
        if (!source || !canAccessDatasetSnapshot(source, ctx) || source.availableAt > now ||
            source.expiresAt !== null && source.expiresAt <= now || !source.entitlementPolicyId)
          throw new ArtifactExportRightsError("A retained source is unavailable in the current ownership or rights scope.");
        const policy = await getEntitlementPolicyById(source.entitlementPolicyId,tx,true);
        permit(policy);
        if (policy!.provider !== source.provider || policy!.dataClass !== source.dataClass)
          throw new ArtifactExportRightsError("The current source policy no longer matches its provider and data class.");
        admittedHashes.set(id,source.contentHash);
      }
      const historicalPolicies=new Set<string>();
      for (const binding of group.modelBindings) {
        const [run]=await tx.select({id:financialModelRuns.id,snapshotId:financialModelRuns.datasetSnapshotId,
          resultHash:financialModelRuns.resultHash,owner:financialModelRuns.createdByUserId})
          .from(financialModelRuns).where(eq(financialModelRuns.id,binding.modelRunId)).for("share").limit(1);
        if (!run || run.owner!==ctx.userId || run.snapshotId!==binding.datasetSnapshotId || run.resultHash!==binding.resultHash ||
            admittedHashes.get(binding.datasetSnapshotId)!==binding.contentHash || !refs.includes(binding.entitlementPolicyRef))
          throw new ArtifactExportRightsError("Retained model custody does not match its exact owned run and source snapshot.");
        historicalPolicies.add(binding.entitlementPolicyRef.slice("entitlement-policy:".length));
      }
      // This exemption is local to one canonical source revision and its
      // verified server-projected tuple. It never discharges another source.
      for (const id of policyIds) if (!historicalPolicies.has(id)) permit(await getEntitlementPolicyById(id,tx,true));
    }
  });
}

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
  const groups = await readExportAuthorityGroups(ctx,artifactId,selectedVersion);
  const metadata = groups[0];
  await assertCurrentExportSourceRights(ctx, groups);
  const engineRef = metadata?.refreshSpec?.engineRef;
  if (typeof engineRef === "string" && engineRef.startsWith("integrated_financial_model:")) {
    const match = /^integrated_financial_model:([^:]+):run:([0-9a-f-]{36})$/.exec(engineRef);
    if (!match) throw new Error("Model export has an unrecognized persisted run identity.");
    await loadIntegratedModelArtifactSource(ctx, match[2], artifact.projectId, false, artifact.owningChatId);
  }
  const resolved = await getArtifactVersion(ctx, artifactId, selectedVersion);
  if (recordedBlockedArtifactSources(resolved.trustManifest ? trustManifestSchema.parse(resolved.trustManifest) : null) > 0) {
    throw new ArtifactExportRightsError("This revision records denied, revoked or expired source access. Export is blocked pending a source-rights review.");
  }
  const currentGroups=await readExportAuthorityGroups(ctx,artifactId,selectedVersion);
  if (currentGroups[0].contentHash!==resolved.contentHash) throw new ArtifactExportRightsError("Export revision changed during admission.");
  await assertCurrentExportSourceRights(ctx,currentGroups);
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
