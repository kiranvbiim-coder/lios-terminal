import { z } from "zod";
import { spreadsheetArtifactContentSchema, type ArtifactContent } from "@shared/artifactContracts";
import { nativeSpreadsheetRaw } from "@shared/spreadsheetNativeRaw";
import { getArtifact, getArtifactVersion, createArtifactProposal } from "./artifactStore";
import { hashLedgerValue } from "./ledgerStore";
import { parseSpreadsheetArtifactImport, parseSpreadsheetArtifactImportIsolated } from "./spreadsheetArtifactImport";
import { resolveSandboxRuntimeProfile } from "./exec/sandbox-runtime-profile";
import type { TenantContext } from "./tenantContext";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
type Workbook = Extract<ArtifactContent, { kind: "spreadsheet" }>;
export function reconcileReturnedSpreadsheet(base: Workbook, imported: Workbook, source: { artifactId: string; version: number; contentHash: string }): Workbook {
  const metadata = imported.sheets.filter(sheet => sheet.cells.A1?.raw === "LiOS P4 export provenance");
  if (metadata.length !== 1) throw new Error("Return an XLSX exported from this saved LiOS workbook; source metadata is missing or ambiguous.");
  const row = (label: string) => { const pair = Object.entries(metadata[0].cells).find(([ref, cell]) => /^A\d+$/.test(ref) && cell.raw === label); return pair ? metadata[0].cells[`B${pair[0].slice(1)}`]?.raw : undefined; };
  if (row("P4 Artifact ID") !== source.artifactId || row("Artifact version") !== String(source.version) || row("Content SHA-256") !== source.contentHash) throw new Error("Returned XLSX source identity/version/hash does not match the owned immutable workbook.");
  const expectedNames = new Set(base.sheets.map(sheet => sheet.name));
  if (imported.sheets.some(sheet => !expectedNames.has(sheet.name) && sheet !== metadata[0])) throw new Error("New or renamed analytical worksheets are unsupported in this source-bound return; import separately instead.");
  const sheets = base.sheets.map(previous => {
    const actual = imported.sheets.find(sheet => sheet.name === previous.name);
    if (!actual || actual === metadata[0]) throw new Error("A source analytical worksheet is missing or ambiguous.");
    const cells: typeof previous.cells = {};
    let rowCount = previous.rowCount, columnCount = previous.columnCount;
    for (const ref of new Set([...Object.keys(previous.cells), ...Object.keys(actual.cells)])) {
      const before = previous.cells[ref], after = actual.cells[ref];
      if (!after) { if (before?.lineage) cells[ref] = { ...before, raw: "" }; continue; }
      const coordinates = /^([A-Z]+)([1-9]\d*)$/.exec(ref);
      if (!coordinates) throw new Error("Returned worksheet contains an invalid cell reference.");
      let column = 0;
      for (const letter of coordinates[1]) column = column * 26 + letter.charCodeAt(0) - 64;
      rowCount = Math.max(rowCount, Number(coordinates[2])); columnCount = Math.max(columnCount, column);
      const raw = before && nativeSpreadsheetRaw(before.raw, before.format) === after.raw ? before.raw : after.raw;
      const format = before?.format == null && (after.format == null || after.format === "General") ? null : after.format;
      cells[ref] = { raw, format, ...(before?.lineage ? { lineage: before.lineage } : {}) };
    }
    return { ...previous, cells, names: actual.names, rowCount, columnCount };
  });
  return spreadsheetArtifactContentSchema.parse({ ...base, sheets });
}
export async function proposeSpreadsheetReturn(ctx: TenantContext, artifactId: string, body: unknown, file: { buffer: Buffer; originalname: string }) {
  const input = z.object({ baseVersion: z.coerce.number().int().positive(), baseHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(body);
  if (file.buffer.length > 20 * 1024 * 1024 || !/\.xlsx$/i.test(file.originalname)) throw new Error("Choose a bounded LiOS-exported XLSX file.");
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.kind !== "spreadsheet" || artifact.ownerUserId !== ctx.userId || artifact.headVersion !== input.baseVersion || artifact.status !== "active") throw new Error("Workbook is unavailable or the source revision moved.");
  const version = await getArtifactVersion(ctx, artifactId, input.baseVersion);
  if (version.contentHash !== input.baseHash || hashLedgerValue(version.content) !== input.baseHash) throw new Error("Source workbook hash changed.");
  for (const ref of [...version.sourceRefs, ...(version.dependencyRefs ?? [])]) if (ref.startsWith("entitlement-policy:")) {
    const policy = await getEntitlementPolicyById(ref.slice("entitlement-policy:".length));
    const now = new Date();
    if (!policy || policy.effectiveFrom > now || (policy.effectiveTo && policy.effectiveTo <= now) || !policy.permittedUses.includes("display") || !policy.permittedUses.includes("export") || policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_")) throw new Error("Current source rights do not permit this workbook return.");
  }
  const profile = resolveSandboxRuntimeProfile();
  const upload = { bytes: file.buffer, originalName: file.originalname };
  const parsed = profile.mode === "strict" ? await parseSpreadsheetArtifactImportIsolated(upload, { backend: profile.backend!, sandboxNodePath: profile.tools.node!, sandboxXlsxModulePath: profile.tools.xlsxModule! }) : parseSpreadsheetArtifactImport(upload);
  if (parsed.unsupportedFeatures.some(feature => feature !== "defined_names")) throw new Error("Returned workbook contains unsupported charts, pivots or external links; no changes were staged.");
  const base = spreadsheetArtifactContentSchema.parse(version.content);
  const next = reconcileReturnedSpreadsheet(base, parsed.content, { artifactId, version: input.baseVersion, contentHash: input.baseHash });
  if (hashLedgerValue(next) === version.contentHash) return { changed: false, proposal: null };
  return { changed: true, proposal: await createArtifactProposal(ctx, { artifactId, baseVersion: input.baseVersion, type: "artifact_patch", summary: `Review actual XLSX return edits; file SHA-256 ${parsed.sha256}. Formulas and historical source bindings are not recalculated or newly verified.`, patch: next as unknown as Record<string, unknown>, actorType: "user" }) };
}
