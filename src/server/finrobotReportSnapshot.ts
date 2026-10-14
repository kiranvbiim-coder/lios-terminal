/**
 * FinRobot-derived immutable report snapshot / sourced-number provenance gate.
 *
 * Source pin: AI4Finance-Foundation/FinRobot
 * 2717499b8e30f242640af08c4ad9afd1113c2d45 (Apache-2.0).
 * Original mechanisms: finrobot_desktop/desktop/src/pages/artifact-detail/reportData.ts,
 * finrobot_desktop/desktop/src/components/SourcedNumber.tsx,
 * finrobot_desktop/desktop/src/export/reportExportQueries.ts.
 *
 * LiOS adaptation: no live price/refetch, no donor artifact DB or report
 * renderer; inspect only the owned immutable P4 version loaded through the
 * canonical ArtifactStore and report unavailable/uncited values explicitly.
 * This summary is diagnostic, NEVER proof of market data correctness or rights.
 */
import type { ArtifactContent } from "@shared/artifactContracts";
import { artifactContentSchema } from "@shared/artifactContracts";
import { z } from "zod";

export const FINROBOT_SOURCE_LINEAGE = Object.freeze({
  repository: "AI4Finance-Foundation/FinRobot",
  commit: "2717499b8e30f242640af08c4ad9afd1113c2d45",
  license: "Apache-2.0",
  installedDonorRuntime: false,
});

const recordedSnapshotSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(5_000),
  executionReceiptIds: z.array(z.string().trim().min(1).max(300)).max(5_000),
  content: artifactContentSchema,
}).strict();
export type RecordedReportSnapshot = z.infer<typeof recordedSnapshotSchema>;

export const finrobotReportAuditSchema = z.object({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCount: z.number().int().nonnegative(),
  receiptCount: z.number().int().nonnegative(),
  blockCount: z.number().int().nonnegative(),
  blocksWithExplicitRefs: z.number().int().nonnegative(),
  blocksWithoutExplicitRefs: z.number().int().nonnegative(),
  observedAsOfLabels: z.number().int().nonnegative(),
  fetchTimestampLabels: z.number().int().nonnegative(),
  warnings: z.array(z.string().trim().max(220)).max(8),
  validation: z.literal("recorded_provenance_not_provider_verified"),
  liveDataRefreshed: z.literal(false),
  formulaRecalculated: z.literal(false),
  approvalOrInvestmentAdvice: z.literal(false),
}).strict();

function timestamp(value: unknown): boolean {
  return typeof value === "string" && value.length <= 64
    && Number.isFinite(Date.parse(value)) && /^(?:19|20)\d\d-/.test(value);
}
function sourceRefsForBlock(attrs: Record<string, unknown>): string[] {
  const refs = [
    ...(Array.isArray(attrs.sourceRefs) ? attrs.sourceRefs : []),
    attrs.sourceRef,
  ];
  return refs.filter((v): v is string =>
    typeof v === "string" && v.trim().length > 0 && v.length <= 1_000
  );
}
/** Read the pinned P4 Artifact snapshot, never an external donor provider. */
export function inspectFinRobotReportSnapshot(raw: RecordedReportSnapshot) {
  const snapshot=recordedSnapshotSchema.parse(raw);
  const content: ArtifactContent=snapshot.content;
  const blocks=content.kind==="report"||content.kind==="research"?content.blocks:[];
  let attributed=0,asOf=0,fetched=0,formulaWarnings=0,invalidDate=0,invalidNumber=0;
  for(const b of blocks) {
    const attrs=b.attrs;
    if(sourceRefsForBlock(attrs).length)attributed++;
    // Semantic reporting period and actual acquisition time MUST remain separate.
    if(attrs.as_of!==undefined) { if(timestamp(attrs.as_of))asOf++;else invalidDate++; }
    if(attrs.fetched_at!==undefined) { if(timestamp(attrs.fetched_at))fetched++;else invalidDate++; }
    if(typeof attrs.formula_warning==="string" && attrs.formula_warning.trim())formulaWarnings++;
    // A historical rendered number may be unknown, but never rewrite it as 0.
    if(typeof attrs.numericValue==="number" && !Number.isFinite(attrs.numericValue))invalidNumber++;
  }
  const warnings:string[]=[];
  if(snapshot.sourceRefs.length===0)warnings.push("Artifact version has no recorded source references.");
  if(blocks.length>0&&attributed<blocks.length)warnings.push("Some report blocks lack explicit per-block source references; version-level refs are not proof for individual claims.");
  if(invalidDate>0)warnings.push("One or more semantic as-of or fetched-at timestamps are malformed; date truth is unavailable.");
  if(formulaWarnings>0)warnings.push("One or more recorded formulas carry an explicit warning.");
  if(invalidNumber>0)warnings.push("One or more source values are non-finite and cannot be rendered as numeric evidence.");
  if(asOf===0&&blocks.length>0)warnings.push("No explicit semantic as-of date is recorded on report blocks; a fetch time must not be substituted.");
  if(snapshot.executionReceiptIds.length===0)warnings.push("No linked execution receipt IDs were recorded for this version.");
  return finrobotReportAuditSchema.parse({
    sourceHash:snapshot.contentHash,
    sourceCount:new Set(snapshot.sourceRefs).size,
    receiptCount:new Set(snapshot.executionReceiptIds).size,
    blockCount:blocks.length,
    blocksWithExplicitRefs:attributed,
    blocksWithoutExplicitRefs:blocks.length-attributed,
    observedAsOfLabels:asOf,
    fetchTimestampLabels:fetched,
    warnings,
    validation:"recorded_provenance_not_provider_verified",
    liveDataRefreshed:false,
    formulaRecalculated:false,
    approvalOrInvestmentAdvice:false,
  });
}
