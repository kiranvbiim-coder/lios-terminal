import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Compass, Database } from "lucide-react";
import UniversalFinanceDataPanel from "./UniversalFinanceDataPanel";

type CoverageLevel = "full" | "partial" | "none";

interface CoverageCell {
  level: CoverageLevel;
  note: string;
}

interface RegionCoverage {
  id: string;
  label: string;
  suffixes: string[];
  quotes: CoverageCell;
  history: CoverageCell;
  statements: CoverageCell;
  corporateActions: CoverageCell;
}

interface ProviderStatus {
  id: string;
  label: string;
  category: string;
  state: "configured" | "disabled" | "not_configured" | "unreachable";
  detail: string;
  setup: string;
}

const COLUMNS: { key: keyof Pick<RegionCoverage, "quotes" | "history" | "statements" | "corporateActions">; label: string }[] = [
  { key: "quotes", label: "QUOTES" },
  { key: "history", label: "PRICE HISTORY" },
  { key: "statements", label: "FINANCIAL STATEMENTS" },
  { key: "corporateActions", label: "CORPORATE ACTIONS" },
];

function levelClass(level: CoverageLevel): string {
  switch (level) {
    case "full": return "text-up border-[hsl(142,71%,45%)]/30 bg-[hsl(142,71%,45%)]/5";
    case "partial": return "text-[hsl(38,95%,55%)] border-[hsl(38,95%,55%)]/30 bg-[hsl(38,95%,55%)]/5";
    case "none": return "text-[hsl(0,80%,65%)] border-[hsl(0,80%,60%)]/40 bg-[hsl(0,80%,50%)]/5";
  }
}

function levelLabel(level: CoverageLevel): string {
  switch (level) {
    case "full": return "FULL";
    case "partial": return "PARTIAL";
    case "none": return "NONE";
  }
}

function ProviderCoverageMap() {
  const { data, isLoading, error } = useQuery<RegionCoverage[]>({
    queryKey: ["/api/finance/coverage-map"],
    queryFn: async () => {
      const res = await fetch("/api/finance/coverage-map");
      if (!res.ok) throw new Error("Failed to fetch coverage map");
      return res.json();
    },
    staleTime: Infinity,
  });
  const { data: providers, isLoading: providersLoading } = useQuery<ProviderStatus[]>({
    queryKey: ["/api/finance/provider-status"],
    queryFn: async () => {
      const res = await fetch("/api/finance/provider-status");
      if (!res.ok) throw new Error("Failed to fetch provider status");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="h-full flex flex-col bg-[#050505] text-foreground overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Compass className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">DATA COVERAGE MAP</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">WHAT'S ACTUALLY COVERED, BY REGION</span>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading && <div className="font-terminal text-xs text-muted-foreground">Mapping provider coverage...</div>}
        {error && <div className="font-terminal text-xs text-[hsl(0,80%,65%)]">Failed to load coverage map.</div>}
        {data && (
          <>
            <div className="mb-4 border border-border">
              <div className="flex items-center justify-between border-b border-border bg-[#0d0d0d] px-3 py-2">
                <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">PROVIDER RUNTIME STATUS</span>
                <span className="font-terminal text-[8px] text-muted-foreground">CREDENTIALS ARE NEVER EXPOSED</span>
              </div>
              {providersLoading ? (
                <div className="px-3 py-3 font-terminal text-[9px] text-muted-foreground">Checking configured providers...</div>
              ) : (
                <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0 lg:grid-cols-4">
                  {(providers ?? []).map((provider) => {
                    const stateClass = provider.state === "configured" ? "text-up" : provider.state === "unreachable" ? "text-[hsl(0,80%,65%)]" : "text-[hsl(38,95%,55%)]";
                    return (
                      <div key={provider.id} className="min-w-0 px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-terminal text-[10px] font-semibold">{provider.label}</span>
                          <span className={`font-terminal text-[8px] tracking-widest ${stateClass}`}>{provider.state.replace("_", " ").toUpperCase()}</span>
                        </div>
                        <div className="mt-1 font-terminal text-[8px] leading-relaxed text-muted-foreground">{provider.detail}</div>
                        {provider.state !== "configured" && <div className="mt-1 font-terminal text-[8px] leading-relaxed text-muted-foreground/70">{provider.setup}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="overflow-x-auto border border-border">
              <table className="w-full border-collapse font-terminal text-xs">
                <thead>
                  <tr className="bg-[#0d0d0d] border-b border-border">
                    <th className="text-left px-3 py-2 text-[9px] text-muted-foreground tracking-widest">REGION</th>
                    {COLUMNS.map((col) => <th key={col.key} className="text-left px-3 py-2 text-[9px] text-muted-foreground tracking-widest">{col.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.map((region) => (
                    <tr key={region.id} className="border-b border-border/50 hover:bg-white/5 transition-colors align-top">
                      <td className="px-3 py-2.5"><div className="text-[11px] font-semibold text-foreground">{region.label}</div><div className="text-[8px] text-muted-foreground/70 mt-0.5">{region.suffixes.join(", ")}</div></td>
                      {COLUMNS.map((col) => {
                        const cell = region[col.key];
                        return <td key={col.key} className="px-3 py-2.5 max-w-[220px]"><span className={`inline-block font-terminal text-[8px] tracking-widest border px-1.5 py-0.5 ${levelClass(cell.level)}`}>{levelLabel(cell.level)}</span><div className="text-[9px] text-muted-foreground/80 mt-1 leading-snug">{cell.note}</div></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 font-terminal text-[8px] text-muted-foreground/70 leading-relaxed max-w-2xl">This table is hand-audited against what's actually wired up, not a marketing claim about vendor breadth. "PARTIAL" means coverage exists but is incomplete or provider-dependent; "NONE" means no provider is registered for that region/category yet. See per-record data status and V6 metric lineage for the provenance of individual numbers.</div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CoverageMapPanel() {
  const [mode, setMode] = useTerminalArtifactState<"providers" | "finance">("CoverageMapPanel.mode", "finance");
  return (
    <div className="h-full flex flex-col bg-[#050505]">
      <div className="shrink-0 flex items-center border-b border-border bg-[#040404] px-2 py-1 gap-1">
        <button onClick={() => setMode("finance")} className={`flex items-center gap-1.5 px-2.5 py-1.5 font-terminal text-[8px] border ${mode === "finance" ? "border-[hsl(38,95%,50%)]/35 text-[hsl(38,95%,58%)] bg-[hsl(38,95%,50%)]/[0.06]" : "border-transparent text-muted-foreground"}`}><Database className="w-3 h-3" /> UNIVERSAL FINANCE OS</button>
        <button onClick={() => setMode("providers")} className={`flex items-center gap-1.5 px-2.5 py-1.5 font-terminal text-[8px] border ${mode === "providers" ? "border-[hsl(38,95%,50%)]/35 text-[hsl(38,95%,58%)] bg-[hsl(38,95%,50%)]/[0.06]" : "border-transparent text-muted-foreground"}`}><Compass className="w-3 h-3" /> PROVIDER COVERAGE</button>
        <span className="ml-auto pr-2 font-terminal text-[7px] tracking-[0.16em] text-muted-foreground">V6 · KNOW / DERIVE / ENTER / TRACE</span>
      </div>
      <div className="flex-1 min-h-0">{mode === "finance" ? <UniversalFinanceDataPanel /> : <ProviderCoverageMap />}</div>
    </div>
  );
}
