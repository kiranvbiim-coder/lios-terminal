// Render only source references actually recorded by the conversation runtime.
// Do not create a URL for provider handles or imply a source can be opened.
import * as React from "react";
import { useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import { safeHref, type ChatCitationSource } from "@/lib/chatMarkdown";

const INITIAL_VISIBLE = 6;

export function inspectableSourceHref(source: ChatCitationSource): string | null {
  // URLs have to be recorded as the source ID itself. A label or inferred provider
  // homepage does not prove a particular document was viewed or is openable.
  if (!source.href) return null;
  const original = safeHref(source.id);
  const recorded = safeHref(source.href);
  return original && original === recorded && /^https?:\/\//i.test(original) ? original : null;
}

export default function ResearchSourceList({ sources }: { sources: readonly ChatCitationSource[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!sources.length) return null;
  const displayed = expanded ? sources : sources.slice(0, INITIAL_VISIBLE);
  const remaining = sources.length - INITIAL_VISIBLE;

  return (
    <section data-testid="trace-sources" aria-label="Sources used" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-ui text-[12px] font-semibold text-foreground">
          Recorded source references ({sources.length})
        </h3>
        {remaining > 0 && (
          <button
            type="button"
            data-testid="trace-sources-expand"
            aria-controls={listId}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="min-h-8 rounded-md border border-border/55 px-3 py-1.5 font-ui text-[12px] text-cyan-100 hover:border-cyan-300/40 hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          >
            {expanded ? "Show fewer sources" : `Show all ${sources.length} sources`}
          </button>
        )}
      </div>
      <ul id={listId} className="flex flex-wrap gap-2" aria-label="Recorded source references">
        {displayed.map((source) => {
          const href = inspectableSourceHref(source);
          return (
            <li key={source.id} className="min-w-0 max-w-full rounded-lg border border-border/55 bg-white/[0.025] px-3 py-2 font-ui text-[12px]">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-6 items-center gap-1.5 break-all text-cyan-100 underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                  aria-label={`Open recorded source: ${source.label}`}
                >
                  {source.label}
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <span className="text-foreground/85">{source.label}</span>
              )}
              <span className="ml-2 text-muted-foreground">
                {href ? "Link recorded" : "Reference only · no verified link"}
              </span>
            </li>
          );
        })}
      </ul>
      {sources.length === 50 && (
        <p className="font-ui text-[12px] text-muted-foreground">
          Showing up to 50 recorded source references. Inspect the detailed trust evidence for additional context.
        </p>
      )}
    </section>
  );
}
