// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { formatSavedAt, provenanceTrustLabel, validationTrustLabel, type TrustLabel } from "@/lib/artifactReadableFormat";

export interface ArtifactProvenanceFacts {
  savedAt?: string | null;
  sourceCount?: number;
  receiptCount?: number;
}

const TONE: Readonly<Record<TrustLabel["tone"], string>> = {
  good: "border-emerald-300/40 text-emerald-200",
  caution: "border-amber-300/50 text-amber-200",
  neutral: "border-cyan-300/30 text-cyan-100",
};

function TrustBadge({ trust, kind }: { trust: TrustLabel; kind: string }) {
  return <li className={`rounded border px-2 py-1 font-ui text-[13px] ${TONE[trust.tone]}`} title={trust.detail}>
    <span className="text-[12px] text-muted-foreground">{kind}: </span><span className="font-semibold">{trust.label}</span>
    <span className="sr-only"> — {trust.detail}</span>
  </li>;
}

/** Plain-language provenance and validation labels; no internal enum names. */
export function ArtifactTrustBadges({ dataClassification, validationLevel, sourceCount }: { dataClassification?: unknown; validationLevel?: unknown; sourceCount?: number }) {
  const provenance = provenanceTrustLabel(dataClassification, sourceCount);
  const validation = validationTrustLabel(validationLevel);
  return <ul aria-label="How much to trust this" className="flex flex-wrap gap-2">
    <TrustBadge trust={provenance} kind="Inputs" />
    {validation && <TrustBadge trust={validation} kind="Model" />}
  </ul>;
}

/** As-of / source footer shown under every readable calculation Artifact. */
export function ArtifactFootnote({ facts, model, fingerprint, units }: {
  facts: ArtifactProvenanceFacts; model?: string | null; fingerprint?: string | null; units?: string | null;
}) {
  const saved = formatSavedAt(facts.savedAt);
  const parts = [
    saved ? `Saved ${saved}` : null,
    typeof facts.sourceCount === "number" ? (facts.sourceCount ? `${facts.sourceCount} recorded source${facts.sourceCount === 1 ? "" : "s"}` : "No external sources recorded") : null,
    typeof facts.receiptCount === "number" && facts.receiptCount > 0 ? `${facts.receiptCount} calculation receipt${facts.receiptCount === 1 ? "" : "s"}` : null,
    model ? `Model ${model}` : null,
    fingerprint ? `Fingerprint ${fingerprint.slice(0, 10)}…${fingerprint.slice(-6)}` : null,
  ].filter((part): part is string => part !== null);
  return <footer aria-label="As-of and source" className="space-y-1 border-t border-border/40 pt-2 font-ui text-[12px] text-muted-foreground">
    {parts.length > 0 && <p>{parts.join(" · ")}</p>}
    {units && <p>{units}</p>}
    <p>Displayed numbers are formatted for reading; stored values are unchanged. Hover a number, or choose “Show full precision”, to see it exactly.</p>
  </footer>;
}
