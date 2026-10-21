import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, type ReactNode } from "react";
import type { ViewMode } from "@/lib/terminalTypes";
import AdvancedRiskPanel from "./AdvancedRiskPanel";
import PortfolioAttributionPanel from "./PortfolioAttributionPanel";
import PortfolioHoldingsPanel from "./PortfolioHoldingsPanel";
import PortfolioOptimizerPanel from "./PortfolioOptimizerPanel";
import PortfolioStressPanel from "./PortfolioStressPanel";
import RiskNetworkPanel from "./RiskNetworkPanel";
import { InstitutionalWorkspaceShell, MethodologyCard, WorkstationOverview } from "./workstations/InstitutionalWorkspaceShell";
import { WORKSTATION_DEFINITIONS } from "./workstations/workstationDefinitions";
import { useAudience } from "@/lib/audience";

type Section = "overview" | "holdings" | "optimizer" | "attribution" | "risk" | "stress" | "network" | "methodology";

interface Props {
  onSymbol: (symbol: string) => void;
  onNav?: (view: ViewMode) => void;
  symbol?: string;
  externalRiskMod?: number;
}

export default function PortfolioPanel({ onSymbol, onNav, symbol = "AAPL", externalRiskMod }: Props) {
  const isClient = useAudience() === "client";
  const [section, setSection] = useTerminalArtifactState<Section>("PortfolioPanel.section", "overview");
  const definition = WORKSTATION_DEFINITIONS.portfolio;
  const navigate = onNav ?? (() => undefined);

  if (isClient) {
    const retailSection = section === "attribution" ? "attribution" : "overview";
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#050505]" data-testid="portfolio-workspace" data-audience="retail">
        <header className="shrink-0 border-b border-border bg-[#090909]">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="font-ui text-[11px] font-semibold text-foreground">Portfolio</div>
            <div className="ml-auto font-ui text-[8px] text-muted-foreground">Client-safe analytics</div>
          </div>
          <nav className="flex overflow-x-auto border-t border-border/70 px-2" aria-label="Portfolio analysis">
            {([
              ["overview", "Overview"],
              ["attribution", "Attribution"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                aria-current={retailSection === id ? "page" : undefined}
                className={`shrink-0 border-b-2 px-3 py-2.5 font-ui text-[8px] font-semibold ${retailSection === id ? "border-amber-300 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          {retailSection === "attribution"
            ? <PortfolioAttributionPanel />
            : <PortfolioHoldingsPanel onSymbol={onSymbol} />}
        </div>
      </div>
    );
  }

  let body: ReactNode;
  if (section === "holdings") body = <PortfolioHoldingsPanel onSymbol={onSymbol} />;
  else if (section === "optimizer") body = <PortfolioOptimizerPanel onSymbol={onSymbol} externalRiskMod={externalRiskMod} />;
  else if (section === "attribution") body = <PortfolioAttributionPanel />;
  else if (section === "risk") body = <AdvancedRiskPanel symbol={symbol} />;
  else if (section === "stress") body = <PortfolioStressPanel onSymbol={onSymbol} onNav={navigate} />;
  else if (section === "network") body = <RiskNetworkPanel onSymbol={onSymbol} />;
  else if (section === "methodology") {
    body = (
      <div className="h-full overflow-y-auto scrollbar-thin p-4">
        <div className="mx-auto max-w-6xl space-y-3">
          <PortfolioRiskMethodologySummary />
          <div className="border border-amber-500/25 bg-amber-500/[0.025] p-3 font-terminal text-[8px] leading-4 text-muted-foreground">
            <span className="font-bold tracking-widest text-amber-300">STRESS CONVENTION:</span> named stress templates and editable shock matrices are scenario assumptions unless a specific engine explicitly sources a historical return series. They should not be read as a replay of exact historical constituent-level outcomes.
          </div>
          <div className="border border-cyan-500/20 bg-cyan-500/[0.025] p-3 font-terminal text-[8px] leading-4 text-muted-foreground">
            <span className="font-bold tracking-widest text-cyan-300">CURRENCY CONVENTION:</span> the holdings surface keeps native currencies separate when no FX normalization contract is available. Cross-currency totals must not be interpreted as one economic base-currency portfolio value unless an explicit FX conversion layer is applied.
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <WorkstationOverview
        definition={definition}
        onSection={(next) => setSection(next as Section)}
        headline="Portfolio construction and portfolio risk are one workflow now."
        description="Start with the actual holdings, move into construction, explain what drove performance, then measure tail/liquidity/credit risk and challenge the portfolio under stress. The existing specialist engines are preserved; this surface makes the hand-offs explicit instead of forcing users to discover six separate panels."
        trustItems={[
          "Native-currency holdings are not silently summed into a fictional blended base currency.",
          "Optimization, attribution, risk, stress, and network engines remain separate deterministic/statistical authorities.",
          "Stress scenarios are assumptions/scenarios unless a panel explicitly identifies an observed historical series.",
          "Advanced optimizer inputs that require factor, benchmark, tax-lot, or mandate data remain explicit rather than auto-invented.",
        ]}
      />
    );
  }

  return (
    <InstitutionalWorkspaceShell
      definition={definition}
      activeSection={section}
      onSection={(next) => setSection(next as Section)}
      symbol={symbol}
      status={{ label: "COMPOSED FROM EXISTING ENGINES", tone: "ok" }}
    >
      {body}
    </InstitutionalWorkspaceShell>
  );
}

export function PortfolioRiskMethodologySummary() {
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      <MethodologyCard title="PORTFOLIO VOLATILITY" formula="σₚ = √(wᵀΣw)" detail="Portfolio risk depends on both asset volatility and covariance. A low-volatility asset can still increase portfolio risk if its covariance structure is unfavorable." />
      <MethodologyCard title="VALUE AT RISK" formula="VaRα = quantileα(Loss)" detail="LIOS exposes parametric, historical, Monte Carlo, and EVT-oriented tail methods. VaR is a threshold, not the expected loss beyond that threshold." />
      <MethodologyCard title="EXPECTED SHORTFALL" formula="ESα = E[Loss | Loss ≥ VaRα]" detail="Expected Shortfall measures average loss in the tail beyond VaR and is therefore more informative for severe-loss magnitude." />
      <MethodologyCard title="ATTRIBUTION" formula="Active Return = Allocation + Selection + Interaction" detail="Brinson-style attribution explains where relative performance came from; factor/style views answer a different question and are kept separate." />
      <MethodologyCard title="BLACK-LITTERMAN" formula="Posterior = Equilibrium Prior + Confidence-weighted Views" detail="Black-Litterman blends equilibrium-implied returns with explicit investor views. View confidence and prior assumptions materially affect the result and remain visible in the optimizer." />
      <MethodologyCard title="COVARIANCE SHRINKAGE" detail="Ledoit-Wolf and Bayesian shrinkage stabilize noisy sample estimates. A more stable covariance estimate is still an estimate, not a guarantee that future dependence will match the sample." />
    </div>
  );
}
