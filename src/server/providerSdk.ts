import crypto from "node:crypto";
import {
  canonicalDataRequestSchema,
  canonicalDataResponseSchema,
  providerAccessProfileSchema,
  providerAccessPostureSchema,
  structuredDataGapSchema,
  type CanonicalDataCapability,
  type CanonicalDataRequest,
  type CanonicalDataResponse,
  type ProviderAccessPosture,
  type ProviderAccessProfile,
  type ProviderAttempt,
  type ProviderEntitlementDecision,
  type ProviderHealth,
  type ProviderObservation,
  type ProviderQuota,
  type StreamingLifecycle,
} from "@shared/universalDataFabric";
import type { TenantContext } from "./tenantContext";
import { getQuotes, getForexQuotes } from "./marketData";
import { resolveFinancialStatements } from "./financialStatementsBroker";
import { getAlternativeDatasetAsOf, listAlternativeDatasets } from "./alternativeDatasetStore";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";
import { openFigiInstrumentFallback } from "./openFigiConnector";
import { searchCommonInstrumentUniverse } from "./instrumentSearchIndexStore";
import { getCompanyFilings } from "./secEdgarData";
import { getIndicatorQuote, getYieldCurve } from "./fredData";
import { getFinancialDatasetAsOf } from "./pointInTimeDatasetStore";
import { getEconomicDatasetAsOf } from "./economicDatasetStore";
import { createLseDataProviderAdapter } from "./lseDataProvider";
import { createEcbDataProviderAdapter } from "./ecbDataProvider";
import { createOecdDataProviderAdapter } from "./oecdDataProvider";
import { createImfDataProviderAdapter } from "./imfDataProvider";
import { guardProviderStreamEntitlement, type ManagedProviderStreamSubscription } from "./providerStreamEntitlement";

export interface ProviderAdapterResult {
  providerId?: string;
  data: unknown;
  sourceRefs?: string[];
  effectiveAt?: string | null;
  publishedAt?: string | null;
  availableAt?: string | null;
  revision?: string | null;
  quota?: ProviderQuota | null;
  entitlement?: ProviderEntitlementDecision;
  normalized?: boolean;
  warnings?: string[];
}

export interface ProviderSearchRequest {
  query: string;
  capability?: CanonicalDataCapability;
  limit?: number;
}

export interface ProviderSearchResult {
  providerId: string;
  rows: unknown[];
  sourceRefs: string[];
}

export interface ProviderStreamSubscription {
  lifecycle: StreamingLifecycle;
  stop(): Promise<void>;
}

export interface LiOSDataProviderAdapter {
  id: string;
  label: string;
  priority: number;
  capabilities: readonly CanonicalDataCapability[];
  pointInTimeModes: ReadonlyArray<CanonicalDataRequest["pointInTime"]["mode"]>;
  access?: ProviderAccessProfile;
  fetch(request: CanonicalDataRequest, context: TenantContext): Promise<ProviderAdapterResult | null>;
  search?(request: ProviderSearchRequest, context: TenantContext): Promise<ProviderSearchResult>;
  stream?(request: CanonicalDataRequest, context: TenantContext): Promise<ProviderStreamSubscription>;
  normalize?(data: unknown, request: CanonicalDataRequest, context: TenantContext): Promise<unknown>;
  health?(context: TenantContext): Promise<ProviderHealth>;
  quota?(context: TenantContext): Promise<ProviderQuota | null>;
  entitlement?(request: CanonicalDataRequest, context: TenantContext): Promise<ProviderEntitlementDecision>;
}

export class ProviderSdkRegistry {
  private readonly adapters = new Map<string, LiOSDataProviderAdapter>();

  register(adapter: LiOSDataProviderAdapter): void {
    if (this.adapters.has(adapter.id)) throw new Error(`Provider adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }

  list(capability?: CanonicalDataCapability): LiOSDataProviderAdapter[] {
    return [...this.adapters.values()]
      .filter((adapter) => !capability || adapter.capabilities.includes(capability))
      .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  }

  get(id: string): LiOSDataProviderAdapter | null {
    return this.adapters.get(id) ?? null;
  }
}

const allowed = (reasons: string[] = []): ProviderEntitlementDecision => ({
  decision: "allowed", policyId: null, permittedUses: ["internal_research"], reasons,
});
const unknownEntitlement = (reason: string): ProviderEntitlementDecision => ({
  decision: "unknown", policyId: null, permittedUses: [], reasons: [reason],
});
const unknownQuota = (): ProviderQuota => ({ limit: null, remaining: null, resetAt: null, retryAfterMs: null, source: "unknown" });

function normalizedAccessProfile(adapter: LiOSDataProviderAdapter): ProviderAccessProfile {
  return providerAccessProfileSchema.parse(adapter.access ?? {});
}

function accessAvailability(status: ProviderAttempt["status"] | null): ProviderAccessPosture["availability"] {
  switch (status) {
    case "returned":
      return { state: "available", reason: "returned", detail: null };
    case "empty":
      return { state: "unavailable", reason: "empty", detail: "Provider returned no usable observation." };
    case "stale_only":
      return { state: "unavailable", reason: "unsupported_point_in_time", detail: "Provider cannot satisfy the requested point-in-time mode." };
    case "entitlement_denied":
      return { state: "unavailable", reason: "entitlement_denied", detail: "Provider entitlement denied this request." };
    case "quota_exhausted":
      return { state: "degraded", reason: "quota_exhausted", detail: "Provider quota is exhausted." };
    case "rate_limited":
      return { state: "degraded", reason: "rate_limited", detail: "Provider is rate limited." };
    case "mapping_required":
      return { state: "unavailable", reason: "mapping_required", detail: "Provider mapping must be confirmed before use." };
    case "policy_denied":
      return { state: "unavailable", reason: "policy_denied", detail: "Provider is excluded by active source policy." };
    case "failed":
      return { state: "unavailable", reason: "provider_failed", detail: "Provider execution failed." };
    case "unsupported":
      return { state: "unavailable", reason: "unknown", detail: "Provider does not support this request." };
    case null:
      return { state: "unknown", reason: "not_evaluated", detail: "Provider access was inspected without executing a data fetch." };
  }
}

function buildProviderAccessPosture(input: {
  adapter: LiOSDataProviderAdapter;
  capability: CanonicalDataCapability;
  requestedMode: CanonicalDataRequest["pointInTime"]["mode"];
  status?: ProviderAttempt["status"] | null;
  entitlement?: ProviderEntitlementDecision | null;
  detail?: string | null;
  providerId?: string;
}): ProviderAccessPosture {
  const access = normalizedAccessProfile(input.adapter);
  const compatible = input.adapter.pointInTimeModes.includes(input.requestedMode);
  const availability = accessAvailability(input.status ?? null);
  const entitlement = input.entitlement ?? unknownEntitlement(
    "Entitlement was not evaluated; absence of an entitlement decision is not permission.",
  );
  return providerAccessPostureSchema.parse({
    providerId: input.providerId ?? input.adapter.id,
    capability: input.capability,
    availability: {
      ...availability,
      detail: input.detail ?? availability.detail,
    },
    authentication: {
      mode: access.authMode,
      credentialRequirement: access.credentialRequirement,
      secretMaterialExposed: false,
    },
    locality: access.locality,
    entitlement,
    rights: {
      aiTransmission: access.aiTransmission,
      internalUse: access.internalUse,
      redistribution: access.redistribution,
    },
    pointInTime: {
      requestedMode: input.requestedMode,
      supportedModes: [...input.adapter.pointInTimeModes],
      compatible,
    },
    notes: access.notes,
  });
}

export function describeProviderAccess(
  input: {
    capability: CanonicalDataCapability;
    pointInTimeMode?: CanonicalDataRequest["pointInTime"]["mode"];
    providerAllow?: string[];
    providerDeny?: string[];
  },
  registry: ProviderSdkRegistry = defaultProviderSdkRegistry,
): ProviderAccessPosture[] {
  const requestedMode = input.pointInTimeMode ?? "latest";
  const allowedProviders = new Set(input.providerAllow ?? []);
  const deniedProviders = new Set(input.providerDeny ?? []);
  return registry.list(input.capability)
    .filter((adapter) => (!allowedProviders.size || allowedProviders.has(adapter.id)) && !deniedProviders.has(adapter.id))
    .map((adapter) => buildProviderAccessPosture({
      adapter,
      capability: input.capability,
      requestedMode,
      status: adapter.pointInTimeModes.includes(requestedMode) ? null : "stale_only",
      entitlement: null,
    }));
}

function symbolFor(request: CanonicalDataRequest): string | null {
  return request.entity.symbol?.trim().toUpperCase() || (/^[A-Za-z0-9.^_=-]+$/.test(request.entity.ref) ? request.entity.ref.toUpperCase() : null);
}

function latestOnlyAdapter(
  id: string,
  label: string,
  priority: number,
  capabilities: CanonicalDataCapability[],
  fetcher: LiOSDataProviderAdapter["fetch"],
): LiOSDataProviderAdapter {
  return { id, label, priority, capabilities, pointInTimeModes: ["latest"], fetch: fetcher };
}

export function createNativeProviderAdapters(): LiOSDataProviderAdapter[] {
  const identity: LiOSDataProviderAdapter = {
    id: "lios.instrument-master",
    label: "LiOS Global Instrument Master",
    priority: 0,
    capabilities: ["security_resolution"],
    pointInTimeModes: ["latest", "as_known_on"],
    access: providerAccessProfileSchema.parse({
      authMode: "local_state",
      credentialRequirement: "not_required",
      locality: "lios_local",
      aiTransmission: "unknown",
      internalUse: "permitted",
      redistribution: "unknown",
      notes: ["Canonical LiOS-owned identity state; external provider fallback, when used, has separate rights."],
    }),
    async search(request) {
      const result = await searchCommonInstrumentUniverse(request.query, { limit: request.limit ?? 20 });
      return {
        providerId: result.source === "provider_fallback" ? "federated" : "lios.instrument-master",
        rows: result.groups,
        sourceRefs: [`instrument-search:${result.source}`],
      };
    },
    async fetch(request) {
      const query = request.entity.identifiers.figi
        ? { identifier: { type: "figi" as const, value: request.entity.identifiers.figi } }
        : request.entity.identifiers.isin
          ? { identifier: { type: "isin" as const, value: request.entity.identifiers.isin } }
          : request.entity.symbol
            ? { ticker: request.entity.symbol }
            : { name: request.entity.ref };
      if (request.pointInTime.mode === "as_known_on" && request.pointInTime.asKnownOn) {
        Object.assign(query, { asOfDate: request.pointInTime.asKnownOn.slice(0, 10) });
      }
      const result = await resolvePersistedInstrument(
        query,
        request.pointInTime.mode === "latest" ? openFigiInstrumentFallback : undefined,
      );
      if (result.status === "not_found") return null;
      return {
        providerId: result.source === "provider_fallback" ? "openfigi" : "lios.instrument-master",
        data: result,
        sourceRefs: [`instrument-resolution:${result.source}`],
        entitlement: result.source === "provider_fallback" ? unknownEntitlement("OpenFIGI data rights are tracked separately from software/API access.") : allowed(["LiOS-owned local identity state."]),
        normalized: true,
      };
    },
  };

  const prices = latestOnlyAdapter("lios.market-data", "LiOS Market Data Router", 10, ["prices"], async (request) => {
    const symbol = symbolFor(request); if (!symbol) return null;
    const quotes = await getQuotes([symbol]);
    const quote = quotes.find((row) => row.symbol.toUpperCase() === symbol) ?? quotes[0];
    if (!quote || quote.status?.provider === "unavailable") return null;
    return {
      providerId: quote.quoteSource || "lios.market-data",
      data: quote,
      sourceRefs: [`quote:${quote.quoteSource || "unknown"}:${symbol}`],
      entitlement: allowed(["Served through the existing governed LiOS market-data router."]),
      normalized: true,
      warnings: quote.isLive ? [] : ["Quote is not marked live by the underlying router."],
    };
  });

  const statements = latestOnlyAdapter("lios.financial-statements", "LiOS Financial Statements Broker", 10, ["statements"], async (request) => {
    const symbol = symbolFor(request); if (!symbol) return null;
    const reportType = typeof request.parameters.reportType === "string" ? request.parameters.reportType : "annual";
    const period = typeof request.parameters.period === "string" ? request.parameters.period : "latest";
    const resolution = await resolveFinancialStatements(symbol, reportType, period, request.providerAllow.length ? request.providerAllow : undefined);
    if (!resolution.authoritative) return null;
    return {
      providerId: resolution.authoritative.providerId,
      data: {
        authoritative: resolution.authoritative.value,
        conflicts: resolution.conflicts,
        observations: resolution.observations.map((item) => ({ providerId: item.providerId, value: item.value })),
      },
      sourceRefs: resolution.observations.map((item) => `provider:${item.providerId}`),
      entitlement: unknownEntitlement("Provider-specific statement entitlements remain authoritative; inspect the selected source policy before redistribution."),
      normalized: true,
      warnings: resolution.conflicts.length ? [`${resolution.conflicts.length} provider conflicts detected.`] : [],
    };
  });

  const alternatives = (id: string, label: string, capability: CanonicalDataCapability, dataClass: "estimates" | "options_chain" | "portfolio_holdings"): LiOSDataProviderAdapter => ({
    id, label, priority: 20, capabilities: [capability], pointInTimeModes: ["latest", "as_known_on"],
    access: providerAccessProfileSchema.parse({
      authMode: "local_state",
      credentialRequirement: "not_required",
      locality: "user_owned",
      aiTransmission: "unknown",
      internalUse: "permitted",
      redistribution: "unknown",
      notes: ["Stored user/organization snapshot; source-specific downstream rights remain authoritative."],
    }),
    async fetch(request, context) {
      const entity = symbolFor(request) ?? request.entity.ref;
      const snapshot = request.pointInTime.mode === "as_known_on" && request.pointInTime.asKnownOn
        ? await getAlternativeDatasetAsOf(dataClass, entity, new Date(request.pointInTime.asKnownOn), context.organizationId)
        : (await listAlternativeDatasets(dataClass, entity, context.organizationId, 1))[0] ?? null;
      if (!snapshot) return null;
      return {
        providerId: snapshot.provider || id,
        data: snapshot.payload,
        sourceRefs: [`snapshot:${snapshot.id}`, `provider:${snapshot.provider}`],
        effectiveAt: snapshot.effectiveAt,
        publishedAt: snapshot.publishedAt,
        availableAt: snapshot.availableAt,
        revision: snapshot.contentHash,
        entitlement: snapshot.entitlementPolicyId
          ? { decision: "allowed", policyId: snapshot.entitlementPolicyId, permittedUses: ["internal_research"], reasons: ["Snapshot carries an entitlement-policy reference."] }
          : unknownEntitlement("No entitlement policy is attached to this snapshot."),
        normalized: true,
      };
    },
  });

  const statementsAsKnown: LiOSDataProviderAdapter = {
    id: "lios.financial-snapshots",
    label: "LiOS Point-in-Time Financial Snapshots",
    priority: 5,
    capabilities: ["statements"],
    pointInTimeModes: ["as_known_on"],
    access: providerAccessProfileSchema.parse({
      authMode: "local_state",
      credentialRequirement: "not_required",
      locality: "lios_local",
      aiTransmission: "unknown",
      internalUse: "unknown",
      redistribution: "unknown",
      notes: ["Point-in-time snapshot is stored locally; original provider rights still govern downstream use."],
    }),
    async fetch(request) {
      const symbol = symbolFor(request);
      if (!symbol || !request.pointInTime.asKnownOn) return null;
      const snapshot = await getFinancialDatasetAsOf(symbol, new Date(request.pointInTime.asKnownOn));
      if (!snapshot) return null;
      return {
        providerId: snapshot.provider,
        data: snapshot.payload,
        sourceRefs: [`snapshot:${snapshot.id}`, `provider:${snapshot.provider}`],
        effectiveAt: snapshot.effectiveAt,
        publishedAt: snapshot.publishedAt,
        availableAt: snapshot.availableAt,
        revision: snapshot.contentHash,
        entitlement: snapshot.entitlementPolicyId
          ? { decision: "allowed", policyId: snapshot.entitlementPolicyId, permittedUses: ["internal_research"], reasons: ["Snapshot carries an entitlement-policy reference."] }
          : unknownEntitlement("Snapshot has no entitlement policy reference."),
        normalized: true,
      };
    },
  };

  const filings = latestOnlyAdapter("lios.sec-filings", "SEC EDGAR Filings", 15, ["filings"], async (request) => {
    const symbol = symbolFor(request);
    if (!symbol) return null;
    const limit = typeof request.parameters.limit === "number"
      ? Math.min(Math.max(Math.floor(request.parameters.limit), 1), 200)
      : 40;
    const rows = await getCompanyFilings(symbol, limit);
    if (!rows.length) return null;
    return {
      providerId: "sec_edgar",
      data: rows,
      sourceRefs: rows.map((row) => row.filingUrl),
      entitlement: unknownEntitlement("SEC filing access is public; downstream redistribution/document rights remain separately governed."),
      normalized: true,
    };
  });

  const macroLive = latestOnlyAdapter("lios.fred-macro", "FRED Macro Router", 15, ["macro"], async (request) => {
    const seriesId = typeof request.parameters.seriesId === "string" ? request.parameters.seriesId : request.entity.ref;
    const quote = await getIndicatorQuote(seriesId);
    if (quote.value === null) return null;
    return {
      providerId: "fred",
      data: quote,
      sourceRefs: [`fred:${seriesId}`],
      effectiveAt: quote.asOf ? `${quote.asOf}T00:00:00.000Z` : null,
      entitlement: unknownEntitlement("FRED source rights must be checked for the intended downstream use."),
      normalized: true,
    };
  });

  const curveLive = latestOnlyAdapter("lios.fred-curve", "FRED Treasury Curve", 15, ["curves"], async () => {
    const result = await getYieldCurve();
    if (!result.isLive) return null;
    const dates = result.curve.map((point) => point.asOf).filter((value): value is string => Boolean(value)).sort();
    return {
      providerId: "fred",
      data: result,
      sourceRefs: result.curve.map((point) => `fred:${point.seriesId}`),
      effectiveAt: dates.at(-1) ? `${dates.at(-1)}T00:00:00.000Z` : null,
      entitlement: unknownEntitlement("FRED source rights must be checked for the intended downstream use."),
      normalized: true,
    };
  });

  const economicAsKnown = (
    id: string,
    label: string,
    capability: "macro" | "curves",
    dataClass: "economic_series" | "yield_curve",
  ): LiOSDataProviderAdapter => ({
    id,
    label,
    priority: 5,
    capabilities: [capability],
    pointInTimeModes: ["as_known_on"],
    access: providerAccessProfileSchema.parse({
      authMode: "local_state",
      credentialRequirement: "not_required",
      locality: "lios_local",
      aiTransmission: "unknown",
      internalUse: "unknown",
      redistribution: "unknown",
      notes: ["Point-in-time economic snapshot is stored locally; original provider rights remain authoritative."],
    }),
    async fetch(request) {
      if (!request.pointInTime.asKnownOn) return null;
      const entity = capability === "curves" ? "UST_NOMINAL" : request.entity.ref;
      const snapshot = await getEconomicDatasetAsOf(entity, dataClass, new Date(request.pointInTime.asKnownOn));
      if (!snapshot) return null;
      return {
        providerId: snapshot.provider,
        data: snapshot.payload,
        sourceRefs: [`snapshot:${snapshot.id}`, `provider:${snapshot.provider}`],
        effectiveAt: snapshot.effectiveAt,
        publishedAt: snapshot.publishedAt,
        availableAt: snapshot.availableAt,
        revision: snapshot.contentHash,
        entitlement: snapshot.entitlementPolicyId
          ? { decision: "allowed", policyId: snapshot.entitlementPolicyId, permittedUses: ["internal_research"], reasons: ["Snapshot carries an entitlement-policy reference."] }
          : unknownEntitlement("Snapshot has no entitlement policy reference."),
        normalized: true,
      };
    },
  });

  const fx = latestOnlyAdapter("lios.fx", "LiOS FX Router", 20, ["fx"], async (request) => {
    const pair = request.entity.ref.replace(/[^A-Za-z]/g, "").toUpperCase();
    const quotes = await getForexQuotes();
    const match = quotes.find((row) => row.pair.replace(/[^A-Za-z]/g, "").toUpperCase() === pair || `${row.base}${row.quote}` === pair);
    if (!match || match.rate === null) return null;
    return { providerId: match.status.provider, data: match, sourceRefs: [`fx:${match.status.provider}:${match.pair}`], entitlement: unknownEntitlement("FX source rights depend on the active quote provider."), normalized: true };
  });

  return [
    identity,
    prices,
    statementsAsKnown,
    statements,
    filings,
    economicAsKnown("lios.economic-snapshots", "LiOS Point-in-Time Macro Snapshots", "macro", "economic_series"),
    macroLive,
    createEcbDataProviderAdapter(),
    createOecdDataProviderAdapter(),
    createImfDataProviderAdapter(),
    economicAsKnown("lios.curve-snapshots", "LiOS Point-in-Time Curve Snapshots", "curves", "yield_curve"),
    curveLive,
    alternatives("lios.estimates", "LiOS Estimates Snapshots", "estimates", "estimates"),
    alternatives("lios.options", "LiOS Options Snapshots", "options", "options_chain"),
    alternatives("lios.portfolios", "LiOS Portfolio Ledger", "portfolios", "portfolio_holdings"),
    fx,
    createLseDataProviderAdapter(),
  ];
}

function attemptStatus(error: unknown): ProviderAttempt["status"] {
  const status = (error as { status?: number } | null)?.status;
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "entitlement_denied";
  return "failed";
}

function gapReason(attempts: ProviderAttempt[], request: CanonicalDataRequest, policyFiltered = false) {
  if (!attempts.length && policyFiltered) return "policy_denied" as const;
  if (request.pointInTime.mode !== "latest" && attempts.some((item) => item.status === "stale_only")) return "point_in_time_unavailable" as const;
  if (attempts.some((item) => item.status === "entitlement_denied")) return "entitlement_required" as const;
  if (attempts.some((item) => item.status === "quota_exhausted")) return "quota_exhausted" as const;
  if (attempts.some((item) => item.status === "rate_limited")) return "rate_limited" as const;
  if (attempts.some((item) => item.status === "mapping_required")) return "mapping_required" as const;
  if (attempts.some((item) => item.status === "failed")) return "provider_error" as const;
  return attempts.length ? "unavailable" as const : "unsupported" as const;
}

function nextActions(attempts: ProviderAttempt[], reason: ReturnType<typeof gapReason>) {
  const actions: Array<{ action: "connect_provider" | "review_entitlement" | "adjust_as_known_on" | "confirm_mapping" | "retry_later" | "use_alternate_source" | "import_data"; providerId: string | null; label: string }> = [];
  if (reason === "entitlement_required") actions.push({ action: "review_entitlement", providerId: attempts.find((item) => item.status === "entitlement_denied")?.providerId ?? null, label: "Review or connect a provider entitlement." });
  if (reason === "point_in_time_unavailable") actions.push({ action: "adjust_as_known_on", providerId: null, label: "Choose a supported as-known-on date/source or import a historical snapshot." });
  if (reason === "mapping_required") actions.push({ action: "confirm_mapping", providerId: null, label: "Review and confirm the suggested provider-field mapping." });
  if (reason === "rate_limited" || reason === "quota_exhausted") actions.push({ action: "retry_later", providerId: null, label: "Retry when provider quota resets." });
  actions.push({ action: "use_alternate_source", providerId: null, label: "Use another connected source that supports this capability." });
  actions.push({ action: "import_data", providerId: null, label: "Import user-owned data for this capability." });
  return actions;
}

export async function executeCanonicalDataRequest(
  raw: CanonicalDataRequest,
  context: TenantContext,
  registry: ProviderSdkRegistry = defaultProviderSdkRegistry,
): Promise<CanonicalDataResponse> {
  const request = canonicalDataRequestSchema.parse(raw);
  const capabilityProviders = registry.list(request.capability);
  const candidates = capabilityProviders.filter((adapter) =>
    (!request.providerAllow.length || request.providerAllow.includes(adapter.id)) &&
    !request.providerDeny.includes(adapter.id)
  );
  const policyFiltered = capabilityProviders.length > 0 && candidates.length === 0;
  const attempts: ProviderAttempt[] = [];
  const observations: ProviderObservation[] = [];
  const accessPostures: ProviderAccessPosture[] = [];

  for (const adapter of candidates) {
    if (!adapter.pointInTimeModes.includes(request.pointInTime.mode)) {
      const detail = `Adapter supports ${adapter.pointInTimeModes.join(", ")} but request requires ${request.pointInTime.mode}.`;
      attempts.push({ providerId: adapter.id, status: "stale_only", detail, latencyMs: 0, quota: null, entitlement: null });
      accessPostures.push(buildProviderAccessPosture({
        adapter,
        capability: request.capability,
        requestedMode: request.pointInTime.mode,
        status: "stale_only",
        entitlement: null,
        detail,
      }));
      continue;
    }
    // An entitlement service failure belongs to this candidate, not the
    // entire provider chain. Do not fetch from a source whose access check
    // failed; allow the next eligible adapter to provide data instead.
    let entitlement: ProviderEntitlementDecision | null = null;
    if (adapter.entitlement) {
      try {
        entitlement = await adapter.entitlement(request, context);
      } catch (error) {
        const status = attemptStatus(error);
        // Do not expose entitlement-provider exception messages: they can
        // contain private account, token or endpoint information.
        const detail = status === "entitlement_denied"
          ? "Provider entitlement denied access."
          : status === "rate_limited"
            ? "Provider entitlement check is rate limited."
            : "Provider entitlement could not be verified.";
        attempts.push({ providerId: adapter.id, status, detail, latencyMs: 0, quota: null, entitlement: null });
        accessPostures.push(buildProviderAccessPosture({
          adapter,
          capability: request.capability,
          requestedMode: request.pointInTime.mode,
          status,
          entitlement: null,
          detail,
        }));
        continue;
      }
    }
    if (entitlement?.decision === "denied") {
      const detail = entitlement.reasons.join(" ");
      attempts.push({ providerId: adapter.id, status: "entitlement_denied", detail, latencyMs: 0, quota: null, entitlement });
      accessPostures.push(buildProviderAccessPosture({
        adapter,
        capability: request.capability,
        requestedMode: request.pointInTime.mode,
        status: "entitlement_denied",
        entitlement,
        detail,
      }));
      continue;
    }
    const started = Date.now();
    try {
      const result = await adapter.fetch(request, context);
      const latencyMs = Date.now() - started;
      if (!result) {
        const detail = "Provider returned no usable observation.";
        attempts.push({ providerId: adapter.id, status: "empty", detail, latencyMs, quota: adapter.quota ? await adapter.quota(context) : null, entitlement });
        accessPostures.push(buildProviderAccessPosture({
          adapter,
          capability: request.capability,
          requestedMode: request.pointInTime.mode,
          status: "empty",
          entitlement,
          detail,
        }));
        continue;
      }
      const resolvedEntitlement = result.entitlement ?? entitlement ?? unknownEntitlement("No explicit entitlement evidence was supplied by this adapter.");
      if (resolvedEntitlement.decision === "denied") {
        const detail = resolvedEntitlement.reasons.join(" ");
        attempts.push({ providerId: adapter.id, status: "entitlement_denied", detail, latencyMs, quota: result.quota ?? null, entitlement: resolvedEntitlement });
        accessPostures.push(buildProviderAccessPosture({
          adapter,
          capability: request.capability,
          requestedMode: request.pointInTime.mode,
          status: "entitlement_denied",
          entitlement: resolvedEntitlement,
          detail,
        }));
        continue;
      }
      const providerId = result.providerId ?? adapter.id;
      const normalizedData = adapter.normalize && !result.normalized
        ? await adapter.normalize(result.data, request, context)
        : result.data;
      const observation: ProviderObservation = {
        providerId,
        capability: request.capability,
        entityRef: request.entity.ref,
        data: normalizedData,
        sourceRefs: result.sourceRefs ?? [],
        clocks: {
          effectiveAt: result.effectiveAt ?? null,
          publishedAt: result.publishedAt ?? null,
          retrievedAt: new Date().toISOString(),
          availableAt: result.availableAt ?? null,
        },
        revision: result.revision ?? null,
        quota: result.quota ?? (adapter.quota ? await adapter.quota(context) : null),
        entitlement: resolvedEntitlement,
        normalized: result.normalized === true || Boolean(adapter.normalize),
        warnings: result.warnings ?? [],
      };
      observations.push(observation);
      attempts.push({ providerId, status: "returned", detail: null, latencyMs, quota: observation.quota, entitlement: observation.entitlement });
      accessPostures.push(buildProviderAccessPosture({
        adapter,
        capability: request.capability,
        requestedMode: request.pointInTime.mode,
        status: "returned",
        entitlement: observation.entitlement,
        providerId,
      }));
      break;
    } catch (error) {
      const status = attemptStatus(error);
      const detail = error instanceof Error ? error.message : "Provider execution failed.";
      attempts.push({
        providerId: adapter.id,
        status,
        detail,
        latencyMs: Date.now() - started,
        quota: (error as { quota?: ProviderQuota } | null)?.quota ?? null,
        entitlement,
      });
      accessPostures.push(buildProviderAccessPosture({
        adapter,
        capability: request.capability,
        requestedMode: request.pointInTime.mode,
        status,
        entitlement,
        detail,
      }));
    }
  }

  const observation = observations[0] ?? null;
  const reason = gapReason(attempts, request, policyFiltered);
  const gap = observation ? null : structuredDataGapSchema.parse({
    schemaVersion: "1",
    capability: request.capability,
    entityRef: request.entity.ref,
    reason,
    providersChecked: attempts,
    requestedPointInTime: request.pointInTime,
    nextActions: nextActions(attempts, reason),
  });
  return canonicalDataResponseSchema.parse({
    schemaVersion: "1",
    requestId: request.requestId,
    capability: request.capability,
    entityRef: request.entity.ref,
    observation,
    observations,
    attempts,
    accessPostures,
    gap,
    resolvedAt: new Date().toISOString(),
  });
}

export async function searchProviderSdk(
  request: ProviderSearchRequest,
  context: TenantContext,
  registry: ProviderSdkRegistry = defaultProviderSdkRegistry,
): Promise<ProviderSearchResult[]> {
  const candidates = request.capability ? registry.list(request.capability) : registry.list();
  const results: ProviderSearchResult[] = [];
  for (const adapter of candidates) {
    if (adapter.search) results.push(await adapter.search(request, context));
  }
  return results;
}

export async function providerHealthSnapshot(
  context: TenantContext,
  registry: ProviderSdkRegistry = defaultProviderSdkRegistry,
): Promise<Array<{ providerId: string; health: ProviderHealth | null; quota: ProviderQuota | null }>> {
  return Promise.all(registry.list().map(async (adapter) => ({
    providerId: adapter.id,
    health: adapter.health ? await adapter.health(context) : null,
    quota: adapter.quota ? await adapter.quota(context) : null,
  })));
}

export async function normalizeProviderData(
  providerId: string,
  data: unknown,
  request: CanonicalDataRequest,
  context: TenantContext,
  registry: ProviderSdkRegistry = defaultProviderSdkRegistry,
): Promise<unknown> {
  const adapter = registry.get(providerId);
  if (!adapter) throw new Error(`Provider adapter not found: ${providerId}`);
  return adapter.normalize ? adapter.normalize(data, request, context) : data;
}

export async function startProviderStream(
  providerId: string,
  request: CanonicalDataRequest,
  context: TenantContext,
  registry: ProviderSdkRegistry = defaultProviderSdkRegistry,
): Promise<ManagedProviderStreamSubscription> {
  const parsed = canonicalDataRequestSchema.parse(request);
  const adapter = registry.get(providerId);
  if (!adapter?.stream) throw new Error(`Provider ${providerId} does not expose a streaming adapter.`);
  if (!adapter.capabilities.includes(parsed.capability)) {
    throw new Error("Provider does not support the requested streaming capability.");
  }
  if ((parsed.providerAllow.length && !parsed.providerAllow.includes(providerId))
      || parsed.providerDeny.includes(providerId)) {
    throw new Error("Provider streaming is excluded by the requested source policy.");
  }
  if (!adapter.pointInTimeModes.includes(parsed.pointInTime.mode)) {
    throw new Error("Provider does not support the requested point-in-time streaming mode.");
  }
  // Unlike a one-time fetch, a stream is an ongoing source of external
  // observations. Without a live entitlement hook, an explicit current grant
  // cannot be established. This is a fail-closed launch gate; the provider
  // must continue enforcing its own grant for the lifetime of the stream.
  if (!adapter.entitlement) {
    throw new Error("Streaming provider has no live entitlement verification.");
  }
  let entitlement: ProviderEntitlementDecision;
  try {
    entitlement = await adapter.entitlement(parsed, context);
  } catch {
    // Never propagate secret-bearing account/provider failure messages.
    throw new Error("Streaming provider entitlement could not be verified.");
  }
  if (entitlement.decision !== "allowed" || !entitlement.permittedUses.includes("internal_research")) {
    throw new Error("Streaming provider entitlement does not permit internal research access.");
  }
  const source = await adapter.stream(parsed, context);
  // Permissions can change while the provider is opening its connection.
  // Verify the grant again before returning a usable subscription, then keep
  // it under one managed recheck/stop lifecycle. On failed verification the
  // just-opened stream is closed rather than given to the caller.
  const managed = guardProviderStreamEntitlement(
    source,
    () => adapter.entitlement!(parsed, context),
    entitlement,
  );
  if (!await managed.recheckEntitlement()) {
    throw new Error("Streaming provider entitlement changed while connecting.");
  }
  return managed;
}

export const defaultProviderSdkRegistry = new ProviderSdkRegistry();
for (const adapter of createNativeProviderAdapters()) defaultProviderSdkRegistry.register(adapter);

export function createCanonicalDataRequest(input: Omit<CanonicalDataRequest, "schemaVersion" | "requestId"> & { requestId?: string }): CanonicalDataRequest {
  return canonicalDataRequestSchema.parse({ ...input, schemaVersion: "1", requestId: input.requestId ?? crypto.randomUUID() });
}

export { unknownQuota };
