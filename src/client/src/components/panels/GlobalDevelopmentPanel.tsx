import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { Globe2 } from "lucide-react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { useWbCatalog, useWbProviderCatalog, useWbCompare, useWbIndicator, type WbDomain } from "@/lib/useOfficialSources";

const DOMAINS: { value: WbDomain; label: string }[] = [
  { value: "economics_policy", label: "ECONOMICS & FISCAL" },
  { value: "supply_chain", label: "SUPPLY CHAIN & TRADE" },
  { value: "environment_sustainability", label: "ENVIRONMENT" },
  { value: "tourism_hospitality", label: "TOURISM" },
];

function fmtValue(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "$" && Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (unit === "$" && Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e6) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function GlobalDevelopmentPanel() {
  const [domain, setDomain] = useTerminalArtifactState<WbDomain>("GlobalDevelopmentPanel.domain", "economics_policy");
  const { data: catalog } = useWbCatalog(domain);
  const [catalogMode, setCatalogMode] = useTerminalArtifactState<"curated" | "provider">("GlobalDevelopmentPanel.catalogMode", "curated");
  const [catalogPage, setCatalogPage] = useTerminalArtifactState("GlobalDevelopmentPanel.catalogPage", 1);
  const [catalogSearch, setCatalogSearch] = useTerminalArtifactState("GlobalDevelopmentPanel.catalogSearch", "");
  const providerCatalog = useWbProviderCatalog(catalogPage, 50, catalogSearch, catalogMode === "provider");
  const [code, setCode] = useTerminalArtifactState<string>("GlobalDevelopmentPanel.code", "");
  const [focusCountry, setFocusCountry] = useTerminalArtifactState("GlobalDevelopmentPanel.focusCountry", "US");

  const activeCode = code || (catalogMode === "provider" ? providerCatalog.data?.items[0]?.code : catalog?.[0]?.code) || "";
  const activeIndicator = catalogMode === "provider"
    ? providerCatalog.data?.items.find((i) => i.code === activeCode)
    : catalog?.find((i) => i.code === activeCode);
  const { data: compareData, isLoading: compareLoading } = useWbCompare(activeCode, []);
  const { data: focusData, isLoading: focusLoading } = useWbIndicator(activeCode, focusCountry);

  const chartData = useMemo(
    () => (compareData ?? []).filter((r) => r.value !== null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [compareData],
  );

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <Globe2 className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">GLOBAL DEVELOPMENT COMPARATOR — WORLD BANK</span>
        <span className="font-terminal text-[7px] text-[hsl(142,71%,50%)] tracking-widest border border-[hsl(142,71%,30%)]/40 px-1.5 py-0.5">OFFICIAL · NO KEY</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">WBDV</span>
      </div>

      <div className="flex border-b border-border bg-[#060606] shrink-0 overflow-x-auto scrollbar-thin">
        {DOMAINS.map((d) => (
          <button
            key={d.value}
            onClick={() => { setDomain(d.value); setCode(""); }}
            className={`px-3 py-2 font-terminal text-[8px] tracking-wider whitespace-nowrap border-r border-border/50 ${
              domain === d.value ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#060606] shrink-0 flex-wrap">
        <select value={catalogMode} onChange={(event) => { setCatalogMode(event.target.value as "curated" | "provider"); setCode(""); setCatalogPage(1); }} className="bg-[#0a0a0a] border border-border px-2 py-1.5 font-terminal text-[8px] text-foreground">
          <option value="curated">CURATED DOMAIN</option>
          <option value="provider">ALL PROVIDER INDICATORS</option>
        </select>
        {catalogMode === "provider" && (
          <>
            <button type="button" onClick={() => { setCatalogPage((page) => Math.max(1, page - 1)); setCode(""); }} disabled={catalogPage <= 1} className="border border-border px-2 py-1.5 font-terminal text-[8px] disabled:opacity-30">‹</button>
            <input value={catalogSearch} onChange={(event) => { setCatalogSearch(event.target.value); setCatalogPage(1); setCode(""); }} placeholder="FILTER CURRENT PROVIDER PAGE" className="bg-[#0a0a0a] border border-border px-2 py-1.5 font-terminal text-[8px] text-foreground w-44" />
            <button type="button" onClick={() => { setCatalogPage((page) => page + 1); setCode(""); }} disabled={!providerCatalog.data?.hasMore} className="border border-border px-2 py-1.5 font-terminal text-[8px] disabled:opacity-30">›</button>
            <span className="font-terminal text-[8px] text-muted-foreground">PAGE {catalogPage}{providerCatalog.data?.total ? ` / ${Math.ceil(providerCatalog.data.total / 50)}` : ""}</span>
          </>
        )}
        <select value={activeCode} onChange={(event) => setCode(event.target.value)} className="bg-[#0a0a0a] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none min-w-[280px]">
          {(catalogMode === "provider" ? providerCatalog.data?.items ?? [] : catalog ?? []).map((i) => (
            <option key={i.code} value={i.code}>{i.name.toUpperCase()} ({i.unit})</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 font-terminal text-[8px] text-muted-foreground">COUNTRY <input value={focusCountry} onChange={(event) => setFocusCountry(event.target.value.toUpperCase().slice(0, 3))} maxLength={3} className="w-10 bg-[#0a0a0a] border border-border px-1.5 py-1.5 font-terminal text-[8px] text-foreground uppercase" /></label>
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">{activeIndicator?.category ?? "PROVIDER CATALOG"}</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">CROSS-COUNTRY COMPARISON — LATEST AVAILABLE YEAR PER COUNTRY</div>
          <div className="border border-border bg-[#0a0a0a] p-3">
            {compareLoading ? (
              <div className="py-8 text-center font-terminal text-[9px] text-muted-foreground">LOADING...</div>
            ) : !chartData.length ? (
              <div className="py-8 text-center font-terminal text-[9px] text-muted-foreground">NO DATA AVAILABLE FOR THIS INDICATOR.</div>
            ) : (
              <div className="space-y-1.5">
                {(() => {
                  const maxVal = Math.max(...chartData.map((c) => c.value ?? 0), 1);
                  return chartData.map((c) => (
                    <button
                      key={c.countryCode}
                      onClick={() => setFocusCountry(c.countryCode)}
                      className="w-full flex items-center gap-2 group"
                    >
                      <span className={`w-8 shrink-0 text-left font-terminal text-[9px] font-bold tracking-wider ${c.countryCode === focusCountry ? "text-[hsl(38,95%,55%)]" : "text-muted-foreground group-hover:text-foreground"}`}>
                        {c.countryCode}
                      </span>
                      <span className="flex-1 h-4 bg-[#111] relative overflow-hidden">
                        <span
                          className={`absolute inset-y-0 left-0 transition-all ${c.countryCode === focusCountry ? "bg-[hsl(38,95%,55%)]" : "bg-[hsl(38,60%,35%)] group-hover:bg-[hsl(38,70%,42%)]"}`}
                          style={{ width: `${Math.max(2, ((c.value ?? 0) / maxVal) * 100)}%` }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-right font-terminal text-[9px] tabular-nums text-foreground">{fmtValue(c.value, activeIndicator?.unit ?? "")}</span>
                      <span className="w-10 shrink-0 text-right font-terminal text-[7px] text-muted-foreground/60">{c.year}</span>
                    </button>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>

        <div className="w-80 shrink-0 border-l border-border p-4 overflow-y-auto scrollbar-thin">
          {focusLoading ? (
            <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
          ) : !focusData || focusData.status === "unavailable" ? (
            <div className="font-terminal text-[9px] text-muted-foreground">NO DATA AVAILABLE FOR THIS COUNTRY/INDICATOR PAIR.</div>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-terminal text-2xl text-foreground">{fmtValue(focusData.latestValue, focusData.unit)}</span>
                <span className="font-terminal text-[8px] text-muted-foreground">{focusData.status?.toUpperCase() ?? (focusData.isLive ? "LIVE" : "CACHED")}</span>
              </div>
              <div className="font-terminal text-[8px] text-muted-foreground mb-4">AS OF {focusData.latestYear} — WORLD BANK REPORTING LAG, NOT LIVE-TICK DATA</div>
              <div className="h-40 border border-border bg-[#0a0a0a] p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={focusData.history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="wbFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="year" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={20} />
                    <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} tickFormatter={(v) => fmtValue(v, focusData.unit)} />
                    <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [fmtValue(v, focusData.unit), focusData.name]} />
                    <Area type="monotone" dataKey="value" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#wbFill)" dot={{ r: 2, fill: "hsl(38,95%,55%)" }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="px-4 py-1.5 border-t border-border bg-[#060606] shrink-0">
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">World Bank Open Data — official, free, no key required. Curated domain indicators remain available; ALL PROVIDER INDICATORS uses bounded server pagination and search. Annual series; reporting gaps are shown honestly rather than interpolated.</span>
      </div>
    </div>
  );
}
