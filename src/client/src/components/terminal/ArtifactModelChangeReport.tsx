import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { ArtifactPane } from "./ArtifactPane";
import type { ArtifactDetail, ProjectArtifactVersionRecord } from "@/lib/useArtifacts";
import type { ProjectSession } from "@/lib/useProjects";
export default function ArtifactModelChangeReport({ detail, versions, sessions, blocked, onAsk }: { detail: ArtifactDetail; versions: ProjectArtifactVersionRecord[]; sessions: ProjectSession[]; blocked: boolean; onAsk: (id: string, title: string, prompt?: string) => void }) {
  const [from, setFrom] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  if (output) return <section><button type="button" onClick={() => setOutput(null)}>Back to source model</button><ArtifactPane artifactId={output} projectId={detail.artifact.projectId} sessions={sessions} onClose={() => setOutput(null)} onAsk={onAsk}/></section>;
  const choices = versions.filter(version => version.version < detail.version.version);
  return <section aria-label="Create model change report" className="mb-4 space-y-2 rounded border border-border/50 p-3">
    <h3 className="font-semibold">Model change / restatement report</h3>
    <p className="text-sm text-muted-foreground">Exact recorded source/model changes and downstream output differences. No provider fetch or model recalculation. Source rights are rechecked.</p>
    <label>Earlier model revision<select aria-label="Model change report earlier revision" value={from} disabled={blocked || pending} onChange={event => setFrom(event.target.value)}><option value="">Select an earlier revision</option>{choices.map(version => <option key={version.id} value={version.version}>v{version.version} · {version.contentHash.slice(0, 12)}</option>)}</select></label>
    <button type="button" disabled={blocked || pending || !choices.some(version => String(version.version) === from)} onClick={async () => {
      setPending(true); setError(null);
      try { const response = await apiRequest("POST", `/api/artifacts/${encodeURIComponent(detail.artifact.id)}/model-change-report`, { fromVersion: Number(from), toVersion: detail.version.version, toContentHash: detail.version.contentHash }); const saved: { artifact: { id: string } } = await response.json(); setOutput(saved.artifact.id); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Model report could not be retained."); }
      finally { setPending(false); }
    }}>Create and open recorded change report</button>
    {pending && <p role="status">Creating source-bound report…</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
