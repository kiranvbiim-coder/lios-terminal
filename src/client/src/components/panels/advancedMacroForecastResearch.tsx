import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface AdvancedReceipt {
  dataClassification?: string;
  modelId?: string;
  modelPath?: string;
  modelVersion?: string;
  validationLevel?: string;
  inputSnapshotHash?: string;
  outputSnapshotHash?: string;
  runId?: string;
  sourceBindings?: Array<{ provider?: string; field?: string; sourceReference?: string; snapshot?: { id?: string; contentHash?: string } }>;
  warnings?: string[];
}

export interface AdvancedWorkflowSpec {
  family: string;
  model: string;
  label: string;
  instructions: string;
}

export function manualProvenance(parameters: Record<string, unknown>) {
  return { dataClassification: "manual", manualInputs: parameters };
}

export async function runAdvancedManual(family: string, model: string, parameters: Record<string, unknown>) {
  const response = await apiRequest("POST", `/api/quant/advanced/${family}/${model}`, {
    ...parameters,
    inputProvenance: manualProvenance(parameters),
  });
  return response.json() as Promise<Record<string, unknown> & { receipt?: AdvancedReceipt }>;
}

export async function runAdvancedSourced(
  family: string,
  model: string,
  parameters: Record<string, unknown>,
  inputProvenance: Record<string, unknown>,
) {
  const response = await apiRequest("POST", `/api/quant/advanced/${family}/${model}`, { ...parameters, inputProvenance });
  return response.json() as Promise<Record<string, unknown> & { receipt?: AdvancedReceipt }>;
}

export function ReceiptSummary({ receipt }: { receipt?: AdvancedReceipt }) {
  if (!receipt) return null;
  const metadata = [
    ["CLASS", receipt.dataClassification], ["MODEL", receipt.modelId ?? receipt.modelPath], ["VERSION", receipt.modelVersion],
    ["VALIDATION", receipt.validationLevel], ["INPUT", receipt.inputSnapshotHash], ["OUTPUT", receipt.outputSnapshotHash], ["RUN", receipt.runId],
  ].filter((item): item is [string, string] => typeof item[1] === "string" && item[1].length > 0);
  const lineage = receipt.sourceBindings?.map((binding) => `${binding.provider ?? "SOURCE"}:${binding.field ?? "input"} (${binding.snapshot?.id ?? binding.sourceReference ?? "unbound"})`).join(" / ");
  return <div className="border border-amber-400/30 bg-amber-400/5 p-2 font-mono text-[7px] text-muted-foreground space-y-1">
    <div className="text-amber-300">PROVENANCE RECEIPT</div>
    <div>{metadata.map(([label, value]) => `${label}: ${value}`).join(" / ") || "RECEIPT METADATA UNAVAILABLE"}</div>
    <div>SOURCES / LINEAGE: {lineage || "MANUAL INPUTS RECORDED"}</div>
    {!!receipt.warnings?.length && <div className="text-amber-200">WARNINGS: {receipt.warnings.join(" · ")}</div>}
  </div>;
}

/** A deliberate manual-import path: it never presents JSON as live data. */
export function AdvancedManualWorkflow({ spec }: { spec: AdvancedWorkflowSpec }) {
  const [parameters, setParameters] = useState("");
  const [result, setResult] = useState<(Record<string, unknown> & { receipt?: AdvancedReceipt }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setError(null); setResult(null);
    let parsed: Record<string, unknown>;
    try {
      const candidate: unknown = JSON.parse(parameters);
      if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") throw new Error("Parameters must be a JSON object.");
      parsed = candidate as Record<string, unknown>;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter a JSON object."); return;
    }
    setLoading(true);
    try { setResult(await runAdvancedManual(spec.family, spec.model, parsed)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Advanced model unavailable."); }
    finally { setLoading(false); }
  };
  return <section className="space-y-2 border border-border p-3">
    <div className="font-terminal text-[9px] text-foreground">{spec.label}</div>
    <div className="font-mono text-[7px] leading-relaxed text-muted-foreground">MANUAL IMPORT — {spec.instructions}</div>
    <textarea aria-label={`${spec.label} manual parameters`} value={parameters} onChange={(event) => setParameters(event.target.value)} rows={6} placeholder="Paste the exact request fields as JSON…" className="w-full resize-y border border-border bg-black p-2 font-mono text-[8px] outline-none focus:border-amber-400/50" />
    <button type="button" onClick={() => void run()} disabled={loading || !parameters.trim()} className="border border-amber-400/40 px-3 py-1.5 font-terminal text-[8px] text-amber-300 disabled:opacity-40">{loading ? "RUNNING…" : "RUN MANUAL IMPORT"}</button>
    {error && <div role="alert" className="font-mono text-[8px] text-red-300">{error}</div>}
    {result && <><pre className="max-h-44 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[7px] text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={result.receipt} /></>}
  </section>;
}
