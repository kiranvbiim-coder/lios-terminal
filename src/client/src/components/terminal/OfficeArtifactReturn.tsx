import { useEffect, useMemo, useRef, useState } from "react";
import { readOfficeArtifactRoundtrip, OFFICE_ARTIFACT_LIMITS } from "@shared/officeArtifactRoundtrip";
import type { ArtifactContent } from "@shared/artifactContracts";
import { proposeOfficeArtifactReturn } from "@/lib/useArtifacts";

type ReturnFile = Awaited<ReturnType<typeof readOfficeArtifactRoundtrip>> & { fileHash: string; filename: string };
function previewChanges(source: ArtifactContent, proposed: ArtifactContent): string[] {
  if ((source.kind === "report" || source.kind === "research") && proposed.kind === source.kind) {
    const originals = new Map(source.blocks.map(block => [block.id, block]));
    const next = new Map(proposed.blocks.map(block => [block.id, block]));
    return [...new Set([...originals.keys(), ...next.keys()])].flatMap(id => {
      const before = originals.get(id); const after = next.get(id);
      if (JSON.stringify(before) === JSON.stringify(after)) return [];
      return [`${id}: ${before?.type ?? "new"} → ${after?.type ?? "deleted"}\nBefore: ${before?.text ?? "(new block)"}\nAfter: ${after?.text ?? "(deleted block)"}\nRecorded formatting, table, chart or metadata changes are included in the complete proposed content.`];
    });
  }
  return JSON.stringify(source) === JSON.stringify(proposed) ? [] : ["Recorded structured content changed; inspect the complete proposed content before accepting."];
}

export default function OfficeArtifactReturn({ artifactId, version, contentHash, onStaged }: {
  artifactId: string; version: number; contentHash: string; onStaged: () => void;
}) {
  const [file, setFile] = useState<ReturnFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectContent, setInspectContent] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const changes = useMemo(() => file ? previewChanges(file.sourceContent, file.content) : [], [file]);
  useEffect(() => () => { generation.current += 1; }, []);
  const read = async (selected: File) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++generation.current;
    setBusy(true); setError(null); setNotice(null); setFile(null);
    try {
      if (selected.size > OFFICE_ARTIFACT_LIMITS.compressedBytes) throw new Error("Office return exceeds the compressed file limit.");
      const buffer = await selected.arrayBuffer();
      const returned = await readOfficeArtifactRoundtrip(new Uint8Array(buffer));
      if (returned.sourceArtifactId !== artifactId || returned.sourceVersion !== version || returned.sourceHash !== contentHash) throw new Error("This Office file was exported from another Artifact or saved revision. Export the current source before returning edits.");
      if (current === generation.current) setFile({ ...returned, filename: selected.name });
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Unable to read Office return.");
    } finally {
      if (current === generation.current) { inFlight.current = false; setBusy(false); }
    }
  };
  const stage = async () => {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    const current = ++generation.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await proposeOfficeArtifactReturn(artifactId, {
        sourceArtifactId: file.sourceArtifactId, sourceVersion: file.sourceVersion, sourceHash: file.sourceHash,
        sourceContent: file.sourceContent, content: file.content, format: file.format,
        fileHash: file.fileHash, warnings: file.warnings,
      });
      if (current !== generation.current) return;
      setNotice(result.proposal ? "Office changes proposed below. Inspect and accept explicitly; the saved Artifact is unchanged." : "No canonical content changes were found.");
      onStaged();
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Unable to stage Office changes.");
    } finally {
      if (current === generation.current) { inFlight.current = false; setBusy(false); }
    }
  };
  return <section aria-label="Return edited Office work" className="mt-4 space-y-3 rounded border border-border/50 p-3" data-testid="artifact-office-return">
    <h3 className="font-semibold">Return edited Office work</h3>
    <p className="text-sm text-muted-foreground">Choose a LiOS-exported DOCX or PPTX from this saved revision. Actual native edits are read locally, then staged through the existing Artifact review. Nothing is applied automatically.</p>
    <input type="file" aria-label="Edited Office file" accept=".docx,.pptx" disabled={busy} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void read(selected); }}/>
    {busy && <p role="status">Reading or staging Office work…</p>}
    {file && <><p className="break-words text-sm">{file.filename} · {file.format.toUpperCase()} · source v{file.sourceVersion} · SHA-256 {file.fileHash}</p>
      {file.warnings.map((warning, index) => <p key={index} className="text-sm text-amber-200">{warning}</p>)}
      <details><summary>Inspect returned changes</summary>{changes.map((change, index) => <pre key={index} className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{change}</pre>)}</details>
      <details onToggle={event => setInspectContent(event.currentTarget.open)}><summary>Complete proposed canonical content</summary>{inspectContent && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(file.content, null, 2)}</pre>}</details>
      <button type="button" disabled={busy} onClick={() => void stage()} className="rounded border border-cyan-300/40 px-3 py-2" data-testid="artifact-stage-office-return">Stage Office changes for review</button>
    </>}
    {notice && <p role="status" data-testid="artifact-office-return-status">{notice}</p>}
    {error && <p role="alert" data-testid="artifact-office-return-error" className="text-red-200">{error}</p>}
  </section>;
}
