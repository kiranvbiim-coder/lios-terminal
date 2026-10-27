import * as React from "react";
import { lazy, Suspense, useMemo, useState } from "react";
import { GitBranch, GitCompareArrows } from "lucide-react";
import type { PerspectiveLink } from "@/lib/researchPerspectives";
import { projectRecordedEvidenceFlow } from "@/lib/recordedEvidenceFlow";

const RecordedEvidenceSankey = lazy(() => import("./RecordedEvidenceSankey"));

class FlowPlotBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p role="alert" className="p-3 font-ui text-xs text-amber-200">The flow chart could not render. Every available recorded link is still inspectable in the table below.</p>
      : this.props.children;
  }
}

/** Optional Kibo/beUI-inspired source-first compare+flow view. One canonical
 * Investigation remains responsible for evidence authoring and permissions.
 * List remains accessible when visual ECharts is loading or unavailable. */
export function RecordedEvidenceFlowPanel({
  links, selectedId, onSelect,
}: {
  links: readonly PerspectiveLink[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const model = useMemo(() => projectRecordedEvidenceFlow(links), [links]);

  if (!model.totalRecordedLinks) return null;

  return <section data-testid="recorded-evidence-flow" aria-label="Recorded evidence relationship flow"
    className="min-w-0 rounded-2xl border border-border/60 bg-card/40 p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="inline-flex items-center gap-2 font-ui text-sm font-semibold text-foreground">
          <GitBranch className="h-4 w-4 text-cyan-200" aria-hidden="true" />Evidence relationship flow
        </h3>
        <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
          {model.totalRecordedLinks} explicitly recorded relationship{model.totalRecordedLinks === 1 ? "" : "s"} match the current filters.
          Each link counts as one ledger record, not one unit of influence, probability, consensus or truth.
        </p>
      </div>
      <button type="button" onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls="li-research-relationship-flow"
        className="min-h-10 shrink-0 rounded-lg border border-border/65 px-3 font-ui text-sm text-foreground hover:border-amber-300/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
        {open ? "Hide flow" : "View flow"}
      </button>
    </div>
    {open && <div id="li-research-relationship-flow" className="mt-4 space-y-3">
      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <p className="rounded-lg border border-border/45 p-2">From recorded evidence ID</p>
        <p className="rounded-lg border border-border/45 p-2">Explicit relationship type</p>
        <p className="rounded-lg border border-border/45 p-2">To recorded evidence ID</p>
      </div>
      <div className="h-[280px] min-w-0 rounded-xl border border-border/50 bg-background/55 p-2 sm:h-[380px]"
        data-testid="recorded-evidence-flow-plot">
        <FlowPlotBoundary>
          <Suspense fallback={<p role="status" className="p-3 font-ui text-xs text-muted-foreground">Preparing recorded flow visualization…</p>}>
            <RecordedEvidenceSankey projection={model}/>
          </Suspense>
        </FlowPlotBoundary>
      </div>
      <p className="font-ui text-xs leading-5 text-muted-foreground">
        Colored links are a layout of recorded directions and types. Paths are not causal chains.
        Repeated links do not establish independent confirmation.
      </p>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border/55" role="region"
        aria-label="Accessible exact relationship flow records" tabIndex={0}>
        <table className="w-full min-w-[420px] table-fixed text-left font-ui text-xs">
          <thead className="sticky top-0 bg-background text-muted-foreground">
            <tr><th scope="col" className="w-[28%] p-2">From</th><th scope="col" className="w-[27%] p-2">Recorded type</th><th scope="col" className="w-[28%] p-2">To</th><th scope="col" className="w-[17%] p-2">Inspect</th></tr>
          </thead>
          <tbody>
            {model.rows.map(row => <tr key={row.id} className="border-t border-border/40">
              <td className="break-words p-2" title={row.fromTitle}>E{row.fromEvidenceId} · {row.fromTitle}</td>
              <td className="break-words p-2 text-cyan-200">{row.relationType.replaceAll("_", " ")}</td>
              <td className="break-words p-2" title={row.toTitle}>E{row.toEvidenceId} · {row.toTitle}</td>
              <td className="p-2"><button type="button" onClick={() => onSelect(row.id)}
                aria-label={`Inspect recorded relationship ${row.id}`} aria-pressed={selectedId === row.id}
                className="inline-flex min-h-10 items-center gap-1 rounded-md border border-border/65 px-2 font-ui text-xs text-foreground hover:border-amber-300/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true"/>Inspect
              </button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {model.omittedLinks > 0 && <p role="status" className="font-ui text-xs text-muted-foreground">
        {model.omittedLinks} additional recorded relationship{model.omittedLinks === 1 ? " is" : "s are"} not drawn.
        The full filtered Perspectives lanes remain available below.
      </p>}
    </div>}
  </section>;
}
