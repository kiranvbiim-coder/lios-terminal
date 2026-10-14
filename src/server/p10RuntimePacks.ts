import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";

export const P10_RUNTIME_PACK_IDS = ["core", "research", "quant", "modeling", "data-lab", "local-ai"] as const;
export type P10RuntimePackId = typeof P10_RUNTIME_PACK_IDS[number];
export const P10_OPTIONAL_MANAGED_ADDON_IDS = ["community-yahoo"] as const;
export type P10OptionalManagedAddonId = typeof P10_OPTIONAL_MANAGED_ADDON_IDS[number];

export interface P10RuntimePackDefinition {
  id: P10RuntimePackId;
  name: string;
  description: string;
  includedManagedPackIds: string[];
  capabilities: string[];
  defaultEnabled: boolean;
  requiresNetwork: boolean;
  requiresUserCredential: boolean;
  releaseNotes: string[];
}

export const P10_RUNTIME_PACKS: readonly P10RuntimePackDefinition[] = Object.freeze([
  {
    id: "core",
    name: "Core",
    description: "LiOS desktop/runtime foundation with deterministic statistics, portfolio analytics and local-first Project workflows.",
    includedManagedPackIds: ["core"],
    capabilities: ["projects", "artifacts", "statistics", "portfolio", "deterministic-core"],
    defaultEnabled: true,
    requiresNetwork: false,
    requiresUserCredential: false,
    releaseNotes: ["Always present.", "No hosted data credential is bundled."],
  },
  {
    id: "research",
    name: "Research",
    description: "SEC research and optional local document intelligence for evidence-linked Project research.",
    includedManagedPackIds: ["research-sec", "research-docs"],
    capabilities: ["sec-search", "document-intelligence", "research-graph", "thesis-refresh"],
    defaultEnabled: false,
    requiresNetwork: true,
    requiresUserCredential: false,
    releaseNotes: ["SEC access follows sec.gov policy.", "Docling remains an opt-in local package."],
  },
  {
    id: "quant",
    name: "Quant",
    description: "Fixed income, econometrics, forecasting, optimization and machine-learning engines.",
    includedManagedPackIds: ["fixed-income", "econometrics", "forecasting", "optimization", "ml"],
    capabilities: ["fixed-income", "econometrics", "forecasting", "optimization", "machine-learning", "risk"],
    defaultEnabled: false,
    requiresNetwork: false,
    requiresUserCredential: false,
    releaseNotes: ["Uses the signed managed-runtime allow-list.", "No provider data is bundled."],
  },
  {
    id: "modeling",
    name: "Modeling",
    description: "Scenario, valuation and formula/model-change workflows backed by deterministic engines.",
    includedManagedPackIds: ["fixed-income", "optimization"],
    capabilities: ["valuation", "scenario-branching", "formula-studio", "model-change-review"],
    defaultEnabled: false,
    requiresNetwork: false,
    requiresUserCredential: false,
    releaseNotes: ["Builds on P6/P8 deterministic engines.", "AI remains explanatory/proposal-only unless explicitly approved."],
  },
  {
    id: "data-lab",
    name: "Data Lab",
    description: "Advanced local data preparation, high-volume analysis and provider-connected experimentation.",
    includedManagedPackIds: ["econometrics", "forecasting", "optimization", "ml"],
    capabilities: ["data-fabric", "duckdb", "high-volume", "experimentation", "lineage"],
    defaultEnabled: false,
    requiresNetwork: false,
    requiresUserCredential: false,
    releaseNotes: ["Provider connectors remain BYOD/user-owned.", "External provider terms remain separate from LiOS code licensing."],
  },
  {
    id: "local-ai",
    name: "Local AI",
    description: "BYO/local AI capability pack. LiOS does not silently download or bundle a model.",
    includedManagedPackIds: [],
    capabilities: ["byoai", "local-model", "agent-runtime"],
    defaultEnabled: false,
    requiresNetwork: false,
    requiresUserCredential: false,
    releaseNotes: ["User supplies the local model/runtime.", "Master AI switch and Project approvals remain authoritative."],
  },
]);

const LOW_LEVEL_IDS = new Set(MANAGED_RUNTIME_MANIFEST.packs.map((pack) => pack.id));

export function validateP10RuntimePackCatalog(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const pack of P10_RUNTIME_PACKS) {
    if (ids.has(pack.id)) errors.push("Duplicate P10 runtime pack id: " + pack.id);
    ids.add(pack.id);
    for (const lowLevel of pack.includedManagedPackIds) {
      if (!LOW_LEVEL_IDS.has(lowLevel)) errors.push(`P10 runtime pack ${pack.id} references unknown managed pack ${lowLevel}.`);
    }
  }
  for (const id of P10_RUNTIME_PACK_IDS) if (!ids.has(id)) errors.push("Missing canonical P10 runtime pack: " + id);
  const defaults = P10_RUNTIME_PACKS.filter((pack) => pack.defaultEnabled).map((pack) => pack.id);
  if (defaults.length !== 1 || defaults[0] !== "core") errors.push("Only Core may be enabled by default.");
  return errors;
}

export function expandP10RuntimePacks(ids: readonly P10RuntimePackId[]): string[] {
  const requested = new Set<P10RuntimePackId>(ids);
  requested.add("core");
  const lowLevel = new Set<string>();
  for (const pack of P10_RUNTIME_PACKS) {
    if (!requested.has(pack.id)) continue;
    for (const id of pack.includedManagedPackIds) lowLevel.add(id);
  }
  lowLevel.add("core");
  return [...lowLevel];
}

export function p10RuntimePackById(id: P10RuntimePackId): P10RuntimePackDefinition {
  const pack = P10_RUNTIME_PACKS.find((item) => item.id === id);
  if (!pack) throw new Error("Unknown P10 runtime pack: " + id);
  return pack;
}
