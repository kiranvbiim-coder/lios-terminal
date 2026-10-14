import { useMemo, useState } from "react";
import {
  buildMetricExplorerModel,
  formatMetricExplorerValue,
  metricExplorerExplanation,
  type MetricExplorerGroup,
  type MetricExplorerInput,
  type MetricExplorerRow,
} from "@/lib/MetricExplorer";

const PAGE_SIZE = 12;
const GROUPS: Array<"ALL" | MetricExplorerGroup> = ["ALL", "CORE", "EXTENDED", "PROVIDER", "DERIVED"];
const STATUSES = ["ALL", "live", "filed", "imported", "manual", "derived", "missing", "stale", "conflict", "not-applicable"] as const;

type ExplorerRow = MetricExplorerRow;

function displayStatus(status: string): string {
  return status.toUpperCase();
}

function displayRawValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    try { return JSON.stringify(value); } catch { return "[object]"; }
  }
  return formatMetricExplorerValue(value);
}

export default function MetricExplorerPanel({ input }: { input: MetricExplorerInput }) {
  const model = useMemo(() => buildMetricExplorerModel(input), [input]);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<"ALL" | MetricExplorerGroup>("ALL");
  const [category, setCategory] = useState("ALL");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("ALL");
  const [provider, setProvider] = useState("ALL");
  const [page, setPage] = useState(0);
  const [availableOnly, setAvailableOnly] = useState(false);

  const providers = useMemo(() => [...new Set([
    ...model.canonical.map(row => row.resolved.provider).filter((value): value is string => Boolean(value)),
    ...model.provider.map(row => row.provider),
  ])].sort(), [model]);
  const categories = useMemo(() => [...new Set(model.canonical.map(row => row.category))].sort(), [model]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...model.canonical, ...model.provider].filter((row: ExplorerRow) => {
      const resolved = "resolved" in row ? row.resolved : undefined;
      const rowStatus = resolved?.status ?? ("status" in row ? row.status : "missing");
      const rowProvider = resolved?.provider ?? ("provider" in row ? row.provider : undefined);
      const available = resolved ? resolved.value !== null : "value" in row && row.value !== null && row.value !== undefined && row.value !== "";
      const searchable = [row.id, row.label, "category" in row ? row.category : "provider", rowProvider ?? "", resolved?.source ?? ("source" in row ? row.source : "")].join(" ").toLowerCase();
      const rowCategory = "category" in row ? row.category : "provider";
      return (!needle || searchable.includes(needle))
        && (group === "ALL" || row.group === group)
        && (category === "ALL" || rowCategory === category)
        && (status === "ALL" || rowStatus === status)
        && (provider === "ALL" || rowProvider === provider)
        && (!availableOnly || available);
    });
  }, [model, query, group, category, status, provider, availableOnly]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filteredRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const update = <T,>(setter: (value: T) => void, value: T) => { setter(value); setPage(0); };

  return (
    <section className="space-y-2" data-testid="metric-explorer" aria-label="Governed metric explorer">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">GOVERNED METRIC EXPLORER</div>
          <div className="font-terminal text-[7px] text-muted-foreground/60">{model.latestPeriod ? `LATEST STATEMENT PERIOD ${model.latestPeriod}` : "NO STATEMENT PERIOD AVAILABLE"} · NULLS ARE NOT ZERO-FILLED</div>
        </div>
        <span className="font-terminal text-[7px] text-muted-foreground" data-testid="metric-explorer-count">{filteredRows.length} MATCH{filteredRows.length === 1 ? "" : "ES"}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-1.5 border border-border bg-[#0a0a0a] p-2" data-testid="metric-explorer-filters">
        <input value={query} onChange={(event) => update(setQuery, event.target.value)} placeholder="SEARCH METRICS..." aria-label="Search metrics" data-testid="metric-explorer-search" className="bg-transparent border border-border px-2 py-1 font-terminal text-[8px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <select value={group} onChange={(event) => update(setGroup, event.target.value as "ALL" | MetricExplorerGroup)} aria-label="Metric group filter" data-testid="metric-explorer-group" className="bg-[#0a0a0a] border border-border px-1 font-terminal text-[8px] text-foreground">
          {GROUPS.map(value => <option key={value} value={value}>{value === "ALL" ? "ALL GROUPS" : value}</option>)}
        </select>
        <select value={category} onChange={(event) => update(setCategory, event.target.value)} aria-label="Metric category filter" data-testid="metric-explorer-category" className="bg-[#0a0a0a] border border-border px-1 font-terminal text-[8px] text-foreground">
          <option value="ALL">ALL CATEGORIES</option>
          {categories.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}
        </select>
        <select value={status} onChange={(event) => update(setStatus, event.target.value as (typeof STATUSES)[number])} aria-label="Metric status filter" data-testid="metric-explorer-status" className="bg-[#0a0a0a] border border-border px-1 font-terminal text-[8px] text-foreground">
          {STATUSES.map(value => <option key={value} value={value}>{value === "ALL" ? "ALL STATUS" : displayStatus(value)}</option>)}
        </select>
        <select value={provider} onChange={(event) => update(setProvider, event.target.value)} aria-label="Metric provider filter" data-testid="metric-explorer-provider" className="bg-[#0a0a0a] border border-border px-1 font-terminal text-[8px] text-foreground">
          <option value="ALL">ALL PROVIDERS</option>
          {providers.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <label className="flex items-center gap-1 px-1 font-terminal text-[8px] text-muted-foreground">
          <input type="checkbox" checked={availableOnly} onChange={(event) => update(setAvailableOnly, event.target.checked)} data-testid="metric-explorer-available" />
          SHOW AVAILABLE ONLY
        </label>
      </div>

      <div className="border border-border overflow-x-auto">
        <table className="w-full border-collapse min-w-[760px]" data-testid="metric-explorer-table">
          <thead>
            <tr className="border-b border-border bg-[#0a0a0a]">
              {["GROUP / METRIC", "VALUE", "STATUS", "PERIOD / AS-OF", "PROVIDER / SOURCE", "FORMULA / DEPENDENCIES"].map(label => <th key={label} className="px-2 py-1.5 text-left font-terminal text-[7px] text-muted-foreground tracking-wider">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row: ExplorerRow) => {
              const canonical = "resolved" in row;
              const resolved = canonical ? row.resolved : undefined;
              const value = canonical ? formatMetricExplorerValue(resolved?.value ?? null, row.unit, resolved?.currency === "EUR" ? "€" : resolved?.currency === "GBP" ? "£" : "$") : displayRawValue(row.value);
              const rowStatus = resolved?.status ?? ("status" in row ? row.status : "missing");
              const rowPeriod = resolved?.period ?? ("period" in row ? row.period : undefined);
              const rowAsOf = resolved?.asOf ?? ("asOf" in row ? row.asOf : undefined);
              const rowProvider = resolved?.provider ?? ("provider" in row ? row.provider : undefined);
              const rowSource = resolved?.source ?? ("source" in row ? row.source : undefined);
              const explanation = resolved ? metricExplorerExplanation(resolved) : "Provider-native field retained without canonical mapping";
              return (
                <tr key={`${row.group}:${row.id}`} className="border-b border-border/30 align-top" data-testid={`metric-explorer-row-${row.id}`}>
                  <td className="px-2 py-2">
                    <div className="font-terminal text-[7px] text-muted-foreground">{row.group} · {canonical ? row.category : "RAW PROVIDER"}</div>
                    <div className="font-terminal text-[9px] text-foreground font-bold">{row.label}</div>
                    <div className="font-terminal text-[7px] text-muted-foreground/50">{row.id} · UNIT {canonical ? row.unit : row.unit ?? "provider-native / unavailable"}</div>
                  </td>
                  <td className="px-2 py-2 font-terminal text-[9px] tabular-nums text-foreground font-bold">{value}</td>
                  <td className="px-2 py-2 font-terminal text-[7px] text-muted-foreground">{displayStatus(rowStatus)}</td>
                  <td className="px-2 py-2 font-terminal text-[7px] text-muted-foreground">{rowPeriod ?? "PERIOD —"}<br />{rowAsOf ?? "AS-OF —"}</td>
                  <td className="px-2 py-2 font-terminal text-[7px] text-muted-foreground"><span>{rowProvider ?? "PROVIDER —"}</span><br /><span className="text-muted-foreground/60">{rowSource ?? "SOURCE —"}</span></td>
                  <td className="px-2 py-2 font-terminal text-[7px] text-muted-foreground max-w-[250px]">{explanation ?? "—"}{canonical && resolved?.dependencies.length ? <div className="text-muted-foreground/60 mt-0.5">DEP: {resolved.dependencies.join(", ")}</div> : null}</td>
                </tr>
              );
            })}
            {pageRows.length === 0 && <tr><td colSpan={6} className="px-3 py-3 font-terminal text-[8px] text-muted-foreground">NO METRICS MATCH FILTERS. TO VIEW HONEST MISSING STATES, DISABLE SHOW AVAILABLE ONLY.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between font-terminal text-[7px] text-muted-foreground" data-testid="metric-explorer-pagination">
        <span>PAGE {safePage + 1} / {pageCount}</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => setPage(value => Math.max(0, value - 1))} disabled={safePage === 0} aria-label="Previous metric page" className="border border-border px-2 py-1 disabled:opacity-40">PREV</button>
          <button type="button" onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))} disabled={safePage >= pageCount - 1} aria-label="Next metric page" className="border border-border px-2 py-1 disabled:opacity-40">NEXT</button>
        </div>
      </div>
    </section>
  );
}
