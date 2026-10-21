import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { Shield, Calculator, AlertTriangle, Info } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";
import { kellyAllocation } from "@/lib/riskMath";

interface Props { onNav: (v: ViewMode) => void; }

function NumInput({ label, value, onChange, unit = "", hint = "" }: { label: string; value: number; onChange: (v: number) => void; unit?: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between font-terminal text-[8px]">
        <span className="text-muted-foreground">{label}</span>
        {hint && <span className="text-muted-foreground/50">{hint}</span>}
      </div>
      <div className="flex items-center border border-border bg-[#0c0c0c] focus-within:border-[hsl(38,95%,50%)/50%]">
        <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} step="any"
          className="flex-1 px-2.5 py-1.5 bg-transparent font-terminal text-[11px] text-foreground focus:outline-none tabular-nums" />
        {unit && <span className="px-2 font-terminal text-[9px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

function ResultRow({ label, value, cls = "", sub = "" }: { label: string; value: string; cls?: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/30">
      <div>
        <div className="font-terminal text-[9px] text-muted-foreground">{label}</div>
        {sub && <div className="font-terminal text-[7.5px] text-muted-foreground/60">{sub}</div>}
      </div>
      <span className={`font-terminal text-[11px] font-bold tabular-nums ${cls || "text-foreground"}`}>{value}</span>
    </div>
  );
}

export default function RiskCalcPanel({ onNav }: Props) {
  const [tab, setTab] = useTerminalArtifactState<"kelly"|"fixed"|"var"|"ev">("RiskCalcPanel.tab", "kelly");

  // Kelly inputs
  const [winRate,  setWinRate] = useTerminalArtifactState("RiskCalcPanel.winRate", 55);
  const [avgWin,   setAvgWin] = useTerminalArtifactState("RiskCalcPanel.avgWin", 2.0);
  const [avgLoss,  setAvgLoss] = useTerminalArtifactState("RiskCalcPanel.avgLoss", 1.0);
  const [portfolio,setPortfolio] = useTerminalArtifactState("RiskCalcPanel.portfolio", 100000);

  // Fixed fractional
  const [riskPct,   setRiskPct] = useTerminalArtifactState("RiskCalcPanel.riskPct", 1.0);
  const [entryPrice,setEntryPrice] = useTerminalArtifactState("RiskCalcPanel.entryPrice", 100);
  const [stopPrice, setStopPrice] = useTerminalArtifactState("RiskCalcPanel.stopPrice", 95);

  // VaR
  const [posSize,    setPosSize] = useTerminalArtifactState("RiskCalcPanel.posSize", 10000);
  const [dailyVol,   setDailyVol] = useTerminalArtifactState("RiskCalcPanel.dailyVol", 1.5);
  const [confidence, setConfidence] = useTerminalArtifactState("RiskCalcPanel.confidence", 95);

  // Expected Value
  const [prob,   setProb] = useTerminalArtifactState("RiskCalcPanel.prob", 60);
  const [reward, setReward] = useTerminalArtifactState("RiskCalcPanel.reward", 300);
  const [risk,   setRisk] = useTerminalArtifactState("RiskCalcPanel.risk", 100);

  // Kelly computations
  const kelly = useMemo(() => {
    const result = kellyAllocation({ winProbability: winRate / 100, averageWinR: avgWin, averageLossR: avgLoss });
    const fraction = result?.fraction ?? 0;
    const halfFraction = fraction / 2;
    const capital = Number.isFinite(portfolio) && portfolio > 0 ? portfolio : 0;
    const fullDollar = fraction * capital;
    const halfDollar = halfFraction * capital;
    const sharesAtEntry = entryPrice > 0 && Number.isFinite(entryPrice) ? Math.floor(fullDollar / entryPrice) : 0;
    return { valid: result !== null, K: fraction * 100, half: halfFraction * 100, fullDollar, halfDollar, sharesAtEntry };
  }, [winRate, avgWin, avgLoss, portfolio, entryPrice]);

  // Fixed fractional
  const fixed = useMemo(() => {
    const riskAmt = portfolio * riskPct / 100;
    const stopDist = Math.abs(entryPrice - stopPrice);
    const shares = stopDist > 0 ? Math.floor(riskAmt / stopDist) : 0;
    const posVal  = shares * entryPrice;
    const posWt   = portfolio > 0 ? (posVal / portfolio) * 100 : 0;
    return { riskAmt, shares, posVal, posWt };
  }, [portfolio, riskPct, entryPrice, stopPrice]);

  // VaR
  const varCalc = useMemo(() => {
    const z = confidence >= 99 ? 2.326 : confidence >= 97.5 ? 1.96 : confidence >= 95 ? 1.645 : 1.28;
    const var1d = posSize * (dailyVol / 100) * z;
    const var5d = var1d * Math.sqrt(5);
    const var21d = var1d * Math.sqrt(21);
    return { var1d, var5d, var21d, z };
  }, [posSize, dailyVol, confidence]);

  // Expected Value
  const ev = useMemo(() => {
    const W = prob / 100;
    const expected = W * reward - (1 - W) * risk;
    const rr = reward / (risk || 1);
    const breakEven = risk / (reward + risk) * 100;
    return { expected, rr, breakEven };
  }, [prob, reward, risk]);

  const tabs = [
    { id: "kelly" as const, label: "KELLY CRITERION" },
    { id: "fixed" as const, label: "FIXED FRACTIONAL" },
    { id: "var"   as const, label: "VALUE AT RISK" },
    { id: "ev"    as const, label: "EXPECTED VALUE" },
  ];

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Shield className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">POSITION SIZING & RISK CALCULATOR</span>
        <ProvenanceBadge compact details={{ kind: "computed", method: "Deterministic risk arithmetic", inputs: ["analyst-entered portfolio and strategy statistics"], logic: "Kelly uses f*=(p×b−q)/b where b=average win / average loss. Negative edge is floored to zero. Parametric VaR is a separate normal-return approximation.", limitations: ["Kelly is highly sensitive to probability/payoff estimation error", "Kelly output is an allocation fraction, not a guaranteed maximum loss", "Parametric VaR can understate fat-tail risk"] }} />
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">RISK</span>
      </div>

      {/* Tab row */}
      <div className="shrink-0 flex border-b border-border bg-[#060606]">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-2 font-terminal text-[8px] tracking-wider transition-all border-r border-border last:border-r-0 ${tab === t.id ? "bg-[hsl(38,95%,50%)/10%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>{t.label}</button>
        ))}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Inputs */}
        <div className="w-80 shrink-0 border-r border-border bg-[#060606] p-5 space-y-4 overflow-y-auto scrollbar-thin">
          <div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-3">PORTFOLIO</div>
            <NumInput label="PORTFOLIO SIZE" value={portfolio} onChange={setPortfolio} unit="$" />
          </div>

          {tab === "kelly" && (
            <div className="space-y-3">
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">STRATEGY STATISTICS</div>
              <NumInput label="WIN RATE"         value={winRate}  onChange={setWinRate}  unit="%" hint="Historical %" />
              <NumInput label="AVG WIN (R multiple)" value={avgWin}  onChange={setAvgWin}  unit="R" hint="e.g. 2 = 2R win" />
              <NumInput label="AVG LOSS (R multiple)" value={avgLoss} onChange={setAvgLoss} unit="R" hint="Usually 1.0" />
              <NumInput label="ENTRY PRICE (for shares)" value={entryPrice} onChange={setEntryPrice} unit="$" />
            </div>
          )}
          {tab === "fixed" && (
            <div className="space-y-3">
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">TRADE PARAMETERS</div>
              <NumInput label="RISK PER TRADE"  value={riskPct}    onChange={setRiskPct}    unit="%" hint="1–2% recommended" />
              <NumInput label="ENTRY PRICE"      value={entryPrice} onChange={setEntryPrice} unit="$" />
              <NumInput label="STOP LOSS PRICE"  value={stopPrice}  onChange={setStopPrice}  unit="$" />
            </div>
          )}
          {tab === "var" && (
            <div className="space-y-3">
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">POSITION PARAMETERS</div>
              <NumInput label="POSITION SIZE"    value={posSize}     onChange={setPosSize}     unit="$" />
              <NumInput label="DAILY VOLATILITY" value={dailyVol}    onChange={setDailyVol}    unit="%" hint="σ of daily returns" />
              <NumInput label="CONFIDENCE LEVEL" value={confidence}  onChange={setConfidence}  unit="%" hint="95 or 99" />
            </div>
          )}
          {tab === "ev" && (
            <div className="space-y-3">
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">TRADE SETUP</div>
              <NumInput label="WIN PROBABILITY"  value={prob}   onChange={setProb}   unit="%" />
              <NumInput label="POTENTIAL REWARD" value={reward} onChange={setReward} unit="$" hint="Target gain" />
              <NumInput label="POTENTIAL RISK"   value={risk}   onChange={setRisk}   unit="$" hint="Max loss" />
            </div>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 p-5 overflow-y-auto scrollbar-thin space-y-5">
          {tab === "kelly" && (
            <>
              <div>
                <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-3">KELLY CRITERION RESULTS</div>
                <div className="bg-[#080808] border border-border p-4 space-y-0">
                  <ResultRow label="FULL KELLY ALLOCATION" value={`${kelly.K.toFixed(2)}%`} cls={kelly.K > 25 ? "text-[hsl(0,80%,60%)]" : "text-[hsl(142,71%,55%)]"} sub="theoretical capital fraction under stated binary-payoff assumptions" />
                  <ResultRow label="HALF-KELLY ALLOCATION" value={`${kelly.half.toFixed(2)}%`} cls="text-[hsl(38,95%,55%)]" />
                  <ResultRow label="FULL KELLY AMOUNT" value={`$${kelly.fullDollar.toLocaleString("en-US",{maximumFractionDigits:0})}`} />
                  <ResultRow label="HALF-KELLY AMOUNT" value={`$${kelly.halfDollar.toLocaleString("en-US",{maximumFractionDigits:0})}`} cls="text-[hsl(38,95%,55%)] font-bold" />
                  <ResultRow label="SHARES AT ENTRY PRICE" value={`${kelly.sharesAtEntry} shares`} />
                </div>
              </div>
              <div className="flex items-start gap-2 bg-[hsl(38,95%,10%)] border border-[hsl(38,95%,25%)] p-3 text-[8.5px] font-terminal text-[hsl(38,95%,60%)]">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                <span>Kelly maximizes expected log growth only when the estimated win probability and payoff ratio are accurate and the payoff model is appropriate. Fractional Kelly reduces sensitivity to estimation error. Formula: f* = (p·b − q) / b, where b = Avg Win / Avg Loss.</span>
              </div>
            </>
          )}

          {tab === "fixed" && (
            <div>
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-3">FIXED FRACTIONAL RESULTS</div>
              <div className="bg-[#080808] border border-border p-4 space-y-0">
                <ResultRow label="MAX RISK IN DOLLARS"  value={`$${fixed.riskAmt.toFixed(2)}`} cls="text-[hsl(0,80%,60%)]" sub={`${riskPct}% of $${portfolio.toLocaleString()}`} />
                <ResultRow label="STOP DISTANCE"        value={`$${Math.abs(entryPrice - stopPrice).toFixed(2)}/share`} />
                <ResultRow label="SHARES TO BUY"        value={`${fixed.shares} shares`} cls="text-[hsl(142,71%,55%)] text-xl" />
                <ResultRow label="POSITION VALUE"       value={`$${fixed.posVal.toLocaleString("en-US",{maximumFractionDigits:0})}`} />
                <ResultRow label="POSITION WEIGHT"      value={`${fixed.posWt.toFixed(1)}%`} cls={fixed.posWt > 20 ? "text-[hsl(0,80%,60%)]" : "text-foreground"} sub="% of portfolio" />
              </div>
            </div>
          )}

          {tab === "var" && (
            <div>
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-3">VALUE AT RISK (PARAMETRIC)</div>
              <div className="bg-[#080808] border border-border p-4 space-y-0">
                <ResultRow label={`1-DAY VaR @${confidence}%`}  value={`-$${varCalc.var1d.toFixed(0)}`} cls="text-[hsl(0,80%,60%)]" sub={`Z = ${varCalc.z}`} />
                <ResultRow label={`5-DAY VaR @${confidence}%`}  value={`-$${varCalc.var5d.toFixed(0)}`} cls="text-[hsl(0,80%,60%)]" />
                <ResultRow label={`21-DAY VaR @${confidence}%`} value={`-$${varCalc.var21d.toFixed(0)}`} cls="text-[hsl(0,80%,60%)]" />
                <ResultRow label="AS % OF POSITION"             value={`${(varCalc.var1d / posSize * 100).toFixed(2)}% / day`} />
              </div>
              <div className="font-terminal text-[8px] text-muted-foreground/70 mt-2 leading-relaxed">
                Parametric VaR assumes normal distribution of returns. Actual tail risk may be larger (fat tails). Use as directional guidance only.
              </div>
            </div>
          )}

          {tab === "ev" && (
            <div>
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-3">EXPECTED VALUE ANALYSIS</div>
              <div className="bg-[#080808] border border-border p-4 space-y-0">
                <ResultRow label="EXPECTED VALUE PER TRADE" value={`${ev.expected >= 0 ? "+" : ""}$${ev.expected.toFixed(2)}`}
                  cls={ev.expected >= 0 ? "text-[hsl(142,71%,55%)] text-xl" : "text-[hsl(0,80%,60%)] text-xl"} />
                <ResultRow label="RISK : REWARD RATIO"      value={`1 : ${ev.rr.toFixed(2)}`} />
                <ResultRow label="BREAK-EVEN WIN RATE"      value={`${ev.breakEven.toFixed(1)}%`} sub={prob >= ev.breakEven ? "Your win rate exceeds break-even ✓" : "⚠ Win rate below break-even"} cls={prob >= ev.breakEven ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,55%)]"} />
              </div>
              <div className={`mt-3 p-3 border font-terminal text-[9px] leading-relaxed ${ev.expected >= 0 ? "border-[hsl(142,71%,25%)] text-[hsl(142,71%,60%)] bg-[hsl(142,71%,5%)]" : "border-[hsl(0,80%,25%)] text-[hsl(0,80%,60%)] bg-[hsl(0,80%,5%)]"}`}>
                {ev.expected >= 0
                  ? `✓ POSITIVE EDGE: This trade setup has a positive expected value of +$${ev.expected.toFixed(2)} per $${risk} risked. Take this trade if it fits your plan.`
                  : `✗ NEGATIVE EDGE: Expected value is -$${Math.abs(ev.expected).toFixed(2)}. Either improve win rate above ${ev.breakEven.toFixed(1)}% or increase reward:risk ratio.`}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
