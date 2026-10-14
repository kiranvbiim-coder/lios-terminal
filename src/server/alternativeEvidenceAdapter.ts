import {
  normalizedAlternativeEvidenceSchema,
  type AlternativeEvidenceBlockReason,
  type AlternativeEvidenceClass,
  type AlternativeEvidenceIdentity,
  type AlternativeEvidenceRights,
  type NormalizedAlternativeEvidence,
} from "@shared/alternativeEvidence";
import type { AlternativeSnapshotInput } from "@shared/pointInTimeAlternativeData";
import {
  getAlternativeDatasetAsOf,
  listAlternativeDatasets,
} from "./alternativeDatasetStore";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";
import type { TenantContext } from "./tenantContext";

export type AlternativeSnapshot = Awaited<ReturnType<typeof listAlternativeDatasets>>[number];

type Preview = NormalizedAlternativeEvidence["preview"];

type Quality = {
  score?: unknown;
  recordCount?: unknown;
  missingOptionalFields?: unknown;
};

function evidenceClass(dataClass: AlternativeSnapshot["dataClass"]): AlternativeEvidenceClass {
  if (dataClass === "private_series") return "private_market";
  if (dataClass === "portfolio_holdings") return "user_owned";
  return "alternative_data";
}

function safeQuality(value: unknown): { score: number | null; recordCount: number; missingOptionalFields: number } {
  const quality = value && typeof value === "object" && !Array.isArray(value) ? value as Quality : {};
  const score = typeof quality.score === "number" && Number.isFinite(quality.score)
    ? Math.max(0, Math.min(1, quality.score))
    : null;
  return {
    score,
    recordCount: typeof quality.recordCount === "number" && Number.isInteger(quality.recordCount) && quality.recordCount >= 0 ? quality.recordCount : 0,
    missingOptionalFields: typeof quality.missingOptionalFields === "number" && Number.isInteger(quality.missingOptionalFields) && quality.missingOptionalFields >= 0 ? quality.missingOptionalFields : 0,
  };
}

export function alternativeEvidenceRightsFromPolicy(
  policy: Awaited<ReturnType<typeof getEntitlementPolicyById>>,
): AlternativeEvidenceRights {
  if (!policy || !policy.reviewedAt) {
    return {
      entitlement: {
        decision: "unknown",
        policyId: policy?.id ?? null,
        permittedUses: [],
        reasons: [policy
          ? "Snapshot entitlement policy has not been formally reviewed; rights remain unknown."
          : "Snapshot entitlement policy is unavailable; rights remain unknown."],
      },
      aiTransmission: "unknown",
      internalUse: "unknown",
      redistribution: "unknown",
      policyReviewed: false,
      attribution: null,
    };
  }

  const uses = new Set(policy.permittedUses ?? []);
  const internalUse = uses.has("internal_research") ? "permitted" as const : "restricted" as const;
  const aiTransmission = uses.has("model_input") ? "permitted" as const : "restricted" as const;
  const redistribution = policy.redistribution === "unknown"
    ? "unknown" as const
    : policy.accessScope === "redistributable" && (policy.redistribution === "allowed" || policy.redistribution === "attribution_required")
      ? "permitted" as const
      : "restricted" as const;

  return {
    entitlement: {
      decision: internalUse === "permitted" ? "allowed" : "denied",
      policyId: policy.id,
      permittedUses: [...(policy.permittedUses ?? [])],
      reasons: internalUse === "permitted"
        ? ["Reviewed snapshot policy explicitly permits internal research."]
        : ["Reviewed snapshot policy does not permit internal research."],
    },
    aiTransmission,
    internalUse,
    redistribution,
    policyReviewed: true,
    attribution: policy.attribution ?? null,
  };
}

function identityQuery(snapshot: AlternativeSnapshot): { kind: "name" | "ticker" | "none"; query: { name: string } | { ticker: string } | null } {
  if (snapshot.dataClass === "portfolio_holdings") return { kind: "none", query: null };
  if (snapshot.dataClass === "options_chain" || snapshot.dataClass === "estimates") {
    return { kind: "ticker", query: { ticker: snapshot.entityKey } };
  }
  return { kind: "name", query: { name: snapshot.entityKey } };
}

async function resolveIdentity(snapshot: AlternativeSnapshot): Promise<AlternativeEvidenceIdentity> {
  const lookup = identityQuery(snapshot);
  if (!lookup.query) {
    return {
      state: "not_applicable",
      queryKind: "none",
      entityKey: snapshot.entityKey,
      entityId: null,
      securityId: null,
      listingId: null,
      name: null,
    };
  }
  const result = await resolvePersistedInstrument(lookup.query);
  if (result.status === "resolved" && result.match?.entityId) {
    return {
      state: "resolved",
      queryKind: lookup.kind,
      entityKey: snapshot.entityKey,
      entityId: result.match.entityId,
      securityId: result.match.securityId ?? null,
      listingId: result.match.listingId ?? null,
      name: result.match.name,
    };
  }
  return {
    state: result.status === "ambiguous" ? "ambiguous" : "not_found",
    queryKind: lookup.kind,
    entityKey: snapshot.entityKey,
    entityId: null,
    securityId: null,
    listingId: null,
    name: null,
  };
}

function boundedLines(lines: string[], totalRecords: number, limit: number): Preview {
  const shown = lines.slice(0, limit);
  return {
    text: shown.join("\n").slice(0, 12_000),
    totalRecords,
    shownRecords: shown.length,
    truncated: totalRecords > shown.length,
  };
}

function preview(snapshot: AlternativeSnapshot, limit = 20): Preview {
  switch (snapshot.dataClass) {
    case "private_series": {
      const payload = snapshot.payload as Extract<AlternativeSnapshotInput, { dataClass: "private_series" }>["payload"];
      const rows = [...payload.observations]
        .sort((a, b) => b.observationAt.localeCompare(a.observationAt) || b.availableAt.localeCompare(a.availableAt))
        .map((row) => `${row.observationAt} | ${row.value} ${payload.unit} | available ${row.availableAt}`);
      const dimensions = Object.entries(payload.dimensions).sort(([a], [b]) => a.localeCompare(b));
      const header = [
        `series=${payload.seriesId}`,
        `name=${payload.name}`,
        `frequency=${payload.frequency}`,
        ...dimensions.map(([key, value]) => `${key}=${value}`),
      ].join(" | ");
      const body = boundedLines(rows, payload.observations.length, limit);
      return { ...body, text: [header, body.text].filter(Boolean).join("\n").slice(0, 12_000) };
    }
    case "options_chain": {
      const payload = snapshot.payload as Extract<AlternativeSnapshotInput, { dataClass: "options_chain" }>["payload"];
      const rows = [...payload.contracts]
        .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike || a.type.localeCompare(b.type) || a.contractSymbol.localeCompare(b.contractSymbol))
        .map((row) => `${row.contractSymbol} | ${row.type} | strike=${row.strike} | expiry=${row.expiry} | bid=${row.bid ?? "unknown"} | ask=${row.ask ?? "unknown"} | last=${row.last ?? "unknown"} | iv=${row.impliedVolatility ?? "unknown"}`);
      const body = boundedLines(rows, payload.contracts.length, limit);
      return { ...body, text: [`underlying=${payload.underlying}`, body.text].filter(Boolean).join("\n").slice(0, 12_000) };
    }
    case "commodity_curve": {
      const payload = snapshot.payload as Extract<AlternativeSnapshotInput, { dataClass: "commodity_curve" }>["payload"];
      const rows = [...payload.points]
        .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.contract.localeCompare(b.contract))
        .map((row) => `${row.contract} | expiry=${row.expiry} | observation=${row.observationAt} | price=${row.price} ${row.currency}/${row.unit} | settlement=${row.settlementType}`);
      const body = boundedLines(rows, payload.points.length, limit);
      return { ...body, text: [`commodity=${payload.commodity}`, body.text].filter(Boolean).join("\n").slice(0, 12_000) };
    }
    case "portfolio_holdings": {
      const payload = snapshot.payload as Extract<AlternativeSnapshotInput, { dataClass: "portfolio_holdings" }>["payload"];
      const rows = [...payload.holdings]
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || String(a.taxLotId ?? "").localeCompare(String(b.taxLotId ?? "")))
        .map((row) => `${row.symbol} | quantity=${row.quantity} | costBasis=${row.costBasis ?? "unknown"} | marketPrice=${row.marketPrice ?? "unknown"} | marketValue=${row.marketValue ?? "unknown"} ${row.currency}`);
      const body = boundedLines(rows, payload.holdings.length, limit);
      return { ...body, text: [`portfolio=${payload.name} | asOf=${payload.asOf} | baseCurrency=${payload.baseCurrency}`, body.text].filter(Boolean).join("\n").slice(0, 12_000) };
    }
    case "estimates": {
      const payload = snapshot.payload as Extract<AlternativeSnapshotInput, { dataClass: "estimates" }>["payload"];
      const rows = [...payload.observations]
        .sort((a, b) => b.availableAt.localeCompare(a.availableAt) || a.metric.localeCompare(b.metric) || a.contributor.localeCompare(b.contributor))
        .map((row) => `${row.metric} | ${row.fiscalPeriod} | ${row.contributor} | value=${row.value} ${row.unit} | available=${row.availableAt}`);
      const body = boundedLines(rows, payload.observations.length, limit);
      return { ...body, text: [`symbol=${payload.symbol} | generic snapshot only; analyst/recommendation semantics remain SI-03.29-owned`, body.text].filter(Boolean).join("\n").slice(0, 12_000) };
    }
  }
}

export function blockReasonForAlternativeEvidence(
  rights: AlternativeEvidenceRights,
): AlternativeEvidenceBlockReason | null {
  if (rights.entitlement.decision === "denied") return "entitlement_denied";
  if (rights.entitlement.decision === "unknown") return "entitlement_unknown";
  if (rights.internalUse === "restricted") return "internal_use_restricted";
  if (rights.internalUse === "unknown") return "internal_use_unknown";
  if (rights.aiTransmission === "restricted") return "ai_transmission_restricted";
  if (rights.aiTransmission === "unknown") return "ai_transmission_unknown";
  return null;
}

export function buildNormalizedAlternativeEvidence(input: {
  snapshot: AlternativeSnapshot;
  policy: Awaited<ReturnType<typeof getEntitlementPolicyById>>;
  identity: AlternativeEvidenceIdentity;
  previewLimit?: number;
}): NormalizedAlternativeEvidence {
  const { snapshot, policy, identity } = input;
  const quality = safeQuality(snapshot.quality);
  return normalizedAlternativeEvidenceSchema.parse({
    evidenceClass: evidenceClass(snapshot.dataClass),
    dataClass: snapshot.dataClass,
    snapshotRef: `snapshot:${snapshot.id}`,
    parentSnapshotRef: snapshot.parentSnapshotId ? `snapshot:${snapshot.parentSnapshotId}` : null,
    providerId: snapshot.provider,
    sourceId: snapshot.source,
    entityKey: snapshot.entityKey,
    identity,
    clocks: {
      effectiveAt: snapshot.effectiveAt,
      publishedAt: snapshot.publishedAt,
      retrievedAt: snapshot.retrievedAt,
      availableAt: snapshot.availableAt,
    },
    provenance: {
      contentHash: snapshot.contentHash,
      lineageHash: stableSnapshotHash(snapshot.lineage ?? {}),
      entitlementPolicyId: snapshot.entitlementPolicyId,
      qualityScore: quality.score,
      recordCount: quality.recordCount,
      missingOptionalFields: quality.missingOptionalFields,
    },
    rights: alternativeEvidenceRightsFromPolicy(policy),
    preview: preview(snapshot, input.previewLimit ?? 20),
  });
}

export async function normalizeAlternativeSnapshotEvidence(
  snapshot: AlternativeSnapshot,
  previewLimit = 20,
): Promise<NormalizedAlternativeEvidence> {
  const policy = snapshot.entitlementPolicyId
    ? await getEntitlementPolicyById(snapshot.entitlementPolicyId)
    : null;
  const identity = await resolveIdentity(snapshot);
  return buildNormalizedAlternativeEvidence({ snapshot, policy, identity, previewLimit });
}

export async function loadAlternativeEvidence(input: {
  tenant: TenantContext;
  dataClasses: AlternativeSnapshot["dataClass"][];
  entityKey?: string;
  asOf?: string;
  limitPerClass: number;
  previewLimit: number;
}): Promise<NormalizedAlternativeEvidence[]> {
  const results: NormalizedAlternativeEvidence[] = [];
  for (const dataClass of input.dataClasses) {
    const snapshots = input.asOf && input.entityKey
      ? [await getAlternativeDatasetAsOf(dataClass, input.entityKey, new Date(input.asOf), input.tenant.organizationId)].filter((row): row is AlternativeSnapshot => Boolean(row))
      : await listAlternativeDatasets(dataClass, input.entityKey, input.tenant.organizationId, input.limitPerClass);
    for (const snapshot of snapshots) {
      results.push(await normalizeAlternativeSnapshotEvidence(snapshot, input.previewLimit));
    }
  }
  return results.sort((a, b) =>
    b.clocks.availableAt.localeCompare(a.clocks.availableAt)
    || a.dataClass.localeCompare(b.dataClass)
    || a.snapshotRef.localeCompare(b.snapshotRef)
  );
}
