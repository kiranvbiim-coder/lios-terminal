import type { AdvancedRiskReceipt } from "./advancedPortfolioRisk";

export function AdvancedPortfolioRiskReceipt({ receipt }: { receipt?: AdvancedRiskReceipt }) {
  if (!receipt) return null;
  return (
    <div className="mt-2 border border-border/70 bg-[#070707] p-2 font-terminal text-[7px] text-muted-foreground space-y-1">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-foreground">
        <span>PROVENANCE <b className="text-amber-200 uppercase">{receipt.dataClassification}</b></span>
        <span>MODEL {receipt.modelId} v{receipt.modelVersion}</span>
        <span>VALIDATION {receipt.validationLevel}</span>
        <span>RUN {receipt.runId}</span>
      </div>
      <div className="break-all">INPUT {receipt.inputSnapshotHash} · OUTPUT {receipt.outputSnapshotHash}</div>
      <div>SOURCES {receipt.sourceBindings.length ? receipt.sourceBindings.map((binding) => `${binding.field}: ${binding.provider}/${binding.connectorId} @ ${binding.asOf} (${binding.freshness}; ${binding.snapshot.id}/${binding.snapshot.contentHash})`).join("; ") : "No immutable source binding supplied; parameters are explicitly MANUAL."}</div>
      <div>LINEAGE {receipt.transformations.length ? receipt.transformations.join(" → ") : "Direct submitted parameters"} · DATASETS {receipt.datasetSnapshotIds.length ? receipt.datasetSnapshotIds.join(", ") : "none"} · AS-OF {receipt.effectiveAt ?? "manual"}</div>
      {receipt.seed !== null && <div>SEED {receipt.seed}</div>}
      {receipt.warnings.length > 0 && <div className="text-amber-200">WARNINGS {receipt.warnings.join(" | ")}</div>}
    </div>
  );
}
