// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { Component, lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ArtifactContent } from "@shared/artifactContracts";

const ArtifactChart = lazy(() => import("./ArtifactChart"));
type ChartContent = Extract<ArtifactContent, { kind: "chart" }>;

class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p role="alert" className="rounded border border-red-300/20 p-3 text-sm text-red-200">The chart could not be drawn. The tables above show the same recorded values.</p>
      : this.props.children;
  }
}

/** Read-only chart built from values already recorded on a calculation Artifact (existing chart renderer). */
export function ReadableChart({ title, caption, series }: {
  title: string; caption?: string; series: ChartContent["series"];
}) {
  const [mounted, setMounted] = useState(false);
  // Draw only after mount: the renderer is client-only and lazily loaded.
  useEffect(() => setMounted(true), []);
  if (!series.some(item => item.points.length > 0)) return null;
  const content: ChartContent = { kind: "chart", chartType: "line", rendererPreference: "recharts", options: {}, series };
  return <section aria-label={title} className="space-y-2 rounded-lg border border-border/50 p-3">
    <h3 className="font-ui text-[14px] font-semibold">{title}</h3>
    {caption && <p className="font-ui text-[12px] text-muted-foreground">{caption}</p>}
    {mounted
      ? <ChartBoundary><Suspense fallback={<p role="status" className="font-ui text-[13px] text-muted-foreground">Loading chart…</p>}><ArtifactChart content={content} readOnly /></Suspense></ChartBoundary>
      : <p role="status" className="font-ui text-[13px] text-muted-foreground">Loading chart…</p>}
  </section>;
}
