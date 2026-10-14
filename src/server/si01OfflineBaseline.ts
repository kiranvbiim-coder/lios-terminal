import {
  PROVIDER_OPERATOR_USER,
  PROVIDER_OPERATOR_VENDOR,
  homeProfileProviderIds,
} from "@shared/runtimeProviderContracts";
import { P6_FINANCE_WORKFLOWS } from "./p6FinanceWorkflow";
import {
  createHomeRuntimeSnapshot,
  homeProviderDescriptors,
} from "./runtimeProviders";

export type OfflineCapabilityState =
  | "required-local"
  | "deterministic-local"
  | "provider-dependent"
  | "optional-local";

export interface OfflineDependencyEntry {
  id: string;
  state: OfflineCapabilityState;
  owner: string;
  sourcePaths: readonly string[];
  behavior: string;
}

function entry(value: OfflineDependencyEntry): OfflineDependencyEntry {
  return Object.freeze({
    ...value,
    sourcePaths: Object.freeze([...value.sourcePaths]),
  });
}

/**
 * SI-01.15 is a truth inventory, not a second offline runtime. Entries point
 * at existing authorities and state what happens when remote provider egress
 * is unavailable.
 */
export const SI01_OFFLINE_DEPENDENCY_INVENTORY: readonly OfflineDependencyEntry[] = Object.freeze([
  entry({
    id: "home.database",
    state: "required-local",
    owner: "GM-04 database provider",
    sourcePaths: ["server/db.ts", "server/runtimeProviders.ts"],
    behavior: "Desktop Local uses embedded PGlite unless the user explicitly supplies PostgreSQL.",
  }),
  entry({
    id: "home.storage",
    state: "required-local",
    owner: "GM-05 storage provider",
    sourcePaths: ["server/projectAttachmentStore.ts", "server/runtimeProviders.ts"],
    behavior: "Desktop Local stores user data in local/user-owned storage.",
  }),
  entry({
    id: "home.identity",
    state: "required-local",
    owner: "GM-07 identity/session authority",
    sourcePaths: ["server/auth.ts", "server/sessionRestoration.ts"],
    behavior: "Local session identity can restore as authenticated_offline when an offline lease authorizes it.",
  }),
  entry({
    id: "home.license",
    state: "required-local",
    owner: "GM-07 signed offline licence authority",
    sourcePaths: ["server/licenseLease.ts", "server/runtimeProviders.ts"],
    behavior: "Entitlement is verified from a signed local/offline lease rather than a vendor runtime call.",
  }),
  entry({
    id: "home.execution",
    state: "required-local",
    owner: "GM-10 execution authority",
    sourcePaths: ["server/exec", "server/runtimeProviders.ts"],
    behavior: "Execution is owned by the user's Home; unsupported remote/runtime capability stays unavailable.",
  }),
  entry({
    id: "home.backup",
    state: "required-local",
    owner: "GM-06 backup authority",
    sourcePaths: ["server/backupArchive.ts", "server/backupService.ts"],
    behavior: "Verified backup/restore operates on local canonical state without vendor runtime dependency.",
  }),
  entry({
    id: "finance.personal",
    state: "deterministic-local",
    owner: "P6 personal-finance calculator",
    sourcePaths: ["server/p6PersonalFinance.ts", "server/p6FinanceRoutes.ts"],
    behavior: "User-owned inputs calculate locally and deterministically with AI/provider connectivity absent.",
  }),
  entry({
    id: "finance.local-decisions",
    state: "deterministic-local",
    owner: "P6 deterministic decision engines",
    sourcePaths: ["server/p6FinanceWorkflow.ts"],
    behavior: "Deterministic engines remain calculators of record; workflows needing external source data must not invent it.",
  }),
  entry({
    id: "external.market-data",
    state: "provider-dependent",
    owner: "P5 universal data fabric / market providers",
    sourcePaths: ["server/marketData.ts", "server/egressPolicy.ts"],
    behavior: "Cached/authorized stored data may be used with its real provenance; missing remote data stays missing when egress is offline.",
  }),
  entry({
    id: "external.web-research",
    state: "provider-dependent",
    owner: "P7 research/provider fabric",
    sourcePaths: ["server/researchSearch.ts", "server/researchService.ts", "server/egressPolicy.ts"],
    behavior: "Remote search/research transport is blocked by offline egress and must surface unavailable rather than fabricated evidence.",
  }),
  entry({
    id: "external.ai",
    state: "provider-dependent",
    owner: "BYOAI provider authority",
    sourcePaths: ["server/byoaiRouter.ts", "server/masterAiGate.ts", "server/egressPolicy.ts"],
    behavior: "Remote AI is optional/provider-dependent; deterministic local engines do not depend on it.",
  }),
  entry({
    id: "local.browser",
    state: "optional-local",
    owner: "P5 optional browser runtime",
    sourcePaths: ["server/playwrightBrowserAdapter.ts", "server/runtimeProviders.ts"],
    behavior: "Optional local browser runtime is not required for the deterministic offline baseline.",
  }),
]);

export function assertOfflineBaselineInventory(
  entries: readonly OfflineDependencyEntry[] = SI01_OFFLINE_DEPENDENCY_INVENTORY,
): void {
  const seen = new Set<string>();
  for (const item of entries) {
    if (seen.has(item.id)) throw new Error(`Duplicate SI-01.15 offline dependency: ${item.id}`);
    seen.add(item.id);
    if (!item.sourcePaths.length) throw new Error(`Offline dependency ${item.id} has no canonical source owner.`);
    if (!item.behavior.trim()) throw new Error(`Offline dependency ${item.id} has no explicit offline behavior.`);
  }

  const required = new Set(
    entries.filter((item) => item.state === "required-local").map((item) => item.id),
  );
  for (const id of [
    "home.database",
    "home.storage",
    "home.identity",
    "home.license",
    "home.execution",
    "home.backup",
  ]) {
    if (!required.has(id)) throw new Error(`Required offline Home authority is missing: ${id}`);
  }
}

export function assertDesktopLocalZeroVendorRuntime(
  env: NodeJS.ProcessEnv = {},
): void {
  const snapshot = createHomeRuntimeSnapshot({
    ...env,
    LIOS_RUNTIME_MODE: "desktop_local",
    LIOS_EGRESS_MODE: "offline",
    DATABASE_URL: "",
    LIOS_STORAGE_KIND: "local",
  });
  if (!snapshot.conformance.conformant) {
    throw new Error(
      "Desktop Local selected a non-conformant Home provider: " +
        JSON.stringify(snapshot.conformance.issues),
    );
  }

  const byId = new Map(homeProviderDescriptors().map((descriptor) => [descriptor.id, descriptor]));
  for (const { providerId } of homeProfileProviderIds(snapshot.profile)) {
    const descriptor = byId.get(providerId);
    if (!descriptor) throw new Error(`Selected Home provider is not registered: ${providerId}`);
    if (!descriptor.capabilities.includes(PROVIDER_OPERATOR_USER)) {
      throw new Error(`Selected Home provider is not declared user-operated: ${providerId}`);
    }
    if (descriptor.capabilities.includes(PROVIDER_OPERATOR_VENDOR)) {
      throw new Error(`Desktop Local depends on vendor-operated runtime provider: ${providerId}`);
    }
  }
}

export function offlineDeterministicFinanceFamilies(): string[] {
  return P6_FINANCE_WORKFLOWS
    .filter((workflow) => workflow.deterministic)
    .map((workflow) => workflow.family);
}
