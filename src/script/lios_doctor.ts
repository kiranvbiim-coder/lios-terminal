#!/usr/bin/env node
import { dataRootIsExplicit } from "../server/dataRoot";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import { P10_RUNTIME_PACKS, validateP10RuntimePackCatalog } from "../server/p10RuntimePacks";
import { P11_PACK_CATALOG, validateP11PackCatalog } from "../server/p11PackCatalog";
import { managedRuntimePythonPath, readManagedRuntimeState } from "../server/pythonRuntimeManager";
import { evaluateManagedRuntimeReadiness } from "../server/provisioningReadiness";
import { planManagedRuntimeRepair, type DoctorRepairPlan } from "../server/doctorRepairPlan";
import { effectiveSandboxIsolationMode } from "../server/exec/sandbox-runtime-profile";
import { SP01_DEPENDENCY_INVENTORY } from "../server/sp01DependencyInventory";
import { p10ObservabilityPath, p10RemoteObservabilityConfig } from "../server/p10Observability";
import { p10OpenLineageConfig } from "../server/p10OpenLineage";

export interface LiosDoctorSnapshot {
  schemaVersion: "1";
  generatedAt: string;
  system: Record<string, unknown>;
  runtimePacks: Record<string, unknown>;
  repairPlan: DoctorRepairPlan;
  sp01Dependencies: typeof SP01_DEPENDENCY_INVENTORY;
  connectors: Record<string, unknown>;
  observability: Record<string, unknown>;
  jobsAgents: Record<string, unknown>;
  dataDiagnostics: Record<string, unknown>;
  releaseGovernance: Record<string, unknown>;
  warnings: string[];
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export function buildLiosDoctorSnapshot(env: NodeJS.ProcessEnv = process.env): LiosDoctorSnapshot {
  const state = readManagedRuntimeState();
  const managedRuntimeReadiness = evaluateManagedRuntimeReadiness({
    state,
    pythonAvailable: Boolean(managedRuntimePythonPath()),
    requiredPackIds: ["core"],
  });
  const isolationMode = effectiveSandboxIsolationMode(undefined, env);
  const repairPlan = planManagedRuntimeRepair(managedRuntimeReadiness, { isolationMode });
  const packErrors = validateP10RuntimePackCatalog();
  const p11PackErrors = validateP11PackCatalog();
  const observability = p10RemoteObservabilityConfig(env);
  const lineage = p10OpenLineageConfig(env);
  const root = repoRoot();
  const governanceFiles = [
    "THIRD_PARTY_NOTICES.md",
    "third_party/components.json",
    "third_party/upstream-lock.json",
    "third_party/imported-oss-regression.json",
    "third_party/lse-release-inventory.json",
    "third_party/p11-candidates.json",
    "docs/technical/P11_ENGINE_FABRIC_SPEC.md",
    "docs/technical/P11_OSS_CANDIDATE_MATRIX.md",
  ];
  const warnings: string[] = [];
  if (packErrors.length) warnings.push(...packErrors);
  if (p11PackErrors.length) warnings.push(...p11PackErrors.map((item) => "p11-engine-fabric: " + item));
  if (state?.verificationWarnings?.length) warnings.push(...state.verificationWarnings.map((item) => "managed-runtime: " + item));
  if (!managedRuntimeReadiness.ready) {
    warnings.push(`managed-runtime readiness: ${managedRuntimeReadiness.state} (${managedRuntimeReadiness.reasons.join(" ")})`);
  }
  if (repairPlan.executionStatus === "blocked" && repairPlan.executionBlocker) {
    warnings.push(`managed-runtime repair execution blocked: ${repairPlan.executionBlocker}`);
  }

  return {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    system: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      executionIsolationMode: isolationMode,
      localDataDirectoryConfigured: dataRootIsExplicit({ env }),
      hostedDatabaseConfigured: Boolean(env.DATABASE_URL?.trim()),
    },
    sp01Dependencies: SP01_DEPENDENCY_INVENTORY,
    runtimePacks: {
      catalog: P10_RUNTIME_PACKS.map((pack) => ({
        id: pack.id,
        defaultEnabled: pack.defaultEnabled,
        managedPackIds: pack.includedManagedPackIds,
        capabilities: pack.capabilities,
      })),
      installedReleasePackIds: state?.selectedReleasePackIds ?? [],
      installedManagedPackIds: state?.selectedPackIds ?? [],
      managedManifestVersion: state?.manifestVersion ?? null,
      hashVerified: state?.hashVerified ?? false,
      runtimePresent: Boolean(state),
      managedRuntimeReadiness,
      engineFabricCatalog: P11_PACK_CATALOG.map((pack) => ({
        id: pack.id,
        defaultInstalled: pack.defaultInstalled,
        runtimeKinds: pack.runtimeKinds,
        managedPackIds: pack.managedPackIds,
        capabilityCount: pack.capabilities.length,
        executableCapabilityCount: pack.availability.filter((item) => item.executionStatus === "available").length,
        plannedCapabilityCount: pack.availability.filter((item) => item.executionStatus === "planned").length,
        policyBlockedCapabilityCount: pack.availability.filter((item) => item.executionStatus === "policy_blocked").length,
        proofCapability: pack.proofCapability,
      })),
      engineFabricValidationErrors: p11PackErrors,
    },
    repairPlan,
    connectors: {
      builtInCount: BUILT_IN_CONNECTORS.length,
      adapterImplementedCount: BUILT_IN_CONNECTORS.filter((item) => item.adapterImplemented).length,
      catalogOnlyCount: BUILT_IN_CONNECTORS.filter((item) => !item.adapterImplemented).length,
      custodyModes: countBy(BUILT_IN_CONNECTORS.map((item) => item.custodyMode)),
      sourceTypes: countBy(BUILT_IN_CONNECTORS.map((item) => item.sourceType)),
      ids: BUILT_IN_CONNECTORS.map((item) => item.id),
      credentialValuesRead: false,
    },
    observability: {
      localEnabled: env.LIOS_OBSERVABILITY_LOCAL_ENABLED !== "false",
      localFileName: path.basename(p10ObservabilityPath()),
      localFilePresent: fs.existsSync(p10ObservabilityPath()),
      localDataDirectoryConfigured: dataRootIsExplicit({ env }),
      remoteEnabled: observability.enabled,
      remoteReason: observability.reason,
      openLineageLocalEnabled: lineage.localEnabled,
      openLineageRemoteEnabled: lineage.remoteEnabled,
      openLineageReason: lineage.reason,
      rawContentAllowed: false,
    },
    jobsAgents: {
      durableCalculationJobs: true,
      continuousIntelligenceWorkflows: true,
      canonicalAgentRuntime: true,
      tenantRecordsEnumerated: false,
      detail: "Authenticated UI/API owns tenant job/workflow inspection; the doctor command reports system capability only.",
    },
    dataDiagnostics: {
      universalDataFabric: true,
      canonicalLineage: true,
      providerHealthContracts: true,
      optionalLseProvider: BUILT_IN_CONNECTORS.some((item) => item.id === "lse"),
      externalProviderDataBundled: false,
    },
    releaseGovernance: {
      files: Object.fromEntries(governanceFiles.map((file) => [file, fs.existsSync(path.join(root, file))])),
      vulnerabilityAuditScriptPresent: fs.existsSync(path.join(root, "src", "script", "audit_production_dependencies.mjs")),
      p10ReleaseAuditPresent: fs.existsSync(path.join(root, "src", "script", "audit_p10_release.ts")),
    },
    warnings,
  };
}

function renderHuman(snapshot: LiosDoctorSnapshot, section: string | null): string {
  const sections: Record<string, unknown> = {
    system: snapshot.system,
    "runtime-packs": snapshot.runtimePacks,
    repair: snapshot.repairPlan,
    "sp01-dependencies": snapshot.sp01Dependencies,
    connectors: snapshot.connectors,
    observability: snapshot.observability,
    "jobs-agents": snapshot.jobsAgents,
    data: snapshot.dataDiagnostics,
    release: snapshot.releaseGovernance,
  };
  if (section) {
    if (!(section in sections)) throw new Error("Unknown doctor section: " + section);
    return `LiOS doctor · ${section}\n` + JSON.stringify(sections[section], null, 2);
  }
  const managedRuntime = snapshot.runtimePacks.managedRuntimeReadiness as { state?: string; repairAction?: string } | undefined;
  return [
    "LiOS doctor",
    `system: ${process.platform}/${process.arch} ${process.version}`,
    `runtime packs: ${P10_RUNTIME_PACKS.map((pack) => pack.id).join(", ")}`,
    `managed runtime core: ${managedRuntime?.state ?? "unknown"}${managedRuntime?.repairAction && managedRuntime.repairAction !== "none" ? ` (action: ${managedRuntime.repairAction})` : ""}`,
    `repair plan: ${snapshot.repairPlan.action} · ${snapshot.repairPlan.executionStatus}${snapshot.repairPlan.requiresConfirmation ? " (confirmation required)" : ""}`,
    `P11 engine packs: ${P11_PACK_CATALOG.map((pack) => pack.id).join(", ")}`,
    `connectors: ${BUILT_IN_CONNECTORS.length} built-in, ${BUILT_IN_CONNECTORS.filter((item) => item.adapterImplemented).length} implemented`,
    `observability remote: ${(snapshot.observability.remoteEnabled as boolean) ? "enabled (redacted-only)" : "disabled"}`,
    `OpenLineage remote: ${(snapshot.observability.openLineageRemoteEnabled as boolean) ? "enabled (fingerprinted-only)" : "disabled"}`,
    `jobs/agents: durable capability available; tenant records not enumerated`,
    `release governance: ${Object.values(snapshot.releaseGovernance.files as Record<string, boolean>).every(Boolean) ? "present" : "incomplete"}`,
    snapshot.warnings.length ? `warnings: ${snapshot.warnings.length}` : "warnings: none",
  ].join("\n");
}

const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  const json = process.argv.includes("--json");
  const sectionArg = process.argv.find((arg) => arg.startsWith("--section="));
  const section = sectionArg ? sectionArg.slice("--section=".length).trim() : null;
  const snapshot = buildLiosDoctorSnapshot();
  console.log(json ? JSON.stringify(snapshot, null, 2) : renderHuman(snapshot, section));
  if (snapshot.warnings.length) process.exitCode = 2;
}
