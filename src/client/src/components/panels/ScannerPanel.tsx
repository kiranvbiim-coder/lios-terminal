import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { useQuotes, useMarketGainers, useMostActive } from "@/lib/useFinance";
import { Scan, Check, X, Minus } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import type { Quote } from "@/lib/finance";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";
import { evaluateScanQuote, rankNearMisses, type ScanType } from "@/lib/scannerDiagnostics";

interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void; }

const SCAN_UNIVERSE = [
  "AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","JPM","V","MA","BRK-B","UNH","PG","JNJ","XOM","HD","CVX","MRK","LLY","ABBV",
  "COST","PEP","KO","BAC","WMT","DIS","NFLX","ADBE","CRM","AMD","INTC","QCOM","TXN","AVGO","AMAT","MU","LRCX","KLAC","SNPS","CDNS",
];

const SCANS: { id: ScanType; label: string; icon: string; bullish: boolean; desc: string }[] = [
  { id: "breakout_52w", label: "52-WEEK HIGH BREAKOUT", icon: "↗", bullish: true, desc: "Observed price within 2% of observed 52W high" },
  { id: "momentum", label: "STRONG MOMENTUM", icon: "⚡", bullish: true, desc: "Observed daily price move greater than +3%" },
  { id: "golden_cross", label: "RANGE TREND CONTINUATION", icon: "⌁", bullish: true, desc: "Positive move with price in upper 40% of observed 52W range" },
  { id: "high_volume", label: "HIGH VOLUME SURGE", icon: "▥", bullish: false, desc: "Observed volume greater than 2.0× observed average volume" },
  { id: "rsi_oversold", label: "LOWER-RANGE PULLBACK", icon: "↓", bullish: true, desc: "Daily decline >3% with price in lower 30% of observed 52W range" },
  { id: "rsi_overbought", label: "EXTENDED NEAR HIGH", icon: "!", bullish: false, desc: "Daily gain >5% while price is within 5% of observed 52W high" },
];

function validQuote(quote: Quote | null | undefined): quote is Quote {
  return Boolean(quote && Number.isFinite(quote.price) && quote.price > 0);
}

function PatternBadge({ matched, bullish }: { matched: boolean; bullish: boolean }) {
  const tone = matched ? bullish ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.05]" : "border-rose-500/30 text-rose-300 bg-rose-500/[0.05]" : "border-border text-muted-foreground";
  return <span className={`font-terminal text-[7.5px] px-1.5 py-0.5 border ${tone}`}>{matched ? "MATCH" : "NEAR MISS"}</span>;
}

function ConditionState({ pass }: { pass: boolean | null }) {
  if (pass === true) return <Check className="h-3 w-3 text-emerald-300" />;
  if (pass === false) return <X className="h-3 w-3 text-rose-300" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

export default function ScannerPanel({ onSymbol }: Props) {
  const [activeScan, setActiveScan] = useTerminalArtifactState<ScanType>("ScannerPanel.activeScan", "breakout_52w");
  const { data: quotes = [], dataUpdatedAt } = useQuotes(SCAN_UNIVERSE);
  const { data: gainers = [] } = useMarketGainers("US");
  const { data: active = [] } = useMostActive("US");

  const allQuotes = useMemo(() => {
    const seen = new Set<string>();
    return [...quotes, ...gainers, ...active].filter((quote): quote is Quote => {
      if (!validQuote(quote) || seen.has(quote.symbol)) return false;
      seen.add(quote.symbol);
      return true;
    });
  }, [quotes, gainers, active]);

  const evaluations = useMemo(() => allQuotes.map((quote) => evaluateScanQuote(quote, activeScan)), [allQuotes, activeScan]);
  const results = useMemo(() => evaluations.filter((item) => item.match), [evaluations]);
  const nearMisses = useMemo(() => rankNearMisses(evaluations).slice(0, 8), [evaluations]);
  const scan = SCANS.find((item) => item.id === activeScan)!;
  const expectedUniverse = new Set([...SCAN_UNIVERSE, ...gainers.map((quote) => quote.symbol), ...active.map((quote) => quote.symbol)]).size;
  const unavailableCount = Math.max(0, expectedUniverse - allQuotes.length);
  const passCounts = (evaluations[0]?.conditions ?? []).map((condition, index) => ({
    id: condition.id,
    label: condition.label,
    passed: evaluations.filter((item) => item.conditions[index]?.pass === true).length,
    available: evaluations.filter((item) => item.conditions[index]?.pass !== null).length,
  }));

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0" data-workstation-toolbar>
        <Scan className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">TECHNICAL PATTERN SCANNER</span>
        <span className="ml-2 font-terminal text-[8px] text-muted-foreground border border-border px-1">{SCAN_UNIVERSE.length}+ STOCKS</span>
        <ProvenanceBadge compact details={{ kind: "computed", source: "Quote universe + market movers/active lists", method: "Deterministic observed-field rule scanner", inputs: ["price", "change %", "52-week high/low", "volume", "average volume"], timestamp: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined, logic: scan.desc, limitations: ["No RSI, moving average or golden-cross value is synthesized", "Near-miss ranking uses condition passes and normalized threshold distance", "Missing inputs remain unavailable rather than imputed"] }} />
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">SCAN</span>
      </div>

      <div className="shrink-0 grid grid-cols-3 border-b border-border bg-[#060606]">
        {SCANS.map((item) => <button key={item.id} onClick={() => setActiveScan(item.id)} className={`p-2.5 border-r border-b border-border text-left transition-all ${activeScan === item.id ? item.bullish ? "bg-emerald-500/[0.05] border-emerald-500/20" : "bg-rose-500/[0.05] border-rose-500/20" : "hover:bg-white/[0.02]"}`}><div className="flex items-center gap-1.5 mb-0.5"><span className="font-terminal text-[10px]">{item.icon}</span><span className={`font-terminal text-[8.5px] font-bold ${activeScan === item.id ? item.bullish ? "text-emerald-300" : "text-rose-300" : "text-muted-foreground"}`}>{item.label}</span></div><div className="font-terminal text-[7.5px] text-muted-foreground leading-tight">{item.desc}</div></button>)}
      </div>

      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-[#060606]">
        <span className={`font-terminal text-[10px] font-bold ${scan.bullish ? "text-emerald-300" : "text-rose-300"}`}>{results.length}</span>
        <span className="font-terminal text-[9px] text-muted-foreground">exact matches · {scan.label}</span>
        <div className="ml-auto flex items-center gap-4 font-terminal text-[8px] text-muted-foreground"><span>UNIVERSE {expectedUniverse}</span><span>VALID {allQuotes.length}</span><span>UNAVAILABLE {unavailableCount}</span><span>{dataUpdatedAt ? `EVALUATED ${new Date(dataUpdatedAt).toLocaleTimeString()}` : "EVALUATING"}</span></div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3" data-analytical-role="evidence">
        {results.length ? <section><div className="mb-2 font-terminal text-[8px] tracking-widest text-muted-foreground">EXACT MATCHES</div><div className="grid grid-cols-1 gap-2 xl:grid-cols-2">{results.map((evaluation) => <button key={evaluation.quote.symbol} onClick={() => onSymbol(evaluation.quote.symbol)} className="border border-border bg-[#080808] p-3 text-left hover:border-amber-500/30 hover:bg-white/[0.02]"><div className="flex items-start justify-between gap-3"><div><div className="font-terminal text-[11px] font-bold text-foreground">{evaluation.quote.symbol}</div><div className="font-terminal text-[8px] text-muted-foreground">{evaluation.quote.name?.slice(0, 32)}</div></div><div className="text-right"><div className={`font-terminal text-[11px] font-bold tabular-nums ${evaluation.quote.changePercent >= 0 ? "text-up" : "text-down"}`}>{evaluation.quote.changePercent >= 0 ? "+" : ""}{evaluation.quote.changePercent.toFixed(2)}%</div><div className="font-terminal text-[9px] tabular-nums text-muted-foreground">${evaluation.quote.price.toFixed(2)}</div></div></div><div className="mt-2 flex items-center gap-2"><PatternBadge matched bullish={scan.bullish} /><span className="font-terminal text-[7.5px] text-muted-foreground">{evaluation.passed}/{evaluation.conditions.length} CONDITIONS PASS</span></div><div className="mt-2 grid gap-1 sm:grid-cols-2">{evaluation.conditions.map((condition) => <div key={condition.id} className="flex items-center gap-2 border border-border/60 bg-black/20 px-2 py-1.5"><ConditionState pass={condition.pass} /><span className="min-w-0 flex-1 truncate font-terminal text-[7.5px] text-muted-foreground">{condition.label}</span><span className="font-terminal text-[8px] tabular-nums text-foreground">{condition.value}</span></div>)}</div></button>)}</div></section> : <section className="border border-border bg-[#080808] p-4"><div className="font-terminal text-[11px] font-bold tracking-widest text-foreground">0 EXACT MATCHES</div><div className="mt-1 font-terminal text-[8.5px] leading-relaxed text-muted-foreground">Zero is preserved as information. The panels below show condition coverage and nearest observed candidates rather than a dead empty state.</div></section>}

        <section className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.3fr]">
          <div className="border border-border bg-[#080808]"><header className="border-b border-border px-3 py-2 font-terminal text-[8.5px] font-bold tracking-widest text-foreground">CONDITION COVERAGE</header><div className="divide-y divide-border/60">{passCounts.map((item) => <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2"><div><div className="font-terminal text-[8px] text-foreground">{item.label}</div><div className="mt-1 h-1 overflow-hidden bg-[#151515]"><div className="h-full bg-amber-400" style={{ width: `${item.available ? item.passed / item.available * 100 : 0}%` }} /></div></div><div className="text-right font-terminal text-[8px] tabular-nums text-muted-foreground"><div className="text-foreground">{item.passed} PASS</div><div>{item.available} VALID</div></div></div>)}</div>{!passCounts.length && <div className="p-4 font-terminal text-[8px] text-muted-foreground">Waiting for valid quote inputs.</div>}</div>
          <div className="border border-border bg-[#080808]"><header className="flex items-center border-b border-border px-3 py-2"><span className="font-terminal text-[8.5px] font-bold tracking-widest text-foreground">NEAREST CANDIDATES</span><span className="ml-auto font-terminal text-[7.5px] text-muted-foreground">PASSES → GAP</span></header><div className="divide-y divide-border/60">{nearMisses.map((evaluation) => { const failed = evaluation.conditions.filter((condition) => condition.pass === false); const unavailable = evaluation.conditions.filter((condition) => condition.pass === null); return <button key={evaluation.quote.symbol} onClick={() => onSymbol(evaluation.quote.symbol)} className="grid w-full grid-cols-[80px_80px_1fr_auto] items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.03]"><div><div className="font-terminal text-[9px] font-bold text-foreground">{evaluation.quote.symbol}</div><div className={`font-terminal text-[8px] ${evaluation.quote.changePercent >= 0 ? "text-up" : "text-down"}`}>{evaluation.quote.changePercent >= 0 ? "+" : ""}{evaluation.quote.changePercent.toFixed(2)}%</div></div><div><PatternBadge matched={false} bullish={scan.bullish} /><div className="mt-1 font-terminal text-[7px] text-muted-foreground">{evaluation.passed}/{evaluation.conditions.length} PASS</div></div><div className="min-w-0"><div className="truncate font-terminal text-[8px] text-muted-foreground">{failed.length ? `FAIL · ${failed.map((item) => `${item.label}: ${item.value}`).join(" · ")}` : "No failed observed conditions"}</div>{unavailable.length > 0 && <div className="truncate font-terminal text-[7px] text-amber-300/80">UNAVAILABLE · {unavailable.map((item) => item.label).join(" · ")}</div>}</div><span className="font-terminal text-[8px] tabular-nums text-muted-foreground">{evaluation.gap.toFixed(2)}</span></button>; })}{!nearMisses.length && <div className="p-4 font-terminal text-[8px] text-muted-foreground">No valid near-miss diagnostics. Missing inputs are not imputed.</div>}</div></div>
        </section>
      </div>
    </div>
  );
}
