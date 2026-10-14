export const SP03_PACKAGED_CHECK_IDS = [
  "sp03.signin",
  "sp03.project_chat",
  "sp03.canonical_identity",
  "sp03.multi_source_evidence",
  "sp03.rights_freshness_asof",
  "sp03.contradictions_gaps_unknowns",
  "sp03.truth_classification",
  "sp03.research_artifact",
  "sp03.lineage_inspection",
  "sp03.no_fake_success",
  "sp03.restart_reopen",
] as const;

export type Sp03PackagedCheckId = typeof SP03_PACKAGED_CHECK_IDS[number];

export interface Sp03PackagedCheck {
  id: Sp03PackagedCheckId;
  pass: boolean;
  detail: string;
}

export interface Sp03EvidenceSource {
  sourceRef: string;
  provider: string;
  sourceType: string;
  retrievedAt: string | null;
  observedAt: string | null;
  asOf: string | null;
  entitlement: "permitted" | "unentitled" | "unavailable" | "unknown";
}

export interface Sp03PackagedEvidence {
  schemaVersion: 1;
  generatedAt: string;
  commit: string;
  platform: string;
  app: string;
  subject: string;
  request: string;
  projectId: number | null;
  chatId: number | null;
  artifactId: string | null;
  artifactVersion: number | null;
  sources: Sp03EvidenceSource[];
  screenshots: string[];
  passed: boolean;
  checks: Sp03PackagedCheck[];
  error?: string;
}

export const SP03_DEFAULT_SUBJECT = "Microsoft Corporation";

export const SP03_DEFAULT_REQUEST = [
  "Research Microsoft Corporation as a real public-company topic using only sources I am permitted to use.",
  "Resolve the canonical entity before using provider or document evidence and do not invent an identifier.",
  "Use at least two materially independent permitted sources when available and preserve each source/provider identity, retrieval time, observation or as-of time, and entitlement posture.",
  "Separate observed facts, sourced estimates or guidance, explicit inference, and missing information.",
  "Call out material contradictions, evidence gaps, stale evidence, ambiguity, unavailable sources, and unknowns instead of smoothing them over.",
  "Create a durable cited Research Artifact in this Project with source refs and lineage for material claims or numbers.",
  "If a requested source is unavailable, unentitled, unsupported, or stale, say so explicitly and do not substitute guessed content.",
].join(" ");

export function hasCompleteSp03CheckSet(
  checks: readonly Pick<Sp03PackagedCheck, "id" | "pass">[],
): boolean {
  if (checks.length !== SP03_PACKAGED_CHECK_IDS.length) return false;
  const byId = new Map(checks.map((check) => [check.id, check] as const));
  if (byId.size !== SP03_PACKAGED_CHECK_IDS.length) return false;
  return SP03_PACKAGED_CHECK_IDS.every((id) => byId.get(id)?.pass === true);
}
