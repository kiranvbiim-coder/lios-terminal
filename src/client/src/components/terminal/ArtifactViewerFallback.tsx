// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import type { ArtifactContent } from "@shared/artifactContracts";
import { formatReadableScalar, humanizeKey } from "@/lib/artifactReadableFormat";
import { ExpertJsonView } from "./ArtifactExpertView";

/** Honest fallback for Artifact kinds without a built-in viewer: says so, offers export, never prints JSON. */
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
  return <section aria-label="Artifact viewer unavailable" data-testid="artifact-viewer-fallback" className="space-y-3 rounded-lg border border-border/50 p-4">
    <h2 className="font-ui text-[15px] font-semibold">No built-in viewer for this {name} Artifact yet</h2>
    <p className="font-ui text-[13px] text-muted-foreground">
      Your {name} Artifact is saved and unchanged. LiOS can’t show it as a readable page yet, so it is not displayed here.
      You can export it to open in another tool, or ask LiOS about it in chat.
    </p>
    {facts.length > 0 && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-ui text-[13px]">
      {facts.map(fact => <React.Fragment key={fact.label}><dt className="text-muted-foreground">{fact.label}</dt><dd className="break-words">{formatReadableScalar(fact.label, fact.value).text}</dd></React.Fragment>)}
    </dl>}
    {onOpenExport && <button type="button" onClick={onOpenExport} className="rounded border border-cyan-300/30 px-3 py-2 font-ui text-[13px] text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">Export this Artifact</button>}
    <ExpertJsonView content={content} onSave={onSave} onDirtyChange={onDirtyChange} disabled={disabled} defaultOpen={expertDefaultOpen} />
  </section>;
}
