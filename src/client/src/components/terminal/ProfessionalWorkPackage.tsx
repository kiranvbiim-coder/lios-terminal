import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useProjectArtifacts, type ArtifactDetail } from "@/lib/useArtifacts";
import type { ProjectSession } from "@/lib/useProjects";
import { ArtifactPane } from "./ArtifactPane";
export default function ProfessionalWorkPackage({ detail, sessions, blocked, onAsk }: { detail: ArtifactDetail; sessions: ProjectSession[]; blocked: boolean; onAsk: (id: string, title: string, prompt?: string) => void }) {
  const catalogue = useProjectArtifacts(detail.artifact.projectId);
  const [workflow, setWorkflow] = useState("ic_memo"), [title, setTitle] = useState(""), [audience, setAudience] = useState(""), [period, setPeriod] = useState(""), [brand, setBrand] = useState(""), [narrative, setNarrative] = useState(""), [additional, setAdditional] = useState(""), [role, setRole] = useState("evidence");
  const [output, setOutput] = useState<string | null>(null), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  if (output) return <section><button type="button" onClick={() => setOutput(null)}>Back to selected source</button><ArtifactPane artifactId={output} projectId={detail.artifact.projectId} sessions={sessions} onClose={() => setOutput(null)} onAsk={onAsk}/></section>;
  return <details className="mb-4 rounded border border-border/50 p-3"><summary>Institutional / board / client work package</summary><div className="mt-3 space-y-2">
    <p className="text-sm text-muted-foreground">Assemble frozen owned source snapshots and authored analysis. No provider fetch, recalculation, implied approval or client suitability certification. Missing analysis remains explicitly disclosed. Original work is not replaced.</p>
    <label>Workflow<select aria-label="Professional package workflow" value={workflow} onChange={event => setWorkflow(event.target.value)}>{["ic_memo", "credit_memo", "deal_memo", "board_materials", "banking_pitch", "client_proposal", "client_report"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
    {[{ label: "Package title", value: title, set: setTitle }, { label: "Audience / client", value: audience, set: setAudience }, { label: "Reporting period", value: period, set: setPeriod }, { label: "Brand / advisor", value: brand, set: setBrand }].map(field => <label key={field.label} className="block">{field.label}<input aria-label={field.label} value={field.value} onChange={event => field.set(event.target.value)} className="ml-2 rounded border border-border p-2"/></label>)}
    <label className="block">Authored recommendation / scope<textarea aria-label="Authored package recommendation" value={narrative} onChange={event => setNarrative(event.target.value)} className="block w-full rounded border border-border p-2"/></label>
    <p>Selected frozen source: {detail.artifact.title} · v{detail.version.version} · {detail.version.contentHash}</p>
    <label>Selected source role<select aria-label="Professional selected source role" value={role} onChange={event => setRole(event.target.value)}>{["evidence", "financial_model", "current", "decision"].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Additional / proposed source<select aria-label="Professional additional source" value={additional} onChange={event => setAdditional(event.target.value)}><option value="">None selected</option>{catalogue.data?.filter(item => item.id !== detail.artifact.id && item.status === "active").map(item => <option key={item.id} value={item.id}>{item.title} · saved v{item.headVersion}</option>)}</select></label>
    <button type="button" disabled={blocked || pending || !title.trim() || !audience.trim() || !period.trim() || !narrative.trim() || workflow === "client_proposal" && (!additional || role !== "current")} onClick={async () => {
      setPending(true); setError(null);
      try {
        const sources = [{ artifactId: detail.artifact.id, version: detail.version.version, contentHash: detail.version.contentHash, role }];
        if (additional) { const response = await fetch(`/api/artifacts/${encodeURIComponent(additional)}`); if (!response.ok) throw new Error("Selected additional source unavailable."); const next: ArtifactDetail = await response.json(); const expected = catalogue.data?.find(item => item.id === additional); if (!expected || next.version.version !== expected.headVersion) throw new Error("Additional source moved; reselect the current source."); sources.push({ artifactId: next.artifact.id, version: next.version.version, contentHash: next.version.contentHash, role: workflow === "client_proposal" ? "proposed" : "evidence" }); }
        const response = await apiRequest("POST", `/api/projects/${detail.artifact.projectId}/artifacts/professional-package`, { workflow, title, audience, reportingPeriod: period, brand, sources, authoredSections: [{ title: workflow === "ic_memo" ? "Executive recommendation" : workflow === "credit_memo" ? "Credit recommendation" : workflow === "deal_memo" ? "Transaction recommendation" : workflow === "board_materials" ? "Board action requested" : workflow === "banking_pitch" ? "Engagement objective" : workflow === "client_proposal" ? "Client objective and scope" : "Executive review", text: narrative }] });
        const saved: ArtifactDetail = await response.json(); setOutput(saved.artifact.id);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Professional package creation failed."); } finally { setPending(false); }
    }}>Create and open source-backed package</button>
    {blocked && <p>Save local work first; source package creation is blocked by unsaved edits.</p>}{pending && <p role="status">Retaining the reviewed source package…</p>}{error && <p role="alert">{error}</p>}
  </div></details>;
}
