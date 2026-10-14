import { useState, useRef } from "react";
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

export function ImportStatementModal({ symbol, onClose, onImported }: Props) {
  const [activeWorkspaceId] = useActiveWorkspaceId();
  const { data: activeWorkspace } = useWorkspace(activeWorkspaceId);
  const [phase, setPhase] = useState<"pick" | "extracting" | "review" | "committing" | "error">("pick");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [activeStatement, setActiveStatement] = useState<StatementType>("balance");
  // Local edits keyed by "reportType:fiscalYear:fieldKey" -- overlays the
  // server's extracted value without mutating `result`, so RESET (re-render
  // from `result`) is just "don't apply an override", same pattern as
  // EditableValue's override model elsewhere in this app.
  const [edits, setEdits] = useState<Record<string, number | null>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(file: File) {
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
      setResult(data);
      const firstType = (["balance", "income", "cashflow"] as StatementType[]).find((t) => data.reports.some((r) => r.reportType === t));
      if (firstType) setActiveStatement(firstType);
      setPhase("review");
    } catch (e: any) {
      setError(e?.message || "Failed to extract statements from PDF.");
      setPhase("error");
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
      onImported();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to save imported statements.");
      setPhase("review");
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
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
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
                Values are extracted locally and shown for review — nothing is saved until you confirm.
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
            <button
              onClick={onClose}
              className="font-terminal text-[8px] tracking-widest px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground"
            >
              CANCEL
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
