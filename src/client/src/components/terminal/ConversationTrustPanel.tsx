import * as React from "react";
import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Database,
  FlaskConical,
} from "lucide-react";
import type { TrustManifest } from "@shared/trustContracts";
import { recordP3TrustInteraction } from "@/lib/p3TrustTelemetry";
import { projectTrustDisclosure } from "@/lib/trustDisclosure";

interface Props {
  manifest: TrustManifest;
  onRecoveryAction?: (action: string) => void;
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function asOfLabel(value: string | null): string {
  if (!value) return "As-of unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "As-of unavailable" : parsed.toLocaleString();
}

export default function ConversationTrustPanel({ manifest, onRecoveryAction }: Props) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) recordP3TrustInteraction("show_work_opened");
  };
  const summary = manifest.summary;
  const disclosure = projectTrustDisclosure(manifest);

  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-emerald-300/15 bg-emerald-300/[0.018]" data-p3-trust-manifest="true">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Database aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-ui text-[13px] font-medium text-foreground">Sources</span>
        <span className="font-ui text-[12px] text-muted-foreground" data-testid="trust-quiet-summary">{disclosure.summary}</span>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls="lios-trust-details"
          className="ml-auto flex items-center gap-1 rounded border border-border/50 px-2 py-1 font-ui text-[12px] text-muted-foreground hover:border-emerald-300/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
        >
          {expanded ? "Hide details" : "Show work"}
          {expanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
        </button>
      </div>

      {disclosure.visibleLimitations.length > 0 && (
        <div className="border-t border-amber-300/15 px-3 py-2" data-testid="trust-visible-limitations" aria-label="Important source limitations">
          <ul className="space-y-1">
            {disclosure.visibleLimitations.map((limitation) => (
              <li key={limitation} className="flex items-start gap-2 font-ui text-[12px] leading-5 text-amber-100">
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{limitation}</span>
              </li>
            ))}
          </ul>
          {disclosure.additionalLimitationCount > 0 && (
            <p className="mt-1 font-ui text-[12px] text-muted-foreground">
              {disclosure.additionalLimitationCount} more source limitation{disclosure.additionalLimitationCount === 1 ? "" : "s"} in Show work.
            </p>
          )}
        </div>
      )}

      {expanded && (
        <div id="lios-trust-details" className="grid gap-3 border-t border-border/45 px-3 py-3 md:grid-cols-2">
          <section className="md:col-span-2" aria-label="Recorded evidence metrics">
            <p className="font-ui text-[12px] text-muted-foreground">
              Recorded quality: {summary.quality} · Reported confidence: {summary.confidence} · Evidence coverage: {summary.evidenceCoveragePct.toFixed(0)}% · Conflict check: {titleCase(summary.conflictState)}
            </p>
          </section>
          <section>
            <div className="flex items-center gap-1.5 font-terminal text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
              <Database className="h-3 w-3" /> Sources
            </div>
            <div className="mt-2 space-y-1.5">
              {manifest.evidence.length ? manifest.evidence.map((item) => (
                <div key={item.evidenceId} className="rounded border border-border/40 bg-black/20 px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-ui text-[12px] font-semibold text-foreground">{item.providerLabel}</span>
                    <span className="font-terminal text-[12px] uppercase text-muted-foreground">{item.freshness}</span>
                    <span className="font-terminal text-[12px] uppercase text-muted-foreground">{item.quality} quality</span>
                  </div>
                  <div className="mt-1 break-all font-terminal text-[12px] text-muted-foreground">{item.sourceRef}</div>
                  <div className="mt-1 font-ui text-[12px] text-muted-foreground">{asOfLabel(item.asOf)}{item.isFallback ? " · fallback" : ""}</div>
                  {item.access && (
                    <div className="mt-1 font-ui text-[12px] leading-3 text-muted-foreground">
                      Access: {titleCase(item.access.state)}
                      {item.access.servedTier ? ` · served ${titleCase(item.access.servedTier)}` : ""}
                      {item.access.entitlementRequired ? " · entitlement/upgrade required" : ""}
                      {item.access.upgradeConnectorLabel ? ` · upgrade: ${item.access.upgradeConnectorLabel}` : ""}
                      {item.access.reason ? ` · ${item.access.reason}` : ""}
                    </div>
                  )}
                  {!!item.notes.length && <div className="mt-1 font-ui text-[12px] leading-3 text-muted-foreground">{item.notes.join(" ")}</div>}
                </div>
              )) : (
                <div className="font-ui text-[12px] leading-4 text-muted-foreground">No external/source observation supports this output. Check the missing evidence section below.</div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-1.5 font-terminal text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
              <FlaskConical className="h-3 w-3" /> Methodology
            </div>
            <ol className="mt-2 space-y-1.5">
              {manifest.methodology.map((step) => (
                <li key={`${step.step}-${step.label}`} className="rounded border border-border/40 bg-black/20 px-2.5 py-2">
                  <div className="font-ui text-[12px] text-foreground">{step.step}. {step.label}</div>
                  <div className="mt-1 font-terminal text-[12px] uppercase text-muted-foreground">
                    {step.deterministic ? "Deterministic / governed" : "Observed / interpretive"}
                    {step.componentId ? ` · ${step.componentId}` : ""}
                  </div>
                  {!!step.receiptIds.length && <div className="mt-1 font-terminal text-[12px] text-muted-foreground">Receipts: {step.receiptIds.join(" · ")}</div>}
                </li>
              ))}
            </ol>
          </section>

          {!!manifest.claims.length && (
            <section>
              <div className="font-terminal text-[12px] uppercase tracking-[0.16em] text-muted-foreground">Claims & calculations</div>
              <div className="mt-2 space-y-1.5">
                {manifest.claims.map((claim) => (
                  <div key={claim.claimId} className="rounded border border-border/40 bg-black/20 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-ui text-[12px] font-semibold text-foreground">{claim.label}</span>
                      <span className="font-terminal text-[12px] uppercase text-muted-foreground">{claim.status}</span>
                      <span className="font-terminal text-[12px] uppercase text-muted-foreground">{claim.confidence} confidence</span>
                    </div>
                    <div className="mt-1 font-ui text-[12px] leading-3 text-muted-foreground">{claim.explanation}</div>
                    {!!claim.formulaRefs.length && (
                      <div className="mt-1 font-terminal text-[12px] leading-3 text-cyan-200/80">
                        {claim.formulaRefs.join(" · ")}
                      </div>
                    )}
                    {!!claim.receiptIds.length && (
                      <div className="mt-1 font-terminal text-[12px] text-muted-foreground">Receipts: {claim.receiptIds.join(" · ")}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!!manifest.assumptions.length && (
            <section>
              <div className="font-terminal text-[12px] uppercase tracking-[0.16em] text-muted-foreground">Assumptions</div>
              <div className="mt-2 space-y-1.5">
                {manifest.assumptions.map((assumption) => (
                  <div key={assumption.ref} className="rounded border border-border/40 bg-black/20 px-2.5 py-2">
                    <div className="font-ui text-[12px] text-foreground">{assumption.label}: {String(assumption.value)}</div>
                    <div className="mt-1 font-terminal text-[12px] uppercase text-muted-foreground">{assumption.source.replaceAll("_", " ")}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(manifest.conflicts.length > 0 || manifest.missing.length > 0 || manifest.warnings.length > 0) && (
            <section>
              <div className="flex items-center gap-1.5 font-terminal text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
                <AlertTriangle className="h-3 w-3" /> Exceptions & recovery
              </div>
              <div className="mt-2 space-y-2">
                {manifest.conflicts.map((conflict) => (
                  <div key={`${conflict.field}-${conflict.sourceRefs.join("-")}`} className="rounded border border-amber-300/15 bg-amber-300/[0.02] px-2.5 py-2">
                    <div className="font-ui text-[12px] font-semibold text-amber-100">{conflict.field} · {conflict.state} conflict</div>
                    <div className="mt-1 font-ui text-[12px] leading-3 text-muted-foreground">{conflict.summary}</div>
                  </div>
                ))}
                {manifest.missing.map((missing) => (
                  <div key={missing.field} className="rounded border border-amber-300/15 bg-amber-300/[0.02] px-2.5 py-2">
                    <div className="font-ui text-[12px] font-semibold text-foreground">Missing · {missing.field.replaceAll("_", " ")}</div>
                    <div className="mt-1 font-ui text-[12px] leading-3 text-muted-foreground">{missing.reason}</div>
                    {!!missing.recoveryActions.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {missing.recoveryActions.map((action) => (
                          <button
                            key={action}
                            type="button"
                            onClick={() => {
                              recordP3TrustInteraction("recovery_action");
                              onRecoveryAction?.(action);
                            }}
                            className="rounded-full border border-border/55 px-2 py-1 font-ui text-[12px] text-muted-foreground hover:text-foreground"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {manifest.warnings.map((warning) => (
                  <div key={warning} className="flex items-start gap-1.5 font-ui text-[12px] leading-3 text-muted-foreground">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-amber-200" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
