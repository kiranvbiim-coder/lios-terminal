import {
  chartArtifactContentSchema, reportArtifactContentSchema, tableArtifactContentSchema,
  type ArtifactContent,
} from "@shared/artifactContracts";
import { readRecordedDocumentTable } from "@shared/richArtifactDocument";
import { prepareArtifactChart } from "./artifactChartProjection";
import { stableSerialize } from "./analyticalCore";
import type { ArtifactDetail, ProjectArtifactRecord } from "./useArtifacts";

type P4VisualContent = Extract<ArtifactContent, { kind: "chart" | "table" }>;

export interface PinnedBriefingVisual {
  artifactId: string;
  version: number;
  contentHash: string;
  projectId: number;
  title: string;
  content: P4VisualContent;
  sourceRefs: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_CHART_SERIES = 8;
const MAX_CHART_POINTS = 1200;
const MAX_TABLE_COLUMNS = 8;
const MAX_TABLE_ROWS = 40;

/** Server-returned P4 content only. Never capture a browser/model-supplied visual payload. */
export function captureBriefingVisual(detail: ArtifactDetail, projectId: number): PinnedBriefingVisual {
  const { artifact, version } = detail;
  if (!Number.isSafeInteger(projectId) || projectId <= 0 ||
      artifact.projectId !== projectId || artifact.status !== "active" ||
      (artifact.kind !== "chart" && artifact.kind !== "table") ||
      version.artifactId !== artifact.id || version.version !== artifact.headVersion ||
      !Number.isSafeInteger(version.version) || version.version < 1 ||
      !SHA256.test(version.contentHash) || version.content.kind !== artifact.kind) {
    throw new Error("The saved visual is not the current, active chart/table version in this Project.");
  }
  // P4 metadata is the origin of these refs. A P4 ID without recorded sources is not evidence.
  const refs = [...new Set(version.sourceRefs.filter(ref => typeof ref === "string" && ref.trim() && ref.length <= 1000))];
  if (!refs.length || refs.length > 100 || artifact.title.trim().length === 0) {
    throw new Error("This visual does not have bounded, recorded P4 source references.");
  }
  let content: P4VisualContent;
  if (artifact.kind === "chart") {
    const parsed = chartArtifactContentSchema.safeParse(version.content);
    if (!parsed.success || parsed.data.series.length < 1 || parsed.data.series.length > MAX_CHART_SERIES ||
      parsed.data.series.reduce((n, series) => n + series.points.length, 0) > MAX_CHART_POINTS) {
      throw new Error("The saved chart exceeds the editable briefing's recorded-series limits.");
    }
    const projection = prepareArtifactChart(parsed.data);
    if (projection.status !== "ready") throw new Error("The recorded chart cannot be rendered without inventing data.");
    content = parsed.data;
  } else {
    const parsed = tableArtifactContentSchema.safeParse(version.content);
    if (!parsed.success || !parsed.data.columns.length || parsed.data.columns.length > MAX_TABLE_COLUMNS ||
      !parsed.data.rows.length || parsed.data.rows.length > MAX_TABLE_ROWS ||
      readRecordedDocumentTable({ table: parsed.data }).status !== "recognized") {
      throw new Error("The saved table is not an eligible, complete recorded table for a briefing.");
    }
    content = parsed.data;
  }
  return { artifactId: artifact.id, version: version.version, contentHash: version.contentHash,
    projectId, title: artifact.title.slice(0, 160), content, sourceRefs: refs };
}

export function verifyCurrentPinnedVisual(pinned: PinnedBriefingVisual, reread: ArtifactDetail): PinnedBriefingVisual {
  const now = captureBriefingVisual(reread, pinned.projectId);
  if (now.artifactId !== pinned.artifactId || now.version !== pinned.version || now.contentHash !== pinned.contentHash ||
      now.title !== pinned.title ||
      JSON.stringify(now.sourceRefs) !== JSON.stringify(pinned.sourceRefs) ||
      stableSerialize(now.content) !== stableSerialize(pinned.content)) {
    throw new Error("The selected visual or its sources changed; review and select its current version again.");
  }
  return now;
}

/** One verified canonical P4 report response, not a hopeful success toast for an unconfirmed write. */
export function assertSavedBriefingArtifact(detail: ArtifactDetail, projectId: number,
  expected: Extract<ArtifactContent, { kind: "report" }>, requiredRefs: readonly string[], sourceRefs: readonly string[]): void {
  const { artifact, version } = detail;
  if (artifact.projectId !== projectId || artifact.kind !== "report" || artifact.origin !== "direct" ||
      artifact.status !== "active" || version.artifactId !== artifact.id ||
      !Number.isSafeInteger(version.version) || version.version < 1 ||
      version.version !== artifact.headVersion || !SHA256.test(version.contentHash) ||
      !reportArtifactContentSchema.safeParse(version.content).success ||
      stableSerialize(version.content) !== stableSerialize(expected) ||
      requiredRefs.some(ref => !version.dependencyRefs.includes(ref)) ||
      sourceRefs.some(ref => !version.sourceRefs.includes(ref))) {
    throw new Error("The P4 response did not confirm the exact briefing and dependencies. Check Library before attempting another save.");
  }
}

/** Only active, Project-owned chart/table heads are eligible for an explicit authenticated read. */
export function eligibleBriefingVisuals(rows: readonly ProjectArtifactRecord[], projectId: number) {
  return rows.filter(row => row.projectId === projectId && row.status === "active" &&
    (row.kind === "chart" || row.kind === "table") && Number.isSafeInteger(row.headVersion) && row.headVersion > 0)
    .slice(0, 60);
}
