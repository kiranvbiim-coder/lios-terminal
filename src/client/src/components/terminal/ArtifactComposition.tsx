import { useEffect, useRef, useState } from "react";
import type { ArtifactContent } from "@shared/artifactContracts";
import { useProjectResources } from "@/lib/useProjects";
import { apiRequest } from "@/lib/queryClient";
import { useProjectArtifacts } from "@/lib/useArtifacts";

export default function ArtifactComposition({ artifactId, projectId, version, content, onStaged }: {
  artifactId: string; projectId: number; version: number; content: Extract<ArtifactContent, { kind: "report" | "research" }>;
  onStaged: () => void;
}) {
  const artifacts = useProjectArtifacts(projectId);
  const resources = useProjectResources(projectId);
  const [kind, setKind] = useState<"image" | "chart" | "table" | "artifact">("chart");
  const [sourceId, setSourceId] = useState("");
  const [caption, setCaption] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false); const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const imageSources = (resources.data ?? []).filter(resource => resource.metadata.kind === "image" && ["image/png", "image/jpeg"].includes(String(resource.metadata.mimeType)) && typeof resource.metadata.attachmentId === "string");
  const artifactSources = (artifacts.data ?? []).filter(artifact => artifact.id !== artifactId && (kind === "artifact" || artifact.kind === kind));
  const stage = async () => {
    if (inFlight.current || !sourceId) return;
    const selected = kind === "image" ? imageSources.find(resource => resource.metadata.attachmentId === sourceId) : artifactSources.find(artifact => artifact.id === sourceId);
    if (!selected) { setError("Selected source is no longer available in this Project."); return; }
    inFlight.current = true; const current = ++generation.current; setBusy(true); setError(null); setNotice(null);
    try {
      const response = await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/compose`, {
        baseVersion: version, kind, sourceId,
        ...(kind !== "image" && "headVersion" in selected ? { sourceVersion: selected.headVersion } : {}),
        ...(caption ? { caption } : {}), ...(sectionId ? { sectionId } : {}),
      });
      await response.json();
      if (current !== generation.current) return;
      setNotice("Composition proposed below. Inspect the captured source and accept explicitly; the saved work is unchanged.");
      onStaged();
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Unable to capture this Project source."); }
    finally { if (current === generation.current) { inFlight.current = false; setBusy(false); } }
  };
  return <section aria-label="Compose Project work" className="mb-4 space-y-3 rounded border border-border/50 p-3" data-testid="artifact-composition">
    <h3 className="font-semibold">Compose Project work</h3>
    <p className="text-sm text-muted-foreground">Capture an owned saved table, chart, reference or PNG/JPEG attachment into this work product. Exact source version/hash and local image bytes are retained; nothing is fetched externally or applied automatically.</p>
    <div className="flex flex-wrap gap-3">
      <label>Content type<select aria-label="Composition content type" value={kind} disabled={busy} onChange={event => { setKind(event.target.value as typeof kind); setSourceId(""); setNotice(null); }} className="ml-2 rounded border border-border bg-background p-2"><option value="chart">Recorded chart</option><option value="table">Recorded table</option><option value="image">Project image</option><option value="artifact">Artifact reference</option></select></label>
      <label>Project source<select aria-label="Composition Project source" value={sourceId} disabled={busy} onChange={event => setSourceId(event.target.value)} className="ml-2 rounded border border-border bg-background p-2"><option value="">Choose a source explicitly</option>{kind === "image" ? imageSources.map(resource => <option key={resource.id} value={String(resource.metadata.attachmentId)}>{resource.label} · {String(resource.metadata.sha256).slice(0, 12)}</option>) : artifactSources.map(artifact => <option key={artifact.id} value={artifact.id}>{artifact.title} · v{artifact.headVersion}</option>)}</select></label>
    </div>
    {artifacts.isError || resources.isError ? <p role="alert">Project source catalogue unavailable. Reopen this work to retry.</p> : null}
    <label className="block">Authored caption<input aria-label="Composition caption" value={caption} maxLength={4000} disabled={busy} onChange={event => setCaption(event.target.value)} className="ml-2 rounded border border-border bg-background p-2"/></label>
    {content.kind === "report" && <label className="block">Report section<select aria-label="Composition report section" value={sectionId} disabled={busy} onChange={event => setSectionId(event.target.value)} className="ml-2 rounded border border-border bg-background p-2"><option value="">New composition section</option>{content.sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>}
    <button type="button" disabled={busy || !sourceId || artifacts.isError || resources.isError} onClick={() => void stage()} className="rounded border border-cyan-300/40 px-3 py-2 disabled:opacity-40" data-testid="artifact-propose-composition">{busy ? "Capturing source…" : "Review captured composition"}</button>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="text-red-200">{error}</p>}
  </section>;
}
