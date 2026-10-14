import crypto from "crypto";
import type {
  ResearchEvidence,
  ResearchEvidenceSnapshot,
  ResearchInvestigation,
  ResearchCitationSnapshot,
  ResearchSourceQuality,
  UserRole,
} from "@shared/schema";

export interface EvidenceFingerprintInput {
  provider: string;
  sourceExternalId?: string | null;
  sourceUrl?: string | null;
  title: string;
  publishedAt?: string | Date | null;
}

export interface NormalizedResearchResult {
  resultId: string;
  evidenceType: ResearchEvidence["evidenceType"];
  evidenceKind: ResearchEvidence["evidenceKind"];
  title: string;
  excerpt: string | null;
  sourceName: string;
  provider: string;
  sourceUrl: string | null;
  sourceExternalId: string | null;
  publishedAt: string | null;
  effectiveAt: string | null;
  retrievedAt: string;
  sourceQuality: ResearchSourceQuality;
  relevanceScore: number | null;
  metadata: Record<string, unknown>;
}

export interface ResearchBriefOutput {
  markdown: string;
  snapshot: ResearchEvidenceSnapshot[];
  snapshotHash: string;
  citations: ResearchCitationSnapshot[];
}

function canonical(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createEvidenceFingerprint(input: EvidenceFingerprintInput): string {
  const publishedAt = input.publishedAt instanceof Date
    ? input.publishedAt.toISOString()
    : input.publishedAt ?? "";
  const identity = [
    canonical(input.provider),
    canonical(input.sourceExternalId),
    canonical(input.sourceUrl),
    canonical(input.title),
    canonical(publishedAt),
  ].join("\u001f");

  return crypto.createHash("sha256").update(identity).digest("hex");
}

export function defaultSourceQuality(
  evidenceType: string,
  provider: string,
  hasDirectUrl: boolean,
): ResearchSourceQuality {
  const normalizedProvider = canonical(provider);
  const isPrimaryOfficial = evidenceType === "filing"
    || evidenceType === "official_data"
    || normalizedProvider.includes("sec edgar")
    || normalizedProvider.includes("fred")
    || normalizedProvider.includes("world bank")
    || normalizedProvider.includes("bls")
    || normalizedProvider.includes("cftc")
    || normalizedProvider.includes("nasa");
  const isDeterministicOutput = evidenceType === "model_output" || evidenceType === "market_data";

  return {
    authority: isPrimaryOfficial ? 1 : isDeterministicOutput ? 0.9 : evidenceType === "news" ? 0.65 : 0.5,
    directness: hasDirectUrl ? (isPrimaryOfficial ? 1 : 0.8) : 0.4,
    recency: 1,
    corroboration: 0.5,
    extractionConfidence: evidenceType === "internal_note" || evidenceType === "claim" ? 0.5 : 0.9,
  };
}

export function calculateSourceQualityScore(quality: ResearchSourceQuality): number {
  const score = quality.authority * 0.3
    + quality.directness * 0.25
    + quality.recency * 0.15
    + quality.corroboration * 0.15
    + quality.extractionConfidence * 0.15;
  return Math.round(score * 1000) / 1000;
}

export function canAccessResearchOrganization(
  role: UserRole,
  actorOrganizationId: number | null | undefined,
  resourceOrganizationId: number | null | undefined,
): boolean {
  if (role.startsWith("internal_")) return true;
  return actorOrganizationId != null && resourceOrganizationId === actorOrganizationId;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function snapshotEvidence(evidence: ResearchEvidence[]): ResearchEvidenceSnapshot[] {
  return [...evidence]
    .sort((a, b) => a.id - b.id)
    .map((item) => ({
      id: item.id,
      evidenceType: item.evidenceType,
      evidenceKind: item.evidenceKind,
      title: item.title,
      excerpt: item.excerpt,
      annotation: item.annotation,
      sourceName: item.sourceName,
      provider: item.provider,
      sourceUrl: item.sourceUrl,
      sourceExternalId: item.sourceExternalId,
      contentFingerprint: item.contentFingerprint,
      publishedAt: iso(item.publishedAt),
      effectiveAt: iso(item.effectiveAt),
      retrievedAt: iso(item.retrievedAt)!,
      sourceQuality: item.sourceQuality,
      relevanceScore: item.relevanceScore,
      metadata: item.metadata,
    }));
}

export function citationIssues(evidence: ResearchEvidenceSnapshot, now = new Date()): string[] {
  const issues: string[] = [];
  if (!evidence.sourceUrl && !["internal_note", "model_output"].includes(evidence.evidenceType)) issues.push("missing_source_url");
  if (!evidence.publishedAt && !evidence.effectiveAt) issues.push("missing_source_date");
  if (!evidence.sourceName.trim()) issues.push("missing_source_name");
  const sourceDate = evidence.effectiveAt ?? evidence.publishedAt;
  if (sourceDate && now.getTime() - new Date(sourceDate).getTime() > 365 * 24 * 60 * 60 * 1000) issues.push("stale_over_one_year");
  if (["claim", "interpretation", "unknown"].includes(evidence.evidenceKind) && !evidence.annotation && !evidence.excerpt) {
    issues.push("unsupported_claim");
  }
  return issues;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, "\\$&");
}

function briefSection(title: string, evidence: ResearchEvidenceSnapshot[], labels: Map<number, string>): string {
  if (!evidence.length) return `## ${title}\n\nNo saved evidence in this category.`;
  return `## ${title}\n\n${evidence.map((item) => {
    const body = item.annotation || item.excerpt || "No excerpt or analyst annotation was saved.";
    return `- **${escapeMarkdown(item.title)}** ${labels.get(item.id)}: ${body.trim()}`;
  }).join("\n")}`;
}

export function buildResearchBrief(
  investigation: Pick<ResearchInvestigation, "title" | "question" | "thesis" | "primarySymbol" | "subjectLabel">,
  evidence: ResearchEvidence[],
  now = new Date(),
): ResearchBriefOutput {
  const snapshot = snapshotEvidence(evidence);
  const labels = new Map(snapshot.map((item, index) => [item.id, `[E${index + 1}]`]));
  const citations = snapshot.map((item, index): ResearchCitationSnapshot => ({
    label: `[E${index + 1}]`,
    evidenceId: item.id,
    title: item.title,
    sourceName: item.sourceName,
    provider: item.provider,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    retrievedAt: item.retrievedAt,
    issues: citationIssues(item, now),
  }));
  const grouped = (kinds: string[]) => snapshot.filter((item) => kinds.includes(item.evidenceKind));
  const unknowns = snapshot.filter((item) => citationIssues(item, now).length > 0);
  const subject = investigation.subjectLabel || investigation.primarySymbol || "Not specified";
  const markdown = [
    `# ${escapeMarkdown(investigation.title)}`,
    `**Subject:** ${escapeMarkdown(subject)}`,
    `**Decision question:** ${investigation.question}`,
    `**Working thesis:** ${investigation.thesis || "No thesis recorded."}`,
    briefSection("Facts and calculations", grouped(["fact", "calculation"]), labels),
    briefSection("Claims and interpretations", grouped(["claim", "interpretation"]), labels),
    briefSection("Counterarguments", grouped(["counterargument"]), labels),
    briefSection("Gaps and source warnings", unknowns, labels),
    `## Citations\n\n${citations.length ? citations.map((citation) => {
      const date = citation.publishedAt?.slice(0, 10) ?? "undated";
      const link = citation.sourceUrl ? `, ${citation.sourceUrl}` : "";
      const warnings = citation.issues.length ? `; warnings: ${citation.issues.join(", ")}` : "";
      return `${citation.label} ${citation.sourceName}, “${citation.title},” ${date}, retrieved ${citation.retrievedAt.slice(0, 10)}${link}${warnings}.`;
    }).join("\n\n") : "No evidence has been saved."}`,
  ].join("\n\n");
  const snapshotHash = crypto.createHash("sha256").update(stableSerialize(snapshot)).digest("hex");
  return { markdown, snapshot, snapshotHash, citations };
}

export function compareEvidenceSnapshots(
  previous: ResearchEvidenceSnapshot[] | null,
  current: ResearchEvidence[],
  now = new Date(),
) {
  const currentSnapshot = snapshotEvidence(current);
  if (!previous) {
    return { baseline: false, added: currentSnapshot, removed: [], modified: [], newlyStale: [] };
  }
  const oldById = new Map(previous.map((item) => [item.id, item]));
  const currentById = new Map(currentSnapshot.map((item) => [item.id, item]));
  const added = currentSnapshot.filter((item) => !oldById.has(item.id));
  const removed = previous.filter((item) => !currentById.has(item.id));
  const modified = currentSnapshot.filter((item) => {
    const old = oldById.get(item.id);
    return old && stableSerialize(old) !== stableSerialize(item);
  });
  const staleBefore = new Set(previous.filter((item) => citationIssues(item, now).includes("stale_over_one_year")).map((item) => item.id));
  const newlyStale = currentSnapshot.filter((item) => citationIssues(item, now).includes("stale_over_one_year") && !staleBefore.has(item.id));
  return { baseline: true, added, removed, modified, newlyStale };
}

export const DEEP_RESEARCH_MAX_ITERATIONS = 3;

export type DeepResearchPlanState = "pending" | "covered";
export type DeepResearchEvidenceGapKind =
  | "no_evidence"
  | "missing_evidence_type"
  | "insufficient_source_diversity";
export type DeepResearchContinuationReason =
  | "gaps_remain"
  | "sufficient_evidence"
  | "budget_exhausted"
  | "inactive"
  | "no_plan";

export interface DeepResearchInvestigationInput {
  id: ResearchInvestigation["id"];
  title: string;
  question: string;
  thesis: string | null;
  status: string;
}

export interface DeepResearchPlanStep {
  order: number;
  evidenceType: ResearchEvidence["evidenceType"];
  objective: string;
  state: DeepResearchPlanState;
}

export interface DeepResearchEvidenceGap {
  kind: DeepResearchEvidenceGapKind;
  evidenceType?: ResearchEvidence["evidenceType"];
  message: string;
}

export interface DeepResearchSourceDiversity {
  distinctProviderCount: number;
  requiredMinimumProviders: number;
  sufficient: boolean;
}

export interface DeepResearchOrchestrationState {
  version: "1.0";
  investigationId: ResearchInvestigation["id"];
  researchObjective: string;
  plan: DeepResearchPlanStep[];
  observedEvidenceTypes: ResearchEvidence["evidenceType"][];
  observedProviders: string[];
  sourceDiversity: DeepResearchSourceDiversity;
  evidenceGaps: DeepResearchEvidenceGap[];
  maxIterations: number;
  iterationsUsed: number;
  iterationsRemaining: number;
  canContinue: boolean;
  continuationReason: DeepResearchContinuationReason;
}

function humanizeEvidenceType(evidenceType: ResearchEvidence["evidenceType"]): string {
  return evidenceType.replaceAll("_", " ");
}

export function buildDeepResearchOrchestration(args: {
  investigation: DeepResearchInvestigationInput;
  evidence: ResearchEvidence[];
  requiredEvidenceTypes: ResearchEvidence["evidenceType"][];
  iterationsUsed?: number;
}): DeepResearchOrchestrationState {
  const requiredEvidenceTypes = args.requiredEvidenceTypes.filter(
    (evidenceType, index, values) => values.indexOf(evidenceType) === index,
  );
  const scopedEvidence = args.evidence.filter(
    (item) => item.investigationId === args.investigation.id,
  );
  const observedEvidenceTypes = [...new Set(scopedEvidence.map((item) => item.evidenceType))]
    .sort((left, right) => left.localeCompare(right));
  const observedProviders = [...new Set(
    scopedEvidence
      .map((item) => item.provider.trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
  const coveredEvidenceTypes = new Set(observedEvidenceTypes);
  const plan = requiredEvidenceTypes.map((evidenceType, index): DeepResearchPlanStep => ({
    order: index + 1,
    evidenceType,
    objective: `Collect and assess ${humanizeEvidenceType(evidenceType)} evidence for: ${args.investigation.question}`,
    state: coveredEvidenceTypes.has(evidenceType) ? "covered" : "pending",
  }));

  const evidenceGaps: DeepResearchEvidenceGap[] = [];
  if (scopedEvidence.length === 0 && requiredEvidenceTypes.length > 0) {
    evidenceGaps.push({
      kind: "no_evidence",
      message: "No evidence has been saved for this investigation yet.",
    });
  }
  for (const evidenceType of requiredEvidenceTypes) {
    if (!coveredEvidenceTypes.has(evidenceType)) {
      evidenceGaps.push({
        kind: "missing_evidence_type",
        evidenceType,
        message: `Missing required ${humanizeEvidenceType(evidenceType)} evidence.`,
      });
    }
  }

  const requiredMinimumProviders = requiredEvidenceTypes.length >= 2 ? 2 : requiredEvidenceTypes.length;
  const sourceDiversitySufficient = requiredMinimumProviders === 0
    || observedProviders.length >= requiredMinimumProviders;
  if (scopedEvidence.length > 0 && !sourceDiversitySufficient) {
    evidenceGaps.push({
      kind: "insufficient_source_diversity",
      message: `Evidence currently spans ${observedProviders.length} distinct provider(s); ${requiredMinimumProviders} are required before synthesis.`,
    });
  }

  const rawIterationsUsed = Number.isFinite(args.iterationsUsed) ? Math.floor(args.iterationsUsed ?? 0) : 0;
  const iterationsUsed = Math.max(0, rawIterationsUsed);
  const iterationsRemaining = Math.max(0, DEEP_RESEARCH_MAX_ITERATIONS - iterationsUsed);
  const active = args.investigation.status === "active";
  const hasPlan = requiredEvidenceTypes.length > 0;
  const gapsRemain = evidenceGaps.length > 0;
  const budgetRemaining = iterationsRemaining > 0;

  let continuationReason: DeepResearchContinuationReason;
  if (!active) continuationReason = "inactive";
  else if (!hasPlan) continuationReason = "no_plan";
  else if (!budgetRemaining) continuationReason = "budget_exhausted";
  else if (!gapsRemain) continuationReason = "sufficient_evidence";
  else continuationReason = "gaps_remain";

  return {
    version: "1.0",
    investigationId: args.investigation.id,
    researchObjective: args.investigation.question,
    plan,
    observedEvidenceTypes,
    observedProviders,
    sourceDiversity: {
      distinctProviderCount: observedProviders.length,
      requiredMinimumProviders,
      sufficient: sourceDiversitySufficient,
    },
    evidenceGaps,
    maxIterations: DEEP_RESEARCH_MAX_ITERATIONS,
    iterationsUsed,
    iterationsRemaining,
    canContinue: continuationReason === "gaps_remain",
    continuationReason,
  };
}
