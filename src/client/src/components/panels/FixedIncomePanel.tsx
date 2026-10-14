import { useState, type ReactNode } from "react";
import type { ViewMode } from "@/lib/terminalTypes";
import FixedIncomeLegacyPanel from "./FixedIncomeLegacyPanel";
import YieldCurvePanel from "./YieldCurvePanel";
import { InstitutionalWorkspaceShell, MethodologyCard, WorkstationOverview } from "./workstations/InstitutionalWorkspaceShell";
import { WORKSTATION_DEFINITIONS } from "./workstations/workstationDefinitions";

type Section = "overview" | "curves" | "bonds" | "methodology";

interface Props {
  onSymbol: (symbol: string) => void;
  onNav?: (view: ViewMode) => void;
}

export default function FixedIncomePanel({ onSymbol, onNav }: Props) {
  const [section, setSection] = useState<Section>("overview");
  const definition = WORKSTATION_DEFINITIONS.fixedIncome;
  const navigate = onNav ?? (() => undefined);

  let body: ReactNode;
  if (section === "curves") body = <YieldCurvePanel onNav={navigate} onSymbol={onSymbol} />;
  else if (section === "bonds") {
    body = (
      <div className="h-full min-h-0 flex flex-col bg-[#050505]">
        <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.035] px-3 py-2 font-terminal text-[7.5px] leading-4 text-muted-foreground">
          <span className="font-bold tracking-widest text-amber-300">SCENARIO INPUT BOUNDARY:</span> the embedded US/India sovereign curve baseline levels and CDS discount-rate proxy in this inherited panel are model/scenario assumptions, not current observed curves. Use <span className="font-bold text-foreground">LIVE CURVES</span> for source-backed curve data.
        </div>
        <div className="flex-1 min-h-0 overflow-hidden"><FixedIncomeLegacyPanel onSymbol={onSymbol} /></div>
      </div>
    );
  } else if (section === "methodology") {
    body = (
      <div className="h-full overflow-y-auto scrollbar-thin p-4">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="border border-amber-500/30 bg-amber-500/[0.035] p-3 font-terminal text-[8px] leading-4 text-muted-foreground">
            <span className="font-bold tracking-widest text-amber-300">SOURCE BOUNDARY:</span> the dedicated LIVE CURVES section is the observed/source-backed curve surface. The inherited Bond/Credit/Rates panel also contains US and India curve-shift presets used as scenario baselines. Those preset curve levels are assumptions for shock analysis, not a claim that they are the current sovereign curve.
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <MethodologyCard title="BOND PRICE" formula="P = Σ CFₜ / (1 + y/m)^t" detail="Coupon and principal cash flows are discounted at the entered yield with the selected payment frequency. The production panel calculates the live result." />
            <MethodologyCard title="MACAULAY / MODIFIED DURATION" formula="D_Mac = Σ(t·PV(CFₜ))/P  ·  D_Mod = D_Mac/(1+y/m)" detail="Duration is a first-order rate sensitivity measure. Modified duration approximates percentage price change for a small yield move." />
            <MethodologyCard title="CONVEXITY" formula="Convexity ≈ Σ[t(t+1)·PV(CFₜ)] / [P(1+y/m)²m²]" detail="Convexity provides the second-order correction to duration and matters more for larger rate moves or longer-duration instruments." />
            <MethodologyCard title="CDS HAZARD APPROXIMATION" formula="Survival(t) = e^(−λt)  ·  Fair Spread = Protection Leg / Premium Leg" detail="The inherited CDS calculator uses quarterly survival/default increments and an explicit recovery assumption. A discount-rate proxy inside that calculator is a model assumption and should not be interpreted as a sourced current funding curve." />
            <MethodologyCard title="KEY-RATE / OAS / IMMUNIZATION" detail="The institutional fixed-income controls reuse deterministic fixed-income engines for spread analytics, key-rate risk, duration immunization, callable OAS, FRNs, inflation-linked bonds, and credit-spread curves." note="These are preserved as existing engine paths; the workstation does not create a second pricing engine." />
            <MethodologyCard title="RATES DERIVATIVES" detail="Interest-rate swap and Black swaption paths remain available in the inherited rates-derivatives runner with manual terms clearly separated from observed market data." />
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <WorkstationOverview
        definition={definition}
        onSection={(next) => setSection(next as Section)}
        headline="Observed curves and scenario curves are no longer visually conflated."
        description="Use the dedicated live curve desk first, then move to bond/credit/rates analytics. The inherited panel still provides duration, convexity, CDS, spread/OAS, key-rate, immunization, FRN, inflation-linked, swap, and swaption capability; this workstation makes the source versus scenario boundary explicit."
        trustItems={[
          "LIVE CURVES is the source-backed rate-curve surface.",
          "Inherited US/India curve levels in the shock panel are scenario presets, not current observations.",
          "Bond, duration, convexity, CDS, spread, OAS, and rates-derivative engines remain deterministic.",
          "Manual instrument terms and discount/recovery assumptions remain visible rather than being presented as provider data.",
        ]}
      />
    );
  }

  return (
    <InstitutionalWorkspaceShell definition={definition} activeSection={section} onSection={(next) => setSection(next as Section)} status={{ label: section === "curves" ? "OBSERVED CURVE SURFACE" : "SOURCE / SCENARIO SPLIT", tone: "ok" }}>
      {body}
    </InstitutionalWorkspaceShell>
  );
}
