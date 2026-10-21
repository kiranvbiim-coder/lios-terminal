import {
  dataArtifactContentSchema,
  richDocumentBlockSchema,
  tableArtifactContentSchema,
  type ArtifactContent,
  type RichArtifactBlock,
} from "@shared/artifactContracts";
import type { ReportPack, ReportSectionType } from "./reportEngine";

type Table = Extract<ArtifactContent, { kind: "table" }>;
type Scalar = string | number | boolean | null;
const TABLE_PAGE_SIZE = 100;

function isScalar(value: unknown): value is Scalar {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function label(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
}

export interface ReportProjectionOptions {
  blockIdPrefix?: "block" | "section";
  attrs?: Record<string, unknown>;
  firstBlockAttrs?: Record<string, unknown>;
}

export interface ReportSectionProjection {
  blocks: RichArtifactBlock[];
  sections: Array<{ id: string; title: string; blockIds: string[] }>;
}

/** Presentation only: recorded values are never parsed, scaled, or recalculated. */
export function projectReportSections(report: ReportPack, options: ReportProjectionOptions = {}): ReportSectionProjection {
  const blocks: RichArtifactBlock[] = [];
  const sections: Array<{ id: string; title: string; blockIds: string[] }> = [];
  for (const [index, section] of report.sections.entries()) {
    const blockIds: string[] = [];
    const baseId = `${options.blockIdPrefix ?? "block"}-${index + 1}`;
    const attrs = {
      reportOutputHash: report.metadata.outputHash,
      ...(report.metadata.engineId !== undefined ? { engineId: report.metadata.engineId } : {}),
      ...(report.metadata.engineVersion !== undefined ? { engineVersion: report.metadata.engineVersion } : {}),
      passportIds: report.metadata.passportIds,
      ...(report.metadata.receiptId !== undefined ? { receiptId: report.metadata.receiptId } : {}),
      ...options.attrs,
      sectionType: section.type,
      order: section.order,
    };
    const emit = (type: RichArtifactBlock["type"], text: string, extra: Record<string, unknown> = {}) => {
      const id = blockIds.length ? `${baseId}-${blockIds.length + 1}` : baseId;
      blockIds.push(id);
      blocks.push({ id, type, text, attrs: {
        ...extra,
        ...attrs,
        ...(index === 0 && blockIds.length === 1 ? options.firstBlockAttrs : {}),
      } });
    };
    const missing = (name: string) => emit("callout", `${name}: no recorded content supplied.`, { missing: true });
    const table = (name: string, payload: Table, extra: Record<string, unknown> = {}) => {
      emit("table", name, { ...extra, table: payload });
    };
    const fieldTable = (name: string, entries: Array<[string, Scalar]>) => {
      for (let start = 0; start < entries.length; start += TABLE_PAGE_SIZE) {
        table(name, {
          kind: "table",
          columns: [{ key: "field", label: "Recorded field", type: "string" }, { key: "value", label: "Recorded value", type: "string" }],
          rows: entries.slice(start, start + TABLE_PAGE_SIZE).map(([field, value]) => ({ field, value })),
        });
      }
    };
    const project = (value: unknown, name: string): void => {
      if (value === undefined || value === null) { missing(name); return; }
      if (isScalar(value)) {
        if (value === "") missing(name);
        else emit("paragraph", typeof value === "string" ? value : String(value));
        return;
      }
      const record = typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      const canonicalTable = tableArtifactContentSchema.safeParse(value);
      if (canonicalTable.success) {
        // Keep the actual canonical payload, including numerical evidence; do not
        // normalize string numbers or replace source columns with inferred ones.
        table(name, value as Table);
        if (!canonicalTable.data.rows.length) missing(`${name} rows`);
        return;
      }
      const data = dataArtifactContentSchema.safeParse(value);
      if (data.success) {
        const { columns, previewRows, rowCount, columnarArtifactId } = data.data;
        for (let start = 0; start < columns.length; start += 500) {
          table(`${name} · recorded preview`, {
            kind: "table",
            columns: columns.slice(start, start + 500).map((column) => ({ key: column.name, label: column.name, type: "string" })),
            rows: previewRows,
          }, { dataColumns: columns, rowCount, columnarArtifactId });
        }
        emit("callout", `${name}: ${previewRows.length} recorded preview rows; recorded row count: ${rowCount}. Full data is not inferred from the preview.`);
        if (!columns.length) missing(`${name} columns`);
        return;
      }
      if (Array.isArray(value)) {
        if (!value.length) { missing(name); return; }
        if (value.every((item) => typeof item === "string")) {
          for (let start = 0; start < value.length; start += TABLE_PAGE_SIZE) {
            emit("bullet_list", value.slice(start, start + TABLE_PAGE_SIZE).join("\n"));
          }
          return;
        }
        if (value.every(isScalar)) {
          fieldTable(name, value.map((item, itemIndex) => [`${name} [${itemIndex + 1}]`, item]));
          return;
        }
        // A recorded array of rows is tabular only for its scalar fields.
        // Nested models retain named paths rather than becoming JSON cells.
        if (value.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
          const rows = value as Array<Record<string, unknown>>;
          const keys = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => isScalar(row[key]))))].sort();
          if (keys.length) {
            for (let start = 0; start < value.length; start += TABLE_PAGE_SIZE) {
              for (let columnStart = 0; columnStart < keys.length; columnStart += 500) {
                const pageKeys = keys.slice(columnStart, columnStart + 500);
                table(name, {
                  kind: "table",
                  columns: pageKeys.map((key) => ({ key, label: label(key), type: "string" })),
                  rows: rows.slice(start, start + TABLE_PAGE_SIZE).map((row) => Object.fromEntries(pageKeys.filter((key) => key in row && isScalar(row[key])).map((key) => [key, row[key]]))) as Table["rows"],
                });
              }
            }
          }
          rows.forEach((row, rowIndex) => {
            for (const key of Object.keys(row).sort()) {
              if (!isScalar(row[key])) project(row[key], `${name} [${rowIndex + 1}] · ${label(key)}`);
            }
          });
          return;
        }
        value.forEach((item, itemIndex) => {
          emit("heading", `${name} [${itemIndex + 1}]`, { level: 3 });
          project(item, `${name} [${itemIndex + 1}]`);
        });
        return;
      }
      if (record) {
        const keys = Object.keys(record).sort();
        if (!keys.length) { missing(name); return; }
        // Authored rich blocks remain authored rich blocks, not a generated
        // recommendation or a serialization of their editing metadata.
        if ((record.kind === "report" || record.kind === "research") && Array.isArray(record.blocks)) {
          for (const sourceBlock of record.blocks) {
            const parsed = richDocumentBlockSchema.safeParse(sourceBlock);
            if (parsed.success) emit(parsed.data.type, parsed.data.text, { ...parsed.data.attrs, sourceBlockId: parsed.data.id, sourceBlockAttrs: parsed.data.attrs });
            else emit("callout", `${name}: a recorded block is not displayable under the rich document contract.`, { unavailable: true });
          }
          for (const key of keys.filter((key) => !["blocks", "sections", "editorPreference", "kind"].includes(key))) project(record[key], `${name} · ${label(key)}`);
          return;
        }
        const scalarFields: Array<[string, Scalar]> = [];
        for (const key of keys) {
          const item = record[key];
          if (item === undefined) continue;
          if (isScalar(item)) {
            if (["statement", "thesis", "recommendation", "narrative", "summary", "description"].includes(key) && typeof item === "string") {
              if (item === "") missing(`${name} · ${label(key)}`);
              else emit("paragraph", item, { recordedField: key });
            } else scalarFields.push([label(key), item]);
          }
        }
        fieldTable(name, scalarFields);
        for (const key of keys) {
          if (record[key] !== undefined && !isScalar(record[key])) {
            emit("heading", `${name} · ${label(key)}`, { level: 3 });
            project(record[key], `${name} · ${label(key)}`);
          }
        }
        return;
      }
      emit("callout", `${name}: recorded value is not displayable as a finite scalar or structured table.`, { unavailable: true });
    };

    if (section.type === "title") {
      const content = section.content !== null && typeof section.content === "object" && !Array.isArray(section.content)
        ? section.content as Record<string, unknown> : null;
      const title = content && typeof content.title === "string" ? content.title
        : typeof section.content === "string" ? section.content : report.title;
      emit("heading", title, { level: 1 });
      if (content) {
        for (const key of ["subtitle", "symbol"]) {
          if (typeof content[key] === "string") emit("paragraph", content[key] as string, { recordedField: key });
        }
      }
    } else {
      emit("heading", section.title, { level: 2 });
      if (section.type === "chart_placeholder") {
        const chart = section.content !== null && typeof section.content === "object" && !Array.isArray(section.content)
          ? section.content as Record<string, unknown> : null;
        if (chart && typeof chart.artifactRef === "string" && chart.artifactRef.length > 0) {
          emit("chart_ref", typeof chart.title === "string" ? chart.title : section.title, { ...chart });
        } else {
          emit("callout", "Chart unavailable: no recorded chart Artifact reference supplied.", { chartUnavailable: true });
          if (section.content !== undefined && section.content !== null) project(section.content, "Recorded chart information");
        }
      } else project(section.content, section.title);
    }
    sections.push({ id: `section-${index + 1}`, title: section.title, blockIds });
  }
  return { blocks, sections };
}

/** Select semantic source sections without embedding the whole Artifact twice. */
export function reportSectionsFromArtifact(source: ArtifactContent): Partial<Record<ReportSectionType, unknown>> {
  switch (source.kind) {
    case "table":
    case "data": return { table: source };
    case "valuation": return {
      key_metrics: { symbol: source.symbol, modelId: source.modelId, outputs: source.outputs, summary: source.summary },
      assumptions: source.assumptions,
    };
    case "portfolio": return { key_metrics: { portfolioRef: source.portfolioRef, summary: source.summary, risk: source.risk }, table: source.holdings };
    case "backtest": {
      const { assumptions, trades, ...recorded } = source;
      return { key_metrics: recorded, table: trades, assumptions };
    }
    case "decision": return { decision_receipt: source, assumptions: source.assumptions };
    case "chart": return { chart_placeholder: { artifactRef: null, chartType: source.chartType }, table: source.series };
    default: return { table: source };
  }
}
