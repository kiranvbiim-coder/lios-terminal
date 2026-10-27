import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, ChartNoAxesCombined } from "lucide-react";
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

/** A non-approximate visual of the first *recorded* chart series, not an invented trend. */
export function recordedGalleryChartPath(content: Extract<ArtifactContent, { kind: "chart" }>): string | null {
  const series = content.series[0];
  if (!series) return null;
  const values = series.points.filter(point => Number.isFinite(point.y)).slice(0, 40).map(point => point.y);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(1e-9, high - low);
  return values.map((y, i) => {
    const x = 8 + (i / (values.length - 1)) * 284;
    const ordinate = 82 - ((y - low) / span) * 70;
    return `${i ? "L" : "M"}${x.toFixed(2)},${ordinate.toFixed(2)}`;
  }).join(" ");
}

function PreviewContent({ content }: { content: ArtifactContent }) {
  const summary = recordedArtifactPreview(content);
  if (content.kind === "chart") {
    const path = recordedGalleryChartPath(content);
    const first = content.series[0];
    return (
      <div className="space-y-2">
        {path ? (
          <svg viewBox="0 0 300 94" role="img" aria-label={`First ${Math.min(40, first.points.length)} recorded points from ${first.label}`} className="h-28 w-full rounded-lg border border-border/40 bg-background/50 p-1">
            <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-300" />
          </svg>
        ) : <p className="text-xs text-muted-foreground">No recorded line to preview.</p>}
        <p className="text-xs text-muted-foreground">{summary}.</p>
        {path && <p className="text-[11px] text-muted-foreground">First {Math.min(40, first.points.length)} points in the first recorded series — open the Artifact for full values and evidence.</p>}
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
        <button type="button" onClick={onOpen} className="inline-flex min-h-10 items-center gap-2 rounded border border-border/60 px-3 font-ui text-xs text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
          Open full Artifact <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      {query.isFetching || !query.isFetchedAfterMount ? (
        <p role="status" className="text-sm text-muted-foreground">Checking access and loading the saved version…</p>
      ) : query.isError || !inspected ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-amber-200"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Preview unavailable or no longer matches this Project and version.</p>
      ) : <PreviewContent content={inspected} />}
    </section>
  );
}
