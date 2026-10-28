import * as React from "react";
import { Component, lazy, Suspense, useEffect, useState } from "react";
import type { GovernedVisualAnswerRequest } from "@shared/governedVisualAnswer";
import { resolveGovernedVisualAnswer } from "@shared/governedVisualAnswer";
import { projectSavedTableGeography } from "@/lib/governedTableGeography";
import { useArtifact } from "@/lib/useArtifacts";

const ArtifactChart = lazy(() => import("./ArtifactChart"));
const TableArtifactTable = lazy(() => import("./ArtifactPane")
  .then(module => ({ default: module.TableArtifactTable })));
const OfflineProjectWorldMap = lazy(() => import("./OfflineProjectWorldMap")
  .then(module => ({ default: module.OfflineProjectWorldMap })));

class GovernedChartBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="alert" className="font-ui text-sm text-amber-200">
      Visual renderer unavailable. The canonical saved Artifact is unchanged; open it in the existing Workbench to inspect the exact saved records.
    </p> : this.props.children;
  }
}


export function GovernedVisualAnswer({ request }: { request: GovernedVisualAnswerRequest }) {
  const [expanded, setExpanded] = useState(false);
  return <section aria-label="Governed visual answer from saved Artifact" data-testid="governed-chat-visual-answer"
    className="mb-2 min-w-0 rounded-xl border border-border/55 bg-card/45 p-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-ui text-sm font-semibold text-foreground">Saved {request.kind === "chart" ? "chart" : "table"} · version {request.version}</p>
        <p className="font-ui text-xs text-muted-foreground">The exact saved version and source references are rechecked before display.</p>
      </div>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
        className="min-h-10 rounded-lg border border-border/65 px-3 font-ui text-sm text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">
        {expanded ? "Hide visual" : "View visual"}
      </button>
    </div>
    {expanded && <SavedVisual key={JSON.stringify(request)} request={request} />}
  </section>;
}

function SavedVisual({ request }: { request: GovernedVisualAnswerRequest }) {
  const artifact = useArtifact(request.artifactId, request.version, true);
  const [mapOpen, setMapOpen] = useState(false);
  const loading = artifact.isFetching || artifact.isPending || !artifact.isFetchedAfterMount;
  const resolved = !loading && !artifact.isError ? resolveGovernedVisualAnswer(request, artifact.data) : null;
  const decision = resolved?.status === "ready" ? resolved : null;
  useEffect(() => { if (loading || !decision) setMapOpen(false); }, [loading, Boolean(decision)]);
  const mapProjection = decision && decision.kind === "table" ? projectSavedTableGeography(decision) : null;
  return (<div className="mt-3 space-y-3" data-testid="governed-chat-visual-content">
      {!loading && <button type="button"
        onClick={() => { setMapOpen(false); void artifact.refetch(); }}
        className="min-h-11 rounded-lg border border-amber-300/40 px-3 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
        Recheck current source permissions
      </button>}
      {loading && <p role="status" className="font-ui text-sm text-muted-foreground">Checking the saved source-backed revision…</p>}
      {!loading && !decision && <p role="alert" className="font-ui text-sm text-amber-200">
        {resolved?.status === "blocked" ? resolved.reason : "Authorization or saved revision is unavailable. No visual answer is displayed."}
      </p>}
      {decision && <>
        <p className="font-ui text-xs leading-5 text-amber-200">This saved snapshot was rechecked when opened. Access can change: select “Recheck current source permissions” for a fresh authenticated read before relying on it.</p>
        <p className="break-words font-ui text-sm font-semibold text-foreground">{decision.title}</p>
        <p className="font-ui text-xs text-muted-foreground">
          Recorded source IDs: {decision.sourceRefs.length}. Saved v{decision.version}. These are retained references, not independent verification or redistribution rights.
        </p>
        {decision.kind === "chart" ? <GovernedChartBoundary>
          <Suspense fallback={<p role="status" className="font-ui text-xs text-muted-foreground">Rendering the saved chart…</p>}>
            <ArtifactChart content={decision.content} artifactSourceRefs={decision.sourceRefs} readOnly/>
          </Suspense>
        </GovernedChartBoundary> : <GovernedChartBoundary>
          <Suspense fallback={<p role="status">Loading saved table…</p>}>
            <TableArtifactTable key={`${request.artifactId}:${decision.version}`} content={decision.content} />
          </Suspense>
        </GovernedChartBoundary>}
        {decision.kind === "table" && mapProjection && mapProjection.points.length > 0 && <section
          className="rounded-lg border border-border/55 p-3" aria-label="Source-backed saved geography">
          <button type="button" aria-expanded={mapOpen}
            onClick={() => setMapOpen(open => !open)}
            className="min-h-11 rounded-lg border border-amber-300/40 px-3 font-ui text-sm text-foreground focus-visible:outline-2 focus-visible:outline-amber-300">
            {mapOpen ? "Hide recorded locations" : "View recorded locations"} ({mapProjection.eligibleCount})
          </button>
          <p className="mt-2 font-ui text-xs leading-5 text-muted-foreground">
            Offline visualization of exact numeric latitude/longitude cells with authorized row source IDs.
            Scanned {mapProjection.scannedRows} recorded rows; no geocoding or inferred locations.
            {mapProjection.omittedCount > 0 ? " " + mapProjection.omittedCount + " eligible locations beyond the first 60 are not shown." : ""}
          </p>
          {mapOpen && <GovernedChartBoundary>
            <Suspense fallback={<p role="status" className="mt-3 font-ui text-sm text-muted-foreground">Loading the bundled offline world map…</p>}>
              <OfflineProjectWorldMap points={mapProjection.points} origin="P4 saved table" />
            </Suspense>
          </GovernedChartBoundary>}
        </section>}
        <details className="rounded border border-border/50 p-2 font-ui text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground">Recorded source IDs</summary>
          <ul className="mt-2 max-h-32 space-y-1 overflow-auto">
            {decision.sourceRefs.map(ref => <li key={ref} className="break-all"><code>{ref}</code></li>)}
          </ul>
        </details>
      </>}
    </div>
  );
}
