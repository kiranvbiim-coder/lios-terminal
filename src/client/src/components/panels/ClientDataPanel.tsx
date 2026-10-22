import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useEffect, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, ChevronDown, ChevronRight, Trash2, ShieldCheck } from "lucide-react";

/**
 * BYOD -- Bring Your Own Data (Major Bet, Roadmap Rev.3 §05). "Client data
 * never gets raw, unrestricted AI access. It flows through the Data
 * Layer, gets validated and normalized... reaches the client only through
 * the consultant or an approved Terminal workflow." A client uploads a
 * spreadsheet; the server runs it through the exact same deterministic
 * column profiler internal UIDE uploads already use
 * (server/uideEngine/profiler.ts, via /api/client/datasets) and stores
 * only the profile -- never the raw rows. This panel shows that profile
 * back to the client as the trust signal it's meant to be: proof Limuria
 * understood their data correctly, with no AI anywhere in this loop.
 *
 * Client-only, org-scoped like every other table in this schema -- the
 * roadmap's "Private Data Environment" is that same org-scoping guarantee,
 * not a new mechanism.
 */

interface ColumnProfile {
  name: string;
  inferredType: string;
  totalCount: number;
  nullCount: number;
  uniqueCount: number;
  isLikelyKey: boolean;
  sampleValues: string[];
}
interface TabularSheetProfile {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  duplicateOrBlankHeaderWarning: boolean;
}
interface LayoutSheetProfile {
  rowCount: number;
  columnCount: number;
  formulaCount: number;
  hardcodedValueCount: number;
  detectedModelType: string | null;
}
interface SheetProfile {
  sheetName: string;
  shape: "tabular" | "layout" | "empty";
  tabular: TabularSheetProfile | null;
  layout: LayoutSheetProfile | null;
}
interface WorkbookProfile {
  fileName: string;
  sheetNames: string[];
  sheets: SheetProfile[];
}
interface DatasetListItem {
  id: number;
  fileName: string;
  fileExt: string;
  sheetCount: number;
  totalRows: number;
  createdAt: string;
  uploadedByName: string;
}
interface DatasetDetail extends DatasetListItem {
  profile: WorkbookProfile;
}

function SheetView({ sheet }: { sheet: SheetProfile }) {
  if (sheet.shape === "empty") {
    return <p className="font-terminal text-[9px] text-muted-foreground py-2">Empty sheet.</p>;
  }
  if (sheet.shape === "layout" && sheet.layout) {
    return (
      <div className="py-2 font-terminal text-[10px] text-muted-foreground space-y-1">
        <p>Detected as a modeling sheet (labels + formulas), not a data table — {sheet.layout.rowCount} rows × {sheet.layout.columnCount} columns, {sheet.layout.formulaCount} formulas.</p>
        {sheet.layout.detectedModelType && <p>Likely model type: <span className="text-foreground">{sheet.layout.detectedModelType}</span></p>}
      </div>
    );
  }
  if (!sheet.tabular) return null;
  return (
    <div className="py-2 overflow-x-auto">
      {sheet.tabular.duplicateOrBlankHeaderWarning && (
        <p className="font-terminal text-[9px] text-down mb-2">Some column headers are blank or duplicated — double-check the source file's header row.</p>
      )}
      <table className="w-full text-[10px]">
        <thead>
          <tr className="font-terminal uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="text-left px-2 py-1 font-medium">Column</th>
            <th className="text-left px-2 py-1 font-medium">Type</th>
            <th className="text-right px-2 py-1 font-medium">Filled</th>
            <th className="text-right px-2 py-1 font-medium">Unique</th>
            <th className="text-left px-2 py-1 font-medium">Sample Values</th>
          </tr>
        </thead>
        <tbody>
          {sheet.tabular.columns.map((c) => (
            <tr key={c.name} className="border-b border-border/40 last:border-0">
              <td className="px-2 py-1.5 text-foreground font-semibold whitespace-nowrap">{c.name}{c.isLikelyKey && <span className="text-[hsl(38,95%,55%)]"> (key)</span>}</td>
              <td className="px-2 py-1.5 text-muted-foreground uppercase">{c.inferredType}</td>
              <td className="px-2 py-1.5 text-right font-mono-num text-muted-foreground">{c.totalCount - c.nullCount}/{c.totalCount}</td>
              <td className="px-2 py-1.5 text-right font-mono-num text-muted-foreground">{c.uniqueCount}</td>
              <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[240px]">{c.sampleValues.slice(0, 3).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ClientDataPanel() {
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useTerminalArtifactState<number | null>("ClientDataPanel.expandedId", null);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [activeSheet, setActiveSheet] = useTerminalArtifactState(`ClientDataPanel.activeSheet.${expandedId}`, 0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetch("/api/client/datasets")
      .then((r) => (r.ok ? r.json() : []))
      .then(setDatasets)
      .catch(() => setDatasets([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const abort = new AbortController();
    setDetail(null);
    if (expandedId !== null) {
      fetch(`/api/client/datasets/${expandedId}`, { signal: abort.signal })
        .then(async response => { if (!response.ok) throw new Error("Saved dataset is unavailable under current access."); return response.json() as Promise<DatasetDetail>; })
        .then(value => { if (!abort.signal.aborted && value.id === expandedId) setDetail(value); })
        .catch(error => { if (!abort.signal.aborted) setUploadError(error instanceof Error ? error.message : "Dataset detail unavailable."); });
    }
    return () => abort.abort();
  }, [expandedId]);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/client/datasets", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setUploadError(json.error || "Upload failed.");
        return;
      }
      load();
    } catch {
      setUploadError("Could not reach the server.");
    } finally {
      setUploading(false);
    }
  }, []);

  const toggleExpand = (item: DatasetListItem) => {
    setExpandedId(expandedId === item.id ? null : item.id);
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this dataset? This can't be undone.")) return;
    await fetch(`/api/client/datasets/${id}`, { method: "DELETE" });
    if (expandedId === id) { setExpandedId(null); setDetail(null); }
    load();
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="panel-label">MY DATA</div>
          <div className="font-terminal text-[9px] text-muted-foreground mt-1">Upload your own spreadsheets. Limuria validates and profiles the structure — your consultant sees it while working your engagement, no AI ever reads it raw.</div>
        </div>
        <div>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-2.5 py-1 border border-[hsl(38,95%,50%)/40%] text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)/10%] hover:bg-[hsl(38,95%,50%)/20%] text-[10px] font-terminal uppercase transition-colors disabled:opacity-40"
          >
            <Upload className="w-3 h-3" /> {uploading ? "Uploading..." : "Upload Dataset"}
          </button>
        </div>
      </div>

      {uploadError && <div className="p-2.5 border border-down/40 bg-down/10 text-down text-xs">{uploadError}</div>}

      <div className="p-3 border border-border/60 bg-[#080808] flex items-start gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-up shrink-0 mt-0.5" />
        <p className="font-terminal text-[9px] text-muted-foreground">Your data stays in your organization's own private environment. It's never joined with another client's data, and it's never sent to any AI system — only the deterministic structure (column names, types, row counts) is stored.</p>
      </div>

      {loading ? (
        <div className="p-8 text-center font-terminal text-sm text-muted-foreground animate-pulse">Loading datasets...</div>
      ) : datasets.length === 0 ? (
        <div className="p-8 text-center font-terminal text-sm text-muted-foreground border border-dashed border-border">No datasets uploaded yet.</div>
      ) : (
        <div className="space-y-2">
          {datasets.map((d) => {
            const isExpanded = expandedId === d.id;
            return (
              <div key={d.id} className="border border-border/60 bg-[#080808]">
                <div className="p-3 flex items-center justify-between gap-3 cursor-pointer" onClick={() => toggleExpand(d)}>
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[hsl(38,95%,55%)] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-foreground font-semibold truncate">{d.fileName}</div>
                      <div className="font-terminal text-[9px] text-muted-foreground">{d.sheetCount} sheet{d.sheetCount !== 1 ? "s" : ""} · {d.totalRows.toLocaleString("en-US")} rows · {d.uploadedByName} · {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                    </div>
                  </div>
                  <button onClick={(e) => handleDelete(d.id, e)} className="text-muted-foreground hover:text-down shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isExpanded && detail && detail.id === d.id && (
                  <div className="border-t border-border/60 px-3 pb-3">
                    {detail.profile.sheetNames.length > 1 && (
                      <div className="flex gap-1 pt-2 flex-wrap">
                        {detail.profile.sheetNames.map((name, i) => (
                          <button key={name} onClick={() => setActiveSheet(i)}
                            className={`px-2 py-1 font-terminal text-[9px] uppercase border ${activeSheet === i ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground"}`}>
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                    {detail.profile.sheets[activeSheet] ? <SheetView sheet={detail.profile.sheets[activeSheet]} /> : <p role="status">Saved sheet selection is unavailable in this dataset; select a sheet explicitly.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
