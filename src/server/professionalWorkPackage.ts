import { z } from "zod";
import { artifactContentSchema, type ArtifactContent, type RichArtifactBlock } from "@shared/artifactContracts";
import { getArtifact, getArtifactVersion, persistConversationDraft } from "./artifactStore";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { hashLedgerValue } from "./ledgerStore";
import type { TenantContext } from "./tenantContext";
import { projectReportSections, reportSectionsFromArtifact } from "./reportSectionProjection";
import type { ReportSection } from "./reportEngine";
export const professionalWorkPackageRequestSchema = z.object({ projectId: z.number().int().positive(), workflow: z.enum(["ic_memo", "credit_memo", "deal_memo", "board_materials", "banking_pitch", "client_proposal", "client_report"]), title: z.string().trim().min(1).max(300), audience: z.string().trim().min(1).max(300), reportingPeriod: z.string().trim().min(1).max(300), brand: z.string().max(300).default(""), sources: z.array(z.object({ artifactId: z.string().startsWith("artifact:"), version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), role: z.enum(["evidence", "financial_model", "current", "proposed", "decision"]) }).strict()).min(1).max(12), authoredSections: z.array(z.object({ title: z.string().trim().min(1).max(300), text: z.string().max(20_000) }).strict()).min(1).max(30) }).strict();
export type ProfessionalWorkPackageRequest = z.infer<typeof professionalWorkPackageRequestSchema>;
type ScopedWorkPackageRequest = Omit<ProfessionalWorkPackageRequest, "projectId"> & { projectId: number | null };
interface RecordedReviewComposition {
  /** Trusted server composition, never accepted from the public package request. */
  reviewSections?: ReportSection[];
  owningChatId?: number | null;
}
const sections = {
  ic_memo: ["Executive recommendation", "Company and market", "Investment thesis", "Financial and return cases", "Risks and mitigants", "Diligence and proposed terms"],
  credit_memo: ["Credit recommendation", "Borrower and industry", "Financial and downside analysis", "Capital structure and covenants", "Relative value", "Risks and monitoring"],
  deal_memo: ["Transaction recommendation", "Strategic rationale", "Valuation and consideration", "Funding and returns", "Diligence and execution risks", "Terms and conditions"],
  board_materials: ["Board action requested", "Strategic context", "Financial overview", "Alternatives and valuation", "Transaction and risks", "Next steps"],
  banking_pitch: ["Engagement objective", "Strategic positioning", "Valuation evidence", "Transaction alternatives", "Financing considerations", "Execution plan"],
  client_proposal: ["Client objective and scope", "Current situation", "Proposed approach", "Goal and portfolio context", "Costs risks and suitability", "Client review and next steps"],
  client_report: ["Executive review", "Recorded performance", "Current versus proposed allocation", "Net worth and planning", "Fees and limitations", "Action items"],
};
export function assembleProfessionalWorkPackage(input: ScopedWorkPackageRequest, snapshots: { id: string; version: number; hash: string; title: string; role: string; content: ArtifactContent; sourceRefs: string[]; dependencyRefs?: string[]; executionReceiptIds?: string[] }[], composition: RecordedReviewComposition = {}) {
  const blocks: RichArtifactBlock[] = [], sourceRefs = new Set<string>(), dependencyRefs = new Set<string>();
  const add = (id: string, type: RichArtifactBlock["type"], text: string, attrs: Record<string, unknown> = {}) => blocks.push({ id, type, text, attrs });
  add("scope", "callout", `${input.brand ? input.brand + " · " : ""}${input.audience} · ${input.reportingPeriod}. Authored institutional work, not an approval, fairness opinion, suitability certification or execution instruction. Source snapshots are recorded, not refreshed. Missing required analysis is explicitly disclosed, never invented.`);
  if (composition.reviewSections) {
    for (const [index, section] of composition.reviewSections.entries()) {
      const projected = projectReportSections({
        id: "recorded-review", templateId: "investment_memo", title: input.title, generatedAt: "",
        sections: [section],
        metadata: { outputHash: snapshots[0]?.hash ?? "", passportIds: [] },
      }, {
        attrs: { reviewPackage: true, authority: "snapshot_only" },
        firstBlockAttrs: { recordedReviewSection: section.content },
      });
      blocks.push(...projected.blocks.map(block => ({ ...block, id: `review-${index}-${block.id}` })));
    }
  } else {
    const authored = new Map(input.authoredSections.map(item => [item.title.toLowerCase(), item.text]));
    for (const [index, heading] of sections[input.workflow].entries()) {
      add(`section-${index}`, "heading", heading, { level: 1 });
      const text = authored.get(heading.toLowerCase());
      add(`analysis-${index}`, text ? "paragraph" : "callout", text ?? `Not supplied: ${heading}. Review the recorded source appendices and complete this analysis before relying on the package.`, { provenance: { evidenceKind: text ? "user_asserted" : "data_gap" } });
    }
    for (const [index, item] of input.authoredSections.entries()) if (!sections[input.workflow].some(heading => heading.toLowerCase() === item.title.toLowerCase())) { add(`authored-heading-${index}`, "heading", item.title); add(`authored-text-${index}`, "paragraph", item.text, { provenance: { evidenceKind: "user_asserted" } }); }
  }
  for (const [index, source] of snapshots.entries()) {
    const ref = `${source.id}@v${source.version}`; sourceRefs.add(ref); source.sourceRefs.forEach(value => sourceRefs.add(value));
    for (const dependency of source.dependencyRefs ?? []) dependencyRefs.add(dependency);
    const attrs = { sourceArtifactId: source.id, sourceVersion: source.version, sourceHash: source.hash, sourceRef: ref, sourceRefs: [ref, ...source.sourceRefs], dependencyRefs: source.dependencyRefs ?? [], executionReceiptIds: source.executionReceiptIds ?? [], role: source.role };
    add(`source-heading-${index}`, "heading", `${source.role.toUpperCase()} · ${source.title} · v${source.version}`, {
      ...attrs, sourceContent: source.content,
    });
    if (source.content.kind === "spreadsheet") {
      // Cell lineage remains exact once in sourceContent above. Expanding the
      // same lineage per cell into generic field blocks multiplies large
      // financial workbooks without adding readable review evidence.
      for (const [sheetIndex, sheet] of source.content.sheets.entries()) {
        const cells = Object.entries(sheet.cells);
        const sheetSections: ReportSection[] = [];
        for (let start = 0; start < cells.length || start === 0; start += 1_000) {
          sheetSections.push({
            type: "table", title: `${sheet.name} · recorded cells ${start + 1}–${Math.min(start + 1_000, cells.length)}`,
            order: sheetSections.length,
            content: {
              kind: "table",
              columns: [
                { key: "cell", label: "Cell", type: "string" },
                { key: "raw", label: "Exact raw / formula", type: "string" },
                { key: "format", label: "Format", type: "string" },
                { key: "origin", label: "Origin (exact lineage in source snapshot)", type: "string" },
              ],
              rows: cells.slice(start, start + 1_000).map(([cell, value]) => ({
                cell, raw: value.raw, format: value.format,
                origin: value.lineage?.kind ?? "Unbound authored cell",
              })),
            },
          });
        }
        const projected = projectReportSections({
          id: `${ref}:${sheet.id}`, templateId: "investment_memo", title: sheet.name, generatedAt: "",
          sections: sheetSections, metadata: { outputHash: source.hash, passportIds: [] },
        }, { attrs: { sourceRef: ref, sourceSnapshotBlockId: `source-heading-${index}`, sourceSheetId: sheet.id } });
        blocks.push(...projected.blocks.map(block => ({ ...block, id: `source-${index}-sheet-${sheetIndex}-${block.id}` })));
      }
      continue;
    }
    const sourceSections = reportSectionsFromArtifact(source.content);
    if (source.content.kind === "chart") {
      sourceSections.chart_placeholder = { artifactRef: source.id, version: source.version, contentHash: source.hash, chartType: source.content.chartType };
    }
    const projected = projectReportSections({
      id: ref, templateId: "investment_memo", title: source.title, generatedAt: "",
      sections: Object.entries(sourceSections).map(([type, content], order) => ({
        type: type as ReportSection["type"], title: `Recorded ${type.replace(/_/g, " ")}`, content, order,
      })),
      metadata: { outputHash: source.hash, passportIds: [] },
    }, { attrs: { sourceRef: ref, sourceSnapshotBlockId: `source-heading-${index}` } });
    blocks.push(...projected.blocks.map(block => ({ ...block, id: `source-${index}-${block.id}` })));
  }
  const templateId = input.workflow === "credit_memo" ? "risk_report" : input.workflow.startsWith("client_") ? "portfolio_review" : input.workflow === "board_materials" ? "earnings_preview" : "investment_memo";
  const content = artifactContentSchema.parse({ kind: "report", templateId, blocks, sections: [{ id: "package", title: input.title, blockIds: blocks.map(block => block.id) }] });
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > 4 * 1024 * 1024) throw new Error("Complete selected work package exceeds the publication bound; select fewer sources rather than silently truncate.");
  return { content, sourceRefs: [...sourceRefs], dependencyRefs: [...new Set([...sourceRefs, ...dependencyRefs])] };
}
export async function createProfessionalWorkPackage(ctx: TenantContext, raw: unknown, composition: RecordedReviewComposition = {}) {
  const input = composition.owningChatId != null
    ? professionalWorkPackageRequestSchema.extend({ projectId: z.null() }).parse(raw)
    : professionalWorkPackageRequestSchema.parse(raw);
  if (input.workflow === "client_proposal" && (!input.sources.some(item => item.role === "current") || !input.sources.some(item => item.role === "proposed"))) throw new Error("A client proposal requires explicit current and proposed snapshots; neither is inferred.");
  const snapshots = [];
  for (const selected of input.sources) {
    const artifact = await getArtifact(ctx, selected.artifactId);
    if (artifact.projectId !== input.projectId || (input.projectId === null && artifact.owningChatId !== composition.owningChatId)
      || artifact.ownerUserId !== ctx.userId || artifact.status !== "active") throw new Error("Select owned active sources from this Project or originating Chat only.");
    const version = await getArtifactVersion(ctx, artifact.id, selected.version);
    if (version.contentHash !== selected.contentHash || hashLedgerValue(version.content) !== version.contentHash) throw new Error("Selected immutable source hash does not match.");
    for (const ref of [...version.sourceRefs, ...version.dependencyRefs]) if (ref.startsWith("entitlement-policy:")) {
      const policy = await getEntitlementPolicyById(ref.slice("entitlement-policy:".length)), now = new Date();
      if (!policy || policy.effectiveFrom > now || policy.effectiveTo && policy.effectiveTo <= now || !["display", "export", "derived_output"].every(use => policy.permittedUses.includes(use)) || policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_")) throw new Error("Current source rights do not permit this work package.");
    }
    snapshots.push({ id: artifact.id, version: version.version, hash: version.contentHash, title: artifact.title, role: selected.role, content: artifactContentSchema.parse(version.content), sourceRefs: version.sourceRefs, dependencyRefs: version.dependencyRefs, executionReceiptIds: version.executionReceiptIds });
  }
  const output = assembleProfessionalWorkPackage(input, snapshots, composition);
  const identity = hashLedgerValue({ input, ...(composition.reviewSections ? { reviewSections: composition.reviewSections } : {}), ...(composition.owningChatId != null ? { owningChatId: composition.owningChatId } : {}), owner: ctx.userId, organization: ctx.organizationId });
  const requestId = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-8${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
  return persistConversationDraft(ctx, { projectId: input.projectId, owningChatId: composition.owningChatId, requestId, draft: { schemaVersion: "1", artifactId: `professional-work:${identity}`, artifactType: "professional.work.report", title: input.title, projectId: input.projectId, sourceRefs: output.sourceRefs, executionReceiptIds: [], data: output.content, persistence: "project_candidate" }, dependencyRefs: output.dependencyRefs });
}
