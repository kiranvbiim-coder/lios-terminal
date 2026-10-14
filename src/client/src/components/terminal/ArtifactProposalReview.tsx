import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { proposalValuePreview, reviewArtifactProposal, type ProposalContentChange } from "@/lib/artifactProposalReview";
import type { ProjectArtifactProposalRecord, ProjectArtifactVersionRecord } from "@/lib/useArtifacts";

function CompleteInspection({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return <details className="mt-2 rounded border border-border/50 p-2" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-ui text-[13px]">{label}</summary>
    {open && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-terminal text-[12px]">{JSON.stringify(value, null, 2)}</pre>}
  </details>;
}

function ChangeList({ changes }: { changes: ProposalContentChange[] }) {
  return <div className="mt-2 space-y-2">{changes.map(change => {
    const before = proposalValuePreview(change.before), after = proposalValuePreview(change.after);
    return <div key={change.path} className="rounded border border-border/40 p-2">
      <div className="break-all font-terminal text-[12px]">{change.path}{change.provenance && <span className="ml-2 text-amber-200">PROVENANCE</span>}</div>
      <div className="mt-1 grid gap-2 md:grid-cols-2">{([{ label: "Before", preview: before, color: "text-red-200" }, { label: "After", preview: after, color: "text-emerald-200" }]).map(item => <div key={item.label}>
        <div className="font-ui text-[12px] text-muted-foreground">{item.label}</div>
        <pre className={`max-h-40 overflow-auto whitespace-pre-wrap break-words font-terminal text-[12px] ${item.color}`}>{item.preview.text}</pre>
        {item.preview.truncated && <p className="font-ui text-[12px] text-amber-200">Value excerpt only; inspect complete content below for the exact value.</p>}
      </div>)}</div>
    </div>;
  })}</div>;
}

export function ArtifactProposalReview({ proposal, base, current, headVersion, onDecision }: {
  proposal: ProjectArtifactProposalRecord;
  base: ProjectArtifactVersionRecord | undefined;
  current: ProjectArtifactVersionRecord;
  headVersion: number;
  onDecision: (id: string, decision: "accept" | "reject") => Promise<void>;
}) {
  const review = useMemo(() => reviewArtifactProposal(proposal, base, headVersion), [proposal, base, headVersion]);
  if (proposal.status !== "pending") return null;
  return <section aria-label="Review proposed Artifact change" className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.02] p-3">
    <h3 className="font-ui text-[14px] font-semibold">Review proposed Artifact change</h3>
    <p className="mt-1 whitespace-pre-wrap break-words font-ui text-[13px] text-muted-foreground">{proposal.summary}</p>
    <dl className="mt-2 space-y-1 break-all font-terminal text-[12px]">
      <div><dt className="inline text-muted-foreground">Target / source base: </dt><dd className="inline">{proposal.artifactId}@v{proposal.baseVersion}</dd></div>
      <div><dt className="inline text-muted-foreground">Base SHA-256: </dt><dd className="inline">{base?.contentHash ?? "Unavailable"}</dd></div>
      <div><dt className="inline text-muted-foreground">Proposal source: </dt><dd className="inline">{proposal.proposalType} · {proposal.id} · {proposal.createdAt}</dd></div>
      <div><dt className="inline text-muted-foreground">Recorded proposed SHA-256: </dt><dd className="inline">{proposal.proposedContentHash}</dd></div>
      <div><dt className="inline text-muted-foreground">Current saved revision: </dt><dd className="inline">{current.artifactId}@v{current.version} · {current.contentHash}</dd></div>
    </dl>
    {review.stale && <p role="alert" className="mt-2 text-sm text-amber-200">This proposal is stale: its base is v{proposal.baseVersion}, but the Artifact head is v{headVersion}. Acceptance is disabled. Reject it or ask for a new proposal against the current revision. The preview below remains based on the original immutable revision, not the current content.</p>}
    {review.error && <p role="alert" className="mt-2 whitespace-pre-wrap break-words text-sm text-red-200">{review.error}</p>}
    {review.content && <>
      <p className="mt-3 font-ui text-[13px]">Replaced top-level fields: {review.topLevelKeys.length ? review.topLevelKeys.join(", ") : "None (content unchanged)"}. Nested paths below show the actual effects of shallow field replacement.</p>
      <p className="mt-1 font-ui text-[12px] text-muted-foreground">Showing {review.changes.length} of {review.changeCount} changed paths. {review.changes.length < review.changeCount ? "This is a bounded excerpt, not a complete change list." : "All changed paths are listed."}</p>
      <ChangeList changes={review.changes}/>
      {review.provenanceChangeCount > 0 && <details className="mt-3 rounded border border-amber-300/30 p-2">
        <summary className="cursor-pointer font-ui text-[13px] text-amber-200">Provenance / evidence status changes ({review.provenanceChangeCount})</summary>
        <p className="mt-1 text-xs text-muted-foreground">Showing {review.provenanceChanges.length} of {review.provenanceChangeCount} provenance paths; these are declared content changes, not independent verification.</p>
        <ChangeList changes={review.provenanceChanges}/>
      </details>}
      <CompleteInspection key={`${proposal.id}:proposed`} label="Inspect complete canonical proposed content (no truncation)" value={review.content}/>
    </>}
    {base && <>
      <CompleteInspection label="Inspect complete immutable base content" value={base.content}/>
      <CompleteInspection label="Inspect immutable base sources, trust and capture metadata" value={{ sourceRefs: base.sourceRefs, dependencyRefs: base.dependencyRefs, executionReceiptIds: base.executionReceiptIds, assumptionRefs: base.assumptionRefs, trustManifest: base.trustManifest, refreshSpec: base.refreshSpec }}/>
      <p className="mt-2 font-ui text-[12px] text-muted-foreground">Base sources, receipts and trust remain immutable historical custody. They do not verify revised content; P4 rechecks linked rights and clears inherited current-content trust when accepting edits.</p>
    </>}
    {review.stale && <CompleteInspection label="Inspect complete current saved content" value={current.content}/>}
    <div className="mt-3 flex justify-end gap-2">
      <button type="button" onClick={() => void onDecision(proposal.id, "reject")} className="rounded px-2 py-1 font-ui text-[13px] text-muted-foreground">Reject</button>
      <button type="button" disabled={!review.canAccept} onClick={() => { if (review.canAccept) void onDecision(proposal.id, "accept"); }} className="flex items-center gap-1 rounded bg-cyan-300 px-2 py-1 font-ui text-[13px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-3 w-3"/> Accept</button>
    </div>
  </section>;
}
