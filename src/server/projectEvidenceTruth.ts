export const SOURCE_QUALITY_TIERS = [
  "authority",
  "regulatory_filing",
  "first_party",
  "provider_data",
  "owner_provided",
  "secondary_publication",
  "community",
  "unverified_web",
  "unknown",
] as const;
export type SourceQualityTier = (typeof SOURCE_QUALITY_TIERS)[number];

const FRESHNESS_HORIZON_DAYS: Record<string, number> = {
  claim: 90,
  filing: 400,
  provider: 7,
};

export type ProjectEvidenceKnowledgeClassification = "known" | "qualified";

export type ProjectEvidenceKnowledgePosture = {
  classification: ProjectEvidenceKnowledgeClassification;
  qualifiers: string[];
};

export type ProjectEvidenceTruthPosture = {
  temporal: {
    observedAt: string | null;
    retrievedAt: string | null;
    publishedAt: string | null;
    effectiveAt: string | null;
    asOfAt: string | null;
    asOfBasis: "effective_at" | "published_at" | "observed_at" | "unknown";
    modelPeriod: string | null;
  };
  sourceQuality: {
    originClass: string | null;
    evidenceKind: string | null;
    tier: SourceQualityTier;
    claimVerification: "not_verified_by_digest";
  };
  freshness: {
    state: "fresh" | "stale" | "unknown";
    basis: "declared" | "computed_horizon" | "none";
    assessedAt: string | null;
    reason: string | null;
  };
  access: {
    availability: "available" | "unavailable" | "inaccessible" | "unknown";
    entitlement: "entitled" | "unentitled" | "unknown";
  };
  certainty: "verified" | "uncertain" | "disputed" | "unknown";
  unknowns: string[];
  knowledge: ProjectEvidenceKnowledgePosture;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function inferTier(
  metadata: Record<string, unknown>,
  originClass: string | null,
  evidenceKind: string | null,
): SourceQualityTier {
  const declared = oneOf(metadata.sourceTier, SOURCE_QUALITY_TIERS);
  if (declared) return declared;
  if (originClass === "authority") return "authority";
  if (originClass === "first_party") return "first_party";
  if (originClass === "secondary") return "secondary_publication";
  if (originClass === "community") return "community";
  if (evidenceKind === "filing") return "regulatory_filing";
  if (originClass === "owner") return "owner_provided";
  if (originClass === "provider") return "provider_data";
  if (originClass === "untrusted") return "unverified_web";
  return "unknown";
}

export function deriveProjectEvidenceKnowledge(
  truth: Omit<ProjectEvidenceTruthPosture, "knowledge">,
): ProjectEvidenceKnowledgePosture {
  const qualifiers: string[] = [];
  if (truth.certainty !== "verified") qualifiers.push(`certainty:${truth.certainty}`);
  if (truth.freshness.state !== "fresh") qualifiers.push(`freshness:${truth.freshness.state}`);
  if (truth.access.availability !== "available") qualifiers.push(`availability:${truth.access.availability}`);
  if (truth.access.entitlement !== "entitled") qualifiers.push(`entitlement:${truth.access.entitlement}`);

  // A model/fiscal period is applicable only to some evidence kinds, so its absence remains
  // explicit truth metadata without by itself downgrading otherwise-known evidence.
  const representedUnknowns = new Set([
    "freshness",
    "availability",
    "entitlement",
    "certainty",
    "model_period",
  ]);
  for (const item of truth.unknowns) {
    if (!representedUnknowns.has(item)) qualifiers.push(`unknown:${item}`);
  }

  return {
    classification: qualifiers.length === 0 ? "known" : "qualified",
    qualifiers: [...new Set(qualifiers)],
  };
}

export function buildProjectEvidenceTruth(input: {
  now?: Date;
  observedAt?: string | null;
  metadata?: Record<string, unknown> | null;
}): ProjectEvidenceTruthPosture {
  const metadata = input.metadata ?? {};
  const observedAt = nonEmptyString(input.observedAt);
  const retrievedAt = nonEmptyString(metadata.retrievedAt);
  const publishedAt = nonEmptyString(metadata.publishedAt);
  const effectiveAt = nonEmptyString(metadata.effectiveAt);
  const modelPeriod = nonEmptyString(metadata.modelPeriod);
  const originClass = nonEmptyString(metadata.originClass);
  const evidenceKind = nonEmptyString(metadata.evidenceKind);
  const declaredFreshness = oneOf(metadata.freshnessState, ["fresh", "stale", "unknown"] as const);
  const availability = oneOf(
    metadata.availabilityState,
    ["available", "unavailable", "inaccessible", "unknown"] as const,
  ) ?? "unknown";
  const entitlement = oneOf(metadata.entitlementState, ["entitled", "unentitled", "unknown"] as const) ?? "unknown";
  const certainty = oneOf(metadata.certaintyState, ["verified", "uncertain", "disputed", "unknown"] as const) ?? "unknown";

  let asOfAt: string | null = null;
  let asOfBasis: ProjectEvidenceTruthPosture["temporal"]["asOfBasis"] = "unknown";
  if (effectiveAt) {
    asOfAt = effectiveAt;
    asOfBasis = "effective_at";
  } else if (publishedAt) {
    asOfAt = publishedAt;
    asOfBasis = "published_at";
  } else if (observedAt) {
    asOfAt = observedAt;
    asOfBasis = "observed_at";
  }

  let freshnessState = declaredFreshness ?? "unknown";
  let freshnessBasis: ProjectEvidenceTruthPosture["freshness"]["basis"] =
    declaredFreshness && declaredFreshness !== "unknown" ? "declared" : "none";
  let computedReason: string | null = null;
  const horizon = evidenceKind ? FRESHNESS_HORIZON_DAYS[evidenceKind] : undefined;
  const parsedAsOf = asOfAt ? Date.parse(asOfAt) : Number.NaN;
  if (freshnessBasis === "none" && horizon !== undefined && Number.isFinite(parsedAsOf)) {
    const now = input.now ?? new Date();
    const ageDays = (now.getTime() - parsedAsOf) / 86_400_000;
    freshnessState = ageDays > horizon ? "stale" : "fresh";
    freshnessBasis = "computed_horizon";
    computedReason = `as-of age ${Math.max(0, Math.floor(ageDays))}d vs ${horizon}d horizon for ${evidenceKind}`;
  }

  const tier = inferTier(metadata, originClass, evidenceKind);
  const unknowns: string[] = [];
  if (!observedAt) unknowns.push("observed_at");
  if (!retrievedAt) unknowns.push("retrieved_at");
  if (!publishedAt) unknowns.push("published_at");
  if (!effectiveAt) unknowns.push("effective_at");
  if (!modelPeriod) unknowns.push("model_period");
  if (tier === "unknown") unknowns.push("source_quality");
  if (freshnessState === "unknown") unknowns.push("freshness");
  if (availability === "unknown") unknowns.push("availability");
  if (entitlement === "unknown") unknowns.push("entitlement");
  if (certainty === "unknown") unknowns.push("certainty");

  const truth: Omit<ProjectEvidenceTruthPosture, "knowledge"> = {
    temporal: {
      observedAt,
      retrievedAt,
      publishedAt,
      effectiveAt,
      asOfAt,
      asOfBasis,
      modelPeriod,
    },
    sourceQuality: {
      originClass,
      evidenceKind,
      tier,
      claimVerification: "not_verified_by_digest",
    },
    freshness: {
      state: freshnessState,
      basis: freshnessBasis,
      assessedAt: nonEmptyString(metadata.freshnessAssessedAt)
        ?? (freshnessBasis === "computed_horizon" ? (input.now ?? new Date()).toISOString() : null),
      reason: nonEmptyString(metadata.freshnessReason) ?? computedReason,
    },
    access: { availability, entitlement },
    certainty,
    unknowns,
  };

  return {
    ...truth,
    knowledge: deriveProjectEvidenceKnowledge(truth),
  };
}

export function formatProjectEvidenceTruthSummary(truth: ProjectEvidenceTruthPosture): string {
  const basis = truth.temporal.asOfBasis === "effective_at"
    ? "effective"
    : truth.temporal.asOfBasis === "published_at"
      ? "published"
      : truth.temporal.asOfBasis === "observed_at"
        ? "observed"
        : null;
  const parts = [
    truth.temporal.asOfAt && basis ? `As-of ${basis} ${truth.temporal.asOfAt}` : "As-of unknown",
    truth.temporal.retrievedAt ? `retrieved ${truth.temporal.retrievedAt}` : "retrieval time unknown",
    truth.temporal.effectiveAt ? `effective ${truth.temporal.effectiveAt}` : "effective date unknown",
    `source quality ${truth.sourceQuality.tier} (${truth.sourceQuality.originClass ?? "origin unknown"})`,
    truth.temporal.modelPeriod ? `period ${truth.temporal.modelPeriod}` : "period unknown",
    `freshness ${truth.freshness.state}${truth.freshness.basis === "computed_horizon" ? " (computed)" : ""}`,
    `availability ${truth.access.availability}`,
    `entitlement ${truth.access.entitlement}`,
    `certainty ${truth.certainty}`,
    `knowledge ${truth.knowledge.classification}`,
    truth.knowledge.qualifiers.length ? `qualifiers ${truth.knowledge.qualifiers.join(",")}` : "qualifiers none",
    "claim not verified by deterministic digest",
  ];
  return parts.join("; ");
}
