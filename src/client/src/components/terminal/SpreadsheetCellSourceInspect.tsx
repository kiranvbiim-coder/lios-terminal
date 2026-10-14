import type { SpreadsheetCell } from "@shared/artifactContracts";
import { deriveSpreadsheetCellLineageStatus } from "@shared/spreadsheetCellLineage";

const statusLabels = {
  unbound: "No recorded source binding",
  current: "Matches captured historical binding",
  edited_unverified: "Edited · captured binding is historical only",
  historical_unverified: "Imported history · source binding not verified",
  authored_unverified: "User-authored assumption · not source verified",
};

/** Read-only view of the selected cell in the existing P4 draft, never a provider freshness claim. */
export function SpreadsheetCellSourceInspect({ sheetName, cellRef, cell }: {
  sheetName: string;
  cellRef: string;
  cell: SpreadsheetCell;
}) {
  const status = deriveSpreadsheetCellLineageStatus(cell);
  const lineage = cell.lineage;
  const fields: [string, string | undefined][] = lineage ? [
    ["Origin", lineage.kind === "reported_actual" ? "Reported actual" : lineage.kind === "engine_output" ? "Persisted engine output" : "Assumption"],
    ["Custody", lineage.custody],
    ["Assumption origin", lineage.kind === "user_assumption" ? lineage.assumptionOrigin : undefined],
    ["Dataset snapshot", lineage.datasetSnapshotId],
    ["Dataset content hash", lineage.contentHash],
    ["Model run", lineage.modelRunId],
    ["Run result hash", lineage.resultHash],
    ["Statement", lineage.statement],
    ["Canonical key", lineage.canonicalKey],
    ["Source path", lineage.sourcePath],
    ["Result path", lineage.resultPath],
    ["Period", lineage.period],
    ["Fiscal year", lineage.fiscalYear],
    ["Period end", lineage.periodEnd],
    ["Recorded availability", lineage.availableAt],
    ["Currency", lineage.currency],
    ["Source unit", lineage.sourceUnit],
    ["Entitlement policy", lineage.entitlementPolicyRef],
    ["Numeric representation", lineage.numericRepresentation],
    ["Captured value hash", lineage.capturedValueHash],
  ] : [];
  return <section aria-label="Selected cell source" data-testid="spreadsheet-cell-source-inspect" className="mt-3 rounded-lg border border-border/50 p-3 text-[13px]">
    <div className="flex flex-wrap gap-2 font-terminal"><span>{sheetName} · {cellRef}</span><span data-testid="spreadsheet-cell-lineage-status" data-lineage-status={status} className={status === "edited_unverified" ? "text-amber-200" : "text-muted-foreground"}>{statusLabels[status]}</span></div>
    <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[160px_1fr]">
      <dt className="text-muted-foreground">Current raw / formula</dt><dd data-testid="spreadsheet-cell-current-raw" className="whitespace-pre-wrap break-all font-terminal">{cell.raw || "(empty)"}</dd>
      <dt className="text-muted-foreground">Current format</dt><dd className="break-all font-terminal">{cell.format ?? "(none)"}</dd>
      {lineage && <><dt className="text-muted-foreground">Captured raw / formula</dt><dd data-testid="spreadsheet-cell-captured-raw" className="whitespace-pre-wrap break-all font-terminal">{lineage.capturedRaw || "(empty)"}</dd><dt className="text-muted-foreground">Captured format</dt><dd className="break-all font-terminal">{lineage.capturedFormat ?? "(none)"}</dd></>}
      {fields.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="break-all font-terminal">{value}</dd></div>)}
      {lineage && <><dt className="text-muted-foreground">Source references</dt><dd>{lineage.sourceRefs.length ? <ul className="space-y-1">{lineage.sourceRefs.map((sourceRef, index) => <li key={`${index}:${sourceRef}`} className="break-all font-terminal">{sourceRef}</li>)}</ul> : "None recorded"}</dd></>}
    </dl>
    <p className="mt-2 text-muted-foreground">{lineage ? "Recorded historical provenance only. Matching captured text and format does not establish live source freshness, recomputation, or verification of an edited value." : "This cell has no recorded source lineage. Its raw value or formula remains in the canonical spreadsheet draft."}</p>
  </section>;
}
