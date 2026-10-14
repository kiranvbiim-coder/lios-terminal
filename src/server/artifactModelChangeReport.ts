import { z } from "zod";
import { artifactContentSchema, type ArtifactContent, type SpreadsheetCell } from "@shared/artifactContracts";
import { getArtifact, getArtifactVersion, persistProjectConversationDraft } from "./artifactStore";
import { loadIntegratedModelArtifactSource } from "./integratedModelArtifact";
import { hashLedgerValue } from "./ledgerStore";
import type { TenantContext } from "./tenantContext";

export const modelChangeReportRequestSchema = z.object({ fromVersion: z.number().int().positive(), toVersion: z.number().int().positive(), toContentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Workbook = Extract<ArtifactContent, { kind: "spreadsheet" }>;
interface Observation { sheet: string; ref: string; cell: SpreadsheetCell; }
function observations(content: Workbook): Map<string, Observation> {
  const result = new Map<string, Observation>();
  for (const sheet of content.sheets) for (const [ref, cell] of Object.entries(sheet.cells)) {
    const l = cell.lineage;
    const semantic = l ? `${l.kind}:${l.fiscalYear ?? ""}:${l.periodEnd ?? ""}:${l.canonicalKey ?? l.resultPath?.replace(/forecast\.\d+\./, "") ?? l.sourcePath ?? ref}` : ref;
    const key = `${sheet.id}:${semantic}`;
    if (result.has(key)) throw new Error("Model report has ambiguous cell lineage; no values were silently combined.");
    result.set(key, { sheet: sheet.name, ref, cell });
  }
  return result;
}
export function modelChangeReportContent(before: Workbook, after: Workbook, refs: string[]): Extract<ArtifactContent, { kind: "report" }> {
  const left = observations(before), right = observations(after);
  const rows: Record<string, string>[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key), b = right.get(key);
    if (a?.cell.raw === b?.cell.raw && a?.cell.format === b?.cell.format) continue;
    const l = b?.cell.lineage ?? a?.cell.lineage;
    rows.push({ category: l?.kind ?? "authored_cell", period: l?.fiscalYear ?? "", metric: l?.canonicalKey ?? l?.resultPath ?? key, location: `${b?.sheet ?? a?.sheet}!${b?.ref ?? a?.ref}`, before: a?.cell.raw ?? "(absent)", after: b?.cell.raw ?? "(absent)", reason: l?.kind === "reported_actual" ? "Recorded source period/actual changed; consult exact snapshot references." : l?.kind === "engine_output" ? "Persisted downstream output changed; no computation was performed by this report." : "Authored input, layout or metadata changed; not a source-verification claim.", oldSource: a?.cell.lineage?.contentHash ?? a?.cell.lineage?.resultHash ?? "", newSource: b?.cell.lineage?.contentHash ?? b?.cell.lineage?.resultHash ?? "" });
  }
  if (rows.length > 50_000) throw new Error("Model change report exceeds the complete-row publication bound.");
  const content = artifactContentSchema.parse({ kind: "report", templateId: "model_change_report", blocks: [
    { id: "method", type: "callout", text: "Exact recorded version comparison. Reported actuals, downstream persisted outputs and authored changes remain distinct. No provider refresh, model recalculation, inferred reason, approval or execution occurred." },
    { id: "changes", type: "table", text: `${rows.length} complete changed observations`, attrs: { table: { kind: "table", columns: ["category", "period", "metric", "location", "before", "after", "reason", "oldSource", "newSource"].map(key => ({ key, label: key, type: "string" })), rows }, sourceRefs: refs } },
    { id: "sources", type: "paragraph", text: refs.join("\n"), attrs: { sourceRefs: refs } },
  ], sections: [{ id: "change-report", title: "Model changes and reported restatements", blockIds: ["method", "changes", "sources"] }] });
  if (content.kind !== "report") throw new Error("Expected report projection.");
  return content;
}
export async function createModelChangeReport(ctx: TenantContext, artifactId: string, raw: unknown) {
  const request = modelChangeReportRequestSchema.parse(raw);
  if (request.fromVersion >= request.toVersion) throw new Error("Select an earlier source revision and a later model revision.");
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.kind !== "spreadsheet" || artifact.ownerUserId !== ctx.userId || artifact.status !== "active" || !artifact.projectId) throw new Error("An owned active Project model is required.");
  const [from, to] = await Promise.all([getArtifactVersion(ctx, artifactId, request.fromVersion), getArtifactVersion(ctx, artifactId, request.toVersion)]);
  if (to.contentHash !== request.toContentHash) throw new Error("Selected model hash changed; review again.");
  for (const version of [from, to]) {
    const engine = version.refreshSpec?.engineRef;
    const run = typeof engine === "string" ? /^integrated_financial_model:[^:]+:run:([0-9a-f-]{36})$/.exec(engine) : null;
    if (!run) throw new Error("Selected revision has no canonical persisted model run.");
    await loadIntegratedModelArtifactSource(ctx, run[1], artifact.projectId);
    if (hashLedgerValue(version.content) !== version.contentHash) throw new Error("Stored model content hash is invalid.");
  }
  const before = artifactContentSchema.parse(from.content), after = artifactContentSchema.parse(to.content);
  if (before.kind !== "spreadsheet" || after.kind !== "spreadsheet") throw new Error("Model revisions must remain spreadsheets.");
  const refs = [...new Set([`${artifactId}@v${from.version}`, `${artifactId}@v${to.version}`, `artifact-content-sha256:${from.contentHash}`, `artifact-content-sha256:${to.contentHash}`, ...from.sourceRefs, ...to.sourceRefs])];
  const content = modelChangeReportContent(before, after, refs);
  const identity = hashLedgerValue({ artifactId, request, owner: ctx.userId, organization: ctx.organizationId });
  const requestId = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-8${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
  return persistProjectConversationDraft(ctx, { projectId: artifact.projectId, requestId, draft: { schemaVersion: "1", artifactId: `model-change:${identity}`, artifactType: "model.change.report", title: `${artifact.title} changes v${from.version}–v${to.version}`, projectId: artifact.projectId, sourceRefs: refs, executionReceiptIds: [], data: content, persistence: "project_candidate" }, dependencyRefs: refs });
}
