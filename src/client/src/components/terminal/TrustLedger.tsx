import { useEffect, useMemo, useState } from "react";
import { Database, FileCheck2, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { getEvidenceSnapshot, subscribeEvidence, type EvidenceSnapshot, FRESHNESS_LABELS } from "@/lib/terminalEvidence";
import { buildTrustLedger } from "@/lib/terminalTrustLedger";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";

interface Props { onClose: () => void }

function scoreTone(score: number): string {
  if (score >= 85) return "text-emerald-300";
  if (score >= 65) return "text-cyan-300";
  if (score >= 35) return "text-[hsl(38,100%,60%)]";
  return "text-red-300";
}

export default function TrustLedger({ onClose }: Props) {
  const [evidence, setEvidence] = useState<EvidenceSnapshot>(() => getEvidenceSnapshot());
  useEffect(() => subscribeEvidence(setEvidence), []);
  const ledger = useMemo(() => buildTrustLedger(evidence), [evidence]);

  return (
    <div className="fixed inset-0 z-[96] bg-black/84 p-3 backdrop-blur-[5px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(820px,calc(100vh-24px))] w-full max-w-6xl flex-col overflow-hidden border" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Trust Ledger">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center border border-cyan-400/25 bg-cyan-400/[.04]"><ShieldCheck className="h-4 w-4 text-cyan-300" /></div>
          <div className="min-w-0 flex-1"><div className="text-[11px] font-bold tracking-[.14em]">ANALYTICAL TRUST LEDGER</div><div className="mt-1 text-[8px] text-muted-foreground">PROVENANCE · FRESHNESS · RECEIPTS · REPRODUCIBILITY · EXPLICIT GAPS</div></div>
          <button onClick={() => openTerminalUxSurface("evidence")} className="lios-v5-hero-action"><Database className="h-3 w-3 text-cyan-300" /> EVIDENCE</button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[310px_minmax(0,1fr)]">
          <aside className="border-r border-border/60 bg-black/20 p-4">
            <div className="border border-border/70 bg-white/[.012] p-4 text-center">
              <div className="text-[7px] font-bold tracking-[.14em] text-muted-foreground">COVERAGE SCORE</div>
              <div className={`mt-3 text-5xl font-bold tabular-nums ${scoreTone(ledger.coverageScore)}`}>{ledger.coverageScore}</div>
              <div className="mt-2 text-[8px] font-bold tracking-widest text-foreground">{ledger.grade.toUpperCase()}</div>
              <p className="mt-3 text-[7px] leading-relaxed text-muted-foreground">This measures published evidence and reproducibility coverage. It is not a claim that the analytical conclusion is correct.</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="border border-border/60 p-2.5"><div className="text-[6.5px] text-muted-foreground">SOURCES</div><div className="mt-1 text-lg font-bold">{ledger.sourceCount}</div></div>
              <div className="border border-border/60 p-2.5"><div className="text-[6.5px] text-muted-foreground">RECEIPTS</div><div className="mt-1 text-lg font-bold">{ledger.receiptCount}</div></div>
              <div className="border border-border/60 p-2.5"><div className="text-[6.5px] text-muted-foreground">WARNINGS</div><div className={`mt-1 text-lg font-bold ${ledger.warningCount ? "text-orange-300" : "text-foreground"}`}>{ledger.warningCount}</div></div>
              <div className="border border-border/60 p-2.5"><div className="text-[6.5px] text-muted-foreground">CONFLICTS</div><div className={`mt-1 text-lg font-bold ${ledger.conflictCount ? "text-red-300" : "text-foreground"}`}>{ledger.conflictCount}</div></div>
            </div>
            <div className="mt-4"><div className="text-[7px] font-bold tracking-widest text-muted-foreground">FRESHNESS MIX</div><div className="mt-2 space-y-1">{Object.entries(ledger.freshness).filter(([, count]) => count > 0).map(([freshness, count]) => <div key={freshness} className="flex items-center justify-between border border-border/55 px-2 py-1.5 text-[7px]"><span>{FRESHNESS_LABELS[freshness as keyof typeof FRESHNESS_LABELS].toUpperCase()}</span><span className="text-cyan-300">{count}</span></div>)}</div></div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4 scrollbar-thin">
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{ledger.components.map((component) => <div key={component.id} className="border border-border/65 bg-white/[.012] p-3"><div className="text-[6.5px] font-bold tracking-widest text-muted-foreground">{component.label}</div><div className={`mt-2 text-2xl font-bold tabular-nums ${scoreTone(component.score)}`}>{Math.round(component.score)}</div><div className="mt-2 text-[7px] leading-relaxed text-muted-foreground">{component.detail}</div></div>)}</section>

            <section className="mt-4 border border-border/70"><div className="flex items-center gap-2 border-b border-border/60 bg-[#080808] px-3 py-2"><FileCheck2 className="h-3 w-3 text-cyan-300" /><div className="text-[8px] font-bold tracking-widest">PROVENANCE RECORDS</div></div>{evidence.provenance.length ? <div className="divide-y divide-border/55">{evidence.provenance.map((record) => <div key={record.id} className="grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_110px_100px]"><div><div className="text-[8px] font-bold">{record.label}</div><div className="mt-1 text-[7px] text-muted-foreground">{record.source}{record.provider ? ` · ${record.provider}` : ""}</div>{record.conflicts.length > 0 && <div className="mt-1 text-[6.5px] text-red-300">{record.conflicts.length} CONFLICTS</div>}</div><div className="text-[7px] text-cyan-300">{record.freshness.toUpperCase()}</div><div className="text-[7px] text-muted-foreground">{record.quality.toUpperCase()}</div></div>)}</div> : <div className="p-5 text-center text-[7px] text-muted-foreground">NO PROVENANCE PUBLISHED BY THIS SURFACE</div>}</section>

            <section className="mt-4 border border-border/70"><div className="flex items-center gap-2 border-b border-border/60 bg-[#080808] px-3 py-2"><Database className="h-3 w-3 text-[hsl(38,100%,60%)]" /><div className="text-[8px] font-bold tracking-widest">CALCULATION RECEIPTS</div></div>{evidence.receipts.length ? <div className="divide-y divide-border/55">{evidence.receipts.map((receipt) => <div key={receipt.id} className="grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_120px_160px]"><div><div className="text-[8px] font-bold">{receipt.label}</div><div className="mt-1 text-[7px] text-muted-foreground">{receipt.engine}{receipt.engineVersion ? ` · v${receipt.engineVersion}` : ""} · {Object.keys(receipt.outputs).length} OUTPUTS</div>{receipt.warnings.length > 0 && <div className="mt-1 text-[6.5px] text-orange-300">{receipt.warnings.length} WARNINGS</div>}</div><div className="text-[7px] text-muted-foreground">{receipt.modelVersion ?? "MODEL VERSION —"}</div><div className="truncate text-[7px] text-cyan-300" title={receipt.reproducibilityId}>{receipt.reproducibilityId || "NO REPRODUCIBILITY ID"}</div></div>)}</div> : <div className="p-5 text-center text-[7px] text-muted-foreground">NO CALCULATION RECEIPTS PUBLISHED BY THIS SURFACE</div>}</section>

            <section className="mt-4 border border-border/70 p-3"><div className="flex items-center gap-2 text-[8px] font-bold tracking-widest"><TriangleAlert className="h-3 w-3 text-orange-300" /> COVERAGE GAPS</div><div className="mt-3 space-y-1.5">{ledger.gaps.length ? ledger.gaps.map((gap) => <div key={gap} className="border border-orange-500/15 bg-orange-500/[.02] p-2 text-[7px] text-orange-200">{gap}</div>) : <div className="border border-emerald-500/20 bg-emerald-500/[.025] p-2 text-[7px] text-emerald-300">NO COVERAGE GAPS DETECTED BY THIS LEDGER</div>}</div></section>
          </main>
        </div>
      </section>
    </div>
  );
}
