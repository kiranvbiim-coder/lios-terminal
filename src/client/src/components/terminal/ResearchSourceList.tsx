import * as React from "react";
import { useId, useState } from "react";
import { safeHref, type ChatCitationSource } from "@/lib/chatMarkdown";

export function inspectableSourceHref(source: ChatCitationSource): string | null {
  if (!source.href) return null;
  const original = safeHref(source.id);
  const recorded = safeHref(source.href);
  return original && original === recorded && /^https?:\/\//i.test(original) ? original : null;
}

/** Adapted from the existing #116 proposal; links never infer provider homepages. */
export default function ResearchSourceList({ sources }: { sources: readonly ChatCitationSource[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!sources.length) return null;
  const displayed = expanded ? sources : sources.slice(0, 6);
  return (
    <section data-testid="trace-sources" aria-label="Recorded sources" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-ui text-sm font-semibold">Recorded source references ({sources.length})</h3>
        {sources.length > 6 && <button type="button" aria-controls={listId} aria-expanded={expanded}
          onClick={() => setExpanded(current => !current)}
          className="min-h-11 rounded-md border border-border/55 px-3 font-ui text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
          {expanded ? "Show fewer sources" : `Show all ${sources.length} sources`}
        </button>}
      </div>
      <ul id={listId} className="flex flex-wrap gap-2">
        {displayed.map(source => {
          const href = inspectableSourceHref(source);
          return <li key={source.id} className="min-w-0 max-w-full rounded-lg border border-border/55 px-3 py-2 font-ui text-sm">
            {href ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open recorded source: ${source.label}`}
              className="inline-flex min-h-11 items-center break-all text-cyan-100 underline focus-visible:ring-2 focus-visible:ring-cyan-300/60">{source.label}</a>
              : <span className="break-words">{source.label}</span>}
            <span className="ml-2 text-muted-foreground">{href ? "Link recorded" : "Reference only · no verified link"}</span>
            {href && <div className="break-all text-muted-foreground">{href}</div>}
          </li>;
        })}
      </ul>
      {sources.length === 50 && <p className="font-ui text-sm text-muted-foreground">Showing up to 50 recorded source references. Inspect Trust for additional context.</p>}
    </section>
  );
}
