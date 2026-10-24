import type { useNativeArtifactDraftRecovery } from "@/lib/nativeArtifactDraftRecovery";

export default function NativeDraftRecoveryNotice({ recovery, dirty }: { recovery: ReturnType<typeof useNativeArtifactDraftRecovery>; dirty: boolean }) {
  return <>
    {recovery.candidate && <div role="alert" data-testid="protected-artifact-recovery" className="mb-3 rounded border border-amber-300/40 p-3 font-ui text-sm text-amber-100">
      <p>{recovery.matching ? "Protected unsaved edits were found. Recover for review or discard the checkpoint." : "Encrypted edits belong to another saved revision. They cannot overwrite this revision."}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {recovery.matching && <button type="button" onClick={recovery.restore} className="min-h-9 rounded border px-3 py-1.5">Recover local edits</button>}
        <button type="button" onClick={() => void recovery.discard()} className="min-h-9 rounded border px-3 py-1.5">Discard recovery</button>
      </div>
    </div>}
    {recovery.notice && <p role={recovery.status === "error" ? "alert" : "status"} className="mb-2 font-ui text-sm text-amber-200">{recovery.notice}</p>}
    {recovery.status === "error" && <div className="mb-3 flex flex-wrap gap-2">
      <button type="button" onClick={recovery.retry} className="min-h-9 rounded border px-3 py-1.5 text-sm">Retry protected recovery</button>
      <button type="button" onClick={recovery.continueWithoutRecovery} className="min-h-9 rounded border px-3 py-1.5 text-sm">Continue without crash recovery</button>
    </div>}
    {dirty && recovery.status === "disabled" && <p role="status" className="mb-2 font-ui text-sm text-amber-200">Protected crash recovery is unavailable or disabled. Save the Artifact revision before leaving.</p>}
  </>;
}
