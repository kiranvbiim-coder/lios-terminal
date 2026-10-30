// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { formatReadableNumber, formatReadableScalar, humanizeKey, recordOrNull, type ReadableFormatOptions } from "@/lib/artifactReadableFormat";
import { cn } from "@/lib/utils";

/**
 * Renders any recorded JSON-like value as readable UI instead of raw JSON: objects become labelled
 * rows, arrays of records become a sortable table, arrays of plain values become chips, and nested
 * records become collapsible sections. Nothing is dropped: capped tables offer "Show all", and every
 * formatted number keeps its stored value in `title`/`data-exact`.
 */
export interface ReadableValueProps {
  value: unknown;
  /** Show every stored digit and string verbatim (audit evidence) and never cap rows. */
  exact?: boolean;
  /** Rows shown before "Show all" for tables and lists. */
  rowLimit?: number;
  /** Nested sections shallower than this depth start open. */
  openDepth?: number;
  /** Optional ISO currency code recorded with the value; never assumed. */
  currency?: string | null;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

interface Ctx { exact: boolean; rowLimit: number; openDepth: number; options: ReadableFormatOptions }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const MAX_TABLE_COLUMNS = 16;

type Scalar = string | number | boolean | bigint | null | undefined;

function isScalar(value: unknown): value is Scalar {
  return value === null || value === undefined || ["string", "number", "boolean", "bigint"].includes(typeof value);
}

/** Display text plus the exact stored text when the display differs. */
export function readableScalarText(key: string, value: Scalar, ctx: Pick<Ctx, "exact" | "options"> = { exact: false, options: {} }): { text: string; exact: string | null } {
  if (value === null || value === undefined) return { text: "—", exact: null };
  if (typeof value === "boolean") return { text: value ? "Yes" : "No", exact: null };
  if (typeof value === "bigint") return { text: String(value), exact: null };
  if (typeof value === "number") return formatReadableNumber(key, value, { ...ctx.options, showExact: ctx.exact });
  if (ctx.exact) return { text: value, exact: null };
  if (ISO_DATE.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) return { text: date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }), exact: value };
  }
  if (ISO_DATE_TIME.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return { text: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }), exact: value };
  }
  // Long hashes are shortened with the full value kept in the tooltip; other text stays verbatim.
  const formatted = formatReadableScalar(key, value, ctx.options);
  return formatted.exact !== null ? formatted : { text: value, exact: null };
}

function ScalarText({ name, value, ctx }: { name: string; value: Scalar; ctx: Ctx }) {
  const { text, exact } = readableScalarText(name, value, ctx);
  const muted = value === null || value === undefined;
  return <span title={exact ?? undefined} data-exact={exact ?? undefined}
    className={`whitespace-pre-wrap break-words ${typeof value === "number" ? "tabular-nums" : ""} ${muted ? "text-muted-foreground" : ""}`}>{text}</span>;
}

function compare(a: unknown, b: unknown): number {
  const emptyA = a === null || a === undefined;
  const emptyB = b === null || b === undefined;
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(isScalar(a) ? a : JSON.stringify(a)).localeCompare(String(isScalar(b) ? b : JSON.stringify(b)), undefined, { numeric: true });
}

function ShowAll({ total, shown, onClick }: { total: number; shown: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="mt-1 rounded px-2 py-1 font-ui text-[12px] text-cyan-200 hover:bg-white/5">
    Show all {total} (showing {shown})
  </button>;
}

function RecordTable({ name, rows, ctx, depth }: { name: string; rows: Array<Record<string, unknown>>; ctx: Ctx; depth: number }) {
  const [sort, setSort] = React.useState<{ column: string; dir: 1 | -1 } | null>(null);
  const [all, setAll] = React.useState(false);
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  const ordered = sort ? rows.map((row, index) => ({ row, index })).sort((a, b) => sort.dir * compare(a.row[sort.column], b.row[sort.column]) || a.index - b.index).map(item => item.row) : rows;
  const limit = ctx.exact || all ? ordered.length : ctx.rowLimit;
  const visible = ordered.slice(0, limit);
  return <div>
    <div className="max-h-[380px] overflow-auto rounded border border-border/50" tabIndex={0} aria-label={`${humanizeKey(name || "rows")} table`}>
      <table className="w-full text-left">
        <thead className="sticky top-0 bg-background"><tr>{columns.map(column => {
          const active = sort?.column === column;
          return <th key={column} scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined} className="border-b border-border p-0 font-semibold">
            <button type="button" onClick={() => setSort(active && sort.dir === 1 ? { column, dir: -1 } : { column, dir: 1 })} className="w-full p-2 text-left hover:bg-white/5">
              {humanizeKey(column)}{active ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
            </button>
          </th>;
        })}</tr></thead>
        <tbody>{visible.map((row, index) => <tr key={index} className="border-b border-border/30 last:border-0">{columns.map(column => <td key={column} className="p-2 align-top">
          <Node name={column} value={row[column]} ctx={ctx} depth={depth + 1} />
        </td>)}</tr>)}</tbody>
      </table>
    </div>
    {visible.length < ordered.length && <ShowAll total={ordered.length} shown={visible.length} onClick={() => setAll(true)} />}
  </div>;
}

function Chips({ name, items, ctx }: { name: string; items: Scalar[]; ctx: Ctx }) {
  const [all, setAll] = React.useState(false);
  const limit = ctx.exact || all ? items.length : ctx.rowLimit;
  const visible = items.slice(0, limit);
  return <div>
    <ul className="flex flex-wrap gap-1">{visible.map((item, index) => <li key={index} className="rounded border border-border/50 bg-white/[0.03] px-1.5 py-0.5 text-[12px]">
      <ScalarText name={name} value={item} ctx={ctx} />
    </li>)}</ul>
    {visible.length < items.length && <ShowAll total={items.length} shown={visible.length} onClick={() => setAll(true)} />}
  </div>;
}

function MixedList({ name, items, ctx, depth }: { name: string; items: unknown[]; ctx: Ctx; depth: number }) {
  const [all, setAll] = React.useState(false);
  const limit = ctx.exact || all ? items.length : ctx.rowLimit;
  const visible = items.slice(0, limit);
  return <div>
    <ol className="space-y-1">{visible.map((item, index) => <li key={index} className="flex gap-2">
      <span className="shrink-0 text-muted-foreground tabular-nums">{index + 1}.</span>
      <div className="min-w-0 flex-1"><Node name={name} value={item} ctx={ctx} depth={depth + 1} /></div>
    </li>)}</ol>
    {visible.length < items.length && <ShowAll total={items.length} shown={visible.length} onClick={() => setAll(true)} />}
  </div>;
}

function Rows({ record, ctx, depth }: { record: Record<string, unknown>; ctx: Ctx; depth: number }) {
  const entries = Object.entries(record);
  return <div className="divide-y divide-border/30">{entries.map(([key, value]) => {
    const nested = recordOrNull(value);
    if (isScalar(value) || (Array.isArray(value) && (value.length === 0 || value.every(isScalar))) || (nested !== null && Object.keys(nested).length === 0)) {
      return <div key={key} className="grid grid-cols-[minmax(8rem,40%)_1fr] gap-3 py-1.5">
        <div className="text-muted-foreground">{humanizeKey(key)}</div>
        <div className="min-w-0"><Node name={key} value={value} ctx={ctx} depth={depth + 1} /></div>
      </div>;
    }
    const size = Array.isArray(value) ? value.length : Object.keys(value as object).length;
    const count = `${size} ${Array.isArray(value) ? (size === 1 ? "item" : "items") : (size === 1 ? "field" : "fields")}`;
    return <details key={key} open={depth < ctx.openDepth} className="py-1.5">
      <summary className="cursor-pointer text-muted-foreground"><span className="text-foreground">{humanizeKey(key)}</span> <span className="text-[12px]">· {count}</span></summary>
      <div className="mt-1 border-l border-border/40 pl-3"><Node name={key} value={value} ctx={ctx} depth={depth + 1} /></div>
    </details>;
  })}</div>;
}

function Node({ name, value, ctx, depth }: { name: string; value: unknown; ctx: Ctx; depth: number }) {
  if (isScalar(value)) return <ScalarText name={name} value={value} ctx={ctx} />;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">None</span>;
    if (value.every(isScalar)) return <Chips name={name} items={value} ctx={ctx} />;
    const records = value.map(recordOrNull);
    if (records.every((row): row is Record<string, unknown> => row !== null)) {
      const keys = new Set<string>();
      for (const row of records) for (const key of Object.keys(row)) keys.add(key);
      if (keys.size > 0 && keys.size <= MAX_TABLE_COLUMNS) return <RecordTable name={name} rows={records} ctx={ctx} depth={depth} />;
    }
    return <MixedList name={name} items={value} ctx={ctx} depth={depth} />;
  }
  const record = recordOrNull(value);
  if (record) {
    if (!Object.keys(record).length) return <span className="text-muted-foreground">None</span>;
    return <Rows record={record} ctx={ctx} depth={depth} />;
  }
  return <span>{String(value)}</span>;
}

export function ReadableValue({ value, exact = false, rowLimit = 25, openDepth = 1, currency, className, ...rest }: ReadableValueProps) {
  const ctx: Ctx = { exact, rowLimit, openDepth, options: currency ? { currency } : {} };
  return <div className={cn("min-w-0 font-ui text-[13px]", className)} aria-label={rest["aria-label"]} data-testid={rest["data-testid"]}>
    <Node name="" value={value} ctx={ctx} depth={0} />
  </div>;
}

/** Collapsed-by-default disclosure for developer/audit detail; content is still readable, never raw JSON. */
export function TechnicalDetails({ value, summary = "Technical details", exact = true, defaultOpen = false, className }: {
  value: unknown; summary?: string; exact?: boolean; defaultOpen?: boolean; className?: string;
}) {
  return <details open={defaultOpen} className={cn("rounded border border-border/40 p-2", className)}>
    <summary className="cursor-pointer font-ui text-[12px] text-muted-foreground">{summary}</summary>
    <ReadableValue value={value} exact={exact} className="mt-2" />
  </details>;
}
