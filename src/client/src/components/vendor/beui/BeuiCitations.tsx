/**
 * Adapted from beUI (starc007/ui-components), components/agents/citations.tsx.
 * MIT source @601fa21a2b68cfa5f6c1f0b6dcb29528c32472a1
 * Original Git blob 81e5b9be45c248de16645c1554d37d7d33d8960b.
 * Copyright (c) 2026 Saurabh Chauhan; see ./LICENSE.
 *
 * Reuses upstream numbered rows, disclosure and accessible external-link
 * pattern with local LiOS components. No remote favicon requests, second
 * citation store, automatic navigation, or additional animation dependency.
 */
import { useState } from "react";
import { BookOpenText, ChevronDown, ExternalLink, Globe2 } from "lucide-react";
import type { TrustCitationItem } from "@/lib/trustCitationPresentation";

const INITIAL_LIMIT = 8;

/** Render canonical evidence as compact, keyboard-reachable source citations. */
export function BeuiCitations({ items }: { items: readonly TrustCitationItem[] }) {
  const [showAll, setShowAll] = useState(false);
  if (!items.length) {
    return <p className="mt-2 text-sm leading-5 text-muted-foreground">
      No external/source observation supports this output. Check missing evidence below.
    </p>;
  }
  const visible = showAll ? items : items.slice(0, INITIAL_LIMIT);
  return (
    <div className="mt-2 min-w-0" data-testid="p3-beui-evidence-citations">
      <ol aria-label="Recorded evidence sources" className="space-y-1.5">
        {visible.map((item, index) => (
          <li key={item.id} className="rounded-lg border border-border/55 bg-background/35 p-2.5">
            <div className="flex min-w-0 items-start gap-2.5">
              <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted/60 text-xs font-semibold tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Globe2 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {item.href ? (
                    <a href={item.href} target="_blank" rel="noreferrer noopener"
                      className="min-w-0 break-words text-sm font-semibold text-foreground underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      aria-label={`Open recorded provider source ${index + 1}: ${item.title}`}>
                      {item.title}
                      <ExternalLink aria-hidden="true" className="ml-1 inline h-3.5 w-3.5" />
                    </a>
                  ) : <span className="min-w-0 break-words text-sm font-semibold text-foreground">{item.title}</span>}
                </div>
                <p className="mt-1 break-all font-mono text-xs leading-5 text-muted-foreground">{item.sourceRef}</p>
                <ul aria-label={`Evidence ${index + 1} metadata`} className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs leading-5 text-muted-foreground">
                  {item.details.map((detail, detailIndex) => <li key={detailIndex}>{detail}</li>)}
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {items.length > INITIAL_LIMIT && (
        <button type="button" aria-expanded={showAll}
          onClick={() => setShowAll(value => !value)}
          className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-sm text-foreground hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <BookOpenText aria-hidden="true" className="h-4 w-4" />
          {showAll ? "Show fewer recorded sources" : `Show all ${items.length} recorded sources`}
          <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform motion-reduce:transition-none ${showAll ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
