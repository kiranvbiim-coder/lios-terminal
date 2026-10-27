import * as React from "react";
import { useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { EvidenceObservation, TrustManifest } from "@shared/trustContracts";
import {
  describeObservationRights,
  inspectEvidenceClaimObservedBy,
  claimObservedTimeChoices,
  readableAssumptionValue,
} from "@/lib/evidencePrism";

function timestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : "Not recorded";
}

/** Inspect an existing structured P3 claim. No inferred evidence, live provider reads or new grants. */
export default function EvidencePrism({ manifest }: { manifest: TrustManifest }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [observedBy, setObservedBy] = useState<string>("");
  const prefix = useId();
  if (!manifest.claims.length) return null;
  const selected = selectedId ? inspectEvidenceClaimObservedBy(manifest, selectedId, observedBy || null) : null;
  const observedTimes = selectedId ? claimObservedTimeChoices(manifest, selectedId) : [];

  return (
    <section aria-label="Evidence Prism claim inspection" data-testid="ws30-evidence-prism" className="min-w-0">
      <h3 className="font-terminal text-[12px] uppercase tracking-[0.16em] text-muted-foreground">Claims &amp; calculations</h3>
      <p className="mt-1 font-ui text-[12px] text-muted-foreground">
        Select a recorded claim to inspect its source, date, classification, assumptions and entitlement evidence.
      </p>
      <ul className="mt-2 space-y-2">
        {manifest.claims.map(claim => {
          const expanded = selected?.claim.claimId === claim.claimId;
          const detailsId = `${prefix}-claim-${claim.claimId}`;
          return (
            <li key={claim.claimId} className="min-w-0 rounded border border-border/45 bg-black/20" data-claim-id={claim.claimId}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => { setSelectedId(id => id === claim.claimId ? null : claim.claimId); setObservedBy(""); }}
                className="flex min-h-10 w-full items-start justify-between gap-3 rounded px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
              >
                <span className="min-w-0">
                  <span className="block break-words font-ui text-[13px] font-semibold text-foreground">{claim.label}</span>
                  <span className="mt-0.5 block font-terminal text-[11px] text-muted-foreground">
                    Recorded: {claim.status} · {claim.confidence} confidence
                  </span>
                </span>
                {expanded
                  ? <ChevronUp className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden="true"/>
                  : <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden="true"/>}
              </button>
              {expanded && selected && (
                <div id={detailsId} role="region" aria-label={`Recorded evidence for ${claim.label}`} className="space-y-3 border-t border-border/40 px-3 py-3 font-ui text-[12px] text-muted-foreground" data-testid="ws30-claim-evidence">
                  <p className="break-words text-foreground/90">{claim.explanation}</p>
                  {observedTimes.length > 0 && <div data-testid="p3-evidence-time-machine" className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <label className="block font-ui text-sm font-semibold text-foreground">
                      Evidence observation time
                      <select value={observedBy} onChange={event => setObservedBy(event.target.value)}
                        aria-label="Inspect claim observations recorded by this time"
                        className="mt-2 min-h-11 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                        <option value="">All observations in this manifest</option>
                        {observedTimes.map(at => <option key={at} value={at}>Observed by {at}</option>)}
                      </select>
                    </label>
                    <p className="mt-2 font-ui text-xs leading-5 text-muted-foreground">
                      Filters only observations retained in this current manifest. This is not a historical claim, a replay of older permission grants, or evidence of when the underlying event occurred.
                    </p>
                  </div>}
                  <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
                    <div><dt className="inline font-semibold">Claim path: </dt><dd className="inline break-all">{claim.path}</dd></div>
                    <div><dt className="inline font-semibold">Unit: </dt><dd className="inline">Not recorded in trust manifest</dd></div>
                    <div><dt className="inline font-semibold">Evidence status: </dt><dd className="inline">{claim.status} (recorded, not independently verified)</dd></div>
                    <div><dt className="inline font-semibold">Sources matched: </dt><dd className="inline">{selected.sources.length - selected.missingSourceCount} of {selected.sources.length} referenced</dd></div>
                  </dl>
                  {selected.sources.length > 0 ? (
                    <section aria-label="Claim source observations">
                      <h4 className="font-semibold text-foreground">Linked source observations</h4>
                      <ul className="mt-1 space-y-2">
                        {selected.sources.map(source => (
                          <li key={source.ref} className="min-w-0 rounded border border-border/40 p-2">
                            <div className="break-all font-terminal text-[11px]">{source.ref}</div>
                            {source.observations.length ? (
                              <ul className="mt-1 space-y-2">
                                {source.observations.map((observation: EvidenceObservation) => (
                                  <li key={observation.evidenceId} className="space-y-1">
                                    <div className="font-semibold text-foreground">{observation.providerLabel}</div>
                                    <div>Source class: {observation.kind} · {observation.quality} quality · {observation.freshness} freshness</div>
                                    <div>As-of: {timestamp(observation.asOf)} · observed: {timestamp(observation.observedAt)}</div>
                                    <div>{describeObservationRights(observation)}</div>
                                    {observation.isFallback && <div>Fallback observation — not the preferred source</div>}
                                    {!!observation.fields.length && <div>Recorded fields: {observation.fields.join(", ")}</div>}
                                  </li>
                                ))}
                              </ul>
                            ) : <p className="mt-1 text-amber-200">No matching observation in this manifest at the selected observation time. A reference or later observation does not prove earlier support.</p>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : <p className="text-amber-200">No source references recorded for this claim.</p>}
                  <section aria-label="Claim assumptions">
                    <h4 className="font-semibold text-foreground">Assumptions</h4>
                    {selected.assumptions.length ? (
                      <ul className="mt-1 space-y-1">
                        {selected.assumptions.map(assumption => (
                          <li key={assumption.ref} className="break-words">
                            {assumption.record
                              ? <>{assumption.record.label} ({assumption.record.source}): {readableAssumptionValue(assumption.record.value)}</>
                              : <span className="text-amber-200">Unresolved assumption reference: {assumption.ref}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : <p>No assumption references recorded for this claim.</p>}
                  </section>
                  {!!selected.formulaRefs.length && (
                    <div className="break-words">Recorded formulas: {selected.formulaRefs.join(" · ")} (reference only)</div>
                  )}
                  {!!selected.receiptIds.length && (
                    <div className="break-all">Recorded receipt IDs: {selected.receiptIds.join(" · ")} (receipt content not included in this manifest)</div>
                  )}
                  <p className="text-[11px] leading-4">This inspection displays recorded metadata; it does not establish source correctness, redistributable rights or a verified numerical unit.</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
