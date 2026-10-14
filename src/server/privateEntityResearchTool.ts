import { z } from "zod";
import {
  INSTRUMENT_IDENTIFIER_TYPES,
  type InstrumentMasterCandidate,
  type InstrumentResolutionQuery,
} from "@shared/globalInstrumentMaster";
import type { P7ProjectDocument } from "@shared/p7ResearchContracts";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";
import { listProjectIntelligenceDocuments } from "./p7ProjectIntelligenceStore";
import { searchProjectDocuments } from "./p7ProjectIntelligence";
import { buildProjectEvidenceTruth } from "./projectEvidenceTruth";
import { SOURCE_QUALITY_TIERS } from "./projectEvidenceTruth";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { getProject } from "./projectStore";

const identifierTypeSchema = z.enum(INSTRUMENT_IDENTIFIER_TYPES);
const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const privateEntityResearchInputSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
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
  question: z.string().trim().min(1).max(2_000).optional(),
  asOfDate: z.string().date().optional(),
  limit: z.number().int().min(1).max(20).optional(),
}).strict().superRefine((value, ctx) => {
  if ([value.name, value.identifier, value.providerId].filter(Boolean).length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Private entity research requires exactly one of name, identifier, or providerId.",
      path: [],
    });
  }
  if (value.identifier?.type === "registry_id" && !value.identifier.registry) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "registry_id requires an explicit registry.",
      path: ["identifier", "registry"],
    });
  }
});

const truthSchema = z.object({
  temporal: z.object({
    observedAt: z.string().nullable(),
    retrievedAt: z.string().nullable(),
    publishedAt: z.string().nullable(),
    effectiveAt: z.string().nullable(),
    asOfAt: z.string().nullable(),
    asOfBasis: z.enum(["effective_at", "published_at", "observed_at", "unknown"]),
    modelPeriod: z.string().nullable(),
  }).strict(),
  sourceQuality: z.object({
    originClass: z.string().nullable(),
    evidenceKind: z.string().nullable(),
    tier: z.enum(SOURCE_QUALITY_TIERS),
    claimVerification: z.literal("not_verified_by_digest"),
  }).strict(),
  freshness: z.object({
    state: z.enum(["fresh", "stale", "unknown"]),
    basis: z.enum(["declared", "computed_horizon", "none"]),
    assessedAt: z.string().nullable(),
    reason: z.string().nullable(),
  }).strict(),
  access: z.object({
    availability: z.enum(["available", "unavailable", "inaccessible", "unknown"]),
    entitlement: z.enum(["entitled", "unentitled", "unknown"]),
  }).strict(),
  certainty: z.enum(["verified", "uncertain", "disputed", "unknown"]),
  unknowns: z.array(z.string()),
  knowledge: z.object({
    classification: z.enum(["known", "qualified"]),
    qualifiers: z.array(z.string()),
  }).strict(),
}).strict();

const identitySchema = z.object({
  entityId: z.string(),
  name: z.string(),
  jurisdiction: z.string().nullable(),
  legalEntityKind: z.string().nullable(),
  identityStatus: z.string().nullable(),
}).strict();

const candidateSchema = z.object({
  entityId: z.string().nullable(),
  name: z.string(),
  jurisdiction: z.string().nullable(),
  legalEntityKind: z.string().nullable(),
  score: z.number(),
  reasons: z.array(z.string()).max(50),
}).strict();

const evidenceSchema = z.object({
  sourceRef: z.string(),
  sourceType: z.string(),
  title: z.string(),
  excerpt: z.string(),
  contentHash: z.string(),
  observedAt: z.string().nullable(),
  binding: z.enum(["exact_entity_ref", "exact_name"]),
  truth: truthSchema,
}).strict();

export const privateEntityResearchOutputSchema = z.object({
  output: z.object({
    status: z.enum(["researched", "ambiguous", "not_found", "listed_entity"]),
    identity: identitySchema.nullable(),
    candidates: z.array(candidateSchema).max(20),
    evidence: z.array(evidenceSchema).max(20),
    marketIdentity: z.object({
      status: z.enum(["unavailable_no_listing", "listed_entity", "unresolved"]),
      ticker: z.null(),
      listingId: z.null(),
      securityId: z.null(),
      quote: z.null(),
      reason: z.string(),
    }).strict(),
    providerFallbackUsed: z.literal(false),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100),
}).strict();

function normalizedPhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function hasExactNamePhrase(doc: P7ProjectDocument, name: string): boolean {
  const needle = normalizedPhrase(name);
  if (needle.length < 3) return false;
  const haystack = ` ${normalizedPhrase(`${doc.title} ${doc.body}`)} `;
  return haystack.includes(` ${needle} `);
}

function candidateSummary(candidate: InstrumentMasterCandidate, score: number, reasons: string[]) {
  return {
    entityId: candidate.entityId ?? null,
    name: candidate.name,
    jurisdiction: candidate.entity?.jurisdiction ?? candidate.countryCode ?? null,
    legalEntityKind: candidate.entity?.legalEntityKind ?? null,
    score,
    reasons,
  };
}

function excerpt(doc: P7ProjectDocument, preferred?: string | null): string {
  const clean = doc.body.replace(/\s+/g, " ").trim();
  if (clean.length <= 700) return clean;
  const target = preferred ? normalizedPhrase(preferred) : "";
  const normalized = normalizedPhrase(clean);
  const pos = target ? normalized.indexOf(target) : -1;
  if (pos < 0) return clean.slice(0, 700) + "…";
  const start = Math.max(0, Math.min(clean.length - 700, pos - 180));
  return (start > 0 ? "…" : "") + clean.slice(start, start + 700) + (start + 700 < clean.length ? "…" : "");
}

export const privateEntityResearchTool: ConversationToolDefinition = {
  id: "lios.entity.private_research",
  label: "Research a canonical private or no-ticker entity without inventing market data",
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: privateEntityResearchInputSchema,
  outputSchema: privateEntityResearchOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 96 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.source !== "agent" || !call.requestId) {
      throw new Error("Private entity research requires an authenticated governed agent call.");
    }
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Private entity research requires Auto or My Data Project scope.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    if (call.userId !== tenant.userId) throw new Error("Private entity research owner scope does not match the governed call.");
    const projectId = Number(call.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("Private entity research requires an active Project.");
    }
    await getProject(tenant, projectId);

    const parsed = privateEntityResearchInputSchema.parse(input);
    const query: InstrumentResolutionQuery = {
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(parsed.identifier ? { identifier: parsed.identifier } : {}),
      ...(parsed.providerId ? { providerId: parsed.providerId } : {}),
      ...(parsed.asOfDate ? { asOfDate: parsed.asOfDate } : {}),
      includeHistorical: true,
    };
    const resolution = await resolvePersistedInstrument(query);
    assertNotAborted(signal);

    const candidates = resolution.candidates.slice(0, 20).map((item) =>
      candidateSummary(item.candidate, item.score, item.reasons)
    );

    if (resolution.status !== "resolved" || !resolution.match?.entityId) {
      const status = resolution.status === "ambiguous" ? "ambiguous" : "not_found";
      return {
        output: {
          status,
          identity: null,
          candidates,
          evidence: [],
          marketIdentity: {
            status: "unresolved",
            ticker: null,
            listingId: null,
            securityId: null,
            quote: null,
            reason: status === "ambiguous"
              ? "Canonical P5 identity is ambiguous; LiOS did not choose a candidate or invent market identity."
              : "No canonical P5 entity matched; LiOS did not invent a ticker, listing, security or quote.",
          },
          providerFallbackUsed: false,
        },
        summary: status === "ambiguous"
          ? `Private entity identity is ambiguous across ${candidates.length} canonical candidates; no Project evidence was disclosed.`
          : "No canonical private entity matched; no Project evidence was disclosed and no market identity was fabricated.",
        deterministic: true,
        sourceRefs: [],
      };
    }

    const match = resolution.match;
    const entityId = match.entityId;
    if (!entityId) {
      throw new Error("Resolved private entity is missing its canonical entity ID.");
    }
    if (match.listingId || match.securityId || match.instrumentId || match.symbol) {
      return {
        output: {
          status: "listed_entity",
          identity: {
            entityId,
            name: match.name,
            jurisdiction: match.entity?.jurisdiction ?? match.countryCode ?? null,
            legalEntityKind: match.entity?.legalEntityKind ?? null,
            identityStatus: match.entity?.identityStatus ?? null,
          },
          candidates: [],
          evidence: [],
          marketIdentity: {
            status: "listed_entity",
            ticker: null,
            listingId: null,
            securityId: null,
            quote: null,
            reason: "Canonical P5 identity has a listed/security instrument. Use the listed-security research path rather than the private-entity path.",
          },
          providerFallbackUsed: false,
        },
        summary: "The resolved entity has canonical listed/security identity; LiOS did not run the private/no-ticker research path.",
        deterministic: true,
        sourceRefs: [entityId],
      };
    }

    const documents = await listProjectIntelligenceDocuments(tenant, projectId);
    assertNotAborted(signal);
    const allowed = new Set(call.allowedSourceRefs ?? []);
    const permitted = allowed.size
      ? documents.filter((doc) => allowed.has(doc.sourceRef) || doc.sourceRefs.some((ref) => allowed.has(ref)))
      : documents;

    const entityBound = new Set<string>();
    const nameBound = new Set<string>();
    for (const doc of permitted) {
      if (doc.entityRefs.includes(entityId) || doc.contextRefs.entity.includes(entityId)) {
        entityBound.add(doc.id);
      } else if (hasExactNamePhrase(doc, match.name)) {
        nameBound.add(doc.id);
      }
    }
    const eligible = permitted.filter((doc) => entityBound.has(doc.id) || nameBound.has(doc.id));
    const rankHits = eligible.length
      ? searchProjectDocuments(eligible, {
          query: parsed.question ?? match.name,
          limit: Math.min(eligible.length, 100),
          allowedSourceRefs: [],
        })
      : [];
    const rank = new Map(rankHits.map((hit, index) => [hit.documentId, { score: hit.combinedScore, index, excerpt: hit.excerpt }]));
    const limit = parsed.limit ?? 10;
    const selected = [...eligible]
      .sort((left, right) =>
        Number(entityBound.has(right.id)) - Number(entityBound.has(left.id))
        || (rank.get(right.id)?.score ?? 0) - (rank.get(left.id)?.score ?? 0)
        || (right.occurredAt ?? "").localeCompare(left.occurredAt ?? "")
        || left.sourceRef.localeCompare(right.sourceRef)
      )
      .slice(0, limit);

    const evidence = selected.map((doc) => ({
      sourceRef: doc.sourceRef,
      sourceType: doc.sourceType,
      title: doc.title,
      excerpt: rank.get(doc.id)?.excerpt ?? excerpt(doc, parsed.question ?? match.name),
      contentHash: doc.contentHash,
      observedAt: doc.occurredAt,
      binding: entityBound.has(doc.id) ? "exact_entity_ref" as const : "exact_name" as const,
      truth: buildProjectEvidenceTruth({ observedAt: doc.occurredAt, metadata: doc.metadata }),
    }));

    return {
      output: {
        status: "researched",
        identity: {
          entityId,
          name: match.name,
          jurisdiction: match.entity?.jurisdiction ?? match.countryCode ?? null,
          legalEntityKind: match.entity?.legalEntityKind ?? null,
          identityStatus: match.entity?.identityStatus ?? null,
        },
        candidates: [],
        evidence,
        marketIdentity: {
          status: "unavailable_no_listing",
          ticker: null,
          listingId: null,
          securityId: null,
          quote: null,
          reason: "Canonical P5 entity has no listing/security identity. LiOS did not request or fabricate a public-market quote.",
        },
        providerFallbackUsed: false,
      },
      summary: evidence.length
        ? `Found ${evidence.length} permitted Project evidence item${evidence.length === 1 ? "" : "s"} for private entity ${match.name}; no ticker or market quote was invented.`
        : `Canonical private entity ${match.name} resolved, but no permitted Project evidence matched; no ticker or market quote was invented.`,
      deterministic: true,
      sourceRefs: [entityId, ...evidence.map((item) => item.sourceRef)].slice(0, 100),
    };
  },
};
