// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { useState } from "react";
import type { ArtifactContent } from "@shared/artifactContracts";
import {
  formatReadableNumber, humanizeKey, modelDisplayName, omitKeys, recordOrNull, RUN_METADATA_KEYS, type ReadableFormatOptions,
} from "@/lib/artifactReadableFormat";
import { ExpertJsonView } from "./ArtifactExpertView";
import { ReadableChart } from "./ArtifactReadableChart";
import { ArtifactFootnote, ArtifactTrustBadges, type ArtifactProvenanceFacts } from "./ArtifactTrustSummary";
import { ReadableCell, ReadableValueTable, ScenarioComparisonTable } from "./ReadableValueTable";
import { parseSensitivityGrid, SensitivityGridTable } from "./SensitivityGridTable";

type ValuationContent = Extract<ArtifactContent, { kind: "valuation" }>;

/** Full-precision toggle shared by the readable calculation views. */
export function ExactValuesToggle({ showExact, onChange }: { showExact: boolean; onChange: (next: boolean) => void }) {
  return <button type="button" aria-pressed={showExact} onClick={() => onChange(!showExact)}
    className="rounded border border-border/50 px-3 py-2 font-ui text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
    {showExact ? "Show formatted numbers" : "Show full precision"}
  </button>;
}

export default function ValuationArtifactView({ content, facts = {}, onSave, onDirtyChange, disabled = false, expertDefaultOpen = false, initialShowExact = false }: {
  content: ValuationContent;
  facts?: ArtifactProvenanceFacts;
  onSave: (content: ArtifactContent) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
  expertDefaultOpen?: boolean;
  initialShowExact?: boolean;
}) {
  const [showExact, setShowExact] = useState(initialShowExact);
  const currency = typeof content.assumptions.currency === "string" ? content.assumptions.currency : null;
  const options: ReadableFormatOptions = { showExact, currency };
  const summary = content.summary;
  const outputs = content.outputs;
  const base = recordOrNull(outputs.base);
  const scenarioRecords = recordOrNull(outputs.scenarios);
  const scenarios = scenarioRecords && Object.values(scenarioRecords).every(item => recordOrNull(item) !== null) && Object.keys(scenarioRecords).length
    ? scenarioRecords as Record<string, Record<string, unknown>> : null;
  const grid = parseSensitivityGrid(outputs.sensitivity);
  const conventions = recordOrNull(outputs.conventions);
  const handled: Record<string, true> = {
    ...(base ? { base: true as const } : {}), ...(scenarios ? { scenarios: true as const } : {}),
    ...(grid ? { sensitivity: true as const } : {}), ...(conventions ? { conventions: true as const } : {}),
  };
  const leftover = omitKeys(outputs, handled);
  const extraSummary = omitKeys(summary, RUN_METADATA_KEYS);
  const headline = base && typeof base.valuePerShare === "number" ? base.valuePerShare : null;
  const headlineText = headline === null ? null : formatReadableNumber("valuePerShare", headline, options);
  const baseRow = grid && typeof base?.waccPct === "number" ? grid.rowValues.indexOf(base.waccPct) : -1;
  const baseColumn = grid && typeof base?.terminalGrowthPct === "number" && base.terminalMethod === "gordon_growth" ? grid.columnValues.indexOf(base.terminalGrowthPct) : -1;
  const model = modelDisplayName(summary, content.modelId);
  const rowLabel = grid ? humanizeKey(grid.rowKey) : "";
  const columnLabel = grid ? humanizeKey(grid.columnKey) : "";
  const modelVersion = typeof summary.modelVersion === "string" ? summary.modelVersion : null;
  const outputHash = typeof summary.outputSnapshotHash === "string" ? summary.outputSnapshotHash : null;
  const unitsNote = conventions && typeof conventions.currencyUnits === "string"
    ? "Amounts use the same currency units as the cash flows and net debt you supplied; no currency conversion is applied."
    : currency ? null : "Amounts use the units of the inputs you supplied; no currency conversion is applied.";

  return <section aria-label="Valuation Artifact" data-testid="valuation-artifact-view" className="space-y-3">
    <header className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-ui text-[16px] font-semibold">{model}</h2>
        <span className="font-ui text-[13px] text-muted-foreground">{content.symbol ? content.symbol : "No ticker attached"}</span>
        <span className="ml-auto"><ExactValuesToggle showExact={showExact} onChange={setShowExact} /></span>
      </div>
      <ArtifactTrustBadges dataClassification={summary.dataClassification} validationLevel={summary.validationLevel} sourceCount={facts.sourceCount} />
      {headlineText && <div className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-3" data-testid="valuation-headline">
        <div className="font-ui text-[12px] uppercase tracking-wide text-muted-foreground">Base case value per share</div>
        <div className="font-ui text-[24px] font-semibold"><ReadableCell text={headlineText.text} exact={headlineText.exact} align="left" /></div>
      </div>}
    </header>
    {scenarios && <ScenarioComparisonTable title="Scenarios" scenarios={scenarios} options={options} leadKey="valuePerShare"
      note="Bear, base and bull cases side by side, using the inputs recorded with this Artifact." />}
    {!scenarios && base && <ReadableValueTable title="Base case result" values={base} options={options} />}
    {grid && <SensitivityGridTable title="Sensitivity" grid={grid} rowLabel={rowLabel} columnLabel={columnLabel}
      valueLabel={humanizeKey(grid.valueKey)} rowKey={grid.rowKey} columnKey={grid.columnKey} valueKey={grid.valueKey}
      base={{ row: baseRow >= 0 ? baseRow : null, column: baseColumn >= 0 ? baseColumn : null }} options={options} />}
    {grid && grid.rowValues.length >= 2 && <ReadableChart title="Sensitivity chart"
      caption={`Each line holds ${columnLabel.toLowerCase()} fixed; the horizontal axis is ${rowLabel}.`}
      series={grid.columnValues.map((column, columnIndex) => ({
        id: `column-${columnIndex}`,
        label: `${columnLabel} ${formatReadableNumber(grid.columnKey, column, { showExact: true }).text}`,
        points: grid.rowValues.map((row, rowIndex) => ({ x: row, y: grid.matrix[rowIndex][columnIndex] })),
      }))} />}
    <ReadableValueTable title="Assumptions" values={content.assumptions} options={options} emptyText="No assumptions were recorded." note="Inputs used for this calculation." />
    {Object.keys(leftover).length > 0 && <ReadableValueTable title={grid || base || scenarios ? "Other results" : "Results"} values={leftover} options={options} />}
    {conventions && <ReadableValueTable title="Calculation conventions" values={conventions} options={options} />}
    {Object.keys(extraSummary).length > 0 && <ReadableValueTable title="Recorded details" values={extraSummary} options={options} />}
    <ArtifactFootnote facts={facts} model={modelVersion} fingerprint={outputHash} units={unitsNote} />
    <ExpertJsonView content={content} onSave={onSave} onDirtyChange={onDirtyChange} disabled={disabled} defaultOpen={expertDefaultOpen} />
  </section>;
}
