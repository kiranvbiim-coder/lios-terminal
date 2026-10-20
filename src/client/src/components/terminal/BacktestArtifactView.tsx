// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { useState } from "react";
import type { ArtifactContent } from "@shared/artifactContracts";
import type { ReadableFormatOptions } from "@/lib/artifactReadableFormat";
import { ExpertJsonView } from "./ArtifactExpertView";
import { ReadableChart } from "./ArtifactReadableChart";
import { ArtifactFootnote, type ArtifactProvenanceFacts } from "./ArtifactTrustSummary";
import { ReadableRowsTable, ReadableValueTable } from "./ReadableValueTable";
import { ExactValuesToggle } from "./ValuationArtifactView";

type BacktestContent = Extract<ArtifactContent, { kind: "backtest" }>;

const STATUS: Readonly<Record<BacktestContent["status"], { label: string; tone: string; detail: string }>> = {
  edited_not_run: { label: "Edited, not run", tone: "border-amber-300/50 text-amber-200", detail: "The strategy changed after the last run. These numbers, if any, are not from the current strategy." },
  running: { label: "Running", tone: "border-cyan-300/40 text-cyan-100", detail: "The backtest is still running; results are incomplete." },
  completed: { label: "Completed", tone: "border-emerald-300/40 text-emerald-200", detail: "The backtest finished and these are its recorded results." },
  failed: { label: "Failed", tone: "border-red-300/50 text-red-200", detail: "The backtest did not finish. Check the warnings below, then rerun." },
  stale: { label: "Out of date", tone: "border-amber-300/50 text-amber-200", detail: "Inputs or data changed since this ran. Rerun to refresh the results." },
};

export default function BacktestArtifactView({ content, facts = {}, onSave, onDirtyChange, disabled = false, expertDefaultOpen = false, initialShowExact = false }: {
  content: BacktestContent;
  facts?: ArtifactProvenanceFacts;
  onSave: (content: ArtifactContent) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
  expertDefaultOpen?: boolean;
  initialShowExact?: boolean;
}) {
  const [showExact, setShowExact] = useState(initialShowExact);
  const options: ReadableFormatOptions = { showExact };
  const status = STATUS[content.status];
  const pit = content.pointInTimeVerified === true
    ? { text: "Point-in-time data verified: each decision used only data available at that time.", tone: "text-emerald-200" }
    : content.pointInTimeVerified === false
      ? { text: "Not point-in-time verified: results may include look-ahead bias and should not be treated as tradable evidence.", tone: "text-amber-200" }
      : { text: "A point-in-time data check was not recorded for this backtest.", tone: "text-muted-foreground" };
  return <section aria-label="Backtest Artifact" data-testid="backtest-artifact-view" className="space-y-3">
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-ui text-[16px] font-semibold">Backtest{content.strategyRef ? ` · ${content.strategyRef}` : ""}</h2>
        <span className={`rounded border px-2 py-1 font-ui text-[13px] font-semibold ${status.tone}`}>{status.label}</span>
        <span className="ml-auto"><ExactValuesToggle showExact={showExact} onChange={setShowExact} /></span>
      </div>
      <p className="font-ui text-[13px] text-muted-foreground">{status.detail}</p>
      <p className={`font-ui text-[13px] ${pit.tone}`}>{pit.text}</p>
      <p className="font-ui text-[13px] text-muted-foreground">{content.trades.length} trades · {content.equityCurve.length} equity points · {content.drawdown.length} drawdown points</p>
    </header>
    {content.warnings.length > 0 && <section role="alert" aria-label="Backtest warnings" className="rounded-lg border border-amber-300/40 p-3">
      <h3 className="mb-1 font-ui text-[14px] font-semibold text-amber-200">Warnings</h3>
      <ul className="list-disc space-y-1 pl-5 font-ui text-[13px]">{content.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </section>}
    <ReadableValueTable title="Performance" values={content.metrics} options={options} emptyText="No performance metrics were recorded." />
    {Object.keys(content.benchmark).length > 0 && <ReadableValueTable title="Benchmark" values={content.benchmark} options={options} />}
    <ReadableChart title="Equity curve" series={[{ id: "equity", label: "Equity", points: content.equityCurve.map(point => ({ x: point.at, y: point.value })) }]} />
    <ReadableChart title="Drawdown" series={[{ id: "drawdown", label: "Drawdown", points: content.drawdown.map(point => ({ x: point.at, y: point.value })) }]} />
    {content.trades.length > 0 && <ReadableRowsTable title="Trades" rows={content.trades} options={options} exportHint="Export the Artifact as CSV to get every trade." />}
    <ReadableValueTable title="Assumptions" values={content.assumptions} options={options} emptyText="No assumptions were recorded." />
    <ArtifactFootnote facts={facts} fingerprint={content.reproducibilityHash}
      units={content.reproducibilityHash ? "Reproducibility fingerprint recorded: rerunning with the same inputs and data should give the same results." : "No reproducibility fingerprint was recorded for this run."} />
    <ExpertJsonView content={content} onSave={onSave} onDirtyChange={onDirtyChange} disabled={disabled} defaultOpen={expertDefaultOpen} />
  </section>;
}
