// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import type { ArtifactContent } from "@shared/artifactContracts";
import { formatReadableScalar, humanizeKey } from "@/lib/artifactReadableFormat";
import { ExpertJsonView } from "./ArtifactExpertView";
import { ReadableValueTable } from "./ReadableValueTable";

/** Readable, exact-content fallback without inventing a specialist editor or exposing raw JSON. */
export default function ArtifactViewerFallback({ kind, facts = [], onOpenExport, onSave, onDirtyChange, disabled = false, expertDefaultOpen = false, content }: {
  kind: string;
  /** Plain label/value facts that are safe to show (e.g. screen name). */
  facts?: Array<{ label: string; value: unknown }>;
  onOpenExport?: () => void;
  content: ArtifactContent;
  onSave: (content: ArtifactContent) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
  expertDefaultOpen?: boolean;
}) {
  const name = humanizeKey(kind).toLowerCase();
  // Render only the exact, previously authorized saved content. The shared
  // readable formatter bounds nested records; this component never creates data.
  const recorded = Object.entries(content as unknown as Record<string, unknown>).filter(([key]) => key !== "kind");
  const summary = Object.fromEntries(recorded.slice(0, 8));
  const remaining = Math.max(0, recorded.length - 8);
  return <section aria-label={`Recorded ${name} Artifact`} data-testid="artifact-viewer-fallback" className="space-y-3 rounded-xl border border-border/50 bg-card/35 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-ui text-base font-semibold text-foreground">Recorded {name}</h2>
      {onOpenExport && <button type="button" onClick={onOpenExport} className="min-h-10 rounded-lg border border-border/60 px-3 font-ui text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Export</button>}
    </div>
    {facts.length > 0 && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-ui text-[13px]">
      {facts.map(fact => <React.Fragment key={fact.label}><dt className="text-muted-foreground">{fact.label}</dt><dd className="break-words">{formatReadableScalar(fact.label, fact.value).text}</dd></React.Fragment>)}
    </dl>}
    {recorded.length > 0 && <ReadableValueTable title="Recorded details" values={summary} />}
    {remaining > 0 && <p className="font-ui text-xs text-muted-foreground">{remaining} additional recorded fields are available in the advanced view or export.</p>}
    <ExpertJsonView content={content} onSave={onSave} onDirtyChange={onDirtyChange} disabled={disabled} defaultOpen={expertDefaultOpen} />
  </section>;
}
