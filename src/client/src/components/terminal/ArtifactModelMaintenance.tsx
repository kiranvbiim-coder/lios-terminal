import { useEffect, useRef, useState } from "react";
import type { ArtifactModelMaintenancePeriod, ArtifactModelMaintenanceTarget } from "@shared/artifactModelMaintenance";
import { applyArtifactModelMaintenance, reviewArtifactModelMaintenance, useArtifactModelMaintenanceOptions, useInvalidateArtifacts } from "@/lib/useArtifacts";
import type { ArtifactDetail } from "@/lib/useArtifacts";
import { ArtifactModelMaintenanceReviewSession, initialModelMaintenanceReviewState, modelMaintenanceReviewMatches } from "@/lib/artifactModelMaintenanceReview";
import type { ModelMaintenanceContext, ModelMaintenanceReviewState } from "@/lib/artifactModelMaintenanceReview";

const PAGE_SIZE = 40;
function Periods({ periods }: { periods: ArtifactModelMaintenancePeriod[] }) {
  return <ul className="space-y-1">{periods.map((period, index) => <li key={`${period.fiscalYear}:${period.period}:${index}`}>{period.fiscalYear} · {period.period} · {period.periodEnd}</li>)}</ul>;
}
function Snapshot({ target }: { target: ArtifactModelMaintenanceTarget }) {
  return <dl className="space-y-1 break-all text-[12px]">
    <div><dt className="inline text-muted-foreground">Owned immutable snapshot: </dt><dd className="inline">{target.id}</dd></div>
    <div><dt className="inline text-muted-foreground">Content hash: </dt><dd className="inline">{target.contentHash}</dd></div>
    <div><dt className="inline text-muted-foreground">Recorded identity / currency: </dt><dd className="inline">{target.symbol} · {target.currency ?? "Not recorded"}</dd></div>
    <div><dt className="inline text-muted-foreground">Provider / source: </dt><dd className="inline">{target.provider} · {target.source}</dd></div>
    <div><dt className="inline text-muted-foreground">Available at: </dt><dd className="inline">{target.availableAt}</dd></div>
    <div><dt className="inline text-muted-foreground">Source rights policy: </dt><dd className="inline">{target.entitlementPolicyId} · {target.entitlementPolicyHash}</dd></div>
    <div><dt className="text-muted-foreground">Reported periods:</dt><dd><Periods periods={target.periods}/></dd></div>
  </dl>;
}

export default function ArtifactModelMaintenance({ detail, blocked = false, onApplyingChange }: {
  detail: ArtifactDetail; blocked?: boolean; onApplyingChange?: (applying: boolean) => void;
}) {
  const { artifact, version } = detail;
  const currentHead = version.version === artifact.headVersion && artifact.status === "active" && artifact.trashedAt === null;
  const options = useArtifactModelMaintenanceOptions(artifact.id, { version: version.version, contentHash: version.contentHash }, currentHead);
  const invalidate = useInvalidateArtifacts();
  const [state, setState] = useState<ModelMaintenanceReviewState>(initialModelMaintenanceReviewState);
  const [changesPage, setChangesPage] = useState(0);
  const [preservedPage, setPreservedPage] = useState(0);
  const optionsMatch = options.data?.artifactId === artifact.id && options.data.version === version.version && options.data.contentHash === version.contentHash;
  const context: ModelMaintenanceContext = { artifactId: artifact.id, projectId: artifact.projectId, version: version.version, headVersion: artifact.headVersion, contentHash: version.contentHash,
    available: currentHead && !blocked && optionsMatch && options.data?.canApply === true && !options.isError };
  const current = useRef(context);
  current.current = context;
  const session = useRef<ArtifactModelMaintenanceReviewSession | null>(null);
  useEffect(() => {
    const active = new ArtifactModelMaintenanceReviewSession(() => current.current, {
      review: reviewArtifactModelMaintenance,
      apply: async (artifactId, input) => {
        const result = await applyArtifactModelMaintenance(artifactId, input);
        // Even if the inspector was closed, refresh the canonical same-id Artifact on its next opening.
        invalidate(detail.artifact.projectId, artifactId);
        return result;
      },
    }, setState);
    session.current = active;
    return () => { active.dispose(); session.current = null; };
  }, [artifact.id, artifact.projectId, invalidate]);
  useEffect(() => { session.current?.reconcile(); }, [context.artifactId, context.projectId, context.version, context.headVersion, context.contentHash, context.available]);
  useEffect(() => { setChangesPage(0); setPreservedPage(0); }, [state.review?.reviewHash]);
  useEffect(() => { onApplyingChange?.(state.pending === "apply"); return () => { onApplyingChange?.(false); }; }, [state.pending, onApplyingChange]);
  const selected = state.selected;
  const targetStillAvailable = selected !== null && options.data?.targets.some(target => target.id === selected.id && target.contentHash === selected.contentHash) === true;
  const review = state.review;
  const canApply = review !== null && targetStillAvailable && modelMaintenanceReviewMatches(review, context, state.selected) && state.pending === null;
  const savedResultAwaitingRefresh = state.result !== null;
  const disabled = !context.available || state.pending !== null || savedResultAwaitingRefresh;
  const changes = review?.changes.slice(changesPage * PAGE_SIZE, (changesPage + 1) * PAGE_SIZE) ?? [];
  const preserved = review?.preservedCells.slice(preservedPage * PAGE_SIZE, (preservedPage + 1) * PAGE_SIZE) ?? [];
  return <section aria-label="Update model reported periods" data-testid="artifact-model-maintenance" aria-busy={state.pending !== null} className="mb-4 space-y-3 rounded-lg border border-cyan-300/25 p-3">
    <h3 className="text-[14px] font-semibold">Update this model from an owned snapshot</h3>
    <p className="text-sm text-muted-foreground">Uses only saved model v{version.version}. Save local worksheet edits first. Choose a frozen dataset already owned by you, inspect reported periods and actuals, then explicitly apply. No provider fetch, ticker entry, automatic selection, execution, or resume.</p>
    <p className="text-sm text-muted-foreground">The existing P11 engine preserves saved assumptions, schedules, formulas and user overrides. Apply saves one new P4 version of this same model, not a new Artifact. Source permissions, current head and exact review are rechecked by the server.</p>
    {!currentHead && <p role="alert" className="text-sm text-amber-200">This model is not an active current head. Reopen the current saved model before updating.</p>}
    {blocked && <p role="alert" className="text-sm text-amber-200">Unsaved worksheet edits or a spreadsheet save are present. Save those edits and wait for the canonical revision before reviewing or applying. Local drafts must not be discarded by a model update.</p>}
    {options.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading owned immutable snapshots and checking source/author access…</p>}
    {options.data && !optionsMatch && !options.isLoading && !options.isError && <p role="alert" className="text-sm text-red-200">The snapshot response does not match this displayed saved model revision. No selection or update is enabled. Reload the saved model and retry snapshot loading.</p>}
    {options.isError && <div><p role="alert" data-testid="artifact-model-maintenance-options-error" className="break-words text-sm text-red-200">Owned snapshots could not be loaded. {options.error instanceof Error ? options.error.message : "The source or author check failed."} No update is available from this failed request.</p><button type="button" disabled={state.pending !== null || !currentHead} onClick={() => void options.refetch()} className="mt-2 rounded border border-border/50 px-3 py-2 text-sm disabled:opacity-40">Retry loading owned snapshots</button></div>}
    {options.data && optionsMatch && !options.isError && <>
      <p className="break-all text-[12px] text-muted-foreground">Recorded source: {options.data.source.datasetSnapshotId} · {options.data.source.datasetContentHash} · run {options.data.source.runId} · engine {options.data.engineRev}</p>
      <details><summary className="cursor-pointer text-sm">Current source reported periods ({options.data.source.periods.length})</summary><div className="mt-2 max-h-48 overflow-auto text-[12px]"><Periods periods={options.data.source.periods}/></div></details>
      {!options.data.targets.length ? <p role="status" className="text-sm text-muted-foreground">No eligible owned immutable target snapshots were returned for this saved model. This does not fetch or create provider data.</p> : <label className="block text-sm">Target dataset snapshot
        <select aria-label="Model maintenance target snapshot" data-testid="artifact-model-maintenance-target" value={targetStillAvailable ? state.selected?.id ?? "" : ""} disabled={disabled} onChange={event => session.current?.select(options.data?.targets.find(target => target.id === event.target.value) ?? null)} className="mt-1 block w-full rounded border border-border/50 bg-[#090909] px-3 py-2 disabled:opacity-40">
          <option value="">Select an owned snapshot explicitly</option>{options.data.targets.map(target => <option key={`${target.id}:${target.contentHash}`} value={target.id}>{target.symbol} · {target.periods.map(period => `${period.fiscalYear} ${period.period}`).join(", ")} · {target.provider} · {target.id}</option>)}
        </select>
      </label>}
      <p className="text-[12px] text-muted-foreground">{options.data.targets.length} eligible owned snapshots returned; no snapshot is preselected.</p>
    </>}
    {state.selected && <div data-testid="artifact-model-maintenance-selected" className="max-h-64 overflow-auto rounded border border-border/40 p-2"><Snapshot target={state.selected}/></div>}
    <button type="button" data-testid="artifact-model-maintenance-review" disabled={disabled || !targetStillAvailable} onClick={() => void session.current?.review()} className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-cyan-200 disabled:opacity-40">{state.pending === "review" ? "Reviewing saved model and snapshot…" : "Review reported-period update"}</button>
    {review && <div data-testid="artifact-model-maintenance-review-details" data-review-hash={review.reviewHash} className="space-y-3">
      <dl className="space-y-1 break-all font-terminal text-[12px]">
        <div><dt className="inline text-muted-foreground">Captured model head / hash: </dt><dd className="inline">{review.artifactId} · v{review.version} · {review.contentHash}</dd></div>
        <div><dt className="inline text-muted-foreground">Source snapshot / hash / run: </dt><dd className="inline">{review.source.datasetSnapshotId} · {review.source.datasetContentHash} · {review.source.runId}</dd></div>
        <div><dt className="inline text-muted-foreground">Engine revision / normalized input hash: </dt><dd className="inline">{review.engineRev} · {review.inputHash}</dd></div>
        <div><dt className="inline text-muted-foreground">Required review hash: </dt><dd className="inline">{review.reviewHash}</dd></div>
      </dl>
      <details><summary className="cursor-pointer text-sm">Inspect captured target metadata and source rights</summary><div className="mt-2 max-h-64 overflow-auto"><Snapshot target={review.target}/></div></details>
      <div className="grid gap-3 text-[12px] md:grid-cols-2"><div className="max-h-48 overflow-auto"><h4 className="font-semibold">Old source periods</h4><Periods periods={review.source.periods}/></div><div className="max-h-48 overflow-auto"><h4 className="font-semibold">Proposed source periods</h4><Periods periods={review.target.periods}/></div></div>
      <div className="max-h-96 overflow-auto"><table className="w-full text-left text-[12px]"><caption className="mb-2 text-left">All proposed reported-period/source changes · {review.changes.length} total · showing {changes.length ? changesPage * PAGE_SIZE + 1 : 0}–{Math.min((changesPage + 1) * PAGE_SIZE, review.changes.length)}. Exact values, no display rounding; use pages to inspect every change.</caption><thead><tr><th scope="col">Period / field</th><th scope="col">Old actual</th><th scope="col">New actual</th></tr></thead><tbody>{changes.map((change, index) => <tr key={`${changesPage}:${index}`}><th scope="row" className="border-t border-border/40 p-2 font-normal">{change.kind} · {change.periodKey}<br/>{change.path}<details><summary className="cursor-pointer">Source hashes</summary><p className="break-all">Old: {change.oldSourceHash}<br/>New: {change.newSourceHash}</p></details></th><td className="border-t border-border/40 p-2 font-terminal">{JSON.stringify(change.before)}</td><td className="border-t border-border/40 p-2 font-terminal">{JSON.stringify(change.after)}</td></tr>)}</tbody></table></div>
      <div className="flex gap-2"><button type="button" disabled={changesPage === 0} onClick={() => setChangesPage(page => page - 1)} className="rounded border border-border/50 px-2 py-1 text-sm disabled:opacity-40">Previous changes</button><button type="button" disabled={(changesPage + 1) * PAGE_SIZE >= review.changes.length} onClick={() => setChangesPage(page => page + 1)} className="rounded border border-border/50 px-2 py-1 text-sm disabled:opacity-40">Next changes</button></div>
      <details><summary className="cursor-pointer text-sm">Preserved formula / override / custom cells ({review.preservedCells.length})</summary><p className="mt-2 text-[12px] text-muted-foreground">Showing {preserved.length ? preservedPage * PAGE_SIZE + 1 : 0}–{Math.min((preservedPage + 1) * PAGE_SIZE, review.preservedCells.length)} of {review.preservedCells.length}; pages expose every recorded preserved cell.</p><div className="max-h-80 overflow-auto"><table className="w-full text-left text-[12px]"><thead><tr><th>Cell / reason</th><th>Exact raw value / formula</th><th>Format</th></tr></thead><tbody>{preserved.map(cell => <tr key={`${cell.sheetId}:${cell.cell}`}><th scope="row" className="border-t border-border/40 p-2 font-normal">{cell.sheetId}!{cell.cell} · {cell.reason}</th><td className="border-t border-border/40 p-2"><pre className="whitespace-pre-wrap break-all">{cell.raw}</pre></td><td className="border-t border-border/40 p-2">{cell.format ?? "Not recorded"}</td></tr>)}</tbody></table></div><div className="mt-2 flex gap-2"><button type="button" disabled={preservedPage === 0} onClick={() => setPreservedPage(page => page - 1)} className="rounded border border-border/50 px-2 py-1 text-sm disabled:opacity-40">Previous preserved cells</button><button type="button" disabled={(preservedPage + 1) * PAGE_SIZE >= review.preservedCells.length} onClick={() => setPreservedPage(page => page + 1)} className="rounded border border-border/50 px-2 py-1 text-sm disabled:opacity-40">Next preserved cells</button></div></details>
      <details><summary className="cursor-pointer text-sm">Exact preserved engine parameters and source references</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-[12px]">{JSON.stringify({ assumptions: review.assumptions, schedules: review.schedules, sourceRefs: review.sourceRefs }, null, 2)}</pre></details>
      <button type="button" data-testid="artifact-model-maintenance-apply" disabled={!canApply} onClick={() => void session.current?.apply()} className="rounded bg-cyan-300 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40">{state.pending === "apply" ? "Applying reviewed update…" : "Apply reviewed update to this model"}</button>
    </div>}
    {state.pending === "apply" && <p role="status" className="text-sm text-muted-foreground">The explicit update is in flight. Worksheet editing is locked. Leaving this inspector does not cancel server execution; reopening never resumes or retries it automatically.</p>}
    {state.error && <div><p role="alert" data-testid="artifact-model-maintenance-error" className="break-words text-sm text-red-200">{state.error}</p><button type="button" disabled={state.pending !== null} onClick={() => invalidate(artifact.projectId, artifact.id)} className="mt-2 rounded border border-border/50 px-3 py-2 text-sm disabled:opacity-40">Reload saved model revision</button></div>}
    {state.result && <p role="status" data-testid="artifact-model-maintenance-result" className="break-all text-sm text-emerald-200">Existing model {state.result.artifact.id} updated to v{state.result.version.version} · run {state.result.receipt.runId}. Canonical same-model revision refresh requested. {state.result.receipt.replayed ? "The existing recorded result was returned; no second version was created." : "One new model version was recorded."}</p>}
  </section>;
}
