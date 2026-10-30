import { useRef } from "react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { TerminalInspectorRequest } from "@/lib/terminalInspector";
import { getCrossDomainBridges } from "@/lib/terminalCrossDomainBridges";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import type { ViewMode } from "@/lib/terminalTypes";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ArtifactInspection, ArtifactInspectionTarget } from "@shared/artifactInspection";
import { SpreadsheetCellSourceInspect } from "./SpreadsheetCellSourceInspect";
import ConversationTrustPanel from "./ConversationTrustPanel";
import { ReadableValue } from "@/components/ui/ReadableValue";

interface Props {
  request: TerminalInspectorRequest;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onClose: () => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
  return String(value);
}

function ContextualMiniInspector({ request, onOpen }: Props) {
  const capability = getTerminalCapability(request.view);
  const bridges = getCrossDomainBridges(request.view).slice(0, 4);
  return <div className="max-h-[70vh] space-y-4 overflow-auto p-4 text-sm">
    <h3>{request.label || capability.label}</h3>
    <p>{request.metricKey ?? "Visible value"}: {formatValue(request.value)}</p>
    <p className="text-muted-foreground">{request.sourceHint ?? "No exact canonical source binding is present."} Symbol, label and display-value similarity are not evidence custody; unrelated sources and receipts are not substituted.</p>
    {bridges.length > 0 && <details><summary>Related analytical surfaces · navigation only</summary>{bridges.map(bridge => <button key={bridge.id} type="button" onClick={() => onOpen(bridge.to, "tab", bridge.symbolAware ? request.symbol : undefined)} className="block rounded border border-border/45 p-2 text-left">{bridge.label} · {bridge.reason}</button>)}</details>}
  </div>;
}

function ExactArtifactInspector({ target }: { target: ArtifactInspectionTarget }) {
  const inspection = useQuery<ArtifactInspection>({
    queryKey: ["/api/artifacts", target.artifactId, "inspect", target],
    queryFn: async () => {
      const response = await apiRequest("POST", `/api/artifacts/${encodeURIComponent(target.artifactId)}/inspect`, target);
      const result = await response.json() as ArtifactInspection;
      if (JSON.stringify(result.target) !== JSON.stringify(target)) throw new Error("Inspection response does not match the exact requested identity.");
      return result;
    },
    retry: false, staleTime: 0, gcTime: 0,
  });
  const data = !inspection.isFetching && !inspection.isError ? inspection.data : undefined;
  return <div className="max-h-[75vh] space-y-4 overflow-auto p-4">
    <p className="break-all text-sm">Artifact {target.artifactId} · v{target.version}<br/>SHA-256 {target.contentHash}</p>
    {inspection.isFetching && <p role="status">Checking exact saved revision and current source rights…</p>}
    {inspection.isError && <p role="alert">Exact inspection unavailable: {inspection.error.message}. No contextual or symbol-matched evidence is substituted.</p>}
    {data && <>
      <h3 className="font-semibold">{data.title} · {data.kind}</h3>
      <p className="text-sm text-muted-foreground">Saved historical custody, not a live freshness claim. Inspection, comments, P4 change acceptance, Decision review and execution remain separate authorities.</p>
      {data.cell && <SpreadsheetCellSourceInspect sheetName={data.cell.sheetName} cellRef={data.cell.ref} cell={data.cell.value}/>}
      {target.cell?.kind === "table" && <div className="text-sm"><span>Exact table value: </span><ReadableValue value={data.tableValue} exact className="inline-block align-top" /></div>}
      <section className="space-y-2"><h4>Recorded sources</h4>{data.sourceRefs.length ? data.sourceRefs.map(ref => <p key={ref} className="break-all font-mono text-xs">{ref}</p>) : <p>No source recorded; no trust classification inferred.</p>}</section>
      <section><h4>Recorded numerical provenance</h4>{data.numericalEvidence.length ? data.numericalEvidence.map(item => <details key={item.id}><summary>{item.source.kind} · {item.source.field} · {item.normalizedValue}</summary><ReadableValue value={item} exact className="text-xs" /></details>) : <p className="text-sm text-muted-foreground">No bound numerical evidence at this target. Labels and values do not establish numerical class.</p>}</section>
      {data.trustManifest && <ConversationTrustPanel manifest={data.trustManifest}/>}
      <details><summary>Advanced custody, assumptions, transformations and downstream references</summary><ReadableValue value={{ receipts: data.executionReceiptIds, assumptions: data.assumptionRefs, dependencies: data.dependencyRefs, references: data.references, currentDisplayRights: data.rights }} exact className="text-xs" /></details>
      <p className="text-xs text-muted-foreground">Advanced depth is presentation only. It grants no source access, review or execution permission.</p>
    </>}
  </div>;
}

export default function MiniInspector(props: Props) {
  const returnFocus = useRef<HTMLElement | null>(typeof document === "undefined" ? null : document.activeElement as HTMLElement | null);
  return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }}>
    <DialogContent className="max-w-xl border-border bg-[#0a0b0d] p-0" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
      <DialogTitle className="px-4 pt-4">{props.request.target ? "Exact Artifact source inspection" : "Contextual inspection · not exact source custody"}</DialogTitle>
      {props.request.target ? <ExactArtifactInspector key={JSON.stringify(props.request.target)} target={props.request.target}/> : <ContextualMiniInspector {...props}/>}
    </DialogContent>
  </Dialog>;
}
