import crypto from "node:crypto";
import { z } from "zod";
import { artifactContentSchema } from "@shared/artifactContracts";
import { numericalEvidenceSchema, normalizeEvidenceDecimal, type NumericalEvidence } from "@shared/numericalEvidenceContracts";
import type { P7ProjectDocument } from "@shared/p7ResearchContracts";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { getProject } from "./projectStore";
import { listProjectIntelligenceDocuments } from "./p7ProjectIntelligenceStore";
import { createArtifact } from "./artifactStore";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { tenantContext } from "./tenantContext";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const financialRowSchema = z.object({
  metric: z.string().trim().min(1).max(500), value: z.string().max(2_000),
  period: z.string().max(200).nullable(), unit: z.string().max(200).nullable(), currency: z.string().max(20).nullable(),
  rowIndex: z.number().int().nonnegative(), valueColumn: z.string().trim().min(1).max(200),
}).passthrough();

export function numericalEvidenceTable(document: P7ProjectDocument) {
  const declared = Array.isArray(document.metadata.financialRows) ? document.metadata.financialRows : [];
  const rows: Array<Record<string, string | null>> = [];
  const evidence: NumericalEvidence[] = [];
  let rejectedValues = 0;
  const anchor = document.metadata.anchor && typeof document.metadata.anchor === "object" ? document.metadata.anchor as Record<string, unknown> : {};
  const pageNumber = typeof anchor.pageNumber === "number" && Number.isInteger(anchor.pageNumber) && anchor.pageNumber > 0 ? anchor.pageNumber : null;
  const lineSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict();
  const line = lineSchema.safeParse(anchor.lineRange);
  const lineRange = line.success && line.data.end >= line.data.start ? line.data : null;
  for (const item of declared.slice(0, 500)) {
    const parsed = financialRowSchema.safeParse(item);
    if (!parsed.success) { rejectedValues++; continue; }
    const row = parsed.data;
    const normalizedValue = normalizeEvidenceDecimal(row.value, row.unit);
    if (normalizedValue === null) { rejectedValues++; continue; }
    const unknowns: NumericalEvidence["unknowns"] = [];
    if (!row.period) unknowns.push("period");
    if (!row.unit) unknowns.push("unit");
    if (!row.currency) unknowns.push("currency");
    if (!pageNumber && !lineRange) unknowns.push("precise_anchor");
    const target = { row: rows.length, column: "value" };
    const record = numericalEvidenceSchema.parse({
      id: `numeric:${hash(JSON.stringify({ sourceRef: document.sourceRef, contentHash: document.contentHash, row: row.rowIndex, column: row.valueColumn, target })).slice(0, 32)}`,
      target, source: { kind: "document", sourceRef: document.sourceRef, contentHash: document.contentHash,
        provider: null, receiptRef: null, field: row.metric, period: row.period || null, unit: row.unit || null, currency: row.currency || null,
        tableRef: typeof document.metadata.tableId === "string" ? document.metadata.tableId : null,
        row: row.rowIndex, column: row.valueColumn, pageNumber, lineRange },
      rawValue: row.value, normalizedValue,
      transformations: [{ operation: "decimal_text_normalization", version: "1", inputHash: hash(row.value), outputHash: hash(normalizedValue) }], unknowns,
    });
    rows.push({ metric: row.metric, period: row.period, value: normalizedValue, unit: row.unit, currency: row.currency, sourceRef: document.sourceRef });
    evidence.push(record);
  }
  const omittedValues = Math.max(0, declared.length - 500);
  const content = artifactContentSchema.parse({ kind: "table", columns: [
    { key: "metric", label: "Source field", type: "string" }, { key: "period", label: "Model period", type: "string" },
    { key: "value", label: "Exact decimal value (source units)", type: "string" }, { key: "unit", label: "Declared unit", type: "string" },
    { key: "currency", label: "Declared currency", type: "string" }, { key: "sourceRef", label: "Evidence source", type: "string" },
  ], rows, numericalEvidence: evidence });
  return { content, rejectedValues, omittedValues, incomplete: document.metadata.incomplete === true || omittedValues > 0 || rejectedValues > 0 };
}

const inputSchema = z.object({ sourceRef: z.string().trim().min(1).max(1_000), title: z.string().trim().min(1).max(300) }).strict();
const outputSchema = z.object({
  output: z.object({ artifactId: z.string(), version: z.number().int().positive(), valueCount: z.number().int().positive(), rejectedValues: z.number().int().nonnegative(), omittedValues: z.number().int().nonnegative(), incomplete: z.boolean() }).strict(),
  summary: z.string().max(2_000), deterministic: z.literal(true), sourceRefs: z.array(z.string().max(1_000)).max(100),
}).strict();
const tenantSchema = z.object({ userId: z.number().int().positive(), organizationId: z.number().int().positive().nullable(), role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]) }).strict();

export const numericalEvidenceTool: ConversationToolDefinition = {
  id: "lios.project.numeric_evidence", label: "Save exact-decimal values with cited source-field lineage", kind: "calculate",
  permissionClass: "safe_auto", access: "write", sideEffect: "internal_write", replaySafe: false,
  inputSchema, outputSchema: outputSchema.transform((value): ConversationToolResult => value), maxOutputBytes: 16 * 1024, cancel: null,
  invoke: async (input, signal, call) => {
    assertNotAborted(signal);
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) throw new Error("Numerical evidence requires Auto or My Data scope.");
    if (call.source === "agent" && call.resourceTransmissionAllowed === false) throw new Error("Project resource transmission is disabled.");
    const tenant = tenantSchema.parse(call.tenant);
    if (call.userId !== tenant.userId || !call.projectId || !call.requestId) throw new Error("Numerical evidence requires authenticated Project context.");
    const ctx = tenantContext({ id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role });
    await getProject(ctx, call.projectId);
    const parsed = inputSchema.parse(input);
    const documents = await listProjectIntelligenceDocuments(ctx, call.projectId);
    const allowed = new Set(call.allowedSourceRefs ?? []);
    const document = documents.find(doc => doc.sourceRef === parsed.sourceRef && (!allowed.size || allowed.has(doc.sourceRef) || doc.sourceRefs.some(ref => allowed.has(ref))));
    if (!document) throw new Error("Requested numerical source is not available in the permitted Project evidence.");
    if (document.metadata.structureKind !== "table" || document.sourceType !== "document") throw new Error("Numerical evidence requires an existing structured document table; no values were inferred from prose or provider claims.");
    const result = numericalEvidenceTable(document);
    if (result.content.kind !== "table" || !result.content.rows.length) throw new Error("No unambiguous declared decimal values are available; no Artifact was created.");
    assertNotAborted(signal);
    const refs = [document.sourceRef];
    const saved = await createArtifact(ctx, { projectId: call.projectId, title: parsed.title, content: result.content, sourceRefs: refs, dependencyRefs: refs,
      origin: "conversation", actorType: "conversation", requestId: call.requestId,
      note: `Exact source-unit numerical evidence; ${result.rejectedValues} ambiguous values rejected; ${result.omittedValues} values omitted; incomplete=${result.incomplete}.` });
    return { output: { artifactId: saved.artifact.id, version: saved.version.version, valueCount: result.content.rows.length, rejectedValues: result.rejectedValues, omittedValues: result.omittedValues, incomplete: result.incomplete },
      summary: `Saved ${result.content.rows.length} exact decimal value(s) with source field/period/unit/hash/normalization lineage to ${saved.artifact.id}@v1. No scaling or binary floating-point rounding; ${result.rejectedValues} rejected and ${result.omittedValues} omitted value(s).`,
      deterministic: true, sourceRefs: [...refs, `${saved.artifact.id}@v1`] };
  },
};
