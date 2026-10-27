import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { canonicalDataCapabilitySchema, externalRightsSchema } from "@shared/universalDataFabric";
import { users } from "@shared/schema";
import type { SourceConnection } from "@shared/schema";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { getDb } from "./db";
import { getProject } from "./projectStore";
import { listSourceConnections } from "./sourceConnectionService";
import { createProviderRegistryForUser } from "./providerRuntimeRegistry";
import { createCanonicalDataRequest, executeCanonicalDataRequest } from "./providerSdk";
import { authorizeCanonicalDataRequests } from "./canonicalDataRequestGate";
import { getLatestExternalRightsAssessment } from "./externalRightsStore";
import { isCredentialSafeReference } from "@shared/dataFabric";
import { hashLedgerValue } from "./ledgerStore";
import type { TenantContext } from "./tenantContext";

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

const previewSchema = z.object({
  connectionId: z.number().int().positive(),
  capability: canonicalDataCapabilitySchema.default("provider_extension"),
  entityRef: z.string().trim().min(1).max(240),
  symbol: z.string().trim().max(80).nullable().default(null),
  maxRows: z.number().int().min(1).max(10).default(5),
}).strict();
const listSchema = z.object({}).strict();

const listingOutputSchema = z.object({
  output: z.object({
    sources: z.array(z.object({
      id: z.number().int().positive(),
      label: z.string(),
      connectorId: z.string(),
      sourceType: z.string(),
      verified: z.literal(true),
      previewAvailable: z.boolean(),
    }).strict()).max(50),
    dataFetchPerformed: z.literal(false),
  }).strict(),
  summary: z.string().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().max(1_000)).max(50),
}).strict();

const previewOutputSchema = z.object({
  output: z.object({
    connectionId: z.number().int().positive(),
    providerId: z.string(),
    capability: canonicalDataCapabilitySchema,
    previewRows: z.array(z.record(z.unknown())).max(10),
    returnedRows: z.number().int().nonnegative(),
    retrievedAt: z.string(),
    normalized: z.boolean(),
    rightsReviewed: z.literal(true),
    cache: z.enum(["hit", "miss", "deduped"]),
  }).strict(),
  summary: z.string().max(2_000),
  deterministic: z.literal(false),
  sourceRefs: z.array(z.string().max(1_000)).max(100),
}).strict();

type DataCall = {
  source: string;
  requestId?: string | null;
  userId?: number | null;
  projectId?: number | null;
  tenant?: unknown;
  sourceScope?: string | null;
  resourceTransmissionAllowed?: boolean | null;
  researchSourcePolicy?: {
    mode?: string;
    allowedSourceRefs?: string[];
    providerAllow?: string[];
    providerDeny?: string[];
  } | null;
};

/** Validate server-owned context; neither the model nor a request parameter can choose the tenant. */
function checkScope(call: DataCall): { tenant: TenantContext; projectId: number } {
  if (call.source !== "agent" || !call.requestId) {
    throw new Error("Connected provider tools require an authenticated governed agent call.");
  }
  if (!sourceScopeAllowsProjectData(call.sourceScope === "my_data" ? "my_data" : call.sourceScope === "auto" ? "auto" : "web")) {
    throw new Error("Connected provider data requires Auto or My Data source scope.");
  }
  if (call.resourceTransmissionAllowed !== true) {
    throw new Error("AI transmission of Project/source content is disabled.");
  }
  const tenant = tenantSchema.parse(call.tenant) as TenantContext;
  const projectId = Number(call.projectId);
  if (call.userId !== tenant.userId || !Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error("Connected provider data requires server-owned user and Project scope.");
  }
  return { tenant, projectId };
}

export function sourceAllowedForChat(
  source: Pick<SourceConnection, "id" | "status">,
  policy: DataCall["researchSourcePolicy"],
): boolean {
  if (source.status !== "healthy") return false;
  const providerId = `source:${source.id}`;
  if (policy?.providerDeny?.includes(providerId)) return false;
  if (policy?.providerAllow?.length && !policy.providerAllow.includes(providerId)) return false;
  if (policy?.mode === "only_refs" && !policy.allowedSourceRefs?.includes(`source-connection:${source.id}`)) return false;
  return true;
}

/** Explicit per-user review, not model-provided permission; unknown rights fail closed. */
export function reviewedChatReleaseRights(rights: {
  dataRights: { internalUse: string; redistribution: string };
  apiTerms: { reviewed: boolean };
} | null | undefined, sourceType: SourceConnection["sourceType"]): boolean {
  if (!rights || rights.dataRights.internalUse !== "permitted" || rights.dataRights.redistribution !== "permitted") return false;
  if (sourceType === "private_api" && !rights.apiTerms.reviewed) return false;
  return true;
}

function safeRef(ref: string): string {
  return isCredentialSafeReference(ref) ? ref : `source-ref-hash:${hashLedgerValue(ref)}`;
}

const confidentialKey = /(?:secret|password|token|credential|authorization|cookie|private[_-]?key|api[_-]?key)/i;

/**
 * Bound the content sent to the AI; this is a sample, not a claim to return
 * every row. Redact credential-like field names and never pass nested payloads
 * or raw endpoint URLs into the model context.
 */
export function safePreviewRows(data: unknown, maxRows: number): Array<Record<string, unknown>> {
  if (!data || typeof data !== "object") return [];
  const value = data as Record<string, unknown>;
  const candidate = Array.isArray(data) ? data
    : Array.isArray(value.rows) ? value.rows
    : Array.isArray(value.records) ? value.records
    : [];
  return candidate.slice(0, Math.min(Math.max(maxRows, 1), 10)).map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return { value: "[unsupported row]" };
    return Object.fromEntries(
      Object.entries(row as Record<string, unknown>).slice(0, 30).map(([key, cell]) => {
        if (confidentialKey.test(key)) return [key, "[REDACTED]"];
        if (typeof cell === "number") return [key, Number.isFinite(cell) ? cell : null];
        if (typeof cell === "boolean" || cell === null) return [key, cell];
        if (typeof cell === "string") {
          const safe = isCredentialSafeReference(cell) && !/^https?:\/\//i.test(cell);
          return [key, safe ? cell.slice(0, 500) : "[REDACTED]"];
        }
        return [key, "[nested value withheld]"];
      }),
    );
  });
}

export const connectedProviderListChatTool: ConversationToolDefinition = {
  id: "lios.provider.connected_sources",
  label: "List my verified connected data sources (identities only; no data fetch or secret values)",
  planningHint: "Call with {} to inspect the current Project owner's verified connected sources. Only source IDs, labels and types are returned; use previewAvailable=true for the connected_preview tool, and never guess IDs.",
  kind: "resolve", permissionClass: "safe_auto", access: "read", sideEffect: "none", replaySafe: true,
  inputSchema: listSchema,
  outputSchema: listingOutputSchema.transform((v): ConversationToolResult => v),
  maxOutputBytes: 16 * 1024, cancel: null,
  invoke: async (_input, signal, rawCall) => {
    assertNotAborted(signal);
    const call = rawCall as DataCall;
    const { tenant, projectId } = checkScope(call);
    await getProject(tenant, projectId);
    const connections = await listSourceConnections(tenant.userId);
    const permitted = connections.filter((connection) =>
      connection.organizationId === tenant.organizationId && sourceAllowedForChat(connection, call.researchSourcePolicy)
    ).slice(0, 50);
    assertNotAborted(signal);
    return {
      output: {
        sources: permitted.map((s) => ({ id: s.id, label: s.name, connectorId: s.connectorId, sourceType: s.sourceType, verified: true as const, previewAvailable: s.sourceType === "file" || s.sourceType === "private_api" })),
        dataFetchPerformed: false as const,
      },
      summary: `${permitted.length} verified, owner-scoped connected source(s); no data was retrieved.`,
      deterministic: true as const,
      sourceRefs: permitted.map((s) => `source-connection:${s.id}`),
    };
  },
};

export const connectedProviderPreviewChatTool: ConversationToolDefinition = {
  id: "lios.provider.connected_preview",
  label: "Retrieve a small approved preview from my verified connected source with exact provenance",
  planningHint: "First call lios.provider.connected_sources. Provide connectionId from that result, capability and an explicit entityRef; never invent IDs or tickers. This tool requires exact-step user approval, source rights reviewed for AI release, and owner Project scope. Never use it to execute MCP tools or arbitrary database SQL.",
  kind: "retrieve",
  permissionClass: "user_confirm",
  // A configured private API may use POST and external I/O. Conservatively
  // declare write access so the canonical approval ledger treats it as an
  // external side effect, never as a safe read-only shortcut.
  access: "write",
  sideEffect: "external",
  replaySafe: false,
  allowProjectApproval: false,
  inputSchema: previewSchema,
  outputSchema: previewOutputSchema.transform((v): ConversationToolResult => v),
  maxOutputBytes: 32 * 1024, cancel: null,
  invoke: async (raw, signal, rawCall) => {
    assertNotAborted(signal);
    const call = rawCall as DataCall;
    const { tenant, projectId } = checkScope(call);
    const parsed = previewSchema.parse(raw);
    await getProject(tenant, projectId);
    const source = (await listSourceConnections(tenant.userId)).find((s) =>
      s.id === parsed.connectionId && s.organizationId === tenant.organizationId,
    );
    if (!source || !sourceAllowedForChat(source, call.researchSourcePolicy)) {
      throw new Error("Requested source is unverified or excluded by the active source policy.");
    }
    // MCP tools use lios.external-mcp.call and its separate Project approval.
    // Raw database queries and cloud object URIs must never be generated by the model.
    if (source.sourceType !== "file" && source.sourceType !== "private_api") {
      throw new Error("Connected Chat preview currently supports verified local files and private API sources only.");
    }
    const rights = await getLatestExternalRightsAssessment(tenant, "data", `source-connection:${source.id}`);
    const assessedRights = externalRightsSchema.safeParse(rights?.rights);
    if (!assessedRights.success || !reviewedChatReleaseRights(assessedRights.data, source.sourceType)) {
      throw new Error("Source data is not approved for external AI use; record an explicit owner-scoped data-rights review first.");
    }
    const actorRows = await getDb().select({ id: users.id, email: users.email })
      .from(users).where(and(eq(users.id, tenant.userId))).limit(1);
    const actor = actorRows[0];
    if (!actor) throw new Error("Authenticated provider owner is unavailable.");
    const request = createCanonicalDataRequest({
      projectId,
      capability: parsed.capability,
      entity: { ref: parsed.entityRef, symbol: parsed.symbol, identifiers: {} },
      fields: [],
      parameters: { maxRows: parsed.maxRows },
      pointInTime: { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false },
      providerAllow: [`source:${source.id}`],
      providerDeny: [],
    });
    await authorizeCanonicalDataRequests([request], tenant);
    assertNotAborted(signal);
    const registry = await createProviderRegistryForUser(tenant, actor);
    // A Chat preview is an explicit, user-approved read of the current
    // source. Do not reuse TTL-cached file rows or remote API observations:
    // local files can change without a connector-settings mutation.
    const response = await executeCanonicalDataRequest(request, tenant, registry);
    assertNotAborted(signal);
    const observed = response.observation;
    if (!observed || observed.providerId !== `source:${source.id}`) {
      throw new Error("This connected source did not return an attributable observation.");
    }
    if (observed.entitlement.decision === "denied") {
      throw new Error("The provider denied use of this observation.");
    }
    const previewRows = safePreviewRows(observed.data, parsed.maxRows);
    const refs = [...new Set([`source-connection:${source.id}`, ...observed.sourceRefs.map(safeRef)])].slice(0, 100);
    return {
      output: {
        connectionId: source.id,
        providerId: observed.providerId,
        capability: parsed.capability,
        previewRows,
        returnedRows: previewRows.length,
        retrievedAt: observed.clocks.retrievedAt,
        normalized: observed.normalized,
        rightsReviewed: true as const,
        cache: "miss" as const,
      },
      summary: previewRows.length
        ? `Retrieved ${previewRows.length} preview row(s) from verified ${source.name}; truncated to the authorized preview size. Original sources are linked in this tool's source references.`
        : `Source ${source.name} returned no tabular preview rows; no observations were invented.`,
      deterministic: false as const,
      sourceRefs: refs,
    };
  },
};
