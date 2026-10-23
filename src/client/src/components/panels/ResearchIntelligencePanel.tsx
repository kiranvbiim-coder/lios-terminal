import { useTerminalArtifactState, useTerminalArtifactSymbol, useTerminalArtifactContext } from "@/lib/terminalArtifactState";
import { useEffect, useState, type ReactNode } from "react";
import CompanyFundamentalsPanel from "./CompanyFundamentalsPanel";
import ConsensusIntelligencePanel from "./ConsensusIntelligencePanel";
import FilingIntelligencePanel from "./FilingIntelligencePanel";
import FinancialStatementsPanel from "./FinancialStatementsPanel";
import ResearchInvestigationPanel from "./ResearchInvestigationPanel";
import { InstitutionalWorkspaceShell, MethodologyCard } from "./workstations/InstitutionalWorkspaceShell";
import { WORKSTATION_DEFINITIONS } from "./workstations/workstationDefinitions";

type Section = "investigation" | "filings" | "consensus" | "financials" | "fundamentals" | "methodology";

interface Props {
  symbol: string;
  role: string;
  starterQuestion?: string;
  starterSymbol?: string;
}

export default function ResearchIntelligencePanel({ symbol, role, starterQuestion, starterSymbol }: Props) {
  const [section, setSection] = useTerminalArtifactState<Section>("ResearchIntelligencePanel.section", "investigation");
  const terminal = useTerminalArtifactContext();
  const [researchSymbol, setResearchSymbol] = useTerminalArtifactSymbol((terminal ? symbol : starterSymbol || symbol || "AAPL").trim().toUpperCase());
  const definition = WORKSTATION_DEFINITIONS.research;

  useEffect(() => {
    if (terminal) return;
    const next = (starterSymbol || symbol || "").trim().toUpperCase();
    if (next) setResearchSymbol(next);
  }, [starterSymbol, symbol]);

  let body: ReactNode;
  if (section === "filings") body = <FilingIntelligencePanel symbol={researchSymbol} onSymbol={setResearchSymbol} />;
  else if (section === "consensus") body = <ConsensusIntelligencePanel symbol={researchSymbol} role={role} />;
  else if (section === "financials") body = <FinancialStatementsPanel symbol={researchSymbol} />;
  else if (section === "fundamentals") body = <CompanyFundamentalsPanel symbol={researchSymbol} />;
  else if (section === "methodology") {
    body = (
      <div className="h-full overflow-y-auto scrollbar-thin p-4">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <MethodologyCard title="EVIDENCE CLASSES" detail="Research separates filing, news, official data, market data, model output, uploaded document, internal note, and claim evidence. A narrative note is not promoted to the same status as a filed or official observation." />
            <MethodologyCard title="SOURCE QUALITY" formula="Score = 0.30·Authority + 0.25·Directness + 0.15·Recency + 0.15·Corroboration + 0.15·Extraction Confidence" detail="The investigation engine stores the underlying quality dimensions so the score can be challenged instead of becoming a mysterious badge." />
            <MethodologyCard title="RELATIONSHIP GRAPH" detail="Evidence relationships are explicit: supports, contradicts, supersedes, derived_from, affects, and cites. This prevents a list of sources from being mistaken for a reasoned argument." />
            <MethodologyCard title="WHAT CHANGED" detail="Brief snapshots and evidence state support change detection: added, removed, modified, and newly stale evidence are different events and should trigger different analyst responses." />
            <MethodologyCard title="VARIANT PERCEPTION" detail="Consensus is kept as an external benchmark to the research thesis. It can challenge a view, but it is not silently blended into the evidence case or deterministic model output." />
            <MethodologyCard title="FINANCIAL GROUNDING" detail="Financial statements and fundamentals are first-class neighbors of the evidence case so research can reconcile narrative claims against operating and balance-sheet reality." />
          </div>
        </div>
      </div>
    );
  } else {
    body = <ResearchInvestigationPanel symbol={researchSymbol} role={role} starterQuestion={starterQuestion} starterSymbol={researchSymbol} />;
  }

  return (
    <InstitutionalWorkspaceShell definition={definition} activeSection={section} onSection={(next) => setSection(next as Section)} symbol={researchSymbol} status={{ label: "INTERNAL SOURCE-BOUND RESEARCH", tone: "ok" }}>
      {body}
    </InstitutionalWorkspaceShell>
  );
}
