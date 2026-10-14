import { z } from "zod";
import {
  INSTRUMENT_IDENTIFIER_TYPES,
  type InstrumentMasterCandidate,
  type InstrumentResolutionQuery,
} from "@shared/globalInstrumentMaster";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";
import { assertNotAborted } from "./conversationRuntimeCore";
import { getProject } from "./projectStore";

const identifierTypeSchema = z.enum(INSTRUMENT_IDENTIFIER_TYPES);

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const entityIntelligenceInputSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  ticker: z.string().trim().min(1).max(120).optional(),
  mic: z.string().trim().min(1).max(32).optional(),
  exchange: z.string().trim().min(1).max(120).optional(),
  identifier: z.object({
    type: identifierTypeSchema,
    value: z.string().trim().min(1).max(500),
    provider: z.string().trim().min(1).max(120).optional(),
    registry: z.string().trim().min(1).max(240).optional(),
    jurisdiction: z.string().trim().min(1).max(120).optional(),
  }).strict().optional(),
  providerId: z.object({
    provider: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(500),
  }).strict().optional(),
  includeHistorical: z.boolean().optional(),
  asOfDate: z.string().date().optional(),
}).strict().superRefine((value, ctx) => {
  const primary = [value.name, value.ticker, value.identifier, value.providerId].filter(Boolean);
  if (primary.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "Entity resolution requires exactly one of name, ticker, identifier, or providerId.",
    });
  }
  if (value.mic && !value.ticker) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mic"], message: "MIC qualifies a ticker lookup." });
  }
  if (value.exchange && !value.ticker) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exchange"], message: "Exchange qualifies a ticker lookup." });
  }
  if (value.identifier?.type === "registry_id" && !value.identifier.registry) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["identifier", "registry"], message: "registry_id requires an explicit registry." });
  }
});

const identifierViewSchema = z.object({
  type: identifierTypeSchema,
  value: z.string(),
  provider: z.string().nullable(),
  registry: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  isPrimary: z.boolean(),
}).strict();

const relatedInstrumentSchema = z.object({
  listingId: z.string(),
  relationshipType: z.enum(["adr_gdr", "related_instrument"]),
  ratio: z.string().nullable(),
}).strict();

const entityProfileSchema = z.object({
  jurisdiction: z.string().nullable(),
  legalEntityKind: z.enum([
    "corporation",
    "partnership",
    "limited_liability_company",
    "trust",
    "fund",
    "sovereign",
    "government_agency",
    "nonprofit",
    "individual",
    "other",
  ]).nullable(),
  legalForm: z.string().nullable(),
  lifecycleStatus: z.enum(["unknown", "active", "inactive", "dissolved", "merged", "acquired", "insolvent"]),
  identityStatus: z.enum(["provisional", "verified"]),
  nameIsPlaceholder: z.boolean(),
}).strict();

const candidateViewSchema = z.object({
  entityId: z.string().nullable(),
  securityId: z.string().nullable(),
  listingId: z.string().nullable(),
  instrumentId: z.string().nullable(),
  name: z.string(),
  symbol: z.string().nullable(),
  exchange: z.string().nullable(),
  mic: z.string().nullable(),
  countryCode: z.string().nullable(),
  currency: z.string().nullable(),
  shareClass: z.string().nullable(),
  isPrimaryListing: z.boolean(),
  lifecycleStatus: z.enum(["active", "suspended", "delisted", "expired", "merged", "acquired", "renamed", "relisted"]),
  entity: entityProfileSchema.nullable(),
  identifiers: z.array(identifierViewSchema).max(100),
  predecessorEntityIds: z.array(z.string()).max(100),
  successorEntityIds: z.array(z.string()).max(100),
  relatedInstruments: z.array(relatedInstrumentSchema).max(100),
  canonical: z.boolean(),
  source: z.string().nullable(),
}).strict();

const rankedCandidateSchema = z.object({
  candidate: candidateViewSchema,
  score: z.number(),
  reasons: z.array(z.string()).max(50),
}).strict();

export const entityIntelligenceOutputSchema = z.object({
  output: z.object({
    status: z.enum(["resolved", "ambiguous", "not_found"]),
    match: candidateViewSchema.nullable(),
    candidates: z.array(rankedCandidateSchema).max(20),
    source: z.enum(["local", "none"]),
    providerFallbackUsed: z.literal(false),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100),
}).strict();

function candidateView(candidate: InstrumentMasterCandidate) {
  return {
    entityId: candidate.entityId ?? null,
    securityId: candidate.securityId ?? null,
    listingId: candidate.listingId ?? null,
    instrumentId: candidate.instrumentId ?? null,
    name: candidate.name,
    symbol: candidate.symbol ?? null,
    exchange: candidate.exchange ?? null,
    mic: candidate.mic ?? null,
    countryCode: candidate.countryCode ?? null,
    currency: candidate.currency ?? null,
    shareClass: candidate.shareClass ?? null,
    isPrimaryListing: candidate.isPrimaryListing,
    lifecycleStatus: candidate.lifecycleStatus,
    entity: candidate.entity ?? null,
    identifiers: candidate.identifiers.map((identifier) => ({
      type: identifier.type,
      value: identifier.value,
      provider: identifier.provider ?? null,
      registry: identifier.registry ?? null,
      jurisdiction: identifier.jurisdiction ?? null,
      validFrom: identifier.validFrom ?? null,
      validTo: identifier.validTo ?? null,
      isPrimary: identifier.isPrimary ?? false,
    })),
    predecessorEntityIds: candidate.predecessorEntityIds ?? [],
    successorEntityIds: candidate.successorEntityIds ?? [],
    relatedInstruments: (candidate.relatedInstruments ?? []).map((link) => ({
      listingId: link.listingId,
      relationshipType: link.relationshipType,
      ratio: link.ratio ?? null,
    })),
    canonical: candidate.canonical,
    source: candidate.source ?? null,
  };
}

function canonicalRefs(candidate: InstrumentMasterCandidate | null): string[] {
  if (!candidate) return [];
  return [
    candidate.entityId,
    candidate.securityId ?? null,
    candidate.listingId,
    candidate.instrumentId ?? null,
    ...(candidate.predecessorEntityIds ?? []),
    ...(candidate.successorEntityIds ?? []),
    ...(candidate.relatedInstruments ?? []).map((link) => link.listingId),
  ].filter((ref): ref is string => Boolean(ref));
}

export const entityIntelligenceTool: ConversationToolDefinition = {
  id: "lios.entity.resolve",
  label: "Resolve canonical entity, security and listing identity",
  planningHint: [
    "Pass exactly one primary identity field.",
    'For a company or legal name copied from the user goal use {"name":"<exact company/security name>"} (for example {"name":"Microsoft Corporation"}).',
    'Use {"ticker":"<symbol>"} only when the goal explicitly provides a ticker/symbol (for example "$MSFT", "ticker MSFT", "symbol MSFT", or a clearly all-caps market symbol).',
    'Invalid examples: {"name":"Microsoft Corporation","ticker":"MSFT"} (two primary fields), {"query":"Microsoft Corporation"}, and {"symbol":"MSFT"}.',
    "Never treat pronouns or incidental prose tokens such as I, A, AS, IN, or US as ticker symbols.",
    "Do not invent identifiers; ambiguity or missing identity must remain unresolved.",
  ].join(" "),
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: entityIntelligenceInputSchema,
  outputSchema: entityIntelligenceOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 96 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    const tenant = tenantSchema.parse(call.tenant);
    if (call.source !== "agent" || !call.requestId || call.userId !== tenant.userId) {
      throw new Error("Entity intelligence requires an authenticated governed agent call.");
    }
    const projectId = call.projectId == null ? null : Number(call.projectId);
    if (projectId === null || !Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("Entity intelligence requires an active Project scope.");
    }
    await getProject(tenant, projectId);
    if (call.sourceScope && call.sourceScope !== "auto" && call.sourceScope !== "my_data") {
      throw new Error("Canonical entity intelligence requires Auto or My Data scope.");
    }
    const parsed = entityIntelligenceInputSchema.parse(input);
    const query: InstrumentResolutionQuery = {
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(parsed.ticker ? { ticker: parsed.ticker } : {}),
      ...(parsed.mic ? { mic: parsed.mic } : {}),
      ...(parsed.exchange ? { exchange: parsed.exchange } : {}),
      ...(parsed.identifier ? { identifier: parsed.identifier } : {}),
      ...(parsed.providerId ? { providerId: parsed.providerId } : {}),
      ...(parsed.includeHistorical !== undefined ? { includeHistorical: parsed.includeHistorical } : {}),
      ...(parsed.asOfDate ? { asOfDate: parsed.asOfDate } : {}),
    };

    // Safe-auto entity intelligence is intentionally local-only. External
    // provider fallback is a separate governed data-provider operation and
    // must never be smuggled into a deterministic read.
    const resolution = await resolvePersistedInstrument(query);
    assertNotAborted(signal);
    const candidates = resolution.candidates.slice(0, 20).map((ranked) => ({
      candidate: candidateView(ranked.candidate),
      score: ranked.score,
      reasons: ranked.reasons,
    }));
    const match = resolution.status === "resolved" && resolution.match ? candidateView(resolution.match) : null;
    const refs = [
      ...canonicalRefs(resolution.match),
      ...resolution.candidates.slice(0, 20).flatMap((ranked) => canonicalRefs(ranked.candidate)),
    ];

    const summary = resolution.status === "resolved" && resolution.match
      ? `Resolved to canonical P5 identity ${resolution.match.entityId ?? resolution.match.name}${resolution.match.listingId ? ` / ${resolution.match.listingId}` : ""}. No provider fallback was used.`
      : resolution.status === "ambiguous"
        ? `Entity lookup is ambiguous across ${candidates.length} canonical candidate${candidates.length === 1 ? "" : "s"}; LiOS did not guess.`
        : "No persisted canonical entity matched. LiOS did not fabricate an identifier or invoke a provider fallback.";

    return {
      output: {
        status: resolution.status,
        match,
        candidates,
        source: resolution.source === "local" ? "local" : "none",
        providerFallbackUsed: false,
      },
      summary,
      deterministic: true,
      sourceRefs: [...new Set(refs)].slice(0, 100),
    };
  },
};
