import { useState, useRef, useEffect } from "react";
import { useTerminalArtifactContext, useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { stableSerialize } from "@/lib/analyticalCore";
import { X, Upload, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useActiveWorkspaceId, useWorkspace } from "@/lib/useWorkspaces";

type StatementType = "balance" | "income" | "cashflow";

interface ExtractedFieldValue {
  key: string;
  label: string;
  value: number | null;
  rawText: string | null;
  confidence: "high" | "low";
  sourceMethod: "deterministic" | "llm" | "unmatched";
}

interface ExtractedPeriodReport {
  reportType: StatementType;
  periodLabel: string;
  fiscalYear: string;
  reportedCurrency: string | null;
  fields: ExtractedFieldValue[];
}

interface ExtractionResult {
  fileName: string;
  pageCount: number;
  detectedStatementPages: Record<StatementType, number[]>;
  reports: ExtractedPeriodReport[];
  balanceIdentityChecks: { periodLabel: string; totalAssets: number; totalLiabilitiesAndEquity: number; diffPct: number; pass: boolean }[];
  extractionMethod: string;
  warnings: string[];
}

interface Props {
  symbol: string;
  onClose: () => void;
  onImported: () => void;
}

const STATEMENT_LABEL: Record<StatementType, string> = {
  balance: "BALANCE SHEET",
  income: "INCOME STATEMENT",
  cashflow: "CASH FLOW STATEMENT",
};
interface StatementReviewDraft {
  symbol: string;
  documentHash: string;
  extractionHash: string;
  extraction: ExtractionResult;
  activeStatement: StatementType;
  edits: Record<string, number | null>;
}


export function ImportStatementModal({ symbol, onClose, onImported }: Props) {
  const terminal = useTerminalArtifactContext();
  const setEditing = terminal?.setEditing;
  const ownerRef = useRef(terminal);
  ownerRef.current = terminal;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; setEditing?.("statement-extraction-review", false); }; }, [setEditing]);
  const [review, setReview] = useTerminalArtifactState<StatementReviewDraft | null>(`FinancialStatementsPanel.statementReview.${symbol}`, null);
  const result = review?.symbol === symbol ? review.extraction : null;
  const activeStatement = review?.activeStatement ?? "balance";
  const edits = review?.edits ?? {};
  const setActiveStatement = (value: StatementType) => setReview(previous => previous ? { ...previous, activeStatement: value } : previous);
  const setEdits = (change: (previous: Record<string, number | null>) => Record<string, number | null>) => setReview(previous => previous ? { ...previous, edits: change(previous.edits) } : previous);
  const discardAndClose = () => {
    if (result && !window.confirm("Discard this uncommitted extraction and analyst corrections? They have not been saved as a filed statement.")) return;
    setEditing?.("statement-extraction-review", false);
    setReview(null);
    onClose();
  };
  const keepAndClose = () => {
    if (!terminal) { discardAndClose(); return; }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onClose();
  };
  const [activeWorkspaceId] = useActiveWorkspaceId();
  const { data: activeWorkspace } = useWorkspace(activeWorkspaceId);
  const [phase, setPhase] = useState<"pick" | "extracting" | "review" | "committing" | "error">(result ? "review" : "pick");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(file: File) {
    setEditing?.("statement-extraction-review", true);
    const submittedOwner = terminal?.target?.artifactId ?? null;
    setPhase("extracting");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/uide/statement-extract", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Extraction failed (${res.status}).`);
      }
      const data: ExtractionResult = await res.json();
      const documentHash = bytesToHex(sha256(new Uint8Array(await file.arrayBuffer())));
      const extractionHash = bytesToHex(sha256(utf8ToBytes(stableSerialize(data))));
      if (!mounted.current || (ownerRef.current?.target?.artifactId ?? null) !== submittedOwner) throw new Error("Extraction completed for a changed or closed Artifact; the draft was not attached.");
      const firstType = (["balance", "income", "cashflow"] as StatementType[]).find(t => data.reports.some(report => report.reportType === t)) ?? "balance";
      setEditing?.("statement-extraction-review", false);
      setReview({ symbol, documentHash, extractionHash, extraction: data, activeStatement: firstType, edits: {} });
      setPhase("review");
    } catch (e: any) {
      setError(e?.message || "Failed to extract statements from PDF.");
      setPhase("error");
      setEditing?.("statement-extraction-review", false);
    }
  }

  function editKey(reportType: StatementType, fiscalYear: string, fieldKey: string) {
    return `${reportType}:${fiscalYear}:${fieldKey}`;
  }

  function currentValue(report: ExtractedPeriodReport, field: ExtractedFieldValue): number | null {
    const k = editKey(report.reportType, report.fiscalYear, field.key);
    return k in edits ? edits[k] : field.value;
  }

  async function handleCommit() {
    if (!result) return;
    const submittedOwner = terminal?.target?.artifactId ?? null;
    if (!review || bytesToHex(sha256(utf8ToBytes(stableSerialize(result)))) !== review.extractionHash) { setError("The original extraction draft no longer matches its recorded content. Extract again; corrections were not committed."); return; }
    setEditing?.("statement-extraction-review", true);
    setPhase("committing");
    setError(null);
    try {
      const reportsToCommit = result.reports.map((r) => ({
        ...r,
        fields: r.fields.map((f) => ({ ...f, value: currentValue(r, f) })),
      }));
      const res = await fetch("/api/uide/statement-commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, fileName: result.fileName, reports: reportsToCommit, workspaceId: activeWorkspaceId || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Import failed (${res.status}).`);
      }
      if (!mounted.current || (ownerRef.current?.target?.artifactId ?? null) !== submittedOwner) throw new Error("Import completed for its submitted symbol, but the originating Artifact is no longer open. No other review draft was cleared.");
      setEditing?.("statement-extraction-review", false);
      setReview(null);
      onImported();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to save imported statements.");
      setPhase("review");
      setEditing?.("statement-extraction-review", false);
    }
  }

  const availableTypes = result ? (["balance", "income", "cashflow"] as StatementType[]).filter((t) => result.reports.some((r) => r.reportType === t)) : [];
  const reportsForActive = result ? result.reports.filter((r) => r.reportType === activeStatement).sort((a, b) => Number(b.fiscalYear) - Number(a.fiscalYear)) : [];
  const rowFields = reportsForActive[0]?.fields ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl max-h-[85vh] bg-[#070707] border border-border flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <Upload className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="panel-label">IMPORT PDF STATEMENT — {symbol}</span>
          {activeWorkspace && (
            <span className="font-terminal text-[7px] text-muted-foreground/70 tracking-wider border border-border/50 px-1.5 py-0.5" title="This import will be tagged to your active workspace">
              → {activeWorkspace.name.toUpperCase()}
            </span>
          )}
          <button onClick={keepAndClose} disabled={phase === "extracting" || phase === "committing"} aria-label="Close statement extraction review" className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto scrollbar-thin p-4">
          {phase === "pick" && (
            <div
              className="border border-dashed border-border p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[hsl(38,95%,50%)]/50"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileSelected(file);
              }}
            >
              <FileText className="w-8 h-8 text-muted-foreground" />
              <div className="font-terminal text-[10px] text-muted-foreground text-center">
                DROP A PDF ANNUAL REPORT / STATEMENT FILE HERE, OR CLICK TO BROWSE.
                <br />
                {terminal ? "Extraction and analyst corrections are kept only as an uncommitted draft in this Artifact. Filed figures change only after explicit import." : "Values are extracted locally and shown for review — nothing is saved until you confirm."}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelected(file);
                }}
              />
            </div>
          )}

          {phase === "extracting" && (
            <div className="p-8 text-center font-terminal text-[10px] text-muted-foreground">EXTRACTING STATEMENTS FROM PDF...</div>
          )}

          {phase === "error" && (
            <div className="p-4 border border-red-900/50 bg-red-950/20 font-terminal text-[9px] text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                {error}
                <button onClick={() => setPhase("pick")} className="block mt-2 underline text-muted-foreground hover:text-foreground">
                  Try another file
                </button>
              </div>
            </div>
          )}

          {phase !== "pick" && phase !== "extracting" && result && (
            <div className="space-y-3">
              <p role="status" className="font-terminal text-[8px] text-amber-200">UNCOMMITTED REVIEW DRAFT · {terminal ? "Original extraction and separate analyst corrections are retained in this Artifact; the PDF itself is not retained here." : "This standalone review is not retained until import."} This is not an authoritative filed statement until the explicit import succeeds.</p>
              <div className="font-terminal text-[8px] text-muted-foreground/70">
                {result.fileName} · {result.pageCount} pages · extraction: {result.extractionMethod}
              </div>

              {result.warnings.length > 0 && (
                <div className="border border-amber-900/40 bg-amber-950/10 p-2 space-y-1">
                  {result.warnings.slice(0, 6).map((w, i) => (
                    <div key={i} className="font-terminal text-[8px] text-amber-500/90 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      {w}
                    </div>
                  ))}
                  {result.warnings.length > 6 && (
                    <div className="font-terminal text-[8px] text-muted-foreground">+ {result.warnings.length - 6} more</div>
                  )}
                </div>
              )}

              {result.balanceIdentityChecks.map((c) => (
                <div key={c.periodLabel} className={`font-terminal text-[8px] flex items-center gap-1.5 ${c.pass ? "text-green-500/80" : "text-red-400"}`}>
                  {c.pass ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                  Balance check {c.periodLabel}: assets {c.totalAssets.toLocaleString()} vs liabilities+equity {c.totalLiabilitiesAndEquity.toLocaleString()} ({c.pass ? "matches" : `${(c.diffPct * 100).toFixed(1)}% off — review before importing`})
                </div>
              ))}

              <div className="flex border-b border-border/50">
                {availableTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveStatement(t)}
                    className={`px-3 py-1.5 font-terminal text-[8px] tracking-wider border-r border-border/50 ${
                      activeStatement === t ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {STATEMENT_LABEL[t]}
                  </button>
                ))}
              </div>

              <table className="w-full font-terminal text-[9px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1 text-muted-foreground font-normal">LINE ITEM</th>
                    {reportsForActive.map((r) => (
                      <th key={r.periodLabel} className="text-right py-1 text-muted-foreground font-normal px-2">{r.periodLabel}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowFields.map((rowField) => (
                    <tr key={rowField.key} className="border-b border-border/20 hover:bg-white/[2%]">
                      <td className="py-1 text-foreground/90">{rowField.label}</td>
                      {reportsForActive.map((r) => {
                        const field = r.fields.find((f) => f.key === rowField.key);
                        if (!field) return <td key={r.periodLabel} className="text-right px-2 text-muted-foreground">—</td>;
                        const val = currentValue(r, field);
                        const unmatched = field.sourceMethod === "unmatched";
                        const llmSourced = field.sourceMethod === "llm";
                        return (
                          <td key={r.periodLabel} className="text-right px-2">
                            <div className="inline-flex items-center gap-1">
                              {llmSourced && (
                                <span
                                  title="Filled by local LLM (Ollama) assist -- not deterministically confirmed. Verify against the source PDF."
                                  className="font-terminal text-[6.5px] px-1 py-0.5 bg-sky-500/10 text-sky-400/90 border border-sky-800/40 rounded-none"
                                >
                                  AI
                                </span>
                              )}
                              <input
                                type="number"
                                value={val ?? ""}
                                placeholder={unmatched ? "not found" : ""}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const n = raw === "" ? null : Number(raw);
                                  setEdits((prev) => ({ ...prev, [editKey(r.reportType, r.fiscalYear, field.key)]: n === null || Number.isNaN(n) ? null : n }));
                                }}
                                className={`w-24 bg-transparent text-right border-b px-1 focus:outline-none focus:border-[hsl(38,95%,50%)] ${
                                  unmatched ? "border-amber-900/40 placeholder:text-amber-600/50" : llmSourced ? "border-sky-800/40" : "border-transparent"
                                }`}
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {phase !== "pick" && phase !== "extracting" && result && (
          <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-border shrink-0">
            {error && <span className="font-terminal text-[8px] text-red-400 mr-auto">{error}</span>}
            {terminal && <button type="button" disabled={phase === "committing"} onClick={keepAndClose} className="font-terminal text-[8px] px-3 py-1.5 border border-border">KEEP REVIEW DRAFT / CLOSE</button>}
            <button
              onClick={discardAndClose}
              disabled={phase === "committing"}
              className="font-terminal text-[8px] tracking-widest px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground"
            >
              DISCARD REVIEW DRAFT
            </button>
            <button
              onClick={handleCommit}
              disabled={phase === "committing"}
              className="font-terminal text-[8px] tracking-widest px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-bold disabled:opacity-50"
            >
              {phase === "committing" ? "IMPORTING..." : `IMPORT ALL ${result.reports.length} PERIOD-STATEMENT(S) INTO ${symbol}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
