import { useState } from "react";
export default function SpreadsheetArtifactReturn({ artifactId, version, contentHash, onStaged, blocked }: { artifactId: string; version: number; contentHash: string; onStaged: () => void; blocked: boolean }) {
  const [file, setFile] = useState<File | null>(null), [pending, setPending] = useState(false), [notice, setNotice] = useState<string | null>(null);
  return <section aria-label="Return edited spreadsheet" className="mt-4 space-y-2 rounded border border-border/50 p-3">
    <h3 className="font-semibold">Return edited XLSX to this workbook</h3>
    <p className="text-sm text-muted-foreground">Actual native cell/formula/format edits are parsed through the existing governed importer and staged against this exact saved revision. Source bindings stay historical; no recalculation, automatic acceptance or replacement Artifact.</p>
    {blocked && <p role="status">Save or discard local worksheet edits before returning external work.</p>}
    <input aria-label="Edited LiOS XLSX file" type="file" accept=".xlsx" disabled={pending || blocked} onChange={event => { setFile(event.target.files?.[0] ?? null); setNotice(null); }}/>
    <button type="button" disabled={!file || pending || blocked} onClick={async () => { if (!file || blocked) return; setPending(true); setNotice(null); try { const body = new FormData(); body.append("file", file);   const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/spreadsheet-return?baseVersion=${version}&baseHash=${contentHash}`, { method: "POST", body }); const result: { changed?: boolean; error?: string } = await response.json(); if (!response.ok) throw new Error(result.error ?? "Spreadsheet return failed."); setNotice(result.changed ? "Actual spreadsheet changes staged below for explicit review." : "No canonical spreadsheet changes were found."); onStaged(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Spreadsheet return failed."); } finally { setPending(false); } }}>Stage XLSX changes for review</button>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
