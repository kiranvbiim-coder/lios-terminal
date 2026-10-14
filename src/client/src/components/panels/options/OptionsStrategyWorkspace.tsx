import { Layers3, ShieldCheck, Sparkles, Target, TrendingUp } from "lucide-react";

import { AdvancedRatesDerivativesRunner } from "@/lib/advancedRatesDerivatives";

interface Props {
  symbol: string;
}

const strategyFamilies = [
  { name: "DIRECTIONAL", examples: "Long/short call · long/short put · vertical spreads", purpose: "Express directional convexity with explicit premium and strike risk." },
  { name: "VOLATILITY", examples: "Straddle · strangle · butterflies · condors", purpose: "Compare realized-move requirements against premium paid/received." },
  { name: "HEDGE", examples: "Protective put · covered call · collars", purpose: "Shape downside, upside participation and premium budget around an underlying position." },
  { name: "RELATIVE VALUE", examples: "Synthetic forwards · box structures · parity", purpose: "Inspect replication, implied financing and consistency rather than directional opinion." },
];

export default function OptionsStrategyWorkspace({ symbol }: Props) {
  return (
    <div className="h-full overflow-auto scrollbar-thin bg-[#050505] text-foreground">
      <div className="border-b border-border bg-[#070707] px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers3 className="w-4 h-4 text-violet-400" />
            <span className="font-terminal text-[10px] font-bold tracking-[0.16em]">OPTIONS STRATEGY LAB</span>
            <span className="font-terminal text-[9px] text-muted-foreground">{symbol}</span>
          </div>
          <div className="flex items-center gap-1 font-terminal text-[8px] text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" /> DETERMINISTIC LEGS · EDITABLE INPUTS
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {strategyFamilies.map((family, index) => (
            <div key={family.name} className="border border-border bg-[#080808] p-3">
              <div className="flex items-center gap-1.5 font-terminal text-[8px] font-bold tracking-wider text-muted-foreground">
                {index === 0 ? <TrendingUp className="w-3.5 h-3.5 text-cyan-400" /> : index === 1 ? <Sparkles className="w-3.5 h-3.5 text-amber-400" /> : <Target className="w-3.5 h-3.5 text-violet-400" />}
                {family.name}
              </div>
              <div className="mt-2 font-terminal text-[9px] text-foreground">{family.examples}</div>
              <div className="mt-2 font-terminal text-[7px] leading-relaxed text-muted-foreground">{family.purpose}</div>
            </div>
          ))}
        </div>

        <div className="border border-border bg-[#070707] p-3">
          <div className="font-terminal text-[8px] font-bold tracking-wider text-amber-300">WORKFLOW</div>
          <div className="mt-1 font-terminal text-[8px] leading-relaxed text-muted-foreground">
            Define or edit legs → enter/resolve premiums and volatility assumptions → calculate payoff and portfolio Greeks → stress spot/volatility → compare break-evens and max-risk geometry. Use RISK & HEDGE for hedge-ratio solving, parity, synthetic-forward and financing diagnostics.
          </div>
        </div>

        <AdvancedRatesDerivativesRunner
          title="STRATEGY PAYOFF · PORTFOLIO GREEKS · VOLATILITY / SURFACE CHECKS"
          modelPaths={[
            "derivatives/strategy-payoff",
            "derivatives/portfolio-greeks",
            "derivatives/implied-volatility",
            "derivatives/surface-arbitrage",
            "derivatives/local-volatility",
          ]}
        />
      </div>
    </div>
  );
}
