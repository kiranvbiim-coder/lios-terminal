import { useMemo } from "react";
import { Activity, Crosshair, Gauge, ShieldQuestion } from "lucide-react";
import ChallengeAssumption from "@/components/quant/ChallengeAssumption";
import { runInstitutionalDcf, type InstitutionalDcfInput } from "@/lib/institutionalDcf";
import {
  buildDcfDriverImpacts,
  buildDcfSensitivitySurface,
  solveReverseDcfExplicitGrowth,
  solveReverseDcfTerminalGrowth,
} from "@/lib/institutionalDcfDiagnostics";

interface Props {
  input: InstitutionalDcfInput;
  currency: string;
}

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

function money(value: number | null, currency: string) {
  return finite(value) ? `${currency}${value.toFixed(2)}` : "—";
}

function pct(value: number | null, digits = 1) {
  return finite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%` : "—";
}

export default function InstitutionalDcfDiagnosticsPanel({ input, currency }: Props) {
  const sensitivity = useMemo(() => buildDcfSensitivitySurface(input), [input]);
  const reverseGrowth = useMemo(() => solveReverseDcfExplicitGrowth(input), [input]);
  const reverseTerminal = useMemo(() => solveReverseDcfTerminalGrowth(input), [input]);
  const driverImpacts = useMemo(() => buildDcfDriverImpacts(input), [input]);
  const base = useMemo(() => runInstitutionalDcf(input), [input]);
  const firstYearGrowth = input.years[0]?.revenueGrowthPct ?? 0;
  const challengeResults = useMemo(() => [0, -5, -10].map(shift => {
    const result = runInstitutionalDcf({
      ...input,
      years: input.years.map((year, index) => ({
        ...year,
        revenueGrowthPct: index === 0 ? year.revenueGrowthPct + shift : year.revenueGrowthPct,
      })),
    });
    return {
      testedValue: `${(firstYearGrowth + shift).toFixed(1)}%`,
      outputLabel: "Intrinsic Value / Share",
      outputValue: money(result.valuePerShare, currency),
    };
  }), [currency, firstYearGrowth, input]);

  const sortedImpacts = [...driverImpacts].sort((a, b) => Math.abs(b.impactPct ?? 0) - Math.abs(a.impactPct ?? 0));
  const currentDiscount = input.cashFlowMode === "fcff"
    ? (input.discount.terminalWaccPct ?? input.discount.currentWaccPct)
    : (input.discount.terminalCostOfEquityPct ?? input.discount.currentCostOfEquityPct);

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-3">
        <div className="border border-border/70 bg-[#080808] overflow-x-auto">
          <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-amber-400" />
            <div>
              <div className="font-terminal text-[9px] tracking-widest">TWO-WAY DCF SENSITIVITY</div>
              <div className="font-terminal text-[7px] text-muted-foreground mt-0.5">Terminal growth × terminal {input.cashFlowMode === "fcff" ? "WACC" : "cost of equity"}; every cell reruns the same deterministic engine.</div>
            </div>
          </div>
          <table className="w-full min-w-[620px] font-terminal text-[8px] tabular-nums">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="p-2 text-left">TG \ RATE</th>
                {sensitivity.discountRatesPct.map(rate => <th key={rate} className="p-2 text-center">{rate.toFixed(2)}%</th>)}
              </tr>
            </thead>
            <tbody>
              {sensitivity.cells.map((row, rowIndex) => (
                <tr key={sensitivity.terminalGrowthRatesPct[rowIndex]} className="border-b border-border/30">
                  <td className="p-2 text-cyan-300">{sensitivity.terminalGrowthRatesPct[rowIndex].toFixed(2)}%</td>
                  {row.map(cell => {
                    const isBase = Math.abs(cell.discountRatePct - currentDiscount) < 0.001
                      && Math.abs(cell.terminalGrowthPct - input.terminal.growthPct) < 0.001;
                    return (
                      <td key={`${cell.discountRatePct}-${cell.terminalGrowthPct}`} className={`p-2 text-center ${isBase ? "bg-amber-500/10 text-amber-300" : finite(cell.upsidePct) && cell.upsidePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {money(cell.valuePerShare, currency)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border border-border/70 bg-[#080808]">
          <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2">
            <Crosshair className="w-3.5 h-3.5 text-cyan-300" />
            <span className="font-terminal text-[9px] tracking-widest">REVERSE DCF · MARKET-IMPLIED EXPECTATIONS</span>
          </div>
          <div className="p-3 space-y-2 font-terminal">
            <div className="border border-border/60 p-2.5">
              <div className="text-[7px] text-muted-foreground">UNIFORM EXPLICIT GROWTH SHOCK REQUIRED TO MATCH SPOT</div>
              <div className={`text-[16px] mt-1 ${reverseGrowth.status === "solved" ? "text-amber-300" : "text-muted-foreground"}`}>
                {reverseGrowth.status === "solved" && finite(reverseGrowth.solvedValue) ? `${reverseGrowth.solvedValue >= 0 ? "+" : ""}${reverseGrowth.solvedValue.toFixed(2)} pp` : reverseGrowth.status.toUpperCase()}
              </div>
              <div className="text-[7px] text-muted-foreground mt-1 leading-relaxed">{reverseGrowth.detail}</div>
            </div>
            <div className="border border-border/60 p-2.5">
              <div className="text-[7px] text-muted-foreground">PERPETUAL GROWTH IMPLIED BY SPOT</div>
              <div className={`text-[16px] mt-1 ${reverseTerminal.status === "solved" ? "text-cyan-300" : "text-muted-foreground"}`}>
                {reverseTerminal.status === "solved" && finite(reverseTerminal.solvedValue) ? `${reverseTerminal.solvedValue.toFixed(2)}%` : reverseTerminal.status.toUpperCase()}
              </div>
              <div className="text-[7px] text-muted-foreground mt-1 leading-relaxed">{reverseTerminal.detail}</div>
            </div>
            <div className="text-[7px] text-muted-foreground">Target spot: {money(input.spotPrice, currency)} · Base DCF: {money(base.valuePerShare, currency)}. Reverse DCF is an implication solver, not a forecast.</div>
          </div>
        </div>
      </section>

      <section className="border border-border/70 bg-[#080808]">
        <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-violet-300" />
          <span className="font-terminal text-[9px] tracking-widest">KEY DRIVER IMPACT · ONE-AT-A-TIME LOCAL SHOCKS</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-border/30">
          {sortedImpacts.map(impact => (
            <div key={impact.driver} className="bg-[#080808] p-3 font-terminal">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[8px] tracking-widest text-muted-foreground">{impact.label}</span>
                <span className={`text-[10px] ${finite(impact.absoluteImpactPerShare) && impact.absoluteImpactPerShare >= 0 ? "text-emerald-400" : "text-red-400"}`}>{finite(impact.absoluteImpactPerShare) ? `${impact.absoluteImpactPerShare >= 0 ? "+" : ""}${currency}${impact.absoluteImpactPerShare.toFixed(2)}` : "—"}</span>
              </div>
              <div className="mt-1 text-[7px] text-muted-foreground">{impact.shock}</div>
              <div className="mt-2 h-1 bg-black border border-border/40 overflow-hidden">
                <div className="h-full bg-current opacity-70" style={{ width: `${Math.min(100, Math.abs(impact.impactPct ?? 0) * 5)}%` }} />
              </div>
              <div className="mt-1 text-[7px] text-muted-foreground">Impact on model value {pct(impact.impactPct)}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="border border-border/70 bg-[#080808] p-3">
        <div className="flex items-center gap-2 mb-2"><ShieldQuestion className="w-3.5 h-3.5 text-amber-400" /><span className="font-terminal text-[9px] tracking-widest">ASSUMPTION CHALLENGER</span></div>
        <div className="font-terminal text-[7px] text-muted-foreground mb-2">The deterministic DCF calculates all tested values first. The optional internal AI layer receives only these computed outcomes and may critique the assumption; it never calculates valuation numbers.</div>
        <ChallengeAssumption assumptionLabel="Year-1 revenue growth" assumptionValue={`${firstYearGrowth.toFixed(1)}%`} results={challengeResults} />
      </div>
    </div>
  );
}
