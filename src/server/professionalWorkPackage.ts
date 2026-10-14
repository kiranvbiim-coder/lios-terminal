import { z } from "zod";
import { artifactContentSchema, type ArtifactContent, type RichArtifactBlock } from "@shared/artifactContracts";
import { getArtifact, getArtifactVersion, persistProjectConversationDraft } from "./artifactStore";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { hashLedgerValue } from "./ledgerStore";
import type { TenantContext } from "./tenantContext";
export const professionalWorkPackageRequestSchema = z.object({ projectId: z.number().int().positive(), workflow: z.enum(["ic_memo", "credit_memo", "deal_memo", "board_materials", "banking_pitch", "client_proposal", "client_report"]), title: z.string().trim().min(1).max(300), audience: z.string().trim().min(1).max(300), reportingPeriod: z.string().trim().min(1).max(300), brand: z.string().max(300).default(""), sources: z.array(z.object({ artifactId: z.string().startsWith("artifact:"), version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), role: z.enum(["evidence", "financial_model", "current", "proposed", "decision"]) }).strict()).min(1).max(12), authoredSections: z.array(z.object({ title: z.string().trim().min(1).max(300), text: z.string().max(20_000) }).strict()).min(1).max(30) }).strict();
export type ProfessionalWorkPackageRequest = z.infer<typeof professionalWorkPackageRequestSchema>;
const sections = {
  ic_memo: ["Executive recommendation", "Company and market", "Investment thesis", "Financial and return cases", "Risks and mitigants", "Diligence and proposed terms"],
  credit_memo: ["Credit recommendation", "Borrower and industry", "Financial and downside analysis", "Capital structure and covenants", "Relative value", "Risks and monitoring"],
  deal_memo: ["Transaction recommendation", "Strategic rationale", "Valuation and consideration", "Funding and returns", "Diligence and execution risks", "Terms and conditions"],
  board_materials: ["Board action requested", "Strategic context", "Financial overview", "Alternatives and valuation", "Transaction and risks", "Next steps"],
  banking_pitch: ["Engagement objective", "Strategic positioning", "Valuation evidence", "Transaction alternatives", "Financing considerations", "Execution plan"],
  client_proposal: ["Client objective and scope", "Current situation", "Proposed approach", "Goal and portfolio context", "Costs risks and suitability", "Client review and next steps"],
  client_report: ["Executive review", "Recorded performance", "Current versus proposed allocation", "Net worth and planning", "Fees and limitations", "Action items"],
};
export function assembleProfessionalWorkPackage(input: ProfessionalWorkPackageRequest, snapshots: { id: string; version: number; hash: string; title: string; role: string; content: ArtifactContent; sourceRefs: string[] }[]) {
  const blocks: RichArtifactBlock[] = [], sourceRefs = new Set<string>();
  const add = (id: string, type: RichArtifactBlock["type"], text: string, attrs: Record<string, unknown> = {}) => blocks.push({ id, type, text, attrs });
  add("scope", "callout", `${input.brand ? input.brand + " · " : ""}${input.audience} · ${input.reportingPeriod}. Authored institutional work, not an approval, fairness opinion, suitability certification or execution instruction. Source snapshots are recorded, not refreshed. Missing required analysis is explicitly disclosed, never invented.`);
  const authored = new Map(input.authoredSections.map(item => [item.title.toLowerCase(), item.text]));
  for (const [index, heading] of sections[input.workflow].entries()) {
    add(`section-${index}`, "heading", heading, { level: 1 });
    const text = authored.get(heading.toLowerCase());
    add(`analysis-${index}`, text ? "paragraph" : "callout", text ?? `Not supplied: ${heading}. Review the recorded source appendices and complete this analysis before relying on the package.`, { provenance: { evidenceKind: text ? "user_asserted" : "data_gap" } });
  }
  for (const [index, item] of input.authoredSections.entries()) if (!sections[input.workflow].some(heading => heading.toLowerCase() === item.title.toLowerCase())) { add(`authored-heading-${index}`, "heading", item.title); add(`authored-text-${index}`, "paragraph", item.text, { provenance: { evidenceKind: "user_asserted" } }); }
  for (const [index, source] of snapshots.entries()) {
    const ref = `${source.id}@v${source.version}`; sourceRefs.add(ref); source.sourceRefs.forEach(value => sourceRefs.add(value));
    const attrs = { sourceArtifactId: source.id, sourceVersion: source.version, sourceHash: source.hash, sourceRef: ref, sourceRefs: [ref, ...source.sourceRefs], role: source.role };
    add(`source-heading-${index}`, "heading", `${source.role.toUpperCase()} · ${source.title} · v${source.version}`);
    const content = source.content;
    if (content.kind === "table") add(`table-${index}`, "table", "Exact recorded source table", { ...attrs, table: content });
    else if (content.kind === "chart") add(`chart-${index}`, "chart_ref", "Recorded source chart; no recalculation", { ...attrs, chart: content });
    else if (content.kind === "report" || content.kind === "research") content.blocks.forEach((block, row) => add(`source-${index}-${row}`, block.type, block.text, { ...block.attrs, ...attrs, originalBlockId: block.id }));
    else if (content.kind === "spreadsheet") content.sheets.forEach((sheet, row) => add(`sheet-${index}-${row}`, "table", `${sheet.name} · exact raw/formula observations, not recalculated values`, { ...attrs, table: { kind: "table", columns: [{ key: "cell", label: "Cell", type: "string" }, { key: "raw", label: "Exact raw / formula", type: "string" }, { key: "format", label: "Format", type: "string" }, { key: "origin", label: "Recorded source origin", type: "string" }], rows: Object.entries(sheet.cells).map(([cell, value]) => ({ cell, raw: value.raw, format: value.format ?? "", origin: value.lineage ? JSON.stringify(value.lineage) : "Unbound authored cell" })) } }));
    else add(`record-${index}`, "code", JSON.stringify(content, null, 2), attrs);
  }
  const templateId = input.workflow === "credit_memo" ? "risk_report" : input.workflow.startsWith("client_") ? "portfolio_review" : input.workflow === "board_materials" ? "earnings_preview" : "investment_memo";
  const content = artifactContentSchema.parse({ kind: "report", templateId, blocks, sections: [{ id: "package", title: input.title, blockIds: blocks.map(block => block.id) }] });
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > 4 * 1024 * 1024) throw new Error("Complete selected work package exceeds the publication bound; select fewer sources rather than silently truncate.");
  return { content, sourceRefs: [...sourceRefs] };
}
export async function createProfessionalWorkPackage(ctx: TenantContext, raw: unknown) {
  const input = professionalWorkPackageRequestSchema.parse(raw);
  if (input.workflow === "client_proposal" && (!input.sources.some(item => item.role === "current") || !input.sources.some(item => item.role === "proposed"))) throw new Error("A client proposal requires explicit current and proposed snapshots; neither is inferred.");
  const snapshots = [];
  for (const selected of input.sources) {
    const artifact = await getArtifact(ctx, selected.artifactId);
    if (artifact.projectId !== input.projectId || artifact.ownerUserId !== ctx.userId || artifact.status !== "active") throw new Error("Select owned active sources from this Project only.");
    const version = await getArtifactVersion(ctx, artifact.id, selected.version);
    if (version.contentHash !== selected.contentHash || hashLedgerValue(version.content) !== version.contentHash) throw new Error("Selected immutable source hash does not match.");
    for (const ref of [...version.sourceRefs, ...version.dependencyRefs]) if (ref.startsWith("entitlement-policy:")) {
      const policy = await getEntitlementPolicyById(ref.slice("entitlement-policy:".length)), now = new Date();
      if (!policy || policy.effectiveFrom > now || policy.effectiveTo && policy.effectiveTo <= now || !["display", "export", "derived_output"].every(use => policy.permittedUses.includes(use)) || policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_")) throw new Error("Current source rights do not permit this work package.");
    }
    snapshots.push({ id: artifact.id, version: version.version, hash: version.contentHash, title: artifact.title, role: selected.role, content: artifactContentSchema.parse(version.content), sourceRefs: version.sourceRefs });
  }
  const output = assembleProfessionalWorkPackage(input, snapshots);
  const identity = hashLedgerValue({ input, owner: ctx.userId, organization: ctx.organizationId });
  const requestId = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-8${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
  return persistProjectConversationDraft(ctx, { projectId: input.projectId, requestId, draft: { schemaVersion: "1", artifactId: `professional-work:${identity}`, artifactType: "professional.work.report", title: input.title, projectId: input.projectId, sourceRefs: output.sourceRefs, executionReceiptIds: [], data: output.content, persistence: "project_candidate" }, dependencyRefs: output.sourceRefs });
}
