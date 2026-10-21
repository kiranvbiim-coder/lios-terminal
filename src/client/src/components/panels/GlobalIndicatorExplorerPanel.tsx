import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState } from "react";
import { Download, Telescope } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useLseStatus, useLseEconomicsSearch, useLseEconomicsSeries, useLseEconomicsCountries, type LseSeriesPoint } from "@/lib/useLse";
import { catalogRows, datasetSearchPath, datasetSeriesPath, observationsCsv, seriesRows, type DatasetKind } from "@/lib/lseDatasetBrowser";

function fmtValue(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : v.toFixed(2);
}
function fmtChange(oneYear: number | undefined, fallback: number | undefined) {
  const value = oneYear ?? fallback;
  return value === undefined ? "—" : `${value.toFixed(2)}%`;
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function provenanceCard(data: { provider?: string; source?: string; asOf?: string; retrievedAt?: string; freshness?: string; cache?: string; fallback?: boolean; status?: string }) {
  return (
    <div className="border border-border bg-[#080808] p-3 font-terminal text-[8px] text-muted-foreground" data-testid="dataset-provenance-card">
      <div className="text-foreground tracking-widest mb-2">PROVENANCE / STATUS</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span>PROVIDER <b className="text-foreground">{data.provider ?? "LSE"}</b></span>
        <span>SOURCE <b className="text-foreground">{data.source ?? "LSE catalog/series"}</b></span>
        <span>AS-OF <b className="text-foreground">{data.asOf ?? "—"}</b></span>
        <span>RETRIEVED <b className="text-foreground">{data.retrievedAt ?? "—"}</b></span>
        <span>FRESHNESS <b className="text-foreground">{data.freshness ?? "live or connector cache"}</b></span>
        <span>MODE <b className="text-foreground">{data.cache ?? (data.fallback ? "fallback" : "live")}</b></span>
      </div>
      {data.status && <div className="mt-2 text-amber-400">STATUS: {data.status}</div>}
    </div>
  );
}

export default function GlobalIndicatorExplorerPanel() {
  const { data: status } = useLseStatus();
  const configured = status?.configured ?? false;
  const [mode, setMode] = useTerminalArtifactState<"explorer" | "browser">("GlobalIndicatorExplorerPanel.mode", "explorer");
  const [query, setQuery] = useTerminalArtifactState("GlobalIndicatorExplorerPanel.query", "");
  const [country, setCountry] = useTerminalArtifactState("GlobalIndicatorExplorerPanel.country", "");
  const [category, setCategory] = useTerminalArtifactState("GlobalIndicatorExplorerPanel.category", "");
  const [dataset, setDataset] = useState<DatasetKind>("economics");
  const [selected, setSelected] = useState<string | null>(null);
  const [browserPage, setBrowserPage] = useTerminalArtifactState("GlobalIndicatorExplorerPanel.browserPage", 1);
  const [browserLimit, setBrowserLimit] = useTerminalArtifactState("GlobalIndicatorExplorerPanel.browserLimit", 50);
  const [start, setStart] = useTerminalArtifactState("GlobalIndicatorExplorerPanel.start", "");
  const [end, setEnd] = useTerminalArtifactState("GlobalIndicatorExplorerPanel.end", "");
  const [seriesLimit, setSeriesLimit] = useTerminalArtifactState("GlobalIndicatorExplorerPanel.seriesLimit", 100);

  const { data: economicsCountries } = useLseEconomicsCountries();
  const datasetCountries = useQuery<{ code: string; name: string }[]>({
    queryKey: ["/api/lse/dataset-browser/countries", dataset],
    enabled: configured && mode === "browser",
    queryFn: async () => {
      const response = await fetch(`/api/lse/${dataset}/countries`);
      if (!response.ok) throw new Error("Failed to load dataset countries");
      return response.json();
    },
    staleTime: 30 * 60 * 1000,
  });
  const countries = mode === "browser" ? datasetCountries.data : economicsCountries;
  const { data: results, isLoading: searchLoading } = useLseEconomicsSearch(query, country || undefined);
  const activeSymbol = selected ?? results?.[0]?.symbol ?? "";
  const { data: series, isLoading: seriesLoading } = useLseEconomicsSeries(activeSymbol);
  const activeRow = results?.find((r) => r.symbol === activeSymbol);

  const browserSearch = useQuery<unknown>({
    queryKey: ["/api/lse/dataset-browser/search", dataset, query, country, category, browserPage, browserLimit],
    enabled: configured && mode === "browser",
    queryFn: async () => {
      const response = await fetch(datasetSearchPath(dataset, { query, country, category, page: browserPage, limit: browserLimit }));
      if (!response.ok) throw new Error("Failed to search the LSE dataset catalog");
      return response.json();
    },
    staleTime: 10 * 60 * 1000,
  });
  const browserCatalog = catalogRows(browserSearch.data, browserLimit);
  const browserActiveSymbol = selected ?? browserCatalog.rows[0]?.symbol ?? "";
  const browserActiveRow = browserCatalog.rows.find((row) => row.symbol === browserActiveSymbol);
  const browserSeries = useQuery<unknown>({
    queryKey: ["/api/lse/dataset-browser/series", dataset, browserActiveSymbol, start, end, seriesLimit],
    enabled: configured && mode === "browser" && !!browserActiveSymbol,
    queryFn: async () => {
      const response = await fetch(datasetSeriesPath(dataset, browserActiveSymbol, { start: start || undefined, end: end || undefined, limit: seriesLimit }));
      if (!response.ok) throw new Error("Failed to load the LSE dataset series");
      return response.json();
    },
    staleTime: 60 * 1000,
  });
  const browserSeriesPage = seriesRows(browserSeries.data, seriesLimit);

  const resetCatalog = () => {
    setBrowserPage(1);
    setSelected(null);
  };
  const exportLoadedSeries = () => {
    downloadText(`${browserActiveSymbol || "lse-dataset"}_observations_page.csv`, observationsCsv(browserSeriesPage.rows), "text/csv;charset=utf-8");
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <Telescope className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">GLOBAL INDICATOR EXPLORER — 14,640 SERIES, 194 COUNTRIES</span>
        <div className="ml-auto flex gap-1" role="tablist" aria-label="Indicator explorer views">
          <button data-testid="indicator-explorer-tab" role="tab" aria-selected={mode === "explorer"} onClick={() => { setMode("explorer"); setSelected(null); }} className={`px-2 py-1 font-terminal text-[8px] tracking-widest border ${mode === "explorer" ? "border-[hsl(38,95%,55%)] text-foreground" : "border-border text-muted-foreground"}`}>EXPLORER</button>
          <button data-testid="dataset-browser-tab" role="tab" aria-selected={mode === "browser"} onClick={() => { setMode("browser"); setSelected(null); }} className={`px-2 py-1 font-terminal text-[8px] tracking-widest border ${mode === "browser" ? "border-[hsl(38,95%,55%)] text-foreground" : "border-border text-muted-foreground"}`}>DATASET BROWSER</button>
        </div>
        <span className="font-terminal text-[8px] text-muted-foreground tracking-widest">GIND</span>
      </div>

      {!configured ? (
        <div className="flex-1 flex items-center justify-center p-6"><div className="max-w-md text-center font-terminal text-[10px] text-muted-foreground border border-border px-4 py-3">NO LSE_API_KEY CONFIGURED — GET A FREE KEY AT LONDONSTRATEGICEDGE.COM/DATA. VALUES BELOW WILL POPULATE ONCE ONE IS SET. HONEST STATE, NOT A BUG.</div></div>
      ) : mode === "explorer" ? (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-hidden">
            <div className="p-2 border-b border-border space-y-1.5 shrink-0">
              <input aria-label="Search indicator series" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SEARCH SERIES (E.G. CPI, GDP, UNEMPLOYMENT)..." className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
              <select aria-label="Filter indicator country" value={country} onChange={(e) => setCountry(e.target.value)} className="w-full bg-[#0a0a0a] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none"><option value="">ALL COUNTRIES</option>{(countries ?? []).map((c) => <option key={c.code} value={c.code}>{c.name.toUpperCase()}</option>)}</select>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">{searchLoading ? <div className="p-3 font-terminal text-[9px] text-muted-foreground">SEARCHING...</div> : !results?.length ? <div className="p-3 font-terminal text-[9px] text-muted-foreground">TYPE TO SEARCH THE CATALOG, OR PICK A COUNTRY TO BROWSE ITS SERIES.</div> : results.map((r) => <button key={r.symbol} onClick={() => setSelected(r.symbol)} className={`w-full text-left px-3 py-2 border-b border-border/50 transition-colors ${r.symbol === activeSymbol ? "bg-[hsl(38,95%,50%)]/10 border-l-2 border-l-[hsl(38,95%,55%)]" : "hover:bg-white/5"}`}><div className="font-terminal text-[9px] text-foreground truncate">{(r.name ?? r.symbol).toUpperCase()}</div><div className="font-terminal text-[8px] text-muted-foreground">{r.symbol} {r.country_name ? `· ${r.country_name}` : ""}</div></button>)}</div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin p-5">{seriesLoading || !activeSymbol ? <div className="font-terminal text-[9px] text-muted-foreground">SELECT A SERIES TO VIEW ITS HISTORY.</div> : <><div className="flex items-center gap-2 mb-1"><span className="font-terminal text-[10px] tracking-widest text-foreground">{(activeRow?.name ?? activeSymbol).toUpperCase()}</span></div><div className="font-terminal text-[9px] text-muted-foreground mb-4">{activeSymbol} {activeRow?.country_name ? `· ${activeRow.country_name}` : ""} {activeRow?.frequency ? `· ${activeRow.frequency}` : ""}</div>{activeRow?.last_value !== undefined && <div className="flex items-baseline gap-4 mb-5"><span className="font-terminal text-3xl text-foreground">{fmtValue(activeRow.last_value)}</span>{activeRow.unit && <span className="font-terminal text-sm text-muted-foreground">{activeRow.unit}</span>}{activeRow.change_pct !== undefined && <span className={`font-terminal text-sm ${activeRow.change_pct >= 0 ? "text-[hsl(142,71%,45%)]" : "text-[hsl(0,80%,55%)]"}`}>{activeRow.change_pct >= 0 ? "+" : ""}{activeRow.change_pct.toFixed(2)}%</span>}</div>}<div className="h-64 border border-border bg-[#0a0a0a] p-3 mb-4">{!series?.length || series.length < 2 ? <div className="h-full flex items-center justify-center font-terminal text-[9px] text-muted-foreground">NO HISTORICAL DATA AVAILABLE</div> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}><defs><linearGradient id="globalIndicatorFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} /><stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} /></linearGradient></defs><XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} /><YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={false} tickLine={false} width={50} domain={["auto", "auto"]} /><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid hsl(0,0%,15%)", fontSize: 11 }} formatter={(v: number) => [fmtValue(v), activeRow?.name ?? activeSymbol]} /><Area type="monotone" dataKey="value" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#globalIndicatorFill)" dot={false} /></AreaChart></ResponsiveContainer>}</div></>}</div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-80 shrink-0 border-r border-border flex flex-col overflow-hidden">
            <div className="p-2 border-b border-border space-y-1.5 shrink-0">
              <div className="flex gap-1" role="group" aria-label="Dataset type"><button data-testid="dataset-economics" onClick={() => { setDataset("economics"); resetCatalog(); }} className={`flex-1 py-1 border font-terminal text-[8px] ${dataset === "economics" ? "border-amber-400 text-foreground" : "border-border text-muted-foreground"}`}>ECONOMICS</button><button data-testid="dataset-bonds" onClick={() => { setDataset("bonds"); resetCatalog(); }} className={`flex-1 py-1 border font-terminal text-[8px] ${dataset === "bonds" ? "border-amber-400 text-foreground" : "border-border text-muted-foreground"}`}>BONDS</button></div>
              <input data-testid="dataset-search" aria-label="Search LSE datasets" value={query} onChange={(e) => { setQuery(e.target.value); resetCatalog(); }} placeholder="SEARCH DATASET / SYMBOL / NAME" className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none" />
              <select data-testid="dataset-country-filter" aria-label="Filter dataset country" value={country} onChange={(e) => { setCountry(e.target.value); resetCatalog(); }} className="w-full bg-[#0a0a0a] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground"><option value="">ALL COUNTRIES</option>{(countries ?? []).map((c) => <option key={c.code} value={c.code}>{c.name.toUpperCase()}</option>)}</select>
              <input data-testid="dataset-category-filter" aria-label="Filter dataset category" value={category} onChange={(e) => { setCategory(e.target.value); resetCatalog(); }} placeholder="CATEGORY (OPTIONAL)" className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground" />
              <label className="flex items-center gap-2 font-terminal text-[8px] text-muted-foreground">PAGE SIZE<select data-testid="dataset-page-size" aria-label="Dataset page size" value={browserLimit} onChange={(e) => { setBrowserLimit(Number(e.target.value)); setBrowserPage(1); }} className="bg-[#0a0a0a] border border-border px-1 py-1 text-foreground"><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
            </div>
            <div className="px-3 py-2 border-b border-border font-terminal text-[8px] text-muted-foreground">{browserSearch.isLoading ? "SEARCHING..." : `${browserCatalog.rows.length} DATASETS ON PAGE${browserCatalog.total !== undefined ? ` · ${browserCatalog.total} TOTAL` : ""}`}</div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">{browserSearch.isError ? <div className="p-3 font-terminal text-[9px] text-red-400">{browserSearch.error instanceof Error ? browserSearch.error.message : "DATASET SEARCH UNAVAILABLE"}</div> : !browserCatalog.rows.length ? <div className="p-3 font-terminal text-[9px] text-muted-foreground">NO DATASETS MATCH THESE FILTERS.</div> : browserCatalog.rows.map((row) => <button data-testid={`dataset-row-${row.symbol}`} key={`${row.dataset}:${row.symbol}`} onClick={() => setSelected(row.symbol)} className={`w-full text-left px-3 py-2 border-b border-border/50 ${row.symbol === browserActiveSymbol ? "bg-amber-400/10 border-l-2 border-l-amber-400" : "hover:bg-white/5"}`}><div className="font-terminal text-[9px] text-foreground truncate">{(row.name ?? row.symbol).toUpperCase()}</div><div className="font-terminal text-[8px] text-muted-foreground">{row.dataset} · {row.symbol} · {row.frequency ?? "frequency unavailable"} · {row.country_name ?? row.country ?? "country unavailable"}</div><div className="font-terminal text-[8px] text-muted-foreground">{row.first_tick ?? "—"} → {row.last_tick ?? "—"} · {row.ticks?.toLocaleString() ?? "—"} ticks · {fmtValue(row.last_value)} · 1Y {fmtChange(row.change_1y, row.change_pct)}</div></button>)}</div>
            <div className="p-2 border-t border-border flex items-center justify-between"><button data-testid="dataset-previous-page" aria-label="Previous dataset page" disabled={browserPage <= 1} onClick={() => { setBrowserPage((p) => p - 1); setSelected(null); }} className="px-2 py-1 border border-border font-terminal text-[8px] disabled:opacity-30">PREV</button><span className="font-terminal text-[8px] text-muted-foreground">PAGE {browserPage}</span><button data-testid="dataset-next-page" aria-label="Next dataset page" disabled={!browserCatalog.hasMore} onClick={() => { setBrowserPage((p) => p + 1); setSelected(null); }} className="px-2 py-1 border border-border font-terminal text-[8px] disabled:opacity-30">LOAD MORE</button></div>
          </aside>
          <main className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
            {!browserActiveSymbol ? <div className="font-terminal text-[9px] text-muted-foreground">SELECT A DATASET TO INSPECT ITS OBSERVATIONS AND SCHEMA.</div> : <>
              <div className="flex items-start justify-between gap-3"><div><div className="font-terminal text-[12px] tracking-widest text-foreground">{(browserActiveRow?.name ?? browserActiveSymbol).toUpperCase()}</div><div className="font-terminal text-[9px] text-muted-foreground mt-1">{browserActiveSymbol} · {browserActiveRow?.frequency ?? "frequency unavailable"} · {browserActiveRow?.country_name ?? browserActiveRow?.country ?? "country unavailable"}</div></div><button data-testid="dataset-export-page" aria-label="Export loaded dataset page as CSV" onClick={exportLoadedSeries} disabled={!browserSeriesPage.rows.length} className="flex items-center gap-1 px-2 py-1 border border-border font-terminal text-[8px] text-muted-foreground disabled:opacity-40"><Download className="w-3 h-3" /> EXPORT PAGE CSV</button></div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-terminal text-[8px]"><div className="border border-border p-2">FIRST TICK <b className="block text-foreground mt-1">{browserActiveRow?.first_tick ?? "—"}</b></div><div className="border border-border p-2">LAST TICK <b className="block text-foreground mt-1">{browserActiveRow?.last_tick ?? "—"}</b></div><div className="border border-border p-2">TICK COUNT <b className="block text-foreground mt-1">{browserActiveRow?.ticks?.toLocaleString() ?? "—"}</b></div><div className="border border-border p-2">LAST VALUE / 1Y <b className="block text-foreground mt-1">{fmtValue(browserActiveRow?.last_value)} / {browserActiveRow?.change_1y !== undefined ? `${browserActiveRow.change_1y.toFixed(2)}%` : "—"}</b></div></div>
              <div className="border border-border bg-[#080808] p-3"><div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-2">OBSERVATION RANGE / SAFE PAGE</div><div className="flex flex-wrap gap-2 items-end"><label className="font-terminal text-[8px] text-muted-foreground">START<input data-testid="dataset-start-date" aria-label="Dataset start date" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="block mt-1 bg-[#0a0a0a] border border-border px-2 py-1 text-foreground" /></label><label className="font-terminal text-[8px] text-muted-foreground">END<input data-testid="dataset-end-date" aria-label="Dataset end date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="block mt-1 bg-[#0a0a0a] border border-border px-2 py-1 text-foreground" /></label><label className="font-terminal text-[8px] text-muted-foreground">LIMIT<input data-testid="dataset-series-limit" aria-label="Observation limit" type="number" min={1} max={500} value={seriesLimit} onChange={(e) => setSeriesLimit(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} className="block mt-1 w-20 bg-[#0a0a0a] border border-border px-2 py-1 text-foreground" /></label></div></div>
              {provenanceCard({ ...browserCatalog, ...browserSeriesPage, source: `${dataset} catalog and series` })}
              <div className="border border-border overflow-auto"><div className="px-3 py-2 border-b border-border font-terminal text-[8px] text-muted-foreground">RAW OBSERVATIONS · {browserSeries.isLoading ? "LOADING" : `${browserSeriesPage.rows.length} LOADED`} {browserSeriesPage.hasMore ? "· MORE AVAILABLE" : ""} · PAGE DATA ONLY</div><table className="w-full font-terminal text-[9px]"><thead><tr className="text-muted-foreground text-[8px] border-b border-border"><th className="text-left px-3 py-1.5">DATE</th><th className="text-right px-3 py-1.5">VALUE {browserActiveRow?.unit ? `(${browserActiveRow.unit})` : ""}</th><th className="text-left px-3 py-1.5">SYMBOL</th></tr></thead><tbody>{browserSeriesPage.rows.map((point: LseSeriesPoint) => <tr key={`${point.symbol}-${point.date}`} className="border-b border-border/50"><td className="px-3 py-1 text-muted-foreground">{point.date}</td><td className="px-3 py-1 text-right text-foreground">{fmtValue(point.value)}</td><td className="px-3 py-1 text-muted-foreground">{point.symbol}</td></tr>)}</tbody></table></div>
              <div className="border border-border bg-[#080808] p-3 font-terminal text-[8px] text-muted-foreground"><div className="text-foreground tracking-widest mb-2">SCHEMA</div><span>date: ISO date/string · value: numeric · symbol: provider series identifier · units: {browserActiveRow?.unit ?? "not supplied by provider"}</span></div>
            </>}
          </main>
        </div>
      )}
    </div>
  );
}
