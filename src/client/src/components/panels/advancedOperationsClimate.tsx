import type { Dispatch, SetStateAction } from "react";
import { StructuredJsonEditor, type JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";

export type InputSourceMode = "manual" | "private" | "synthetic";

const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";

export function advancedInputProvenance(parameters: Record<string, unknown>, sourceMode: InputSourceMode, sourceNote?: string) {
  const sourceTransformation = sourceNote ? `Declared input source: ${sourceNote}` : undefined;
  if (sourceMode === "synthetic") {
    return {
      dataClassification: "synthetic",
      syntheticContext: "Labeled sample input for model exploration; not operational, issuer, or live-source data.",
      transformations: ["Labeled synthetic sample submitted directly to the model", ...(sourceTransformation ? [sourceTransformation] : [])],
    };
  }
  return {
    dataClassification: "manual",
    manualInputs: parameters,
    transformations: [sourceMode === "private"
      ? "Client-uploaded or private-database values submitted directly; no connector binding is available"
      : "Analyst-entered values submitted directly", ...(sourceTransformation ? [sourceTransformation] : [])],
  };
}

export function InputSourceSelector({ value, onChange, domain }: {
  value: InputSourceMode;
  onChange: Dispatch<SetStateAction<InputSourceMode>>;
  domain: string;
}) {
  return (
    <div className="border border-border/60 p-2.5 space-y-1.5">
      <label className="flex flex-col gap-1">
        <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">INPUT SOURCE CLASSIFICATION</span>
        <select value={value} onChange={(event) => onChange(event.target.value as InputSourceMode)} className={inputCls}>
          <option value="manual">MANUAL — analyst-entered parameters</option>
          <option value="private">PRIVATE / CLIENT CSV UPLOAD — no connector binding</option>
          <option value="synthetic">SAMPLE SYNTHETIC — model exploration only</option>
        </select>
      </label>
      <p className="font-terminal text-[7px] text-muted-foreground">
        {value === "synthetic"
          ? "Synthetic sample: never presented as live or client data."
          : value === "private"
            ? `Private/client ${domain} values are classified as manual until an immutable source connection exists.`
            : `Manual ${domain} parameters are sent exactly as entered. No operational/issuer connector is configured.`}
      </p>

    </div>
  );
}
export function ModelInputEditor({ value, onChange, example, schema }: {
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  example: string;
  schema?: JsonFieldSchema[];
}) {
  if (schema) {
    let parsed: Record<string, unknown> = {};
    try {
      const candidate: unknown = JSON.parse(value);
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) parsed = candidate as Record<string, unknown>;
    } catch {
      // value wasn't valid JSON (e.g. mid-edit from a raw-JSON call site) — fall back to an empty object; StructuredJsonEditor applies schema defaults.
    }
    return (
      <div className="flex flex-col gap-1">
        <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MODEL INPUT</span>
        <StructuredJsonEditor schema={schema} value={parsed} onChange={(next) => onChange(JSON.stringify(next))} />
      </div>
    );
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MODEL INPUT (JSON)</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} className={`${inputCls} min-h-56 resize-y leading-relaxed`} />
      <span className="font-terminal text-[7px] text-muted-foreground">Exact Pydantic model fields only. Example structure: {example}</span>
    </label>
  );
}

type Receipt = {
  dataClassification?: string;
  modelPath?: string;
  modelVersion?: string;
  runId?: string;
  inputSnapshotHash?: string;
  outputSnapshotHash?: string;
  validationHash?: string;
  warnings?: string[];
  sourceBindings?: Array<{ field?: string; provider?: string; connectorId?: string; sourceReference?: string; asOf?: string; snapshot?: { id?: string; contentHash?: string } }>;
};

function shortHash(value: string | undefined) {
  return value ? value.slice(0, 16) : "—";
}

export function ProvenanceReceipt({ receipt }: { receipt: Receipt | undefined }) {
  if (!receipt) return null;
  return (
    <section className="border border-border/60 p-2.5 space-y-1.5">
      <div className="font-terminal text-[7.5px] text-[hsl(38,95%,55%)] tracking-wider">RUN RECEIPT / PROVENANCE</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 font-terminal text-[7px] text-muted-foreground">
        <span>CLASSIFICATION: <b className="text-foreground">{receipt.dataClassification ?? "—"}</b></span>
        <span>MODEL: <b className="text-foreground">{receipt.modelPath ?? "—"}</b></span>
        <span>VERSION: <b className="text-foreground">{receipt.modelVersion ?? "—"}</b></span>
        <span>RUN: <b className="text-foreground">{receipt.runId ?? "—"}</b></span>
        <span>INPUT HASH: <b className="text-foreground">{shortHash(receipt.inputSnapshotHash)}</b></span>
        <span>OUTPUT HASH: <b className="text-foreground">{shortHash(receipt.outputSnapshotHash)}</b></span>
        <span>VALIDATION HASH: <b className="text-foreground">{shortHash(receipt.validationHash)}</b></span>
      </div>
      {receipt.sourceBindings?.length ? <div className="font-terminal text-[7px] text-muted-foreground">SOURCE BINDINGS: {receipt.sourceBindings.map((binding) => `${binding.field ?? "input"}: ${binding.provider ?? binding.connectorId ?? "source"} (${binding.sourceReference ?? binding.snapshot?.id ?? "unreferenced"})`).join(" · ")}</div> : <div className="font-terminal text-[7px] text-muted-foreground">SOURCE BINDINGS: none — no live/cached source is claimed.</div>}
      {receipt.warnings?.map((warning) => <div key={warning} className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">WARNING: {warning}</div>)}
    </section>
  );
}
