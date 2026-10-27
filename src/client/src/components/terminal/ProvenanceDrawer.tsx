import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, FileCheck2, RefreshCw, X } from "lucide-react";
import {
  FRESHNESS_LABELS, getEvidenceSnapshot, subscribeEvidence,
  type CalculationReceipt, type EvidenceSnapshot, type ProvenanceRecord,
} from "@/lib/terminalEvidence";
import { filterPublishedSources, safePublishedSourceUrl, summarizePublishedSources, type SourceReviewFilter } from "@/lib/sprintBSourceReview";

function ProvenanceCard({ item }: { item: ProvenanceRecord }) {
  const safeUrl = safePublishedSourceUrl(item.sourceUrl);
  return (
    <article className="border border-border bg-[#0b0b0b] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-terminal text-[10px] font-bold text-foreground">{item.label}</div>
          <div className="mt-1 break-words font-terminal text-xs text-muted-foreground">{item.provider ? `${item.provider} · ` : ""}{item.source}</div>
          {safeUrl && <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block break-all font-ui text-xs text-cyan-200 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">Open published source</a>}
        </div>
        <span className="border border-border px-2 py-1 font-terminal text-[7px] uppercase tracking-widest text-cyan-300">{FRESHNESS_LABELS[item.freshness]}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="border border-border/60 p-2"><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">RETRIEVED</div><div className="mt-1 font-terminal text-[8px] text-foreground">{item.retrievedAt ?? "Not reported"}</div></div>
        <div className="border border-border/60 p-2"><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">EFFECTIVE / AS-OF</div><div className="mt-1 font-terminal text-[8px] text-foreground">{item.effectiveAt ?? "Not reported"}</div></div>
      </div>
      {item.transformations.length > 0 && <div className="mt-3"><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">TRANSFORMATION PATH</div><ol className="mt-1 space-y-1">{item.transformations.map((step, index) => <li key={`${step.label}-${index}`} className="font-terminal text-[8px] text-foreground">{index + 1}. {step.label}{step.description ? <span className="text-muted-foreground"> — {step.description}</span> : null}</li>)}</ol></div>}
      {item.assumptions.length > 0 && <div className="mt-3"><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">ASSUMPTIONS</div><ul className="mt-1 space-y-1">{item.assumptions.map((value) => <li key={value} className="font-terminal text-[8px] text-muted-foreground">• {value}</li>)}</ul></div>}
      {item.conflicts.length > 0 && <div className="mt-3 border border-amber-500/30 bg-amber-500/[0.04] p-2"><div className="flex items-center gap-1.5 font-terminal text-[8px] text-amber-300"><AlertTriangle className="h-3 w-3" /> CONFLICTS / FALLBACKS</div>{item.conflicts.map((value) => <div key={value} className="mt-1 font-terminal text-[8px] text-muted-foreground">{value}</div>)}{item.fallbackSource && <div className="mt-1 font-terminal text-[8px] text-muted-foreground">Fallback: {item.fallbackSource}</div>}</div>}
      <div className="mt-3 flex items-center gap-1.5 font-terminal text-[8px] text-muted-foreground">
        {item.quality === "verified" ? <CheckCircle2 className="h-3 w-3 text-emerald-300" /> : item.quality === "warning" ? <AlertTriangle className="h-3 w-3 text-amber-300" /> : <Database className="h-3 w-3 text-cyan-300" />}
        QUALITY: {item.quality.toUpperCase()}
      </div>
    </article>
  );
}

function ReceiptCard({ receipt }: { receipt: CalculationReceipt }) {
  const sections: Array<[string, Readonly<Record<string, string | number | boolean | null>>]> = [
    ["INPUTS", receipt.inputs], ["PARAMETERS", receipt.parameters], ["OUTPUTS", receipt.outputs],
  ];
  return (
    <article className="border border-border bg-[#0b0b0b] p-3">
      <div className="flex items-start justify-between gap-2"><div><div className="font-terminal text-[10px] font-bold text-foreground">{receipt.label}</div><div className="mt-1 font-terminal text-[8px] text-muted-foreground">{receipt.engine}{receipt.engineVersion ? ` ${receipt.engineVersion}` : ""}{receipt.modelVersion ? ` · model ${receipt.modelVersion}` : ""}</div></div><FileCheck2 className="h-4 w-4 text-cyan-300" /></div>
      <div className="mt-2 font-terminal text-[7px] text-muted-foreground">REPRODUCIBILITY ID <span className="text-amber-300">{receipt.reproducibilityId}</span></div>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">{sections.map(([label, values]) => <div key={label} className="border border-border/60 p-2"><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div><div className="mt-1 space-y-1">{Object.entries(values).length ? Object.entries(values).map(([key, value]) => <div key={key} className="flex justify-between gap-2 font-terminal text-[7px]"><span className="truncate text-muted-foreground">{key}</span><span className="shrink-0 text-foreground">{String(value ?? "—")}</span></div>) : <div className="font-terminal text-[7px] text-muted-foreground">None reported</div>}</div></div>)}</div>
      {receipt.diagnostics.length > 0 && <div className="mt-3 font-terminal text-[8px] text-muted-foreground">Diagnostics: {receipt.diagnostics.join(" · ")}</div>}
      {receipt.warnings.length > 0 && <div className="mt-2 border border-amber-500/30 p-2 font-terminal text-[8px] text-amber-200">Warnings: {receipt.warnings.join(" · ")}</div>}
    </article>
  );
}

export default function ProvenanceDrawer({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<EvidenceSnapshot>(() => getEvidenceSnapshot());
  const [tab, setTab] = useState<"sources" | "receipts">("sources");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceReviewFilter>("all");
  const review = useMemo(() => summarizePublishedSources(snapshot.provenance), [snapshot.provenance]);
  const visibleSources = useMemo(() => filterPublishedSources(snapshot.provenance, query, filter), [snapshot.provenance, query, filter]);
  useEffect(() => subscribeEvidence(setSnapshot), []);

  return (
    <aside className="fixed bottom-0 right-0 top-0 z-[75] flex w-full max-w-xl flex-col border-l border-border bg-[#080808] shadow-2xl" aria-label="Evidence and provenance drawer">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3"><Database className="h-4 w-4 text-cyan-300" /><div className="min-w-0 flex-1"><div className="font-terminal text-[10px] font-bold tracking-widest text-foreground">EVIDENCE & PROVENANCE</div><div className="mt-1 font-terminal text-[8px] text-muted-foreground">Inspect real source metadata published by the active analytical surface.</div></div><button onClick={onClose} className="border border-border p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close evidence drawer"><X className="h-3.5 w-3.5" /></button></header>
      <nav className="flex border-b border-border" aria-label="Evidence sections">{(["sources", "receipts"] as const).map((item) => <button key={item} type="button" aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)} className={`min-h-11 flex-1 px-3 py-2 font-ui text-xs ${tab === item ? "bg-cyan-500/[0.06] text-cyan-300" : "text-muted-foreground hover:text-foreground"}`}>{item === "sources" ? `Sources (${snapshot.provenance.length})` : `Calculation receipts (${snapshot.receipts.length})`}</button>)}</nav>
      {tab === "sources" && <div className="space-y-3 border-b border-border/70 p-3">
        <p className="font-ui text-xs leading-5 text-muted-foreground">These counts describe published metadata, not independent verification, a source-quality score or a live feed.</p>
        <div className="grid grid-cols-2 gap-2 font-ui text-xs sm:grid-cols-4" aria-label="Published source review summary">
          <span className="rounded-lg border border-border/60 p-2">Recorded <strong className="block text-base text-foreground">{review.recorded}</strong></span>
          <span className="rounded-lg border border-border/60 p-2">Review flags <strong className="block text-base text-foreground">{review.review}</strong></span>
          <span className="rounded-lg border border-border/60 p-2">Stale / unknown <strong className="block text-base text-foreground">{review.stale}</strong></span>
          <span className="rounded-lg border border-border/60 p-2">As-of missing <strong className="block text-base text-foreground">{review.missingAsOf}</strong></span>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="min-w-40 flex-1 font-ui text-xs text-muted-foreground">Search recorded sources
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Source, provider or conflict"
              className="mt-1 min-h-11 w-full rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300" />
          </label>
          <label className="font-ui text-xs text-muted-foreground">Review lens
            <select value={filter} onChange={event => setFilter(event.target.value as SourceReviewFilter)}
              className="mt-1 min-h-11 w-full rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
              <option value="all">All sources</option>
              <option value="review">Needs review</option>
              <option value="stale">Stale / unavailable</option>
              <option value="no-as-of">Missing as-of</option>
            </select>
          </label>
        </div>
        <p role="status" className="font-ui text-xs text-muted-foreground">{visibleSources.length} of {review.recorded} recorded sources shown</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
        {tab === "sources" ? snapshot.provenance.length ? visibleSources.length ? <div className="space-y-2">{visibleSources.map((item) => <ProvenanceCard key={item.id} item={item} />)}</div> : <p role="status" className="rounded-lg border border-dashed border-border/70 p-5 font-ui text-sm text-muted-foreground">No published sources match this search and review filter. Clear filters to inspect all recorded sources.</p> : <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-border p-6 text-center"><RefreshCw className="h-5 w-5 text-muted-foreground" /><div className="mt-3 font-terminal text-[9px] text-foreground">NO SOURCE METADATA PUBLISHED YET</div><p className="mt-2 max-w-sm font-terminal text-[8px] leading-relaxed text-muted-foreground">This drawer does not invent provenance. Panels publish provider, freshness, lineage, assumptions, conflicts, and fallback information when they actually have it.</p></div> : snapshot.receipts.length ? <div className="space-y-2">{snapshot.receipts.map((receipt) => <ReceiptCard key={receipt.id} receipt={receipt} />)}</div> : <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-border p-6 text-center"><FileCheck2 className="h-5 w-5 text-muted-foreground" /><div className="mt-3 font-terminal text-[9px] text-foreground">NO CALCULATION RECEIPTS PUBLISHED YET</div><p className="mt-2 max-w-sm font-terminal text-[8px] leading-relaxed text-muted-foreground">Deterministic engines can publish inputs, parameters, outputs, diagnostics, warnings, versions, and reproducibility IDs here.</p></div>}
      </div>
    </aside>
  );
}
