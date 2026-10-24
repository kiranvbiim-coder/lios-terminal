import * as React from "react";
import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Database,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import type { TrustManifest } from "@shared/trustContracts";
import { recordP3TrustInteraction } from "@/lib/p3TrustTelemetry";
import EvidencePrism from "./EvidencePrism";
import EvidenceExceptionDetails from "./EvidenceExceptionDetails";

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

  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-emerald-300/15 bg-emerald-300/[0.018]" data-p3-trust-manifest="true">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
        <span className="font-terminal text-[12px] uppercase tracking-[0.18em] text-muted-foreground">Trust</span>
        <span className="rounded-full border border-border/50 px-2 py-1 font-terminal text-[12px] uppercase text-foreground">
          {titleCase(summary.freshness)}
        </span>
        <span className="rounded-full border border-border/50 px-2 py-1 font-terminal text-[12px] uppercase text-foreground">
          Quality {summary.quality}
        </span>
        <span className="rounded-full border border-border/50 px-2 py-1 font-terminal text-[12px] uppercase text-foreground">
          Confidence {summary.confidence}
        </span>
        <span className="rounded-full border border-border/50 px-2 py-1 font-terminal text-[12px] uppercase text-muted-foreground">
          Evidence {summary.evidenceCoveragePct.toFixed(0)}%
        </span>
        {summary.conflictState !== "none" && (
          <span className="rounded-full border border-amber-300/20 px-2 py-1 font-terminal text-[12px] uppercase text-amber-200">
            {summary.conflictState === "not_evaluated_single_source" ? "Conflict not evaluated" : `Conflict ${summary.conflictState}`}
          </span>
        )}
        {summary.missingCount > 0 && (
          <span className="rounded-full border border-amber-300/20 px-2 py-1 font-terminal text-[12px] uppercase text-amber-200">
            {summary.missingCount} missing
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="ml-auto flex items-center gap-1 rounded border border-border/50 px-2 py-1 font-ui text-[12px] text-muted-foreground hover:border-emerald-300/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
        >
          Show Work
          {expanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
        </button>
      </div>

      {expanded && (
        <div className="grid gap-3 border-t border-border/45 px-3 py-3 md:grid-cols-2">
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

          <EvidencePrism key={manifest.trustId} manifest={manifest} />
          <EvidenceExceptionDetails key={`${manifest.trustId}:exceptions`} manifest={manifest} />

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

          {(manifest.missing.length > 0 || manifest.warnings.length > 0) && (
            <section>
              <div className="flex items-center gap-1.5 font-terminal text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
                <AlertTriangle className="h-3 w-3" /> Exceptions & recovery
              </div>
              <div className="mt-2 space-y-2">
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
                    <CircleCheck className="mt-0.5 h-2.5 w-2.5 shrink-0" />
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
