// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import {
  formatReadableScalar, humanizeKey, readableRows,
  type ReadableFormatOptions,
} from "@/lib/artifactReadableFormat";

const SECTION = "rounded-lg border border-border/50 p-3";
const HEADING = "mb-2 font-ui text-[14px] font-semibold";

/** One exact-preserving cell: shows formatted text, keeps the stored value in title/data-exact. */
export function ReadableCell({ text, exact, align = "right" }: { text: string; exact: string | null; align?: "left" | "right" }) {
  return <span title={exact ?? undefined} data-exact={exact ?? undefined} className={`tabular-nums ${align === "right" ? "text-right" : ""}`}>{text}</span>;
}

/** Label/value table for a recorded object (assumptions, results, metrics). Never prints JSON. */
export function ReadableValueTable({ title, values, options = {}, emptyText = "Nothing recorded.", note }: {
  title: string; values: Record<string, unknown>; options?: ReadableFormatOptions; emptyText?: string; note?: string;
}) {
  const rows = readableRows(values, options);
  return <section aria-label={title} className={SECTION}>
    <h3 className={HEADING}>{title}</h3>
    {note && <p className="mb-2 font-ui text-[12px] text-muted-foreground">{note}</p>}
    {rows.length ? <table className="w-full text-left font-ui text-[13px]">
      <caption className="sr-only">{title}</caption>
      <thead className="sr-only"><tr><th scope="col">Item</th><th scope="col">Value</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} className="border-b border-border/30 last:border-0">
        <th scope="row" className="w-1/2 py-1.5 pr-3 align-top font-normal text-muted-foreground">{row.label}</th>
        <td className="min-w-0 break-words py-1.5 align-top"><ReadableCell text={row.text} exact={row.exact} align="left" /></td>
      </tr>)}</tbody>
    </table> : <p className="font-ui text-[13px] text-muted-foreground">{emptyText}</p>}
  </section>;
}

/** Side-by-side comparison (e.g. bear / base / bull) with one column per named record. */
export function ScenarioComparisonTable({ title, scenarios, options = {}, leadKey, note }: {
  title: string; scenarios: Record<string, Record<string, unknown>>; options?: ReadableFormatOptions; leadKey?: string; note?: string;
}) {
  const names = Object.keys(scenarios);
  const keys: string[] = [];
  for (const name of names) for (const key of Object.keys(scenarios[name])) if (!keys.includes(key)) keys.push(key);
  const visible = keys.filter(key => names.some(name => scenarios[name][key] !== null && scenarios[name][key] !== undefined));
  const ordered = leadKey && visible.includes(leadKey) ? [leadKey, ...visible.filter(key => key !== leadKey)] : visible;
  if (!names.length || !ordered.length) return null;
  return <section aria-label={title} className={SECTION}>
    <h3 className={HEADING}>{title}</h3>
    {note && <p className="mb-2 font-ui text-[12px] text-muted-foreground">{note}</p>}
    <div className="overflow-x-auto" tabIndex={0} aria-label={`${title} table`}>
      <table className="w-full text-left font-ui text-[13px]">
        <caption className="sr-only">{title}</caption>
        <thead><tr><th scope="col" className="border-b border-border p-2 font-semibold">Measure</th>{names.map(name => <th key={name} scope="col" className="border-b border-border p-2 text-right font-semibold">{humanizeKey(name)}</th>)}</tr></thead>
        <tbody>{ordered.map(key => <tr key={key} className="border-b border-border/30">
          <th scope="row" className="p-2 font-normal text-muted-foreground">{humanizeKey(key)}</th>
          {names.map(name => {
            const formatted = formatReadableScalar(key, typeof scenarios[name][key] === "object" && scenarios[name][key] !== null ? undefined : scenarios[name][key], options);
            return <td key={name} className="p-2 text-right"><ReadableCell text={formatted.text} exact={formatted.exact} /></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

const MAX_COLUMNS = 20;

/** Row table for recorded records (holdings, trades). Headers are humanized; cells never print JSON. */
export function ReadableRowsTable({ title, rows, limit = 100, options = {}, exportHint }: {
  title: string; rows: Array<Record<string, unknown>>; limit?: number; options?: ReadableFormatOptions; exportHint?: string;
}) {
  const visible = rows.slice(0, limit);
  const allColumns = Array.from(new Set(visible.flatMap(row => Object.keys(row))));
  const columns = allColumns.slice(0, MAX_COLUMNS);
  return <section aria-label={title} className={SECTION}>
    <h3 className={HEADING}>{title}</h3>
    {rows.length ? <>
      <p role="status" className="mb-2 font-ui text-[12px] text-muted-foreground">
        Showing {visible.length} of {rows.length}{rows.length > visible.length ? `. ${exportHint ?? "Export the Artifact to get every row."}` : "."}
        {allColumns.length > columns.length ? ` ${allColumns.length - columns.length} more columns are available in Expert view.` : ""}
      </p>
      <div className="max-h-[380px] overflow-auto rounded border border-border/50" tabIndex={0} aria-label={`${title} table`}>
        <table className="w-full text-left font-ui text-[13px]">
          <caption className="sr-only">{title}</caption>
          <thead className="sticky top-0 bg-background"><tr>{columns.map(column => <th key={column} scope="col" className="border-b border-border p-2 font-semibold">{humanizeKey(column)}</th>)}</tr></thead>
          <tbody>{visible.map((row, index) => <tr key={index} className="border-b border-border/30">{columns.map(column => {
            const value = row[column];
            const formatted = typeof value === "object" && value !== null
              ? { text: Array.isArray(value) && value.every(item => typeof item !== "object" || item === null) ? value.map(item => formatReadableScalar(column, item, options).text).join(", ") : "Detailed value (see Expert view)", exact: null }
              : formatReadableScalar(column, value, options);
            return <td key={column} className="p-2 align-top"><ReadableCell text={formatted.text} exact={formatted.exact} align="left" /></td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </> : <p className="font-ui text-[13px] text-muted-foreground">None recorded.</p>}
  </section>;
}
