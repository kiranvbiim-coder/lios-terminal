import { useMemo, useState } from "react";
import { Zap, RefreshCw, ChevronDown } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import { useQuotes } from "@/lib/useFinance";
import { useIndicatorDetail } from "@/lib/useEconomics";

interface Props {
  onSymbol: (sym: string) => void;
  onNav: (view: ViewMode) => void;
}

interface MacroParams {
  fedRate: number;
  cpi: number;
  gdp: number;
  oilPrice: number;
  vix: number;
  dxy: number;
}

interface MacroImpacts {
  equityAdj: number;
  bondAdj: number;
  usdStrength: number;
  goldAdj: number;
  btcAdj: number;
  oilDemand: number;
  recessionRisk: number;
}

const DEFAULTS: MacroParams = { fedRate: 5.25, cpi: 2.8, gdp: 2.1, oilPrice: 80, vix: 18, dxy: 104 };

const SCENARIOS: Record<string, { label: string; params: MacroParams }> = {
  gfc2008:      { label: "2008 GFC",        params: { fedRate: 0.25, cpi: 0.1,  gdp: -2.5, oilPrice: 40,  vix: 70, dxy: 88  } },
  covid2020:    { label: "2020 COVID",       params: { fedRate: 0.1,  cpi: 1.2,  gdp: -3.5, oilPrice: 35,  vix: 65, dxy: 99  } },
  rateShock2022:{ label: "2022 RATE SHOCK",  params: { fedRate: 4.5,  cpi: 8.5,  gdp: 2.1,  oilPrice: 110, vix: 34, dxy: 114 } },
  goldilocks:   { label: "GOLDILOCKS",       params: { fedRate: 3.0,  cpi: 2.0,  gdp: 3.5,  oilPrice: 70,  vix: 13, dxy: 100 } },
  stagflation:  { label: "STAGFLATION",      params: { fedRate: 7.0,  cpi: 9.5,  gdp: -1.0, oilPrice: 130, vix: 45, dxy: 110 } },
};

function computeImpacts(p: MacroParams): MacroImpacts {
  const fedDelta = p.fedRate - 3.0;
  const cpiDelta = p.cpi - 2.5;
  const gdpDelta = p.gdp - 2.0;
  const vixDelta = p.vix - 18;
  return {
    equityAdj:    -(fedDelta * 8)  - (cpiDelta * 3) + (gdpDelta * 5)  - (vixDelta * 0.8),
    bondAdj:      -(fedDelta * 12) - (cpiDelta * 5),
    usdStrength:   (fedDelta * 5)  + (gdpDelta * 3) - (cpiDelta * 2),
    goldAdj:      -(fedDelta * 4)  + (vixDelta * 0.6) + (cpiDelta * 4),
    btcAdj:       -(fedDelta * 15) + (vixDelta * -1.2) + (gdpDelta * 8),
    oilDemand:     (gdpDelta * 8)  - (fedDelta * 3),
    recessionRisk: Math.max(0, Math.min(100, 50 + (fedDelta * 12) - (gdpDelta * 15) + (cpiDelta * 5) + (vixDelta * 0.8))),
  };
}

function computeAssets(p: MacroParams, impacts: MacroImpacts) {
  return [
    { label: "S&P 500",      base: 7500,  adj: impacts.equityAdj / 100,       sym: "^GSPC" },
    { label: "10Y UST Yield",base: 4.2,   adj: -impacts.bondAdj / 200,         sym: null    },
    { label: "EUR/USD",      base: 1.09,  adj: -impacts.usdStrength / 1000,    sym: null    },
    { label: "Gold $/oz",    base: 4000,  adj: impacts.goldAdj / 100,          sym: "GC=F"  },
    { label: "Bitcoin",      base: 62000, adj: impacts.btcAdj / 100,           sym: "BTC-USD"},
    { label: "Crude WTI",    base: p.oilPrice, adj: impacts.oilDemand / 200,   sym: "CL=F"  },
    { label: "Nifty 50",     base: 25000, adj: (impacts.equityAdj * 0.85) / 100, sym: "^NSEI"},
    { label: "USD/INR",      base: 83.5,  adj: impacts.usdStrength * 0.3 / 1000, sym: null  },
  ].map(a => ({ ...a, adjusted: a.base * (1 + a.adj), changePct: a.adj * 100 }));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function trailingChangePercent(history: { date: string; value: number }[] | undefined, periodsBack: number) {
  if (!history || history.length <= periodsBack) return null;
  const latest = history[history.length - 1]?.value;
  const prior = history[history.length - 1 - periodsBack]?.value;
  if (!Number.isFinite(latest) || !Number.isFinite(prior) || prior === 0) return null;
  return ((latest - prior) / prior) * 100;
}

function ImpactBar({ label, value, max = 30 }: { label: string; value: number; max?: number }) {
  const isPos = value >= 0;
  const pct = Math.min(100, (Math.abs(value) / max) * 50);
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/30">
      <span className="font-terminal text-[9px] text-muted-foreground w-44 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-[#111] relative overflow-hidden">
        <div
          className={`absolute top-0 h-full transition-all duration-500 ${isPos ? "bg-[hsl(142,71%,45%)]" : "bg-[hsl(0,80%,55%)]"}`}
          style={{ left: isPos ? "50%" : `${50 - pct}%`, width: `${pct}%` }}
        />
        <div className="absolute top-0 left-1/2 w-px h-full bg-[#333]" />
      </div>
      <span className={`font-terminal text-[10px] font-bold tabular-nums w-16 text-right ${isPos ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
        {isPos ? "+" : ""}{value.toFixed(1)}%
      </span>
    </div>
  );
}

/** A Bloomberg-style numeric input field — click value to edit */
function NumericInput({
  label, value, unit = "", decimals = 2, min, max, onChange,
}: {
  label: string; value: number; unit?: string; decimals?: number; min?: number; max?: number;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");

  const formatted = unit === "$"
    ? `$${value.toFixed(decimals)}`
    : `${value.toFixed(decimals)}${unit}`;

  const commit = () => {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      const clamped = (min !== undefined && max !== undefined)
        ? Math.min(max, Math.max(min, parsed))
        : parsed;
      onChange(clamped);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-2 border-b border-border/40">
        <span className="font-terminal text-[9px] text-muted-foreground flex-1 truncate">{label}</span>
        <input
          autoFocus
          type="number"
          defaultValue={value}
          onChange={e => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          className="w-28 bg-[#111] border border-[hsl(38,95%,50%)/60%] px-2 py-0.5 font-terminal text-[10px] text-foreground focus:outline-none text-right"
          step="any"
        />
        {unit && unit !== "$" && <span className="font-terminal text-[9px] text-muted-foreground w-4 shrink-0">{unit}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => { setRaw(String(value)); setEditing(true); }}
      className="w-full flex items-center gap-2 py-2 border-b border-border/40 hover:bg-white/5 group text-left"
    >
      <span className="font-terminal text-[9px] text-muted-foreground flex-1 truncate group-hover:text-foreground transition-colors">{label}</span>
      <span className="font-terminal text-[11px] font-bold text-[hsl(38,95%,55%)] tabular-nums">{formatted}</span>
      <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/50 group-hover:text-[hsl(38,95%,55%)] transition-colors shrink-0" />
    </button>
  );
}

export default function MacroStressPanel({ onSymbol, onNav }: Props) {
  const [params, setParams] = useState<MacroParams>(DEFAULTS);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const fedFunds = useIndicatorDetail("FEDFUNDS");
  const cpi = useIndicatorDetail("CPIAUCSL");
  const gdp = useIndicatorDetail("GDPC1");
  const { data: marketQuotes = [] } = useQuotes(["CL=F", "^VIX", "DX-Y.NYB"]);
  const marketQuoteMap = useMemo(() => new Map(marketQuotes.map((quote) => [quote.symbol, quote])), [marketQuotes]);
  const liveParams = useMemo<Partial<MacroParams>>(() => {
    const next: Partial<MacroParams> = {};
    const fedValue = fedFunds.data?.quote.value;
    const cpiYoY = trailingChangePercent(cpi.data?.history, 12);
    const gdpYoY = trailingChangePercent(gdp.data?.history, 4);
    const oilQuote = marketQuoteMap.get("CL=F")?.price;
    const vixQuote = marketQuoteMap.get("^VIX")?.price;
    const dxyQuote = marketQuoteMap.get("DX-Y.NYB")?.price;
    if (isFiniteNumber(fedValue)) next.fedRate = fedValue;
    if (isFiniteNumber(cpiYoY)) next.cpi = cpiYoY;
    if (isFiniteNumber(gdpYoY)) next.gdp = gdpYoY;
    if (isFiniteNumber(oilQuote)) next.oilPrice = oilQuote;
    if (isFiniteNumber(vixQuote)) next.vix = vixQuote;
    if (isFiniteNumber(dxyQuote)) next.dxy = dxyQuote;
    return next;
  }, [fedFunds.data, cpi.data, gdp.data, marketQuoteMap]);
  const liveParamCount = Object.keys(liveParams).length;

  const applyLiveSnapshot = () => {
    setParams((current) => ({ ...current, ...liveParams }));
    setActiveScenario(null);
  };

  const set = (key: keyof MacroParams) => (val: number) => {
    setParams(p => ({ ...p, [key]: val }));
    setActiveScenario(null);
  };

  const applyScenario = (key: string) => {
    setParams(SCENARIOS[key].params);
    setActiveScenario(key);
  };

  const impacts = useMemo(() => computeImpacts(params), [params]);
  const assets  = useMemo(() => computeAssets(params, impacts), [params, impacts]);

  const recessionLabel =
    impacts.recessionRisk < 25 ? "LOW RISK" :
    impacts.recessionRisk < 50 ? "MODERATE" :
    impacts.recessionRisk < 75 ? "ELEVATED" : "CRITICAL";
  const recessionColorText =
    impacts.recessionRisk < 25 ? "text-[hsl(142,71%,55%)]" :
    impacts.recessionRisk < 50 ? "text-[hsl(38,95%,55%)]" :
    impacts.recessionRisk < 75 ? "text-[hsl(20,90%,55%)]" : "text-[hsl(0,80%,60%)]";
  const recessionColorBorder =
    impacts.recessionRisk < 25 ? "border-[hsl(142,71%,25%)]" :
    impacts.recessionRisk < 50 ? "border-[hsl(38,95%,25%)]" :
    impacts.recessionRisk < 75 ? "border-[hsl(20,90%,25%)]" : "border-[hsl(0,80%,25%)]";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Zap className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">MACRO STRESS TEST & SCENARIO SIMULATOR</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">STRS</span>
      </div>

      <div className="flex-1 grid grid-cols-2 overflow-hidden">
        {/* ── LEFT: Inputs ─────────────────────────────────── */}
        <div className="border-r border-border overflow-y-auto scrollbar-thin p-4 space-y-4">

          {/* Scenario presets */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">HISTORICAL CRISIS SCENARIOS</div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(SCENARIOS).map(([key, s]) => (
                <button
                  key={key}
                  onClick={() => applyScenario(key)}
                  className={`px-3 py-2 font-terminal text-[9px] border text-left transition-all ${
                    activeScenario === key
                      ? "bg-[hsl(38,95%,50%)/20%] border-[hsl(38,95%,50%)/60%] text-[hsl(38,95%,55%)]"
                      : "border-border text-muted-foreground hover:border-[hsl(38,95%,50%)/30%] hover:text-foreground"
                  }`}
                >{s.label}</button>
              ))}
              <button
                onClick={() => { setParams(DEFAULTS); setActiveScenario(null); }}
                className="px-3 py-2 font-terminal text-[9px] border border-border text-muted-foreground hover:text-foreground flex items-center gap-1.5"
              >
                <RefreshCw className="w-2.5 h-2.5" /> RESET DEFAULTS
              </button>
            </div>
          </div>

          <div className="border border-border bg-[#080808] p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="font-terminal text-[9px] text-muted-foreground tracking-widest">LIVE SNAPSHOT INPUTS</div>
              <button
                onClick={applyLiveSnapshot}
                disabled={!liveParamCount}
                className="px-2 py-1 border border-[hsl(38,95%,50%)/45%] font-terminal text-[8px] text-[hsl(38,95%,55%)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                USE LIVE SNAPSHOT
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 font-terminal text-[8px]">
              {[
                ["FEDFUNDS", liveParams.fedRate, "%"],
                ["CPI YOY", liveParams.cpi, "%"],
                ["GDP YOY", liveParams.gdp, "%"],
                ["WTI", liveParams.oilPrice, "$"],
                ["VIX", liveParams.vix, ""],
                ["DXY", liveParams.dxy, ""],
              ].map(([label, value, unit]) => (
                <div key={label} className="border border-border/50 px-2 py-1">
                  <div className="text-muted-foreground">{label}</div>
                  <div className="text-foreground tabular-nums">{typeof value === "number" ? `${unit === "$" ? "$" : ""}${value.toFixed(2)}${unit === "%" ? "%" : ""}` : "UNAVAILABLE"}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 font-terminal text-[7px] text-muted-foreground/60">
              FRED supplies Fed funds, CPI YoY and real GDP YoY; market quotes supply WTI, VIX and DXY. Missing fields are left unchanged.
            </div>
          </div>

          {/* Editable numeric inputs — click to type */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-1.5">
              MACRO PARAMETERS
              <span className="ml-2 text-[8px] text-[hsl(38,95%,50%)]">← CLICK VALUE TO EDIT</span>
            </div>
            <div className="bg-[#080808] border border-border px-3">
              <NumericInput label="FED FUNDS RATE"   value={params.fedRate}  unit="%" decimals={2} min={0}   max={15}  onChange={set("fedRate")} />
              <NumericInput label="CPI INFLATION"     value={params.cpi}      unit="%" decimals={2} min={-5}  max={20}  onChange={set("cpi")} />
              <NumericInput label="GDP GROWTH"        value={params.gdp}      unit="%" decimals={2} min={-10} max={15}  onChange={set("gdp")} />
              <NumericInput label="CRUDE OIL WTI $/bbl" value={params.oilPrice} unit="$" decimals={2} min={10} max={300} onChange={set("oilPrice")} />
              <NumericInput label="VIX FEAR INDEX"   value={params.vix}      unit=""  decimals={1} min={8}   max={90}  onChange={set("vix")} />
              <NumericInput label="USD INDEX (DXY)"  value={params.dxy}      unit=""  decimals={2} min={70}  max={140} onChange={set("dxy")} />
            </div>
            <div className="font-terminal text-[8px] text-muted-foreground/60 mt-1.5 px-0.5">
              Press Enter to confirm · Escape to cancel · Values auto-clamp to valid range
            </div>
          </div>

          {/* Recession Risk */}
          <div className={`border p-3 ${recessionColorBorder}`}>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-1">MODEL RECESSION PROBABILITY</div>
            <div className="flex items-end gap-3 mb-2">
              <span className={`font-terminal text-4xl font-bold tabular-nums ${recessionColorText}`}>
                {Math.round(impacts.recessionRisk)}%
              </span>
              <span className={`font-terminal text-[10px] mb-1 tracking-widest ${recessionColorText}`}>{recessionLabel}</span>
            </div>
            <div className="h-2 bg-[#1a1a1a] overflow-hidden">
              <div
                className="h-full transition-all duration-700"
                style={{
                  width: `${impacts.recessionRisk}%`,
                  backgroundColor: impacts.recessionRisk < 50 ? "hsl(142,71%,45%)" : "hsl(0,80%,55%)"
                }}
              />
            </div>
            <div className="font-terminal text-[8px] text-muted-foreground/60 mt-1.5">
              Derived from Fed rate, GDP growth, inflation spread & VIX
            </div>
          </div>
        </div>

        {/* ── RIGHT: Outputs ───────────────────────────────── */}
        <div className="overflow-y-auto scrollbar-thin p-4 space-y-4">
          {/* Impact cascade */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">ASSET CLASS IMPACT CASCADE</div>
            <div className="bg-[#080808] border border-border p-3 space-y-0.5">
              <ImpactBar label="GLOBAL EQUITY (S&P 500)"   value={impacts.equityAdj} />
              <ImpactBar label="SOVEREIGN BONDS (PRICE)"    value={impacts.bondAdj} />
              <ImpactBar label="USD STRENGTH (DXY)"         value={impacts.usdStrength} />
              <ImpactBar label="GOLD / SAFE HAVEN"          value={impacts.goldAdj} />
              <ImpactBar label="BITCOIN / CRYPTO"           value={impacts.btcAdj} max={50} />
              <ImpactBar label="OIL DEMAND SIGNAL"          value={impacts.oilDemand} />
            </div>
          </div>

          {/* Projected asset prices */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">PROJECTED ASSET PRICES</div>
            <div className="grid grid-cols-2 gap-1.5">
              {assets.map(asset => {
                const isUp = asset.changePct > 0;
                const isDown = asset.changePct < 0;
                const textCls  = isUp ? "text-[hsl(142,71%,55%)]" : isDown ? "text-[hsl(0,80%,60%)]" : "text-foreground";
                const borderCls= isUp ? "border-[hsl(142,71%,25%)]" : isDown ? "border-[hsl(0,80%,25%)]" : "border-border";
                const bgCls    = isUp ? "bg-[hsl(142,71%,5%)]" : isDown ? "bg-[hsl(0,80%,5%)]" : "bg-[#080808]";
                const display  =
                  asset.label === "10Y UST Yield" ? `${asset.adjusted.toFixed(2)}%` :
                  asset.label === "EUR/USD"        ? asset.adjusted.toFixed(4) :
                  asset.label === "USD/INR"        ? asset.adjusted.toFixed(2) :
                  asset.adjusted >= 1000           ? asset.adjusted.toLocaleString("en-US", { maximumFractionDigits: 0 }) :
                  asset.adjusted.toFixed(2);
                return (
                  <button
                    key={asset.label}
                    onClick={() => asset.sym && onSymbol(asset.sym)}
                    className={`p-3 border text-left hover:brightness-125 transition-all ${bgCls} ${borderCls}`}
                  >
                    <div className="font-terminal text-[8px] text-muted-foreground tracking-wider mb-1">{asset.label}</div>
                    <div className={`font-terminal text-base font-bold tabular-nums ${textCls}`}>{display}</div>
                    <div className={`font-terminal text-[9px] tabular-nums ${textCls}`}>
                      {isUp ? "▲" : isDown ? "▼" : "—"} {Math.abs(asset.changePct).toFixed(1)}%
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="font-terminal text-[8px] text-muted-foreground/50 leading-relaxed border border-border/30 p-2">
            MODELS ARE ILLUSTRATIVE. MACRO SENSITIVITIES ARE DERIVED FROM EMPIRICAL COEFFICIENTS. USE AS DIRECTIONAL GUIDANCE ONLY.
          </div>
        </div>
      </div>
    </div>
  );
}
