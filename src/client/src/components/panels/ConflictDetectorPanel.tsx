import { useState } from "react";
import { AlertTriangle, CheckCircle2, GitCompareArrows, RefreshCw, Save, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Props { symbol?: string }

interface ConflictValue {
  providerId: string;
  value: unknown;
}

interface Conflict {
  key: string;
  field: string;
  values: ConflictValue[];
  material?: boolean;
}

interface Resolution {
  capability: string;
  entity: string;
  authoritative: { providerId: string; providerLabel: string; value: unknown } | null;
  observations: Array<{ providerId: string; providerLabel: string }>;
  attemptedProviders: string[];
  failures: Array<{ providerId: string; message: string }>;
  conflicts: Conflict[];
  authoritativeReason: string | null;
  resolvedAt: string;
}

const REPORT_TYPES = ["income", "balance", "cashflow"] as const;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(3)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    return String(value);
  }
  return String(value);
}

export default function ConflictDetectorPanel({ symbol: initialSymbol }: Props) {
  const [symbol, setSymbol] = useState(initialSymbol ?? "AAPL");
  const [reportType, setReportType] = useState<(typeof REPORT_TYPES)[number]>("income");
  const [period, setPeriod] = useState("FY");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Resolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const checkConflicts = async () => {
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    try {
      const res = await fetch(`/api/lse/financials/${encodeURIComponent(symbol.toUpperCase())}/conflicts?reportType=${reportType}&period=${period}`);
      if (!res.ok) throw new Error(`Request failed with HTTP ${res.status}.`);
      setResult(await res.json() as Resolution);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check sources.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const saveSnapshot = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await apiRequest("POST", `/api/data-snapshots/financials/${encodeURIComponent(symbol.toUpperCase())}/conflicts`, { reportType, period });
      const body = await res.json() as { created: boolean; snapshot: { id: string } };
      setSaveMessage(body.created ? `Saved new point-in-time snapshot ${body.snapshot.id.slice(0, 8)}.` : "Unchanged since the last snapshot -- reused the existing record.");
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Snapshot capture failed.");
    } finally {
      setSaving(false);
    }
  };

  const materialConflicts = result?.conflicts.filter((c) => c.material !== false) ?? [];
  const minorConflicts = result?.conflicts.filter((c) => c.material === false) ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <GitCompareArrows className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">DATA CONFLICT DETECTOR</span>
        <span className="font-terminal text-[9px] text-muted-foreground ml-auto">financial_statements</span>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 flex-wrap">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") void checkConflicts(); }}
          placeholder="SYMBOL"
          className="w-24 bg-[#0a0a0a] border border-border px-2 py-1 font-terminal text-[10px] text-foreground uppercase focus:outline-none focus:border-[hsl(38,95%,50%)]/50"
        />
        <select value={reportType} onChange={(e) => setReportType(e.target.value as typeof reportType)} className="bg-[#0a0a0a] border border-border px-2 py-1 font-terminal text-[9px] text-foreground uppercase">
          {REPORT_TYPES.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="bg-[#0a0a0a] border border-border px-2 py-1 font-terminal text-[9px] text-foreground uppercase">
          <option value="FY">FY</option>
          <option value="Q">Q</option>
        </select>
        <button
          onClick={() => void checkConflicts()}
          disabled={loading || !symbol.trim()}
          className="flex items-center gap-1.5 px-3 py-1 bg-[hsl(38,95%,50%)]/10 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] font-terminal text-[9px] uppercase tracking-widest disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Checking..." : "Check Sources"}
        </button>
        {result && (
          <button
            onClick={() => void saveSnapshot()}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1 border border-border text-muted-foreground font-terminal text-[9px] uppercase tracking-widest disabled:opacity-40 hover:border-border/80"
          >
            <Save className="w-3 h-3" />
            {saving ? "Saving..." : "Save Snapshot"}
          </button>
        )}
        {saveMessage && <span className="font-terminal text-[8px] text-muted-foreground">{saveMessage}</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="flex items-center gap-2 text-[hsl(0,80%,60%)] font-terminal text-[9px] mb-3">
            <XCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}
        {!result && !error && !loading && (
          <div className="font-terminal text-[9px] text-muted-foreground">
            Enter a symbol and click "Check Sources" to concurrently call every automatic financial-statement provider and compare their answers. This calls real provider APIs -- more expensive than the terminal's normal single-source display, so it's action-triggered, not automatic.
          </div>
        )}
        {result && (
          <div className="space-y-4">
            <div className="border border-border p-3">
              <div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-widest mb-2">Authoritative Source</div>
              <div className="flex items-center gap-2">
                {result.authoritative ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-[hsl(0,80%,60%)]" />}
                <span className="font-terminal text-[12px] text-foreground font-bold uppercase">{result.authoritative?.providerLabel ?? "None -- no provider returned data"}</span>
              </div>
              {result.authoritativeReason && <div className="font-terminal text-[8px] text-muted-foreground mt-1">{result.authoritativeReason}</div>}
              <div className="font-terminal text-[8px] text-muted-foreground mt-2">
                Attempted: {result.attemptedProviders.join(", ")}
                {result.failures.length > 0 && ` -- ${result.failures.length} failed`}
              </div>
            </div>

            <div className="border border-border p-3">
              <div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-widest mb-2">
                Sources Compared ({result.observations.length})
              </div>
              <div className="flex gap-2 flex-wrap">
                {result.observations.map((o) => (
                  <span key={o.providerId} className={`font-terminal text-[9px] px-2 py-1 border ${o.providerId === result.authoritative?.providerId ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/5" : "border-border text-muted-foreground"}`}>
                    {o.providerLabel}
                  </span>
                ))}
              </div>
            </div>

            <div className="border border-border p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
                <span className="font-terminal text-[8px] text-muted-foreground uppercase tracking-widest">
                  {result.conflicts.length === 0 ? "No conflicts -- every source agrees" : `${materialConflicts.length} material, ${minorConflicts.length} minor conflict${result.conflicts.length === 1 ? "" : "s"}`}
                </span>
              </div>
              {result.conflicts.length > 0 && (
                <table className="w-full font-terminal text-[9px]">
                  <thead>
                    <tr className="text-muted-foreground uppercase text-[8px] border-b border-border">
                      <th className="text-left py-1 pr-2">Period</th>
                      <th className="text-left py-1 pr-2">Field</th>
                      <th className="text-left py-1 pr-2">Severity</th>
                      <th className="text-left py-1">Values by Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.conflicts.map((c, i) => (
                      <tr key={`${c.key}:${c.field}:${i}`} className="border-b border-border/50">
                        <td className="py-1 pr-2 text-muted-foreground">{c.key}</td>
                        <td className="py-1 pr-2 text-foreground">{c.field}</td>
                        <td className="py-1 pr-2">
                          <span className={c.material === false ? "text-cyan-400" : "text-[hsl(0,80%,60%)]"}>{c.material === false ? "minor" : "material"}</span>
                        </td>
                        <td className="py-1 text-foreground">
                          {c.values.map((v) => `${v.providerId}: ${formatValue(v.value)}`).join("  ·  ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
