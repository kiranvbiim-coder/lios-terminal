/**
 * Recorded, inspectable Chat sources. Visual composition adapts beUI's
 * accessible citations/list idea to LiOS's canonical ChatCitationSource.
 * Donor: starc007/ui-components@41a330ba66684696c445d58ca5d77c0133d4059a
 * (components/agents/citations.tsx, MIT). No favicon trackers, implicit
 * provider homepage links, or independent source collection state.
 */
import * as React from "react";
import { useId, useState } from "react";
import { BookOpenText, ExternalLink, Globe2, ShieldCheck } from "lucide-react";
import { recordedCitationHref, type ChatCitationSource } from "@/lib/chatMarkdown";

const INITIAL_VISIBLE = 6;

/** Kept as an export for callers/tests that use the recorded-link contract. */
export const inspectableSourceHref = recordedCitationHref;

function RecordedSourceRow({ source }: { source: ChatCitationSource }) {
  const href = inspectableSourceHref(source);
  const host = href ? new URL(href).hostname : null;
  const icon = href ? <Globe2 aria-hidden="true" className="h-4 w-4" /> : <BookOpenText aria-hidden="true" className="h-4 w-4" />;
  const content = (
    <>
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-white/[0.025] text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-ui text-sm font-medium leading-5 text-foreground">{source.label}</span>
        <span className="mt-1 block break-words font-ui text-xs text-muted-foreground">
          {href ? "Link recorded" : "Reference only · no verified link"}
          {host && <span className="ml-1 opacity-80">· {host}</span>}
        </span>
      </span>
      {source.index !== undefined && (
        <span className="self-start rounded-md border border-border/60 px-1.5 py-0.5 font-ui text-xs font-medium tabular-nums text-muted-foreground" aria-label={`Citation ${source.index}`}>{source.index}</span>
      )}
      {href && <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const className = "group flex h-full min-h-16 w-full items-start gap-3 rounded-lg border border-border/60 bg-white/[0.018] px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70";
  return (
    <li className="min-w-0">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={`${className} hover:border-amber-200/35 hover:bg-white/[0.04]`} aria-label={`Open recorded source: ${source.label}`}>
          {content}
        </a>
      ) : (
        <div className={className} aria-label={`Recorded source reference: ${source.label}`}>{content}</div>
      )}
    </li>
  );
}

export default function ResearchSourceList({ sources }: { sources: readonly ChatCitationSource[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!sources.length) return null;
  const displayed = expanded ? sources : sources.slice(0, INITIAL_VISIBLE);
  const remaining = sources.length - INITIAL_VISIBLE;
  const linkedCount = sources.filter((source) => inspectableSourceHref(source) !== null).length;

  return (
    <section data-testid="trace-sources" aria-label="Sources used" className="space-y-3 rounded-xl border border-border/55 bg-white/[0.012] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-ui text-sm font-semibold text-foreground">
            <BookOpenText aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-200" />
            Recorded source references ({sources.length})
          </h3>
          <p className="mt-1 flex items-center gap-1.5 font-ui text-xs text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
            {linkedCount} recorded web {linkedCount === 1 ? "link" : "links"} · {sources.length - linkedCount} reference-only
          </p>
        </div>
        {remaining > 0 && (
          <button
            type="button"
            data-testid="trace-sources-expand"
            aria-controls={listId}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-border/65 px-3 py-2 font-ui text-xs font-medium text-foreground hover:border-amber-200/30 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
          >
            {expanded ? "Show fewer sources" : `Show all ${sources.length} sources`}
          </button>
        )}
      </div>
      <ul id={listId} className="grid min-w-0 gap-2 md:grid-cols-2" aria-label="Recorded source references">
        {displayed.map((source) => <RecordedSourceRow key={source.id} source={source} />)}
      </ul>
      {sources.length === 50 && (
        <p className="font-ui text-xs text-muted-foreground">
          Showing up to 50 recorded source references. Inspect the detailed trust evidence for additional context.
        </p>
      )}
    </section>
  );
}
