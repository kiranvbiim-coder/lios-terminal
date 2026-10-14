import { useId, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useAudience } from "@/lib/audience";

export type ProvenanceKind = "computed" | "source" | "ai" | "human" | "model";

export interface ProvenanceDetails {
  kind: ProvenanceKind;
  source?: string;
  method?: string;
  modelVersion?: string;
  inputs?: string[];
  timestamp?: string;
  logic?: string;
  confidence?: string | number;
  limitations?: string | string[];
}

const META: Record<ProvenanceKind, { symbol: string; label: string; className: string }> = {
  computed: { symbol: "◆", label: "COMPUTED", className: "border-cyan-500/35 text-cyan-300 bg-cyan-500/[0.06]" },
  source: { symbol: "◇", label: "SOURCE DATA", className: "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.05]" },
  ai: { symbol: "✦", label: "AI ASSISTED", className: "border-fuchsia-500/30 text-fuchsia-300 bg-fuchsia-500/[0.05]" },
  human: { symbol: "◎", label: "HUMAN INPUT", className: "border-amber-500/30 text-amber-300 bg-amber-500/[0.05]" },
  model: { symbol: "▣", label: "MODEL OUTPUT", className: "border-sky-500/30 text-sky-300 bg-sky-500/[0.05]" },
};

function formatTimestamp(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 border-b border-border/50 py-2 last:border-b-0">
      <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">{label}</div>
      <div className="min-w-0 font-terminal text-[9px] leading-relaxed text-foreground/90">{value}</div>
    </div>
  );
}

export default function ProvenanceBadge({
  details,
  compact = false,
  className = "",
  retailVisible = false,
}: {
  details: ProvenanceDetails;
  compact?: boolean;
  className?: string;
  /**
   * Retail analytical surfaces are provenance-quiet by default. Opt in only
   * when source identity materially changes interpretation; full inspection
   * otherwise belongs in Data / Advanced.
   */
  retailVisible?: boolean;
}) {
  const isClient = useAudience() === "client";
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const meta = META[details.kind];
  const limitations = Array.isArray(details.limitations) ? details.limitations : details.limitations ? [details.limitations] : [];

  if (isClient && !retailVisible) return null;

  return (
    <>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-terminal font-semibold tracking-widest transition-colors hover:brightness-125 ${compact ? "text-[7px]" : "text-[8px]"} ${meta.className} ${className}`}
        aria-haspopup="dialog"
        aria-controls={panelId}
        title={`Inspect provenance: ${meta.label}`}
      >
        <span aria-hidden="true">{meta.symbol}</span>
        <span>{meta.label}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <section
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={`${meta.label} provenance`}
            className="w-full max-w-xl border border-border bg-[#090909] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center gap-2 border-b border-border bg-[#0c0c0c] px-4 py-3">
              <span className={`border px-1.5 py-0.5 font-terminal text-[8px] tracking-widest ${meta.className}`}>{meta.symbol} {meta.label}</span>
              <span className="ml-auto font-terminal text-[8px] tracking-widest text-muted-foreground">TRUST INSPECTOR</span>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close provenance inspector"><X className="h-4 w-4" /></button>
            </header>
            <div className="px-4 py-2">
              <DetailRow label="SOURCE" value={details.source} />
              <DetailRow label="METHOD" value={details.method} />
              <DetailRow label="VERSION" value={details.modelVersion} />
              <DetailRow label="INPUTS" value={details.inputs?.length ? details.inputs.join(" · ") : null} />
              <DetailRow label="TIMESTAMP" value={formatTimestamp(details.timestamp)} />
              <DetailRow label="LOGIC" value={details.logic} />
              <DetailRow label="CONFIDENCE" value={details.confidence} />
              <DetailRow label="LIMITATIONS" value={limitations.length ? limitations.map((item) => <div key={item}>• {item}</div>) : null} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function ProvenanceDisclosure({ details, label = "PROVENANCE" }: { details: ProvenanceDetails; label?: string }) {
  const [open, setOpen] = useState(false);
  const meta = META[details.kind];
  return (
    <div className="border border-border/70 bg-[#080808]">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className={`font-terminal text-[8px] font-semibold tracking-widest ${meta.className.split(" ").find((value) => value.startsWith("text-")) ?? "text-foreground"}`}>{meta.symbol} {meta.label}</span>
        <span className="ml-auto font-terminal text-[8px] tracking-widest text-muted-foreground">{label}</span>
        {open ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border/60 px-3 py-1"><DetailRow label="SOURCE" value={details.source} /><DetailRow label="METHOD" value={details.method} /><DetailRow label="INPUTS" value={details.inputs?.join(" · ")} /><DetailRow label="TIMESTAMP" value={formatTimestamp(details.timestamp)} /><DetailRow label="LOGIC" value={details.logic} /><DetailRow label="LIMITATIONS" value={Array.isArray(details.limitations) ? details.limitations.join(" · ") : details.limitations} /></div>}
    </div>
  );
}
