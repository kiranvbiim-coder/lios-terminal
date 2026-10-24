import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { TrustManifest } from "@shared/trustContracts";
import { reviewEvidenceExceptions } from "@/lib/evidenceExceptions";

/**
 * Truthful read-only exception details from the same P3 manifest as EvidencePrism.
 * Source availability here is a recorded observation, not a current rights check.
 */
export default function EvidenceExceptionDetails({ manifest }: { manifest: TrustManifest }) {
  const review = reviewEvidenceExceptions(manifest);
  if (!review.conflicts.length && !review.unknown.length && !review.access.length) return null;
  return (
    <section aria-label="Evidence exceptions" data-testid="ws31-evidence-exceptions" className="min-w-0 space-y-2">
      <h3 className="flex items-center gap-1.5 font-terminal text-[12px] uppercase tracking-[0.16em] text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Contradictions, unknowns &amp; access
      </h3>
      <p className="font-ui text-[12px] text-muted-foreground">
        Exceptions from this run's recorded evidence. No conflicting value is silently selected and no past access check proves current rights.
      </p>

      {!!review.conflicts.length && <div className="space-y-2" aria-label="Source contradictions">
        {review.conflicts.map((conflict, index) => (
          <article key={`${conflict.field}:${index}`} className="rounded border border-amber-300/25 bg-amber-300/[0.025] p-2.5" data-testid="ws31-source-conflict">
            <div className="font-ui text-[12px] font-semibold text-amber-100">{conflict.field} · {conflict.state} contradiction</div>
            <p className="mt-1 break-words font-ui text-[12px] text-muted-foreground">{conflict.summary}</p>
            <p className="mt-1 font-ui text-[11px] text-muted-foreground">
              {conflict.differencePct === null ? "Difference not recorded" : `Recorded relative difference: ${conflict.differencePct.toFixed(2)}%`}
            </p>
            <ul className="mt-2 space-y-1.5" aria-label={`Conflicting sources for ${conflict.field}`}>
              {conflict.sources.map(source => (
                <li key={source.ref} className="rounded border border-border/45 bg-black/20 p-2 text-[12px] text-muted-foreground">
                  <div className="break-all font-terminal text-foreground/90">{source.ref}</div>
                  {source.observations.length
                    ? <ul className="mt-1 space-y-1">
                      {source.observations.map(observation => (
                        <li key={observation.evidenceId}>
                          {observation.providerLabel} · {observation.quality} quality · as-of {observation.asOf ?? "not recorded"}
                        </li>
                      ))}
                    </ul>
                    : <p className="mt-1 text-amber-200">Referenced source observation unavailable in this manifest</p>}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>}

      {!!review.unknown.length && <div className="space-y-1.5" aria-label="Unknown or partial claims">
        {review.unknown.map((item, index) => (
          <p key={`${item.claimId}:${index}`} className="rounded border border-border/45 px-2.5 py-2 font-ui text-[12px] text-muted-foreground" data-testid="ws31-unknown-claim">
            <span className="font-semibold text-foreground">{item.label}:</span> {item.message}. Recorded status: {item.status}.
          </p>
        ))}
      </div>}

      {!!review.access.length && <div className="space-y-1.5" aria-label="Recorded source access limitations">
        {review.access.map(item => (
          <div key={item.observation.evidenceId} className="rounded border border-amber-300/15 px-2.5 py-2 font-ui text-[12px]" data-testid="ws31-source-access">
            <div className="font-semibold text-foreground">{item.observation.providerLabel}</div>
            <p className="mt-0.5 break-all text-muted-foreground">{item.ref}</p>
            <p className="mt-1 text-amber-200">
              {item.assessment.label}
              {item.assessment.level === "blocked" ? " — do not assume this source can be reused" : ""}
            </p>
            <p className="mt-1 text-muted-foreground">
              Recorded at {item.observation.observedAt}; this is not a fresh entitlement check.
            </p>
          </div>
        ))}
      </div>}
      {!!review.recoveryActions.length && <p className="font-ui text-[12px] text-muted-foreground">
        Recovery actions recorded with missing-data items are available in Exceptions &amp; recovery below; no action is executed by this inspection.
      </p>}
    </section>
  );
}
