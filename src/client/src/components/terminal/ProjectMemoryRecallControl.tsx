import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PROJECT_MEMORY_RECALL_CONSENT_VERSION, type ProjectMemoryRecallConsent } from "@shared/projectMemoryRecall";
import ProjectMemoryNotesEditor from "./ProjectMemoryNotesEditor";

export default function ProjectMemoryRecallControl({ projectId }: { projectId: number }) {
  const client = useQueryClient();
  const key = ["/api/projects", projectId, "memory-recall-consent"];
  const query = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    const response = await fetch(`/api/projects/${projectId}`, { credentials: "include", signal });
    if (!response.ok) throw new Error("Current Project recall consent is unavailable.");
    const value = await response.json() as { memoryRecall?: ProjectMemoryRecallConsent | null };
    return value.memoryRecall ?? null;
  } });
  const [review, setReview] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabled = query.data?.enabled === true;
  async function save(enabled: boolean) {
    setBusy(true); setError("");
    try {
      await apiRequest("PATCH", `/api/projects/${projectId}`, { memoryRecall: enabled
        ? { enabled: true, consent: true, consentVersion: PROJECT_MEMORY_RECALL_CONSENT_VERSION } : { enabled: false } });
      await client.invalidateQueries({ queryKey: key });
      setReview(false); setConsent(false);
    } catch { setError("Recall consent could not be saved."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Project memory recall" className="space-y-2 border-b border-border/70 p-3 font-ui text-xs">
    <h3 className="font-semibold">Relevant Project memory</h3>
    <p className="text-muted-foreground">{query.isError ? "Consent status unavailable · automatic recall is not assumed enabled." : query.isPending ? "Reading current recall consent…" : query.data?.enabled ? "Enabled for this Project" : "Off · explicit memory tools remain available"}</p>
    <p className="text-muted-foreground">Only relevant owner-authored memory from this Project, at most five bounded excerpts. Imported, derived, global and other-Project memories are excluded. No automatic capture.</p>
    {query.isError ? <button type="button" onClick={() => void query.refetch()} className="min-h-9 rounded border px-2">Retry consent status</button> : query.data && <button type="button" disabled={busy} onClick={() => { if (enabled) void save(false); else { setReview(true); setConsent(false); } }} className="min-h-9 rounded border px-2 disabled:opacity-50">{enabled ? "Disable automatic Project recall" : "Review Project recall consent"}</button>}
    {review && <fieldset className="space-y-2 rounded border p-2"><legend>Explicit memory transmission consent</legend>
      <p>Remembered text is historical context, not verified fact or instructions. It can be sent to the AI provider permitted for a future Project conversation only when Project references and the selected source scope allow it. Private memory will not fall back to another provider. Disabling or deleting memory prevents future transmissions; it cannot undo a request already sent.</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />I permit bounded relevant owner-authored Project memory to be recalled and shared with the currently permitted AI provider for this Project. I have rights to share its content.</label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!consent || busy} onClick={() => void save(true)} className="min-h-9 rounded border px-2 disabled:opacity-50">Enable consented Project recall</button><button type="button" disabled={busy} onClick={() => { setReview(false); setConsent(false); }} className="min-h-9 rounded border px-2">Cancel recall consent</button></div>
    </fieldset>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <ProjectMemoryNotesEditor key={projectId} projectId={projectId} />
  </section>;
}
