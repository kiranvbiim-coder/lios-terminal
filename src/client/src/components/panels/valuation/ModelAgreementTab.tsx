import { useMemo } from "react";
import { buildValuationBridge, type ValuationMethodResult } from "@/lib/valuationEngines";

// Model Agreement: reconciles every valuation method actually available
// for this symbol (DCF worksheet, DDM, EVA, Residual Income, Comps) into a
// single confidence-weighted range via the shared buildValuationBridge()
// engine -- the same engine the Comps tab's own optional "blend" football
// field uses.
export interface ModelAgreementInputStatus {
  ready: boolean;
  missing: string[];
}

export function modelAgreementInputStatus(inputs: {
  price: number | null;
  sharesOut: number | null;
  methodCount: number;
}): ModelAgreementInputStatus {
  const missing: string[] = [];
  if (inputs.price == null || !Number.isFinite(inputs.price) || inputs.price <= 0) missing.push("market price");
  if (inputs.sharesOut == null || !Number.isFinite(inputs.sharesOut) || inputs.sharesOut <= 0) missing.push("shares outstanding");
  if (!Number.isFinite(inputs.methodCount) || inputs.methodCount <= 0) missing.push("computed valuation methods");
  return { ready: missing.length === 0, missing };
}

interface Props {
  symbol: string;
  curr: string;
  price: number;
  sharesOut: number;
  methods: ValuationMethodResult[];
}

export default function ModelAgreementTab({ symbol, curr, price, sharesOut, methods }: Props) {
  const bridge = useMemo(() => buildValuationBridge(methods, sharesOut), [methods, sharesOut]);
  const available = methods.filter(m => m.equityValue != null && m.equityValue > 0);

  const inputStatus = modelAgreementInputStatus({
    price,
    sharesOut,
    methodCount: available.length,
  });

  if (!inputStatus.ready) {
    return (
      <div className="flex-1 p-4">
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="font-semibold text-amber-200">MODEL AGREEMENT UNAVAILABLE — deterministic dependencies are incomplete.</div>
          <div className="mt-1 text-slate-300">Missing: {inputStatus.missing.join(", ")}. Compute valid valuation methods and market inputs, or use an explicit manual override.</div>
        </div>
      </div>
    );
  }

  const allVals = available.map(m => m.valuePerShare ?? 0).filter(v => v > 0);
  const globalMin = allVals.length ? Math.min(...allVals, price) : price;
  const globalMax = allVals.length ? Math.max(...allVals, price) : price;
  const span = globalMax - globalMin || 1;
  const pricePct = ((price - globalMin) / span) * 100;

  const uptxt = bridge.weightedValuePerShare >= price ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]";

  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      {available.length === 0 ? (
        <div className="bg-[hsl(20,90%,50%)/10%] border border-[hsl(20,90%,50%)/40%] p-3 font-terminal text-[9px] text-[hsl(20,90%,60%)]">
          No valuation methods have real computed values yet for {symbol}. Visit the DCF/FCF Worksheet, DDM, EVA, Residual Income, or Comps tabs to populate this bridge -- each reports its own computed value here once visited.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">WEIGHTED (BLENDED) VALUE / SHARE</span>
              <div className={`font-terminal text-[15px] font-bold tabular-nums ${uptxt}`}>{curr}{bridge.weightedValuePerShare.toFixed(2)}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">RANGE</span>
              <div className="font-terminal text-[13px] font-bold tabular-nums text-foreground">{curr}{bridge.rangeLow.toFixed(2)} – {curr}{bridge.rangeHigh.toFixed(2)}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">MARKET PRICE</span>
              <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{curr}{price.toFixed(2)}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">METHODS AGREEING (OF {methods.length})</span>
              <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{available.length}</div>
            </div>
          </div>

          <div className="bg-[#080808] border border-border p-4">
            <div className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-3">METHOD AGREEMENT — {symbol}</div>
            <div className="space-y-3">
              {available.map(m => {
                const val = m.valuePerShare ?? 0;
                const pct = ((val - globalMin) / span) * 100;
                return (
                  <div key={m.method}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-terminal text-[8px] text-muted-foreground">
                        {m.label} <span className="text-muted-foreground/50">({m.confidence.toUpperCase()})</span>
                      </span>
                      <span className="font-terminal text-[8px] text-foreground tabular-nums">{curr}{val.toFixed(2)}</span>
                    </div>
                    <div className="relative h-3 bg-[#050505] border border-border/50">
                      <div className="absolute h-full w-1 bg-[hsl(38,95%,55%)]" style={{ left: `${pct}%` }} />
                    </div>
                    {m.notes && <div className="font-terminal text-[6px] text-muted-foreground/50 mt-0.5">{m.notes}</div>}
                  </div>
                );
              })}
              <div className="relative h-3 mt-1">
                <div className="absolute h-full w-0.5 bg-[hsl(0,80%,60%)]" style={{ left: `${pricePct}%` }} />
              </div>
              <div className="font-terminal text-[7px] text-muted-foreground text-right">▏ = current price {curr}{price.toFixed(2)}</div>
            </div>
          </div>
        </>
      )}

      <div className="bg-[#080808] border border-border p-4 font-terminal text-[8px] text-muted-foreground space-y-1">
        <div className="text-foreground font-bold mb-1 tracking-widest">HOW THIS BRIDGE WORKS</div>
        <p>Each method's equity value is weighted by its confidence (High=3, Medium=2, Low=1) and averaged into a single blended value/share. The range is the min/max across every available method's own point estimate, not a statistical confidence interval.</p>
        <p>Methods only appear once their source tab has been visited and computed a real value for this symbol — nothing here is fabricated or backfilled with a placeholder.</p>
      </div>
    </div>
  );
}
