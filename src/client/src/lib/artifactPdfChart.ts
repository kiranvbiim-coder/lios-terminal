import type { jsPDF } from "jspdf";
import { chartArtifactContentSchema } from "@shared/artifactContracts";
import { prepareArtifactChart, selectArtifactChartViewport, type ArtifactChartProjection, type ArtifactChartViewport } from "./artifactChartProjection";

export const ARTIFACT_PDF_CHART_HEIGHT = 300;
export const MAX_ARTIFACT_PDF_CHART_WINDOWS = 100;
export const MAX_ARTIFACT_PDF_CHART_SOURCE_POINTS = 20_000;
const WINDOW_X_VALUES = 24;
const WINDOW_SOURCE_POINTS = 200;
const COLORS: Array<[number, number, number]> = [[35, 82, 160], [180, 50, 50], [20, 120, 85], [135, 65, 155], [165, 105, 15], [30, 120, 140], [95, 95, 95], [180, 60, 130]];

export interface ArtifactPdfChartPlan {
  projection: ArtifactChartProjection;
  windows: ArtifactChartViewport[];
  windowCount: number;
  height: number;
  textLabels: string[];
}

/** Reject unresolved references and lossy/oversized exports before a PDF is delivered. */
export function prepareArtifactPdfChart(payload: unknown): ArtifactPdfChartPlan {
  const parsed = chartArtifactContentSchema.safeParse(payload);
  if (!parsed.success) throw new Error("PDF chart requires a valid canonical chart payload; unresolved chart references are unavailable.");
  const projection = prepareArtifactChart(parsed.data);
  if (projection.status !== "ready") throw new Error(projection.message);
  if (projection.series.length > COLORS.length || projection.totalSourcePoints > MAX_ARTIFACT_PDF_CHART_SOURCE_POINTS) {
    throw new Error(`PDF chart exceeds native export bounds (${COLORS.length} series, ${MAX_ARTIFACT_PDF_CHART_SOURCE_POINTS} source points). No points were exported.`);
  }
  // Subtracting extreme finite endpoints can overflow. Reject rather than mis-scale.
  if (projection.yDomain && !Number.isFinite(projection.yDomain[1] - projection.yDomain[0])) throw new Error("PDF chart y range exceeds finite native scale bounds.");
  const windows: ArtifactChartViewport[] = [];
  for (let offset = 0; offset < projection.totalDistinctPoints;) {
    let limit = Math.min(projection.xKind === "category" ? 6 : WINDOW_X_VALUES, projection.totalDistinctPoints - offset);
    let view = selectArtifactChartViewport(projection, { offset, limit });
    while (view.series.reduce((sum, series) => sum + series.points.length, 0) > WINDOW_SOURCE_POINTS && limit > 1) {
      view = selectArtifactChartViewport(projection, { offset, limit: --limit });
    }
    windows.push(view);
    if (windows.length > MAX_ARTIFACT_PDF_CHART_WINDOWS) throw new Error(`PDF chart needs more than ${MAX_ARTIFACT_PDF_CHART_WINDOWS} windows. No points were exported.`);
    offset = view.endExclusive;
  }
  if (!windows.length) windows.push(selectArtifactChartViewport(projection));
  if (projection.xKind === "number" && windows.some(view => view.rows.length && !Number.isFinite((view.xEnd as number) - (view.xStart as number)))) throw new Error("PDF chart x range exceeds finite native scale bounds.");
  const plan: ArtifactPdfChartPlan = { projection, windows, windowCount: windows.length, height: ARTIFACT_PDF_CHART_HEIGHT, textLabels: [] };
  plan.textLabels = windows.flatMap((view, index) => windowText(plan, view, index));
  return plan;
}

function windowText(plan: ArtifactPdfChartPlan, view: ArtifactChartViewport, index: number): string[] {
  const p = plan.projection;
  const count = view.series.reduce((sum, series) => sum + series.points.length, 0);
  return [
    `${p.chartType} | window ${index + 1} of ${plan.windowCount} | ${count} observations`,
    `Full source: ${p.totalSourcePoints} observations; ${p.totalDistinctPoints} distinct x values`,
    `Shared y domain: ${p.yDomain ? `${p.yDomain[0]} to ${p.yDomain[1]}` : "empty"}`,
    p.xKind === "number" ? `Numeric x: ${view.xStart ?? "empty"} to ${view.xEnd ?? "empty"}; actual linear scale` : "Categorical x: explicit numbered positions (number and string remain distinct)",
    ...p.series.map(series => `S${series.index + 1}: ${series.label} [${series.id}]`),
    ...(p.xKind === "category" ? view.rows.map((row, i) => `${i + 1}: ${JSON.stringify(row.x)}`) : []),
  ];
}

export interface ArtifactPdfChartLayout {
  x: number;
  y: number;
  width: number;
  height?: number;
  /** Caller owns page creation and furniture; returns the next page's content y. */
  newPage?: () => number;
  /** Caller may validate against its embedded font. Without it only ASCII is supported. */
  validateText?: (text: string) => void;
}

/** Native vector geometry only. Missing union-x observations break paths, never become zero. */
export function renderArtifactChartPdf(pdf: jsPDF, plan: ArtifactPdfChartPlan, layout: ArtifactPdfChartLayout) {
  const height = layout.height ?? plan.height;
  if (![layout.x, layout.y, layout.width, height].every(Number.isFinite) || layout.x < 0 || layout.y < 0 || layout.width < 240 || height < plan.height) throw new Error("PDF chart layout is outside native rendering bounds.");
  if (plan.windowCount > 1 && !layout.newPage) throw new Error("PDF chart requires a caller-owned page callback to export every window.");
  for (const text of plan.textLabels) {
    if (layout.validateText) layout.validateText(text);
    else if (/[^\x20-\x7e]/.test(text)) throw new Error("PDF chart text needs an embedded font supporting its glyphs.");
  }
  const fontName = layout.validateText ? pdf.getFont().fontName : "helvetica";
  pdf.setFont(fontName, "normal");
  pdf.setFontSize(8);
  // Measure every page before drawing any page; never silently cut long labels.
  const wrapped = plan.windows.map((view, index) => windowText(plan, view, index).map(text => pdf.splitTextToSize(text, layout.width) as string[]));
  for (const lines of wrapped) {
    if (lines.reduce((sum, block) => sum + block.length, 0) * 10 + 108 > height) throw new Error("PDF chart labels exceed the declared page bounds; enlarge the chart layout or shorten source labels.");
  }
  if (layout.x + layout.width > pdf.internal.pageSize.getWidth() || layout.y + height > pdf.internal.pageSize.getHeight()) throw new Error("PDF chart does not fit its declared page bounds.");
  let y = layout.y;
  let representedSourcePoints = 0;
  plan.windows.forEach((view, windowIndex) => {
    if (windowIndex) y = layout.newPage!();
    pdf.setFont(fontName, "normal");
    if (!Number.isFinite(y) || y < 0 || y + height > pdf.internal.pageSize.getHeight()) throw new Error("PDF chart continuation does not fit its declared page bounds.");
    const lines = wrapped[windowIndex];
    pdf.setTextColor(30, 30, 30);
    pdf.setFontSize(8);
    let textY = y + 9;
    for (const block of lines.slice(0, 4)) { pdf.text(block, layout.x, textY); textY += block.length * 10; }
    const left = layout.x + 12;
    const top = textY + 4;
    const width = layout.width - 24;
    const plotHeight = 88;
    const bottom = top + plotHeight;
    const [min, max] = plan.projection.yDomain ?? [0, 0];
    const range = max - min;
    const py = (value: number) => range === 0 ? top + plotHeight / 2 : bottom - 1.2 - ((value - min) / range) * (plotHeight - 2.4);
    const xStart = view.xStart as number;
    const xEnd = view.xEnd as number;
    const px = (x: string | number, index: number) => plan.projection.xKind === "number"
      ? xEnd === xStart ? left + width / 2 : left + 12 + ((x as number) - xStart) / (xEnd - xStart) * (width - 24)
      : left + ((index + 0.5) / view.rows.length) * width;
    pdf.setDrawColor(170, 170, 170);
    pdf.setLineWidth(0.4);
    pdf.rect(left, top, width, plotHeight, "S");
    pdf.line(left, py(0), left + width, py(0));
    let minimumSpacing = width;
    for (let i = 1; i < view.rows.length; i++) minimumSpacing = Math.min(minimumSpacing, px(view.rows[i].x, i) - px(view.rows[i - 1].x, i - 1));
    const barWidth = Math.min(16, minimumSpacing * 0.7) / Math.max(1, view.series.length);
    for (const series of view.series) {
      const color = COLORS[series.index];
      pdf.setDrawColor(...color);
      pdf.setFillColor(...color);
      pdf.setLineWidth(0.8);
      let previous: { x: number; y: number } | null = null;
      view.rows.forEach((row, index) => {
        const value = row[series.dataKey];
        if (value === null) { previous = null; return; }
        if (typeof value !== "number") throw new Error("PDF chart plan contains a non-numeric observation.");
        const point = { x: px(row.x, index), y: py(value) };
        if (plan.projection.chartType === "bar") {
          // Edge bars stay inside the plot; signed rectangles originate at real zero.
          const center = point.x + (series.index - (view.series.length - 1) / 2) * barWidth;
          const x = Math.max(left, Math.min(left + width - barWidth, center - barWidth / 2));
          if (value === 0) pdf.line(x, py(0), x + barWidth, py(0));
          else pdf.rect(x, Math.min(point.y, py(0)), barWidth, Math.abs(point.y - py(0)), "F");
        } else {
          if (previous && plan.projection.chartType !== "scatter") {
            if (plan.projection.chartType === "area") {
              // A linear signed segment closes at zero, with no interpolation across gaps.
              const pale = color.map(component => Math.round(component * 0.25 + 255 * 0.75)) as [number, number, number];
              pdf.setFillColor(...pale);
              const baseline = py(0);
              if ((previous.y - baseline) * (point.y - baseline) < 0) {
                const crossX = previous.x + (point.x - previous.x) * (baseline - previous.y) / (point.y - previous.y);
                pdf.lines([[crossX - previous.x, baseline - previous.y], [previous.x - crossX, 0]], previous.x, previous.y, [1, 1], "F", true);
                pdf.lines([[point.x - crossX, point.y - baseline], [0, baseline - point.y]], crossX, baseline, [1, 1], "F", true);
              } else {
                pdf.lines([[point.x - previous.x, point.y - previous.y], [0, baseline - point.y], [previous.x - point.x, 0], [0, previous.y - baseline]], previous.x, previous.y, [1, 1], "F", true);
              }
              pdf.setFillColor(...color);
            }
            pdf.line(previous.x, previous.y, point.x, point.y);
          }
          pdf.circle(point.x, point.y, 1.2, "F");
        }
        previous = point;
        representedSourcePoints++;
      });
    }
    textY = bottom + 12;
    for (const block of lines.slice(4)) { pdf.text(block, layout.x, textY); textY += block.length * 10; }
  });
  return { bottomY: y + height, windowCount: plan.windowCount, totalSourcePoints: plan.projection.totalSourcePoints, totalDistinctPoints: plan.projection.totalDistinctPoints, representedSourcePoints };
}
