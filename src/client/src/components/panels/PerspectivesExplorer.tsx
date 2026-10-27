/**
 * Perspectives is a read-only view over the *same* authorized research
 * investigations used by the Investigation ledger. Query keys intentionally
 * match the existing hooks so no second content store or permission path exists.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { BookOpenCheck, RefreshCw } from "lucide-react";
import { RecordedPerspectivesBoard } from "./RecordedPerspectivesBoard";

interface ResearchInvestigationSummary {
  id: number;
  title: string;
  primarySymbol: string | null;
  question: string;
  status: string;
}

interface ResearchInvestigationDetail extends ResearchInvestigationSummary {
  thesis: string | null;
  evidence: import("@/lib/researchPerspectives").PerspectiveEvidence[];
  relationships: import("@/lib/researchPerspectives").PerspectiveRelation[];
}

export default function PerspectivesExplorer({ symbol, onOpenInvestigation }: {
  symbol: string;
  onOpenInvestigation: () => void;
}) {
  // Same persisted selection key as the canonical Investigation panel.
  const [selectedId, setSelectedId] = useTerminalArtifactState<number | null>(
    "ResearchInvestigationPanel.selectedId", null,
  );
  const list = useQuery<ResearchInvestigationSummary[]>({
    queryKey: ["/api/research/investigations"],
    refetchOnWindowFocus: false,
  });
  const currentSymbol = symbol.trim().toUpperCase();
  const permittedSummaries = (list.data ?? []).filter(item =>
    !currentSymbol || !item.primarySymbol || item.primarySymbol.toUpperCase() === currentSymbol,
  );
  const activeId = permittedSummaries.some(item => item.id === selectedId)
    ? selectedId
    : permittedSummaries[0]?.id ?? null;
  const detail = useQuery<ResearchInvestigationDetail>({
    queryKey: [`/api/research/investigations/${activeId}`],
    enabled: activeId !== null,
    refetchOnWindowFocus: false,
  });
  // Do not render the previous Investigation's evidence during selection/loading.
  const selectedDetail = detail.data?.id === activeId ? detail.data : null;
  const canDisplay = activeId !== null && selectedDetail !== null && !detail.isFetching && !detail.isError;

  return <div className="flex h-full min-h-0 flex-col bg-[#050505] text-foreground">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/65 p-3 sm:p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="font-ui text-lg font-semibold">Perspectives and competing evidence</h2>
        <p className="font-ui text-xs leading-5 text-muted-foreground">Choose an authorized investigation to examine its recorded evidence relationships.</p>
      </div>
      <label className="flex min-w-0 flex-1 flex-col gap-1 font-ui text-xs text-muted-foreground sm:max-w-[420px]">
        Investigation
        <select
          value={activeId ?? ""}
          onChange={event => setSelectedId(Number(event.target.value))}
          disabled={!permittedSummaries.length || list.isFetching}
          aria-label="Select investigation for Perspectives Explorer"
          className="min-h-11 min-w-0 rounded-lg border border-border/70 bg-background px-3 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
          {!permittedSummaries.length && <option value="">No authorized investigations</option>}
          {permittedSummaries.map(item => <option key={item.id} value={item.id}>
            {item.title}{item.primarySymbol ? ` · ${item.primarySymbol}` : ""}
          </option>)}
        </select>
      </label>
      <button type="button" onClick={() => { void list.refetch(); if (activeId !== null) void detail.refetch(); }}
        disabled={list.isFetching || detail.isFetching}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border/65 px-3 font-ui text-xs text-foreground hover:bg-white/[0.045] disabled:opacity-50">
        <RefreshCw className="h-4 w-4" aria-hidden="true"/> Refresh
      </button>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" aria-label="Perspectives investigation evidence">
      {list.isLoading || (activeId !== null && detail.isLoading) ? (
        <p role="status" className="p-6 font-ui text-sm text-muted-foreground">Loading authorized research evidence…</p>
      ) : list.isError ? (
        <p role="alert" className="m-4 rounded-lg border border-amber-300/35 p-4 font-ui text-sm text-amber-200">Investigation list could not be loaded. No evidence comparisons are available. Retry when your session is ready.</p>
      ) : activeId === null ? (
        <div className="m-5 rounded-2xl border border-dashed border-border/65 p-7 text-center">
          <BookOpenCheck className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true"/>
          <h3 className="mt-3 font-ui text-sm font-semibold">No investigation in this research context</h3>
          <p className="mt-2 font-ui text-xs leading-5 text-muted-foreground">Create or select a research investigation first. Perspectives never invent source positions to populate an empty screen.</p>
          <button type="button" onClick={onOpenInvestigation} className="mt-4 min-h-10 rounded-lg border border-amber-300/30 px-4 font-ui text-sm text-amber-200">Open investigations</button>
        </div>
      ) : detail.isError ? (
        <p role="alert" className="m-4 rounded-lg border border-amber-300/35 p-4 font-ui text-sm text-amber-200">This investigation's evidence could not be read. No prior or unauthorized data is displayed. Refresh or open the investigation.</p>
      ) : !canDisplay ? (
        <p role="status" className="p-6 font-ui text-sm text-muted-foreground">Checking the selected investigation's recorded evidence…</p>
      ) : (
        <RecordedPerspectivesBoard key={activeId}
          title={selectedDetail.title}
          question={selectedDetail.question}
          thesis={selectedDetail.thesis}
          evidence={selectedDetail.evidence}
          relationships={selectedDetail.relationships}
          onOpenInvestigation={() => { setSelectedId(activeId); onOpenInvestigation(); }}
        />
      )}
    </main>
  </div>;
}
