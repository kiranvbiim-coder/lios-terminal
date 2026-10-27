/**
 * Read-only visual presentation of investigation evidence already returned by
 * the canonical /api/research/investigations/:id ledger. Reuses LIOS's existing
 * EvidencePrism expand-to-inspect pattern; no fabricated excerpts, images,
 * relationships, or new evidence store.
 */
import * as React from "react";
import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight, BookOpenText, ChevronDown, ChevronUp, FileText,
  GitCompareArrows, Newspaper, ShieldCheck, StickyNote,
} from "lucide-react";
import { safeHref } from "@/lib/chatMarkdown";

export interface ResearchEvidenceRecord {
  id: number;
  evidenceType: string;
  evidenceKind: string;
  title: string;
  excerpt: string | null;
  annotation: string | null;
  sourceName: string;
  provider: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  effectiveAt: string | null;
  retrievedAt: string;
}

function date(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

/** A publisher URL must come from this exact recorded evidence, never a provider homepage guess. */
export function recordedEvidenceHttpUrl(value: string | null): string | null {
  if (!value) return null;
  const safe = safeHref(value);
  return safe && /^https?:\/\//i.test(safe) ? safe : null;
}

export function evidenceDateLabels(item: Pick<ResearchEvidenceRecord, "publishedAt" | "effectiveAt" | "retrievedAt">) {
  return {
    published: date(item.publishedAt),
    effective: date(item.effectiveAt),
    retrieved: date(item.retrievedAt),
  };
}

export function filterResearchEvidence<T extends Pick<ResearchEvidenceRecord, "title" | "excerpt" | "sourceName" | "provider" | "evidenceType" | "evidenceKind">>(
  items: readonly T[], query: string, kind: string,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(item =>
    (kind === "all" || item.evidenceType === kind) &&
    (!needle || [item.title, item.excerpt, item.sourceName, item.provider, item.evidenceKind]
      .some(value => value?.toLocaleLowerCase().includes(needle))),
  );
}

function EvidenceIcon({ type }: { type: string }) {
  const Icon = type === "filing" ? FileText : type === "news" ? Newspaper
    : type === "internal_note" ? StickyNote : BookOpenText;
  return <Icon className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />;
}

export function ResearchEvidenceCard({
  item, score, selectedForCompare, onCompare, annotationControls,
}: {
  item: ResearchEvidenceRecord;
  score: number;
  selectedForCompare: boolean;
  onCompare: () => void;
  annotationControls?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const reduceMotion = useReducedMotion();
  const link = recordedEvidenceHttpUrl(item.sourceUrl);
  const dates = evidenceDateLabels(item);
  return (
    <motion.article
      initial={false}
      whileHover={reduceMotion ? undefined : { y: -1 }}
      transition={{ type: "spring", stiffness: 350, damping: 28 }}
      className={`min-w-0 overflow-hidden rounded-xl border bg-card/65 shadow-sm transition-colors ${selectedForCompare
        ? "border-amber-300/55"
        : "border-border/60 hover:border-border"}`}
      data-research-evidence-card="true"
      data-evidence-id={item.id}
    >
      <div className="p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-amber-300/[0.06] text-amber-200">
            <EvidenceIcon type={item.evidenceType} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-ui text-[11px]">
              <span className="rounded border border-border/65 px-2 py-0.5 font-semibold text-foreground">{item.evidenceType.replaceAll("_", " ")}</span>
              <span className="text-muted-foreground">{item.evidenceKind.replaceAll("_", " ")}</span>
              <time dateTime={item.publishedAt || item.retrievedAt} className="ml-auto text-muted-foreground">{dates.published !== "Not recorded" ? dates.published : dates.retrieved}</time>
            </div>
            <h3 className="mt-2 font-ui text-[15px] font-semibold leading-snug text-foreground">{item.title}</h3>
            <p className="mt-1.5 line-clamp-1 font-ui text-xs text-muted-foreground">{item.sourceName}{item.provider && item.provider !== item.sourceName ? ` · ${item.provider}` : ""}</p>
          </div>
        </div>
        {item.excerpt && <p className="mt-3 line-clamp-3 border-l-2 border-amber-300/35 pl-3 font-ui text-sm leading-6 text-foreground/85">{item.excerpt}</p>}
        {item.annotation && <p className="mt-3 line-clamp-2 rounded-lg bg-white/[0.025] px-3 py-2 font-ui text-xs leading-5 text-foreground/80">Analyst note · {item.annotation}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.035] px-2 py-1 font-ui text-[11px] text-muted-foreground" title="Weighted recorded source-quality rubric; not independent verification">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-200" aria-hidden="true" />
            Source-quality rubric {score}/100
          </span>
          <span className="font-ui text-[11px] text-muted-foreground">Evidence E{item.id}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
          <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(value => !value)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border/70 px-3 font-ui text-xs font-medium text-foreground hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
            {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
            {open ? "Less detail" : "Inspect evidence"}
          </button>
          <button type="button" aria-pressed={selectedForCompare} onClick={onCompare}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 font-ui text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${selectedForCompare ? "border-amber-300/60 bg-amber-300/[0.08] text-amber-200" : "border-border/70 text-foreground hover:bg-white/[0.05]"}`}>
            <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
            {selectedForCompare ? "Selected" : "Compare"}
          </button>
          {link && <a href={link} target="_blank" rel="noopener noreferrer"
            className="ml-auto inline-flex min-h-10 items-center gap-1.5 px-2 font-ui text-xs text-cyan-200 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
            Open recorded source <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>}
          {!link && <span className="ml-auto font-ui text-[11px] text-muted-foreground">No verified source URL recorded</span>}
        </div>
        {annotationControls}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={detailsId} role="region" aria-label={`Evidence details for ${item.title}`}
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-border/50">
            <div className="space-y-3 p-4">
              <h4 className="font-ui text-xs font-semibold text-muted-foreground">Recorded source context</h4>
              {item.excerpt ? <p className="whitespace-pre-wrap break-words font-ui text-sm leading-7 text-foreground/90">{item.excerpt}</p> : <p className="font-ui text-xs text-muted-foreground">No excerpt recorded for this evidence.</p>}
              <dl className="grid gap-3 rounded-lg bg-white/[0.025] p-3 sm:grid-cols-2 font-ui text-xs">
                {[
                  ["Publisher / source", item.sourceName],
                  ["Provider", item.provider],
                  ["Published", dates.published],
                  ["Effective", dates.effective],
                  ["Retrieved", dates.retrieved],
                ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-foreground">{value || "Not recorded"}</dd></div>)}
              </dl>
              <p className="font-ui text-[11px] text-muted-foreground">This is retained evidence context. A source-quality score is not proof that a claim is correct.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

export interface RecordedEvidenceMetadataDifference {
  key: "evidenceType" | "evidenceKind" | "sourceName" | "provider" | "publishedAt" | "effectiveAt" | "retrievedAt";
  label: string;
  first: string;
  second: string;
  status: "same" | "different" | "missing";
}

/** Literal recorded metadata only. Different fields are not claims of
 * contradicting research conclusions; missing is never an implied value. */
export function compareRecordedEvidenceMetadata(
  first: ResearchEvidenceRecord,
  second: ResearchEvidenceRecord,
): RecordedEvidenceMetadataDifference[] {
  const columns: Array<{ key: RecordedEvidenceMetadataDifference["key"]; label: string }> = [
    { key: "evidenceType", label: "Evidence type" },
    { key: "evidenceKind", label: "Evidence kind" },
    { key: "sourceName", label: "Recorded source" },
    { key: "provider", label: "Provider" },
    { key: "publishedAt", label: "Published at" },
    { key: "effectiveAt", label: "Effective at" },
    { key: "retrievedAt", label: "Retrieved at" },
  ];
  return columns.map(({ key, label }) => {
    const left = first[key];
    const right = second[key];
    const isDate = key === "publishedAt" || key === "effectiveAt" || key === "retrievedAt";
    const normalize = (value: string | null): string =>
      !value?.trim() ? "Not recorded"
        : isDate ? (Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "Not recorded")
        : value;
    const a = normalize(left), b = normalize(right);
    const missing = a === "Not recorded" || b === "Not recorded";
    return { key, label, first: a, second: b,
      status: missing ? "missing" : a === b ? "same" : "different" };
  });
}

export function ResearchEvidenceComparison({ first, second, onClear }: {
  first: ResearchEvidenceRecord;
  second: ResearchEvidenceRecord;
  onClear: () => void;
}) {
  return (
    <section aria-label="Compare recorded research evidence" data-testid="research-evidence-side-by-side"
      className="rounded-2xl border border-amber-300/30 bg-amber-300/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-ui text-sm font-semibold text-foreground">
          <GitCompareArrows className="h-4 w-4 text-amber-200" aria-hidden="true" /> Compare recorded evidence
        </h3>
        <button type="button" onClick={onClear} className="min-h-10 rounded border border-border/70 px-3 font-ui text-xs text-foreground hover:bg-white/[0.05]">Clear selection</button>
      </div>
      <p className="mt-2 font-ui text-xs text-muted-foreground">Side-by-side source facts only; no inferred agreement, contradiction or verification.</p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border/55" role="region" aria-label="Aligned recorded evidence metadata" tabIndex={0}>
        <table className="w-full min-w-[460px] table-fixed text-left font-ui text-xs">
          <caption className="sr-only">Literal recorded metadata comparison; different fields do not establish conflicting claims.</caption>
          <thead className="bg-background/80">
            <tr><th scope="col" className="w-[29%] p-2">Recorded field</th>
              <th scope="col" className="w-[28%] p-2">E{first.id}</th>
              <th scope="col" className="w-[28%] p-2">E{second.id}</th>
              <th scope="col" className="w-[15%] p-2">Match</th></tr>
          </thead>
          <tbody>{compareRecordedEvidenceMetadata(first, second).map(row =>
            <tr key={row.key} data-metadata-comparison={row.status} className="border-t border-border/40">
              <th scope="row" className="break-words p-2 font-medium text-muted-foreground">{row.label}</th>
              <td className="break-words p-2 text-foreground">{row.first}</td>
              <td className="break-words p-2 text-foreground">{row.second}</td>
              <td className="p-2 text-muted-foreground">{row.status === "different" ? "Differs" : row.status === "missing" ? "Missing" : "Same"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-ui text-xs leading-5 text-muted-foreground">Matches compare exact recorded metadata, not research conclusions. Different dates, providers or evidence kinds do not imply contradiction or independent confirmation.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {[first, second].map(item => {
          const href = recordedEvidenceHttpUrl(item.sourceUrl);
          const dates = evidenceDateLabels(item);
          return <article key={item.id} className="min-w-0 space-y-2 rounded-xl border border-border/60 bg-background/70 p-4">
            <p className="font-ui text-[11px] font-semibold uppercase text-amber-200">Evidence E{item.id} · {item.evidenceKind}</p>
            <h4 className="font-ui text-sm font-semibold leading-6 text-foreground">{item.title}</h4>
            <p className="font-ui text-xs text-muted-foreground">{item.sourceName} · Published {dates.published} · Retrieved {dates.retrieved}</p>
            <p className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words font-ui text-sm leading-6 text-foreground/85">{item.excerpt || "No recorded excerpt"}</p>
            {item.annotation && <p className="border-l border-amber-300/40 pl-2 font-ui text-xs text-foreground/85">Analyst note · {item.annotation}</p>}
            {href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 font-ui text-xs text-cyan-200 underline underline-offset-2">Open recorded source <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></a>}
          </article>;
        })}
      </div>
    </section>
  );
}
