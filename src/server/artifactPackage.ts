import {
  artifactContentSchema,
  artifactPackageSchema,
  artifactRefreshSpecSchema,
  LIOS_ARTIFACT_PACKAGE_VERSION,
  type ArtifactPackage,
} from "@shared/artifactContracts";
import { trustManifestSchema } from "@shared/trustContracts";
import type { TenantContext } from "./tenantContext";
import { createProjectPortabilityManifest } from "./projectPortability";
import { getProject } from "./projectStore";
import { listProjectSessions, createProjectSession, archiveProjectSession } from "./projectSessionStore";
import { listEntitlementPolicies } from "./dataEntitlementStore";
import {
  createArtifact,
  createArtifactReference,
  createArtifactVersion,
  listArtifactReferences,
  listArtifactVersions,
  listProjectArtifacts,
  assertArtifactContentSafe,
  assertArtifactRefsSafe,
  assertArtifactRefreshSpecSafe,
  assertArtifactTrustSafe,
  artifactTrustSourceRefs,
  relinkImportedArtifactFork,
  setArtifactStatus,
} from "./artifactStore";
import { hashLedgerValue, sanitizeLedgerPayload } from "./ledgerStore";

const PROVIDER_REF = /^provider:(.+)$/i;

function packageHash(value: Omit<ArtifactPackage, "packageHash">): string {
  return hashLedgerValue(value);
}

function providerRequirements(pkg: ArtifactPackage): Set<string> {
  const result = new Set<string>();
  for (const item of pkg.artifacts) {
    for (const version of item.versions) {
      for (const sourceRef of [
        ...version.sourceRefs,
        ...version.dependencyRefs,
        ...artifactTrustSourceRefs(version.trustManifest),
      ]) {
        const match = PROVIDER_REF.exec(sourceRef);
        if (match?.[1]) result.add(`provider:${match[1]}`);
      }
    }
  }
  return result;
}

export async function createArtifactPackage(ctx: TenantContext, projectId: number): Promise<ArtifactPackage> {
  const [project, manifest, activeSessions, archivedSessions, artifacts] = await Promise.all([
    getProject(ctx, projectId),
    createProjectPortabilityManifest(ctx, projectId),
    listProjectSessions(ctx, projectId, "active"),
    listProjectSessions(ctx, projectId, "archived"),
    listProjectArtifacts(ctx, projectId, { status: "active", limit: 500 }),
  ]);
  const archivedArtifacts = await listProjectArtifacts(ctx, projectId, { status: "archived", limit: 500 });
  const allArtifacts = [...artifacts, ...archivedArtifacts].sort((a, b) => a.id.localeCompare(b.id));
  const artifactBundles = [];
  const references = [];

  for (const artifact of allArtifacts) {
    const [versions, refs] = await Promise.all([
      listArtifactVersions(ctx, artifact.id),
      listArtifactReferences(ctx, artifact.id),
    ]);
    artifactBundles.push({
      identity: {
        schemaVersion: "1" as const,
        id: artifact.id,
        projectId: artifact.projectId,
        owningChatId: artifact.owningChatId,
        kind: artifact.kind as any,
        title: artifact.title,
        status: artifact.status as "active" | "archived",
        origin: artifact.origin as any,
        headVersion: artifact.headVersion,
        forkedFromArtifactId: artifact.forkedFromArtifactId,
        forkedFromVersion: artifact.forkedFromVersion,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
        archivedAt: artifact.archivedAt?.toISOString() ?? null,
      },
      versions: versions.sort((a, b) => a.version - b.version).map((version) => {
        assertArtifactRefsSafe(version.sourceRefs, "package sourceRefs");
        assertArtifactRefsSafe(version.assumptionRefs, "package assumptionRefs");
        assertArtifactRefsSafe(version.dependencyRefs ?? [], "package dependencyRefs");
        return ({
        schemaVersion: "1" as const,
        id: version.id,
        artifactId: version.artifactId,
        version: version.version,
        parentVersionId: version.parentVersionId,
        adapterId: version.adapterId,
        content: artifactContentSchema.parse(version.content),
        contentHash: version.contentHash,
        sourceRefs: version.sourceRefs,
        executionReceiptIds: version.executionReceiptIds,
        assumptionRefs: version.assumptionRefs,
        trustManifest: version.trustManifest ? trustManifestSchema.parse(version.trustManifest) : null,
        dependencyRefs: version.dependencyRefs ?? [],
        refreshSpec: version.refreshSpec ? artifactRefreshSpecSchema.parse(version.refreshSpec) : null,
        note: version.note,
        createdAt: version.createdAt.toISOString(),
      });
      }),
    });
    references.push(...refs.map((ref) => ({
      artifactId: ref.artifactId,
      version: ref.version,
      targetType: ref.targetType as any,
      targetRef: ref.targetRef,
      label: ref.label,
    })));
  }

  const sessions = [...activeSessions, ...archivedSessions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((session) => {
      const workspaceState = sanitizeLedgerPayload(session.workspaceState) as Record<string, unknown>;
      return {
        id: session.id,
        parentSessionId: session.parentSessionId,
        name: session.name,
        status: session.status as "active" | "archived",
        workspaceState,
        stateHash: hashLedgerValue(workspaceState),
      };
    });

  const withoutHash = {
    version: LIOS_ARTIFACT_PACKAGE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceProject: { id: project.id, name: project.name, manifestHash: manifest.manifestHash },
    sessions,
    artifacts: artifactBundles,
    references,
    entitlementRequirements: [] as string[],
    excludesCredentials: true as const,
  };
  const provisional = artifactPackageSchema.parse({ ...withoutHash, packageHash: "0".repeat(64) });
  provisional.entitlementRequirements = [...providerRequirements(provisional)].sort();
  const finalWithoutHash = { ...provisional };
  delete (finalWithoutHash as any).packageHash;
  return verifyArtifactPackage(
    artifactPackageSchema.parse({ ...finalWithoutHash, packageHash: packageHash(finalWithoutHash as any) }),
  );
}

export function verifyArtifactPackage(raw: unknown): ArtifactPackage {
  const pkg = artifactPackageSchema.parse(raw);
  const clone: any = { ...pkg };
  delete clone.packageHash;
  const expected = packageHash(clone);
  if (expected !== pkg.packageHash) throw new Error("Artifact package hash verification failed.");
  for (const item of pkg.artifacts) {
    for (const version of item.versions) {
      assertArtifactContentSafe(version.content);
      assertArtifactRefsSafe(version.sourceRefs, "package sourceRefs");
      assertArtifactRefsSafe(version.assumptionRefs, "package assumptionRefs");
      assertArtifactRefsSafe(version.dependencyRefs, "package dependencyRefs");
      if (version.trustManifest) assertArtifactTrustSafe(version.trustManifest);
      if (version.refreshSpec) assertArtifactRefreshSpecSafe(version.refreshSpec);
      if (hashLedgerValue(version.content) !== version.contentHash) {
        throw new Error(`Artifact version hash mismatch for ${version.artifactId}@v${version.version}.`);
      }
    }
  }
  return pkg;
}

async function revalidatePackageEntitlements(pkg: ArtifactPackage): Promise<void> {
  const policies = await listEntitlementPolicies();
  for (const requirement of pkg.entitlementRequirements) {
    const match = PROVIDER_REF.exec(requirement);
    if (!match?.[1]) continue;
    const provider = match[1];
    const candidates = policies.filter((policy) => policy.provider.toLowerCase() === provider.toLowerCase());
    const allowed = candidates.some((policy) =>
      policy.permittedUses.includes("internal_research") ||
      policy.permittedUses.includes("derived_output") ||
      policy.permittedUses.includes("display")
    );
    if (!allowed) {
      throw new Error(`Import requires an active entitlement policy for provider "${provider}". Reconnect/review that source before import.`);
    }
  }
}

export async function importArtifactPackage(
  ctx: TenantContext,
  projectId: number,
  raw: unknown,
): Promise<{
  importedArtifacts: number;
  importedSessions: number;
  artifactIdMap: Record<string, string>;
  sessionIdMap: Record<string, string>;
}> {
  await getProject(ctx, projectId);
  const pkg = verifyArtifactPackage(raw);
  await revalidatePackageEntitlements(pkg);

  const sessionIdMap: Record<string, string> = {};
  const pendingSessions = [...pkg.sessions];
  let guard = 0;
  while (pendingSessions.length && guard++ < 10_000) {
    let progressed = false;
    for (let i = pendingSessions.length - 1; i >= 0; i--) {
      const source = pendingSessions[i];
      if (source.parentSessionId && !sessionIdMap[source.parentSessionId]) continue;
      const created = await createProjectSession(ctx, {
        projectId,
        chatId: null,
        parentSessionId: source.parentSessionId ? sessionIdMap[source.parentSessionId] : null,
        name: source.name,
        workspaceState: source.workspaceState as any,
      });
      if (source.status === "archived") await archiveProjectSession(ctx, created.id);
      sessionIdMap[source.id] = created.id;
      pendingSessions.splice(i, 1);
      progressed = true;
    }
    if (!progressed) throw new Error("Portable package contains unresolved or cyclic Session ancestry.");
  }

  const artifactIdMap: Record<string, string> = {};
  for (const bundle of pkg.artifacts) {
    const versions = [...bundle.versions].sort((a, b) => a.version - b.version);
    if (!versions.length || versions[0].version !== 1) throw new Error(`Artifact ${bundle.identity.id} has no v1.`);
    const first = versions[0];
    const created = await createArtifact(ctx, {
      projectId,
      title: bundle.identity.title,
      content: first.content,
      origin: "import",
      adapterId: first.adapterId,
      sourceRefs: first.sourceRefs,
      executionReceiptIds: first.executionReceiptIds,
      assumptionRefs: first.assumptionRefs,
      trustManifest: first.trustManifest,
      dependencyRefs: first.dependencyRefs,
      refreshSpec: first.refreshSpec,
      note: `Imported from Project package ${pkg.sourceProject.name}`,
    });
    artifactIdMap[bundle.identity.id] = created.artifact.id;
    let head = 1;
    for (const sourceVersion of versions.slice(1)) {
      if (sourceVersion.version !== head + 1) throw new Error(`Artifact ${bundle.identity.id} has a non-contiguous version history.`);
      await createArtifactVersion(ctx, {
        artifactId: created.artifact.id,
        baseVersion: head,
        content: sourceVersion.content,
        adapterId: sourceVersion.adapterId,
        sourceRefs: sourceVersion.sourceRefs,
        executionReceiptIds: sourceVersion.executionReceiptIds,
        assumptionRefs: sourceVersion.assumptionRefs,
        trustManifest: sourceVersion.trustManifest,
        dependencyRefs: sourceVersion.dependencyRefs,
        refreshSpec: sourceVersion.refreshSpec,
        note: sourceVersion.note ?? `Imported source v${sourceVersion.version}`,
        action: "import",
      });
      head += 1;
    }
    if (bundle.identity.status === "archived") {
      await setArtifactStatus(ctx, created.artifact.id, "archived");
    }
  }

  for (const bundle of pkg.artifacts) {
    if (!bundle.identity.forkedFromArtifactId || !bundle.identity.forkedFromVersion) continue;
    const importedArtifactId = artifactIdMap[bundle.identity.id];
    const importedParentId = artifactIdMap[bundle.identity.forkedFromArtifactId];
    if (!importedArtifactId || !importedParentId) continue;
    await relinkImportedArtifactFork(ctx, importedArtifactId, importedParentId, bundle.identity.forkedFromVersion);
  }

  for (const ref of pkg.references) {
    const artifactId = artifactIdMap[ref.artifactId];
    if (!artifactId) continue;
    let targetRef = ref.targetRef;
    if (ref.targetType === "project") targetRef = String(projectId);
    else if (ref.targetType === "session") {
      if (!sessionIdMap[targetRef]) continue;
      targetRef = sessionIdMap[targetRef];
    } else if (ref.targetType === "artifact") {
      if (!artifactIdMap[targetRef]) continue;
      targetRef = artifactIdMap[targetRef];
    } else {
      // Chat/resource identities are deployment-local and never imported by id.
      continue;
    }
    await createArtifactReference(ctx, {
      artifactId,
      version: ref.version,
      targetType: ref.targetType,
      targetRef,
      label: ref.label,
    });
  }

  return {
    importedArtifacts: Object.keys(artifactIdMap).length,
    importedSessions: Object.keys(sessionIdMap).length,
    artifactIdMap,
    sessionIdMap,
  };
}
