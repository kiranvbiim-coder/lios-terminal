import { useTerminalArtifactContext, useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useEffect, useState } from "react";
import { Activity, BookOpen, Gauge, Layers, Target } from "lucide-react";
import { loadTerminalViewState, patchTerminalViewState } from "@/lib/terminalViewState";

import OptionsPanelInstitutional from "./OptionsPanelInstitutional";
import OptionsRiskHedgePanel from "./OptionsRiskHedgePanel";
import OptionsModelWorkbench, { type OptionsModelView } from "./options/OptionsModelWorkbench";
import OptionsStrategyWorkspace from "./options/OptionsStrategyWorkspace";

interface Props {
  symbol: string;
}

type Workspace = "chain" | OptionsModelView | "hedging" | "strategies";

const workspaceTabs: Array<{
  id: Workspace;
  label: string;
  description: string;
  icon: typeof Activity;
  activeClass: string;
}> = [
  { id: "chain", label: "CHAIN", description: "Pricing grid, Greeks, live chain and contract audit", icon: Activity, activeClass: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  { id: "analytics", label: "ANALYTICS", description: "Contract diagnostics, probabilities, validation and spot-vol scenarios", icon: Gauge, activeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" },
  { id: "formulas", label: "FORMULAS", description: "Symbolic equations, substituted inputs, model outputs and conventions", icon: BookOpen, activeClass: "border-amber-500/40 bg-amber-500/10 text-amber-200" },
  { id: "hedging", label: "RISK & HEDGE", description: "Portfolio Greeks, hedge solving, parity, synthetic forwards and funding", icon: Target, activeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" },
  { id: "strategies", label: "STRATEGIES", description: "Editable option legs, payoff geometry and portfolio-Greek analysis", icon: Layers, activeClass: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
];

const WORKSPACE_IDS = new Set<Workspace>(workspaceTabs.map((tab) => tab.id));

function initialWorkspace(symbol: string): Workspace {
  const value = loadTerminalViewState("options", symbol).workspace;
  return typeof value === "string" && WORKSPACE_IDS.has(value as Workspace) ? value as Workspace : "chain";
}

export default function OptionsPanel({ symbol }: Props) {
  const terminal = useTerminalArtifactContext();
  const [workspace, setWorkspace] = useTerminalArtifactState<Workspace>("OptionsPanel.workspace", () => terminal ? "chain" : initialWorkspace(symbol));

  useEffect(() => {
    if (!terminal) patchTerminalViewState("options", symbol, { workspace });
  }, [symbol, workspace]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="shrink-0 border-b border-border bg-[#060606]">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none px-3 py-1.5">
          {workspaceTabs.map((tab) => {
            const Icon = tab.icon;
            const selected = workspace === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setWorkspace(tab.id)}
                title={tab.description}
                aria-label={`${tab.label}: ${tab.description}`}
                className={`shrink-0 flex items-center gap-1.5 border px-2.5 py-1.5 font-terminal text-[8px] tracking-widest transition-colors ${selected ? tab.activeClass : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"}`}
              >
                <Icon className="w-3 h-3" /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {workspace === "chain" && <OptionsPanelInstitutional symbol={symbol} />}
        {(workspace === "analytics" || workspace === "formulas") && <OptionsModelWorkbench symbol={symbol} view={workspace} />}
        {workspace === "hedging" && <OptionsRiskHedgePanel symbol={symbol} />}
        {workspace === "strategies" && <OptionsStrategyWorkspace symbol={symbol} />}
      </div>
    </div>
  );
}
