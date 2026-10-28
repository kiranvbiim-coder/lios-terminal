import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import type { ArtifactContent } from "@shared/artifactContracts";
import type { ArtifactDetail, ProjectArtifactRecord } from "@/lib/useArtifacts";
import { recordedArtifactPreview } from "@/lib/recordedArtifactPreview";

type RecordIdentity = Pick<ProjectArtifactRecord, "id" | "projectId" | "headVersion" | "kind" | "status" | "title">;

/** Never show a different version, Project, status or content kind in a gallery preview. */
export function checkedGalleryArtifactContent(record: RecordIdentity, detail: ArtifactDetail | undefined): ArtifactContent | null {
  if (!detail ||
    detail.artifact.id !== record.id ||
    detail.version.artifactId !== record.id ||
    detail.artifact.projectId !== record.projectId ||
    detail.artifact.headVersion !== record.headVersion ||
    detail.artifact.kind !== record.kind ||
    detail.artifact.status !== record.status ||
    detail.version.version !== record.headVersion ||
    detail.version.content.kind !== record.kind
  ) return null;
  return detail.version.content;
}

/**
 * Read-only path for the first 40 original *positions* of a saved line chart.
 * Preserve gaps instead of joining unrelated observations or silently skipping points.
 * Non-line types have no line preview: the full Artifact owns their true renderer.
 */
export function recordedGalleryChartPath(content: Extract<ArtifactContent, { kind: "chart" }>): string | null {
  if (content.chartType.trim().toLowerCase() !== "line") return null;
  const points = content.series[0]?.points.slice(0, 40) ?? [];
  const values = points.map(point => point.y).filter(Number.isFinite);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  // Halving before subtracting avoids overflow for finite near-MAX_VALUE endpoints.
  const lowHalf = low / 2;
  const halfRange = high / 2 - lowHalf;
  const pieces: string[] = [];
  let connected = false;
  for (const [index, point] of points.entries()) {
    if (!Number.isFinite(point.y)) { connected = false; continue; }
    const x = 8 + (index / (points.length - 1)) * 284;
    const ratio = halfRange > 0 ? Math.min(1, Math.max(0, (point.y / 2 - lowHalf) / halfRange)) : 0.5;
    const ordinate = 82 - ratio * 70;
    pieces.push(`${connected ? "L" : "M"}${x.toFixed(2)},${ordinate.toFixed(2)}`);
    connected = true;
  }
  return pieces.join(" ") || null;
}

export function GalleryRecordedPreviewContent({ content }: { content: ArtifactContent }) {
  const summary = recordedArtifactPreview(content);
  if (content.kind === "chart") {
    const path = recordedGalleryChartPath(content);
    const first = content.series[0];
    return (
      <div className="space-y-2">
        {path ? (
          <svg viewBox="0 0 300 94" role="img" aria-label={`First ${Math.min(40, first.points.length)} saved chart positions from ${first.label}; missing points remain disconnected`} className="h-28 w-full rounded-lg border border-border/40 bg-background/50 p-1">
            <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-300" />
          </svg>
        ) : <p className="text-xs text-muted-foreground">No recorded line to preview.</p>}
        <p className="text-xs text-muted-foreground">{summary}.</p>
        {path && <p className="text-[11px] text-muted-foreground">First {Math.min(40, first.points.length)} saved positions in the first recorded line series; gaps are not joined. Open the Artifact for exact axes, values and evidence.</p>}
        {!path && content.chartType.trim().toLowerCase() !== "line" && <p className="text-[11px] text-muted-foreground">This saved {content.chartType} chart is not a line chart. Open the Artifact to view the correct chart type rather than an invented line preview.</p>}
      </div>
    );
  }
  if (content.kind === "table" && content.columns.length) {
    const columns = content.columns.slice(0, 3);
    return (
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="w-full min-w-[220px] border-collapse text-left font-ui text-xs">
            <caption className="sr-only">First three columns and first three recorded rows of the saved table</caption>
            <thead><tr>{columns.map(col => <th scope="col" key={col.key} className="border-b border-border/50 p-2 font-semibold">{col.label}</th>)}</tr></thead>
            <tbody>{content.rows.slice(0, 3).map((row, index) => (
              <tr key={index}>{columns.map(col => {
                const cell = row[col.key];
                const value = cell === null || cell === undefined ? "—"
                  : typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean" ? String(cell) : "Complex value";
                return <td key={col.key} className="max-w-[120px] truncate border-b border-border/25 p-2 text-muted-foreground">{value}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{summary} · first 3 rows and columns shown.</p>
      </div>
    );
  }
  if (content.kind === "report" || content.kind === "research") {
    const excerpt = content.blocks.find(block => (block.type === "paragraph" || block.type === "heading") && block.text.trim())?.text;
    return (
      <div className="space-y-2">
        {excerpt && <blockquote className="line-clamp-3 border-l-2 border-amber-300/45 pl-3 font-ui text-sm leading-6 text-foreground/90">{excerpt.slice(0, 260)}</blockquote>}
        <p className="text-xs text-muted-foreground">{summary ?? "Saved document"}</p>
      </div>
    );
  }
  if (content.kind === "spreadsheet") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">{content.sheets.slice(0, 4).map(sheet => <span key={sheet.id} className="rounded border border-emerald-300/20 bg-emerald-300/[0.05] px-2 py-1 font-ui text-xs text-emerald-100">{sheet.name}</span>)}</div>
        <p className="text-xs text-muted-foreground">{summary ?? "Saved spreadsheet"}</p>
      </div>
    );
  }
  return <p className="font-ui text-sm leading-6 text-foreground/90">{summary ?? "This saved type has no compact content preview. Open the Artifact to inspect its recorded content."}</p>;
}

export function ProjectArtifactGalleryPreview({ artifact, onOpen }: {
  artifact: RecordIdentity;
  onOpen: () => void;
}) {
  // Fetch only after explicit Preview selection. This is not a new content store.
  const query = useQuery<ArtifactDetail>({
    queryKey: ["/api/artifacts", artifact.id, "version", artifact.headVersion],
    queryFn: async () => {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}?version=${artifact.headVersion}`);
      if (!response.ok) throw new Error("Exact saved Artifact preview is unavailable.");
      return await response.json() as ArtifactDetail;
    },
    refetchOnMount: "always",
    retry: false,
  });

  const inspected = query.isFetchedAfterMount && !query.isFetching && !query.isError
    ? checkedGalleryArtifactContent(artifact, query.data) : null;
  return (
    <section className="mt-3 rounded-xl border border-amber-300/20 bg-background/70 p-4" aria-label={`Saved preview for ${artifact.title}`} data-testid="project-artifact-exact-preview">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-ui text-sm font-semibold text-foreground">Recorded preview · v{artifact.headVersion}</div>
          <p className="font-ui text-xs text-muted-foreground">Only the exact saved version in this Project. No generated thumbnail.</p>
        </div>
        <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center gap-2 rounded border border-border/60 px-3 font-ui text-xs text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
          Open full Artifact <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      {query.isFetching || !query.isFetchedAfterMount ? (
        <p role="status" className="text-sm text-muted-foreground">Checking access and loading the saved version…</p>
      ) : query.isError || !inspected ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-amber-200"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Preview unavailable or no longer matches this Project and version.</p>
      ) : <GalleryRecordedPreviewContent content={inspected} />}
    </section>
  );
}
