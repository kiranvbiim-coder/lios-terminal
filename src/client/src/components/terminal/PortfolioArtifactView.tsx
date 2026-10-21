// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { useState } from "react";
import type { ArtifactContent } from "@shared/artifactContracts";
import { modelDisplayName, omitKeys, recordOrNull, RUN_METADATA_KEYS, type ReadableFormatOptions } from "@/lib/artifactReadableFormat";
import { ExpertJsonView } from "./ArtifactExpertView";
import { ArtifactFootnote, ArtifactTrustBadges, type ArtifactProvenanceFacts } from "./ArtifactTrustSummary";
import { ReadableRowsTable, ReadableValueTable } from "./ReadableValueTable";
import { ExactValuesToggle } from "./ValuationArtifactView";

type PortfolioContent = Extract<ArtifactContent, { kind: "portfolio" }>;

export default function PortfolioArtifactView({ content, facts = {}, onSave, onDirtyChange, disabled = false, expertDefaultOpen = false, initialShowExact = false }: {
  content: PortfolioContent;
  facts?: ArtifactProvenanceFacts;
  onSave: (content: ArtifactContent) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
  expertDefaultOpen?: boolean;
  initialShowExact?: boolean;
}) {
  const [showExact, setShowExact] = useState(initialShowExact);
  const options: ReadableFormatOptions = { showExact };
  const summary = content.summary;
  const isModelRun = typeof summary.modelPath === "string";
  const summaryBody = omitKeys(summary, RUN_METADATA_KEYS);
  const parameters = recordOrNull(summaryBody.parameters);
  const result = recordOrNull(summaryBody.result);
  const summaryRest = isModelRun && (parameters || result) ? omitKeys(summaryBody, { parameters: true, result: true }) : summaryBody;
  const risk = recordOrNull(content.risk) ?? {};
  // Model-run portfolios repeat the same parameters/result under `risk`; show them once.
  const riskRepeatsSummary = isModelRun && risk.modelPath === summary.modelPath;
  const title = isModelRun ? modelDisplayName(summary, typeof summary.modelId === "string" ? summary.modelId : null) : "Portfolio";
  const modelVersion = typeof summary.modelVersion === "string" ? summary.modelVersion : null;
  const outputHash = typeof summary.outputSnapshotHash === "string" ? summary.outputSnapshotHash : null;
  return <section aria-label="Portfolio Artifact" data-testid="portfolio-artifact-view" className="space-y-3">
    <header className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-ui text-[16px] font-semibold">{title}</h2>
        <span className="font-ui text-[13px] text-muted-foreground">{content.portfolioRef ?? "No portfolio linked"}</span>
        <span className="ml-auto"><ExactValuesToggle showExact={showExact} onChange={setShowExact} /></span>
      </div>
      {isModelRun && <ArtifactTrustBadges dataClassification={summary.dataClassification} validationLevel={summary.validationLevel} sourceCount={facts.sourceCount} />}
    </header>
    {content.holdings.length > 0 && <ReadableRowsTable title={`Holdings (${content.holdings.length})`} rows={content.holdings} options={options} exportHint="Export the Artifact as CSV to get every holding." />}
    {parameters && <ReadableValueTable title="Assumptions" values={parameters} options={options} note="Inputs used for this calculation." />}
    {result && <ReadableValueTable title="Results" values={result} options={options} />}
    {Object.keys(summaryRest).length > 0 && <ReadableValueTable title="Summary" values={summaryRest} options={options} />}
    {!riskRepeatsSummary && Object.keys(risk).length > 0 && <ReadableValueTable title="Risk" values={risk} options={options} />}
    {!content.holdings.length && !parameters && !result && !Object.keys(summaryRest).length && !Object.keys(risk).length && <p role="status" className="rounded-lg border border-border/50 p-3 font-ui text-[13px] text-muted-foreground">This portfolio has no recorded holdings, results or risk figures yet.</p>}
    <ArtifactFootnote facts={facts} model={modelVersion} fingerprint={outputHash} />
    <ExpertJsonView content={content} onSave={onSave} onDirtyChange={onDirtyChange} disabled={disabled} defaultOpen={expertDefaultOpen} />
  </section>;
}
