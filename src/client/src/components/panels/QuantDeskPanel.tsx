import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, type FormEvent } from "react";
import type { ViewMode } from "@/lib/terminalTypes";
import IsingPanel from "./IsingPanel";
import PortfolioPanel from "./PortfolioPanel";
import FixedIncomePanel from "./FixedIncomePanel";
import FractalPanel from "./FractalPanel";
import RiskNetworkPanel from "./RiskNetworkPanel";
import FilingIntelligencePanel from "./FilingIntelligencePanel";
import QuantumFinancePanel from "./QuantumFinancePanel";
import HawkesProcessPanel from "./HawkesProcessPanel";
import EntropyPanel from "./EntropyPanel";
import SynthesisFlowPanel from "./SynthesisFlowPanel";
import ValuationWorkspacePanel from "./workstations/ValuationWorkspacePanel";

interface Props {
  view: ViewMode;
  symbol: string;
  magnetization: number;
  setMagnetization: (mag: number) => void;
  orderIntensity: number;
  setOrderIntensity: (intensity: number) => void;
  linkIsingToQuantum: boolean;
  setLinkIsingToQuantum: (link: boolean) => void;
  linkHawkesToOptimizer: boolean;
  setLinkHawkesToOptimizer: (link: boolean) => void;
  onSymbol: (sym: string) => void;
  onNav: (v: ViewMode) => void;
}

const QUANT_VIEWS: Array<{ id: ViewMode; label: string; code: string; tier: "workstation" | "specialist" }> = [
  { id: "flow", label: "INTELLIGENCE FLOW", code: "FLOW", tier: "workstation" },
  { id: "valuation", label: "VALUATION", code: "VALU", tier: "workstation" },
  { id: "optimizer", label: "PORTFOLIO & RISK", code: "PORT", tier: "workstation" },
  { id: "fixedincome", label: "FIXED INCOME & CREDIT", code: "FI", tier: "workstation" },
  { id: "quantworkbench", label: "QUANT RESEARCH LAB", code: "QLAB", tier: "workstation" },
  { id: "filingintel", label: "FILING INTELLIGENCE", code: "FILG", tier: "workstation" },
  { id: "ising", label: "ISING HERD", code: "ISNG", tier: "specialist" },
  { id: "fractal", label: "CHAOS & VOL", code: "FRAC", tier: "specialist" },
  { id: "risknetwork", label: "RISK NETWORK", code: "RISK", tier: "specialist" },
  { id: "quantum", label: "QUANTUM PRICE", code: "QNTM", tier: "specialist" },
  { id: "hawkes", label: "HAWKES HFT", code: "HWKS", tier: "specialist" },
  { id: "entropy", label: "ENTROPY & LEAD", code: "INTR", tier: "specialist" },
];

export default function QuantDeskPanel({
  view,
  symbol,
  magnetization,
  setMagnetization,
  orderIntensity,
  setOrderIntensity,
  linkIsingToQuantum,
  setLinkIsingToQuantum,
  linkHawkesToOptimizer,
  setLinkHawkesToOptimizer,
  onSymbol,
  onNav,
}: Props) {
  const routedViews = QUANT_VIEWS.filter((item) => item.id !== "quantworkbench");
  const activeView = routedViews.some((qv) => qv.id === view) ? view : "flow";
  const [searchVal, setSearchVal] = useTerminalArtifactState("QuantDeskPanel.searchVal", "");

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const cleanSym = searchVal.trim().toUpperCase();
    if (cleanSym) {
      onSymbol(cleanSym);
      setSearchVal("");
    }
  };

  const renderActiveDesk = () => {
    switch (activeView) {
      case "flow":
        return (
          <SynthesisFlowPanel
            symbol={symbol}
            magnetization={magnetization}
            orderIntensity={orderIntensity}
            linkIsingToQuantum={linkIsingToQuantum}
            setLinkIsingToQuantum={setLinkIsingToQuantum}
            linkHawkesToOptimizer={linkHawkesToOptimizer}
            setLinkHawkesToOptimizer={setLinkHawkesToOptimizer}
            onNav={onNav}
          />
        );
      case "valuation":
        return <ValuationWorkspacePanel symbol={symbol} onSymbol={onSymbol} onNav={onNav} />;
      case "optimizer":
        return <PortfolioPanel onSymbol={onSymbol} onNav={onNav} symbol={symbol} externalRiskMod={linkHawkesToOptimizer ? orderIntensity : undefined} />;
      case "fixedincome":
        return <FixedIncomePanel onSymbol={onSymbol} onNav={onNav} />;
      case "filingintel":
        return <FilingIntelligencePanel symbol={symbol} onSymbol={onSymbol} />;
      case "ising":
        return <IsingPanel symbol={symbol} onUpdateMagnetization={setMagnetization} />;
      case "fractal":
        return <FractalPanel symbol={symbol} />;
      case "risknetwork":
        return <RiskNetworkPanel onSymbol={onSymbol} />;
      case "quantum":
        return <QuantumFinancePanel symbol={symbol} externalBarrierMod={linkIsingToQuantum ? magnetization : undefined} />;
      case "hawkes":
        return <HawkesProcessPanel onUpdateIntensity={setOrderIntensity} />;
      case "entropy":
        return <EntropyPanel symbol={symbol} />;
      default:
        return (
          <SynthesisFlowPanel
            symbol={symbol}
            magnetization={magnetization}
            orderIntensity={orderIntensity}
            linkIsingToQuantum={linkIsingToQuantum}
            setLinkIsingToQuantum={setLinkIsingToQuantum}
            linkHawkesToOptimizer={linkHawkesToOptimizer}
            setLinkHawkesToOptimizer={setLinkHawkesToOptimizer}
            onNav={onNav}
          />
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      <div className="flex flex-col gap-1.5 border-b border-border/60 bg-[#090909] px-3 py-1.5 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
            {QUANT_VIEWS.map((qv) => {
              const isActive = qv.id === activeView;
              return (
                <button
                  key={qv.id}
                  type="button"
                  onClick={() => onNav(qv.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 font-terminal text-[8.5px] tracking-widest transition-all rounded whitespace-nowrap border ${
                    isActive
                      ? "bg-amber-500 text-black font-bold border-amber-400"
                      : qv.tier === "workstation"
                        ? "text-foreground border-border/70 bg-white/[0.02] hover:border-amber-500/35 hover:bg-amber-500/[0.03]"
                        : "text-muted-foreground border-transparent hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  <span className="font-mono text-[7px] opacity-60">[{qv.code}]</span>
                  <span>{qv.label}</span>
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSearch} className="flex items-center gap-2 border border-border/70 bg-black/40 px-2 py-0.5 rounded font-terminal shrink-0 ml-auto sm:ml-0">
            <span className="text-[8px] text-muted-foreground tracking-widest uppercase">EVALUATING:</span>
            <span className="text-[10px] font-bold text-amber-500 select-none mr-1">{symbol}</span>
            <input
              type="text"
              placeholder="TICKER <GO>"
              value={searchVal}
              onChange={(event) => setSearchVal(event.target.value.toUpperCase())}
              className="bg-transparent text-[10px] text-[hsl(38,95%,60%)] placeholder:text-muted-foreground/50 focus:outline-none w-20 uppercase font-bold"
            />
            <button type="submit" className="text-[8px] px-1.5 py-0.5 bg-amber-500 text-black rounded font-bold hover:bg-amber-400 transition-colors">GO</button>
          </form>
        </div>
        <div className="font-terminal text-[7px] tracking-wider text-muted-foreground">
          <span className="text-foreground">WORKSTATIONS</span> are complete workflows. <span className="ml-2">SPECIALIST MODELS remain available without dominating the primary analytical path.</span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">{renderActiveDesk()}</div>
    </div>
  );
}
