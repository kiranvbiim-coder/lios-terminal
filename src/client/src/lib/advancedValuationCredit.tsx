import { apiRequest } from "@/lib/queryClient";
import type { ReactNode } from "react";

export type AdvancedReceipt = {
  dataClassification: "manual" | "live" | "cached" | "synthetic";
  modelId: string;
  modelVersion: string;
  validationLevel: string;
  runId: string;
  inputSnapshotHash: string;
  outputSnapshotHash: string;
  sourceBindings: Array<{ connectorId: string; provider: string; sourceReference: string; asOf: string; snapshot: { id: string; contentHash: string } }>;
  transformations: string[];
  warnings?: string[];
};

export type AdvancedResponse<T> = T & { receipt: AdvancedReceipt };

export async function runAdvancedModel<T>(path: string, parameters: Record<string, unknown>): Promise<AdvancedResponse<T>> {
  const response = await apiRequest("POST", `/api/quant/advanced/${path}`, {
    ...parameters,
    inputProvenance: { dataClassification: "manual", manualInputs: parameters },
  });
  return response.json() as Promise<AdvancedResponse<T>>;
}

export function AdvancedReceiptFooter({ receipt }: { receipt: AdvancedReceipt | null | undefined }): ReactNode {
  if (!receipt) return null;
  const hashes = `${receipt.inputSnapshotHash.slice(0, 12)} → ${receipt.outputSnapshotHash.slice(0, 12)}`;
  return <div className="border border-border bg-[#070707] px-2 py-1.5 font-terminal text-[7px] text-muted-foreground space-y-1">
    <div className="flex flex-wrap gap-x-3 gap-y-1"><span>INPUT <b className="text-foreground">MANUAL / exact submitted parameters</b></span><span>CLASS <b className="text-[hsl(186,80%,60%)]">{receipt.dataClassification.toUpperCase()}</b></span><span>MODEL <b className="text-foreground">{receipt.modelId}@{receipt.modelVersion}</b></span><span>VALIDATION <b className="text-foreground">{receipt.validationLevel}</b></span></div>
    <div className="flex flex-wrap gap-x-3 gap-y-1"><span>RUN <b className="text-foreground">{receipt.runId.slice(0, 16)}</b></span><span>HASHES <b className="text-foreground">{hashes}</b></span><span>LINEAGE <b className="text-foreground">{receipt.sourceBindings.length ? receipt.sourceBindings.map((binding) => `${binding.provider}:${binding.snapshot.id.slice(0, 8)}`).join(", ") : "NONE — analyst-entered"}</b></span></div>
    {receipt.warnings?.length ? <div className="text-amber-400">WARNINGS: {receipt.warnings.join(" | ")}</div> : null}
  </div>;
}
