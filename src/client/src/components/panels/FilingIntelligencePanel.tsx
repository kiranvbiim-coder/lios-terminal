import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { Scan, FileText, ExternalLink, Sliders, AlertTriangle, Search } from "lucide-react";
import { useOHLCV, useQuote } from "@/lib/useFinance";
import type { OHLCVBar } from "@/lib/finance";
import { useEdgarFilings, type EdgarFilingSummary } from "@/lib/useOfficialSources";
import { useSecFilingSearch } from "@/lib/useSecFilingSearch";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrencySymbol } from "@/lib/finance";
import { ReceiptSummary, runAdvancedManual, type AdvancedReceipt } from "./advancedMacroForecastResearch";
interface Props {
  symbol: string;
  onSymbol: (sym: string) => void;
}

const FORM_LABELS: Record<string, string> = {
  "10-K": "Annual report",
  "10-K/A": "Annual report (amended)",
  "10-Q": "Quarterly report",
  "10-Q/A": "Quarterly report (amended)",
  "8-K": "Current report (material event)",
  "4": "Insider transaction",
  "3": "Initial insider ownership",
  "DEF 14A": "Proxy statement",
  "S-1": "IPO registration",
  "S-3": "Shelf registration",
  "SC 13G": "Passive ownership >5%",
  "SC 13D": "Active ownership >5%",
};

// Additive: research/filing-diff wired from this panel's own real EDGAR
// filing list -- the analyst selects two actual filings (accession links
// retained and shown) and pastes the exact section text copied from each
// linked filing. Text is never fabricated or scraped automatically; only
// the accession/date binding is automatic.
function FilingDiffRunner({ filings }: { filings: EdgarFilingSummary[] | undefined }) {
  const [oldAccession, setOldAccession] = useTerminalArtifactState("FilingDiffRunner.oldAccession", "");
  const [newAccession, setNewAccession] = useTerminalArtifactState("FilingDiffRunner.newAccession", "");
  const [oldText, setOldText] = useTerminalArtifactState("FilingDiffRunner.oldText", "");
  const [newText, setNewText] = useTerminalArtifactState("FilingDiffRunner.newText", "");
  const [result, setResult] = useState<(Record<string, unknown> & { receipt?: AdvancedReceipt }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const oldFiling = filings?.find((filing) => filing.accessionNumber === oldAccession) ?? null;
  const newFiling = filings?.find((filing) => filing.accessionNumber === newAccession) ?? null;
  const run = async () => {
    if (!oldFiling || !newFiling) { setError("Select both the older and newer filing being compared."); return; }
    if (!oldText.trim() || !newText.trim()) { setError("Paste the actual section text copied from each linked filing."); return; }
    setLoading(true); setError(null); setResult(null);
    try { setResult(await runAdvancedManual("research", "filing-diff", { oldText, newText, maxChanges: 100 })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Filing diff unavailable."); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-4">
      <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block">FILING TEXT DIFF — TWO REAL SEC FILINGS, ACCESSION-LINKED</span>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <select value={oldAccession} onChange={(e) => setOldAccession(e.target.value)} className="w-full h-8 bg-[#0d0d0d] border border-border px-2 font-terminal text-[9px]">
            <option value="">SELECT OLDER FILING</option>
            {filings?.map((filing) => <option key={filing.accessionNumber} value={filing.accessionNumber}>{filing.formType} / {filing.filedDate}</option>)}
          </select>
          {oldFiling && <a href={oldFiling.filingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-terminal text-[8px] text-[hsl(38,95%,55%)] hover:underline">Accession {oldFiling.accessionNumber} <ExternalLink className="w-3 h-3" /></a>}
          <textarea value={oldText} onChange={(e) => setOldText(e.target.value)} rows={8} placeholder="Paste the OLDER filing's section text, copied from the linked accession above." className="w-full resize-y bg-[#0d0d0d] border border-border p-2 font-mono text-[9px] outline-none focus:border-[hsl(38,95%,50%)]" />
        </div>
        <div className="space-y-1.5">
          <select value={newAccession} onChange={(e) => setNewAccession(e.target.value)} className="w-full h-8 bg-[#0d0d0d] border border-border px-2 font-terminal text-[9px]">
            <option value="">SELECT NEWER FILING</option>
            {filings?.map((filing) => <option key={filing.accessionNumber} value={filing.accessionNumber}>{filing.formType} / {filing.filedDate}</option>)}
          </select>
          {newFiling && <a href={newFiling.filingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-terminal text-[8px] text-[hsl(38,95%,55%)] hover:underline">Accession {newFiling.accessionNumber} <ExternalLink className="w-3 h-3" /></a>}
          <textarea value={newText} onChange={(e) => setNewText(e.target.value)} rows={8} placeholder="Paste the NEWER filing's section text, copied from the linked accession above." className="w-full resize-y bg-[#0d0d0d] border border-border p-2 font-mono text-[9px] outline-none focus:border-[hsl(38,95%,50%)]" />
        </div>
      </div>
      <button type="button" onClick={() => void run()} disabled={loading || !oldFiling || !newFiling || !oldText.trim() || !newText.trim()} className="h-9 px-4 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] font-terminal text-[9px] uppercase disabled:opacity-40">{loading ? "RUNNING…" : "RUN FILING DIFF"}</button>
      {error && <div role="alert" className="font-mono text-[8px] text-red-300">{error}</div>}
      {result && <><pre className="max-h-56 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[7px] text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={result.receipt} /></>}
    </div>
  );
}

function alignedDailyReturnsPct(bars: OHLCVBar[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!bars) return map;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    if (prev > 0) map.set(bars[i].date, ((bars[i].close - prev) / prev) * 100);
  }
  return map;
}

// Additive: econometrics/event-study placed here (rather than Research
// Intelligence) because this panel is the one place that already loads
// both a real EDGAR filing list AND OHLCV history for the same symbol --
// Research Intelligence's timeline has real events but no OHLCV series.
// assetReturnsPct/marketReturnsPct are computed directly from the panel's
// already-fetched OHLCV bars (this symbol vs. ^GSPC), aligned by trading
// date; eventIndex is bound to a real selected filing's filed date, never
// inferred from a headline.
function EventStudyRunner({ filings, assetBars, symbol }: { filings: EdgarFilingSummary[] | undefined; assetBars: OHLCVBar[] | undefined; symbol: string }) {
  const { data: marketData } = useOHLCV("^GSPC", "1Y", "1d");
  const [eventAccession, setEventAccession] = useTerminalArtifactState("EventStudyRunner.eventAccession", "");
  const [estimationWindow, setEstimationWindow] = useTerminalArtifactState("EventStudyRunner.estimationWindow", "60");
  const [eventWindowBefore, setEventWindowBefore] = useTerminalArtifactState("EventStudyRunner.eventWindowBefore", "5");
  const [eventWindowAfter, setEventWindowAfter] = useTerminalArtifactState("EventStudyRunner.eventWindowAfter", "5");
  const [result, setResult] = useState<(Record<string, unknown> & { receipt?: AdvancedReceipt }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const aligned = useMemo(() => {
    const assetReturns = alignedDailyReturnsPct(assetBars);
    const marketReturns = alignedDailyReturnsPct(marketData?.bars);
    const dates = (assetBars ?? []).map((bar) => bar.date).filter((date) => assetReturns.has(date) && marketReturns.has(date));
    return { dates, assetReturnsPct: dates.map((date) => assetReturns.get(date)!), marketReturnsPct: dates.map((date) => marketReturns.get(date)!) };
  }, [assetBars, marketData]);

  const eventFiling = filings?.find((filing) => filing.accessionNumber === eventAccession) ?? null;
  const eventIndex = useMemo(() => {
    if (!eventFiling) return null;
    const idx = aligned.dates.findIndex((date) => date >= eventFiling.filedDate);
    return idx === -1 ? null : idx;
  }, [aligned.dates, eventFiling]);

  const run = async () => {
    if (!eventFiling || eventIndex === null) { setError("Select a real filing event with an aligned trading date in the loaded OHLCV window."); return; }
    const est = Number(estimationWindow), before = Number(eventWindowBefore), after = Number(eventWindowAfter);
    if (!Number.isFinite(est) || est < 20) { setError("estimationWindow must be at least 20 trading days."); return; }
    if (!Number.isFinite(before) || before < 0 || !Number.isFinite(after) || after < 0) { setError("eventWindowBefore/eventWindowAfter must be non-negative."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      setResult(await runAdvancedManual("econometrics", "event-study", {
        assetReturnsPct: aligned.assetReturnsPct, marketReturnsPct: aligned.marketReturnsPct,
        eventIndex, estimationWindow: est, eventWindowBefore: before, eventWindowAfter: after,
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Event study unavailable."); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block">EVENT STUDY — {symbol} vs. ^GSPC, ALIGNED OHLCV, REAL FILING EVENT</span>
      <div className="font-mono text-[8px] text-muted-foreground">{aligned.dates.length} aligned trading days bound as assetReturnsPct/marketReturnsPct from this panel's own loaded OHLCV history. Select the real filing below to anchor eventIndex — never inferred from a headline.</div>
      <select value={eventAccession} onChange={(e) => setEventAccession(e.target.value)} className="w-full max-w-md h-8 bg-[#0d0d0d] border border-border px-2 font-terminal text-[9px]">
        <option value="">SELECT FILING EVENT</option>
        {filings?.map((filing) => <option key={filing.accessionNumber} value={filing.accessionNumber}>{filing.formType} / {filing.filedDate}</option>)}
      </select>
      {eventFiling && <a href={eventFiling.filingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-terminal text-[8px] text-[hsl(38,95%,55%)] hover:underline">Accession {eventFiling.accessionNumber} <ExternalLink className="w-3 h-3" /></a>}
      {eventFiling && eventIndex === null && <div className="font-mono text-[8px] text-red-300">No aligned trading day on/after {eventFiling.filedDate} in the loaded OHLCV window.</div>}
      {eventFiling && eventIndex !== null && <div className="font-mono text-[8px] text-muted-foreground">Event bound to trading date {aligned.dates[eventIndex]} (index {eventIndex} of {aligned.dates.length}).</div>}
      <div className="grid grid-cols-3 gap-2 max-w-md">
        <label className="flex flex-col gap-1"><span className="font-terminal text-[7px] text-muted-foreground uppercase">Estimation window</span><input value={estimationWindow} onChange={(e) => setEstimationWindow(e.target.value)} inputMode="numeric" className="h-8 bg-[#0d0d0d] border border-border px-2 font-mono text-[9px]" /></label>
        <label className="flex flex-col gap-1"><span className="font-terminal text-[7px] text-muted-foreground uppercase">Window before</span><input value={eventWindowBefore} onChange={(e) => setEventWindowBefore(e.target.value)} inputMode="numeric" className="h-8 bg-[#0d0d0d] border border-border px-2 font-mono text-[9px]" /></label>
        <label className="flex flex-col gap-1"><span className="font-terminal text-[7px] text-muted-foreground uppercase">Window after</span><input value={eventWindowAfter} onChange={(e) => setEventWindowAfter(e.target.value)} inputMode="numeric" className="h-8 bg-[#0d0d0d] border border-border px-2 font-mono text-[9px]" /></label>
      </div>
      <button type="button" onClick={() => void run()} disabled={loading || !eventFiling || eventIndex === null} className="h-9 px-4 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] font-terminal text-[9px] uppercase disabled:opacity-40">{loading ? "RUNNING…" : "RUN EVENT STUDY"}</button>
      {error && <div role="alert" className="font-mono text-[8px] text-red-300">{error}</div>}
      {result && <><pre className="max-h-56 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[7px] text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={result.receipt} /></>}
    </div>
  );
}

export default function FilingIntelligencePanel({ symbol, onSymbol }: Props) {
  const [activeSegment, setActiveSegment] = useTerminalArtifactState<"filings" | "technical" | "search" | "diff" | "event">("FilingIntelligencePanel.activeSegment", "filings");
  const [searchQuery, setSearchQuery] = useTerminalArtifactState("FilingIntelligencePanel.searchQuery", "");
  const [searchArmed, setSearchArmed] = useTerminalArtifactState("FilingIntelligencePanel.searchArmed", false);
  const [searchOffset, setSearchOffset] = useTerminalArtifactState("FilingIntelligencePanel.searchOffset", 0);
  const [searchFrom, setSearchFrom] = useTerminalArtifactState("FilingIntelligencePanel.searchFrom", "");
  const [searchTo, setSearchTo] = useTerminalArtifactState("FilingIntelligencePanel.searchTo", "");
  const { data: searchResults, isFetching: isSearchFetching } = useSecFilingSearch(
    searchQuery,
    symbol,
    searchArmed,
    { offset: searchOffset, limit: 20, from: searchFrom || undefined, to: searchTo || undefined },
  );
  // Load daily price history and current quote
  const { data, isLoading } = useOHLCV(symbol, "1Y", "1d");
  const { data: quote, isLoading: isQuoteLoading } = useQuote(symbol);
  // Real SEC EDGAR filing metadata -- US SEC filers only, so this comes back
  // empty for non-US-listed symbols rather than fabricating anything.
  const { data: filings, isLoading: isFilingsLoading } = useEdgarFilings(symbol);

  // Technical pattern parser
  const techSignals = useMemo(() => {
    if (!data?.bars || data.bars.length < 50) return null;

    const closes = data.bars.map((b) => b.close);
    const latestClose = closes[closes.length - 1];

    // Compute simple moving averages (SMA20 and SMA50)
    const sma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
    const sma50 = closes.slice(-50).reduce((s, v) => s + v, 0) / 50;

    // Compute simple RSI14
    const gains = [];
    const losses = [];
    for (let i = closes.length - 14; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      gains.push(d > 0 ? d : 0);
      losses.push(d < 0 ? -d : 0);
    }
    const avgGain = gains.reduce((s, v) => s + v, 0) / 14;
    const avgLoss = losses.reduce((s, v) => s + v, 0) / 14;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    // Signals compilation
    const signals = [];
    if (latestClose > sma20 && sma20 > sma50) {
      signals.push({ name: "Golden Crossover", status: "BULLISH", desc: "Short term SMA is above long term SMA." });
    } else if (latestClose < sma20 && sma20 < sma50) {
      signals.push({ name: "Death Crossover", status: "BEARISH", desc: "Short term SMA is below long term SMA." });
    }

    if (rsi > 70) {
      signals.push({ name: "RSI Overbought", status: "BEARISH", desc: `RSI value is ${rsi.toFixed(0)}, indicating potential reversal.` });
    } else if (rsi < 30) {
      signals.push({ name: "RSI Oversold", status: "BULLISH", desc: `RSI value is ${rsi.toFixed(0)}, indicating undervalued rebound.` });
    }

    // Pattern recognition proxy: check last 3 candlesticks for hammer
    const latestBar = data.bars[data.bars.length - 1];
    const body = Math.abs(latestBar.close - latestBar.open);
    const wick = latestBar.high - Math.max(latestBar.close, latestBar.open);
    const tail = Math.min(latestBar.close, latestBar.open) - latestBar.low;

    if (tail > body * 2 && wick < body * 0.5) {
      signals.push({ name: "Hammer Candlestick", status: "BULLISH", desc: "Long lower shadow suggests sellers capitulated." });
    }

    return {
      rsi,
      sma20,
      sma50,
      signals,
    };
  }, [data]);


  if (isLoading || isQuoteLoading || !data || !quote) {
    return (
      <div className="h-full p-4 space-y-4 bg-[#050505] flex flex-col justify-center animate-pulse">
        <Skeleton className="h-8 w-1/3 bg-border" />
        <Skeleton className="h-64 w-full bg-border" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      {/* Parameters Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2">
          <Scan className="w-4 h-4 text-[hsl(38,95%,55%)] animate-pulse" />
          <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">FILING INTELLIGENCE & SIGNAL SCANNER</span>
          <span className="font-terminal text-[10px] text-foreground font-bold">{symbol}</span>
        </div>

        <div className="flex items-center gap-1 bg-[#0d0d0d] border border-border p-0.5">
          {(["filings", "search", "technical", "diff", "event"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveSegment(tab)}
              className={`px-3 py-1 font-terminal text-[9px] tracking-widest transition-colors uppercase ${
                activeSegment === tab ? "bg-amber-500/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "filings" ? "SEC Filings" : tab === "search" ? "Full-Text Search" : tab === "technical" ? "Technical Signals" : tab === "diff" ? "Filing Diff" : "Event Study"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        {/* Left Column: Core Tool Viewer */}
        <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4 border-b xl:border-b-0 xl:border-r border-border">
          
          {/* TAB 1: Real SEC EDGAR filing list */}
          {activeSegment === "filings" && (
            <div className="space-y-4">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block">
                RECENT SEC FILINGS — LIVE FROM SEC.GOV, US FILERS ONLY
              </span>

              {isFilingsLoading ? (
                <Skeleton className="h-64 w-full bg-border" />
              ) : !filings || filings.length === 0 ? (
                <div className="p-8 text-center font-terminal text-[10px] text-muted-foreground uppercase border border-border bg-[#070707]">
                  No SEC EDGAR filings found for {symbol}. This connector only covers US SEC filers —
                  non-US-listed symbols won't have filings here.
                </div>
              ) : (
                <div className="border border-border overflow-hidden rounded bg-[#070707]">
                  <div className="grid grid-cols-[80px_100px_1fr_32px] border-b border-border p-2 font-terminal text-[8px] font-bold text-muted-foreground bg-[#090909]">
                    <div>FORM</div>
                    <div>FILED</div>
                    <div>TYPE</div>
                    <div></div>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
                    {filings.map((f) => (
                      <a
                        key={f.accessionNumber}
                        href={f.filingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="grid grid-cols-[80px_100px_1fr_32px] border-b border-border/50 last:border-b-0 p-2 font-terminal text-[10px] items-center hover:bg-white/5"
                      >
                        <div className="text-foreground font-bold">{f.formType}</div>
                        <div className="text-muted-foreground tabular-nums">{f.filedDate}</div>
                        <div className="text-muted-foreground">{FORM_LABELS[f.formType] ?? "—"}</div>
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 1.6: Additive -- research/filing-diff */}
          {activeSegment === "diff" && <FilingDiffRunner filings={filings} />}

          {/* TAB 1.7: Additive -- econometrics/event-study */}
          {activeSegment === "event" && <EventStudyRunner filings={filings} assetBars={data.bars} symbol={symbol} />}

          {/* TAB 1.5: Full-text search across SEC filing content (EFTS via edgartools) */}
          {activeSegment === "search" && (
            <div className="space-y-4">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block">
                SEARCH THE TEXT OF {symbol}'S SEC FILINGS — LIVE VIA EDGAR EFTS
              </span>

              <div className="flex items-center gap-1 flex-wrap">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchArmed(false); setSearchOffset(0); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { setSearchOffset(0); setSearchArmed(true); } }}
                  placeholder="e.g. material weakness, litigation, supply chain..."
                  className="flex-1 min-w-[220px] bg-[#0d0d0d] border border-border text-[10px] font-terminal px-2 py-1.5 text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-[hsl(38,95%,50%)]"
                />
                <input type="date" value={searchFrom} onChange={(e) => { setSearchFrom(e.target.value); setSearchOffset(0); }} aria-label="Search filings from date" className="bg-[#0d0d0d] border border-border text-[9px] font-terminal px-2 py-1.5 text-foreground" />
                <input type="date" value={searchTo} onChange={(e) => { setSearchTo(e.target.value); setSearchOffset(0); }} aria-label="Search filings to date" className="bg-[#0d0d0d] border border-border text-[9px] font-terminal px-2 py-1.5 text-foreground" />
                <button
                  type="button"
                  onClick={() => { setSearchOffset(0); setSearchArmed(true); }}
                  disabled={!searchQuery.trim() || isSearchFetching}
                  className="flex items-center gap-1 font-terminal text-[9px] uppercase tracking-widest px-3 py-1.5 border border-border text-muted-foreground hover:text-[hsl(38,95%,55%)] hover:border-[hsl(38,95%,50%)] disabled:opacity-40"
                >
                  <Search className="w-3 h-3" />
                  {isSearchFetching ? "..." : "Search"}
                </button>
              </div>

              {searchArmed && !isSearchFetching && (
                !searchResults?.results.length ? (
                  <div className="p-8 text-center font-terminal text-[10px] text-muted-foreground uppercase border border-border bg-[#070707]">
                    No filings found for "{searchQuery}".
                  </div>
                ) : (
                  <div className="border border-border overflow-hidden rounded bg-[#070707]">
                    <div className="grid grid-cols-[70px_90px_1fr_60px_32px] border-b border-border p-2 font-terminal text-[8px] font-bold text-muted-foreground bg-[#090909]">
                      <div>FORM</div>
                      <div>FILED</div>
                      <div>COMPANY</div>
                      <div>RELEVANCE</div>
                      <div></div>
                    </div>
                    <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
                      {searchResults.results.map((r) => (
                        <a
                          key={r.accessionNumber}
                          href={r.filingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="grid grid-cols-[70px_90px_1fr_60px_32px] border-b border-border/50 last:border-b-0 p-2 font-terminal text-[10px] items-center hover:bg-white/5"
                        >
                          <div className="text-foreground font-bold">{r.form}</div>
                          <div className="text-muted-foreground tabular-nums">{r.filed}</div>
                          <div className="text-muted-foreground truncate">{r.company}</div>
                          <div className="text-[hsl(38,95%,55%)] tabular-nums">{r.score.toFixed(1)}</div>
                          <ExternalLink className="w-3 h-3 text-muted-foreground" />
                        </a>
                      ))}
                    </div>
                  </div>
                )
              )}
              {searchArmed && searchResults && (
                <div className="flex items-center justify-between font-terminal text-[8px] text-muted-foreground">
                  <span>{searchResults.returnedCount} RETURNED · PROVIDER TOTAL {searchResults.totalCount.toLocaleString()}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={searchOffset === 0 || isSearchFetching} onClick={() => setSearchOffset(Math.max(0, searchOffset - 20))} className="border border-border px-2 py-1 disabled:opacity-30">PREV</button>
                    <span>OFFSET {searchResults.offset}</span>
                    <button type="button" disabled={!searchResults.hasMore || isSearchFetching} onClick={() => setSearchOffset(searchOffset + 20)} className="border border-border px-2 py-1 disabled:opacity-30">NEXT</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Technical Signal Screener */}
          {activeSegment === "technical" && (
            <div className="space-y-4">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block">
                ACTIVE TECHNICAL PATTERNS & MOMENTUM ALERTS
              </span>

              <div className="border border-border overflow-hidden rounded bg-[#070707]">
                <div className="grid grid-cols-3 border-b border-border p-2 font-terminal text-[8px] font-bold text-muted-foreground text-center bg-[#090909]">
                  <div>SIGNAL TRIGGER</div>
                  <div>RISK VECTOR</div>
                  <div>CONDITION DETECTED</div>
                </div>

                {techSignals?.signals && techSignals.signals.length > 0 ? (
                  techSignals.signals.map((sig) => (
                    <div key={sig.name} className="grid grid-cols-3 border-b border-border last:border-b-0 p-2.5 font-terminal text-[10px] text-center items-center">
                      <div className="text-foreground font-bold">{sig.name}</div>
                      <div className={`font-bold ${sig.status === "BULLISH" ? "text-up" : "text-down"}`}>
                        {sig.status}
                      </div>
                      <div className="text-muted-foreground text-left">{sig.desc}</div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center font-terminal text-[10px] text-muted-foreground uppercase">
                    No active technical crossover or candlestick patterns detected.
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Right Column: Statistics & Highlights */}
        <div className="w-full xl:w-72 border-t xl:border-t-0 xl:border-l border-border bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
          <div className="p-4 flex-1 space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Sliders className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">INTELLIGENCE MATRIX</span>
            </div>

            <div className="space-y-2.5">
              {/* Technical Indicator stats */}
              {techSignals && (
                <div className="bg-[#080808] border border-border/60 p-3 space-y-1.5 font-mono text-[9px]">
                  <div className="font-terminal text-[8px] text-muted-foreground tracking-widest uppercase border-b border-border/40 pb-1">
                    INDICATOR GAUGES
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-terminal">RSI (14):</span>
                    <span className={`font-bold ${techSignals.rsi > 70 ? "text-down" : techSignals.rsi < 30 ? "text-up" : "text-foreground"}`}>
                      {techSignals.rsi.toFixed(0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-terminal">SMA (20):</span>
                    <span>{quote.symbol.startsWith("^") ? "" : getCurrencySymbol(quote.symbol)}{techSignals.sma20.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-terminal">SMA (50):</span>
                    <span>{quote.symbol.startsWith("^") ? "" : getCurrencySymbol(quote.symbol)}{techSignals.sma50.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Latest filing */}
              {filings && filings.length > 0 && (
                <div className="bg-[#080808] border border-border/60 p-3 space-y-1.5">
                  <div className="font-terminal text-[8px] text-muted-foreground tracking-widest uppercase">MOST RECENT FILING</div>
                  <div className="font-terminal text-lg font-bold font-mono text-foreground">
                    {filings[0].formType}
                    <span className="text-[8.5px] text-muted-foreground ml-1.5 font-terminal uppercase">
                      filed {filings[0].filedDate}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Explanation box */}
            <div className="border border-border/80 bg-[#080808] p-3 text-[8.5px] font-terminal text-muted-foreground leading-normal space-y-1">
              <div className="flex items-center gap-1 text-[9px] text-foreground font-bold border-b border-border/60 pb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span>DATA SOURCE NOTE</span>
              </div>
              <p>
                <strong>SEC Filings:</strong> Live from SEC EDGAR (data.sec.gov) — real form types, filing dates, and links to the official filing index. Covers US SEC filers only.
              </p>
              <p>
                <strong>Technical Signals:</strong> Computed from real daily OHLCV price history (SMA20/50 crossover, RSI14, candlestick pattern detection) — not sourced from any filing.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
