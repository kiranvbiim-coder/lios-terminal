import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { MarketDatasetRevisionReport, PointInTimeMarketSnapshot } from "@shared/pointInTimeData";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

function number(value: number | null, digits = 4) {
  return value === null ? "--" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function MarketDataFabricPanel({ symbol }: { symbol: string }) {
  const upper = symbol.toUpperCase();
  const [snapshots, setSnapshots] = useState<PointInTimeMarketSnapshot[]>([]);
  const [revision, setRevision] = useState<MarketDatasetRevisionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"bars" | "actions" | "lineage">("bars");
  const current = snapshots[0] ?? null;

  const load = useCallback(async () => {
    try {
      setError(null);
      const rows = await json<PointInTimeMarketSnapshot[]>(`/api/data-snapshots/markets/${encodeURIComponent(upper)}`);
      setSnapshots(rows);
      setRevision(rows[0] ? await json<MarketDatasetRevisionReport>(`/api/data-snapshots/${rows[0].id}/revisions`) : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Market dataset unavailable."); }
  }, [upper]);

  useEffect(() => { void load(); }, [load]);

  const capture = async () => {
    setBusy(true); setError(null);
    try {
      await json(`/api/data-snapshots/markets/${encodeURIComponent(upper)}`, { method: "POST", body: JSON.stringify({ range: "5Y" }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Capture failed."); }
    finally { setBusy(false); }
  };

  const bars = useMemo(() => [...(current?.payload.bars ?? [])].reverse().slice(0, 250), [current]);

  return <div className="h-full min-h-0 flex flex-col bg-background overflow-hidden">
    <header className="shrink-0 border-b border-border px-4 py-3 flex flex-wrap items-center gap-3">
      <Database className="w-4 h-4 text-amber-300" />
      <div><div className="font-terminal text-[10px]">POINT-IN-TIME MARKET DATA / {upper}</div><div className="font-mono text-[7px] text-muted-foreground">IMMUTABLE DAILY OBSERVATIONS, RETURNS, ACTIONS AND REVISION LINEAGE</div></div>
      <button onClick={capture} disabled={busy} className="ml-auto h-8 border border-amber-400/40 px-3 font-terminal text-[8px] text-amber-300 disabled:opacity-40" title="Capture a new immutable five-year market snapshot">
        <RefreshCw className={`inline w-3.5 h-3.5 mr-2 ${busy ? "animate-spin" : ""}`} />{busy ? "CAPTURING" : "CAPTURE 5Y"}
      </button>
    </header>
    {error && <div className="shrink-0 border-b border-red-400/30 bg-red-400/5 px-4 py-2 font-mono text-[8px] text-red-300"><TriangleAlert className="inline w-3.5 h-3.5 mr-2" />{error}</div>}
    {!current ? <div className="flex-1 grid place-items-center"><div className="text-center"><Database className="mx-auto mb-3 w-6 h-6 text-muted-foreground" /><div className="font-terminal text-[9px]">NO FROZEN MARKET DATASET</div><div className="mt-1 font-mono text-[7px] text-muted-foreground">CAPTURE CREATES THE FIRST AUDITABLE VERSION FOR {upper}</div></div></div> : <>
      <div className="shrink-0 grid grid-cols-2 md:grid-cols-6 border-b border-border">
        {[
          ["OBSERVATIONS", current.quality.barCount], ["QUALITY", `${(current.quality.score * 100).toFixed(1)}%`],
          ["ACTIONS", current.quality.actionCount], ["VERSIONS", snapshots.length], ["CORRECTIONS", revision?.changedObservations ?? 0],
          ["MATERIAL", revision?.materialChanges ?? 0],
        ].map(([label, value]) => <div key={label} className="border-r border-border px-3 py-2"><div className="font-mono text-[7px] text-muted-foreground">{label}</div><div className="font-terminal text-[10px]">{value}</div></div>)}
      </div>
      <div className="shrink-0 border-b border-border px-4 py-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[7px] text-muted-foreground">
        <span>{current.observationStart} TO {current.observationEnd}</span><span>{current.currency} / {current.timezone}</span><span>BASIS {current.payload.priceBasis.toUpperCase()}</span><span>AS OF {new Date(current.availableAt).toLocaleString()}</span><span>HASH {current.contentHash.slice(0, 12)}</span>
        <span className={current.quality.warnings.length ? "text-amber-300" : "text-emerald-300"}><ShieldCheck className="inline w-3 h-3 mr-1" />{current.quality.warnings.length ? `${current.quality.warnings.length} DATA WARNINGS` : "QUALITY GATE CLEAR"}</span>
      </div>
      {current.quality.warnings.length > 0 && <div className="shrink-0 border-b border-border bg-amber-400/[0.03] px-4 py-2 font-mono text-[7px] text-amber-200">{current.quality.warnings.join(" / ")}</div>}
      <div className="shrink-0 border-b border-border px-4 py-2 flex gap-1">
        {(["bars", "actions", "lineage"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`h-7 border px-3 font-terminal text-[7px] ${tab === item ? "border-amber-400/50 text-amber-300" : "border-border text-muted-foreground"}`}>{item.toUpperCase()}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "bars" && <table className="w-full font-mono text-[8px]"><thead className="sticky top-0 bg-black text-muted-foreground"><tr>{["DATE", "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "PRICE RET", "LOG RET", "TOTAL RET"].map((item) => <th key={item} className="border-b border-border px-3 py-2 text-right first:text-left">{item}</th>)}</tr></thead><tbody>{bars.map((bar) => <tr key={bar.date} className="border-b border-border/50"><td className="px-3 py-1.5">{bar.date}</td>{[bar.open, bar.high, bar.low, bar.close, bar.volume].map((value, index) => <td key={index} className="px-3 py-1.5 text-right">{number(value, index === 4 ? 0 : 4)}</td>)}{[bar.priceReturn, bar.logReturn, bar.totalReturn].map((value, index) => <td key={index} className="px-3 py-1.5 text-right">{value === null ? "--" : `${(value * 100).toFixed(3)}%`}</td>)}</tr>)}</tbody></table>}
        {tab === "actions" && <table className="w-full font-mono text-[8px]"><thead className="sticky top-0 bg-black text-muted-foreground"><tr>{["EFFECTIVE", "TYPE", "CASH", "CURRENCY", "SPLIT", "SOURCE"].map((item) => <th key={item} className="border-b border-border px-3 py-2 text-left">{item}</th>)}</tr></thead><tbody>{current.payload.corporateActions.map((action, index) => <tr key={`${action.effectiveDate}-${action.type}-${index}`} className="border-b border-border/50"><td className="px-3 py-2">{action.effectiveDate}</td><td className="px-3 py-2">{action.type.toUpperCase()}</td><td className="px-3 py-2">{number(action.cashAmount)}</td><td className="px-3 py-2">{action.currency ?? "--"}</td><td className="px-3 py-2">{action.splitFrom && action.splitTo ? `${action.splitFrom}:${action.splitTo}` : "--"}</td><td className="px-3 py-2">{action.source}</td></tr>)}</tbody></table>}
        {tab === "lineage" && <pre className="p-4 whitespace-pre-wrap font-mono text-[8px] leading-5 text-muted-foreground">{JSON.stringify({ snapshotId: current.id, parentSnapshotId: current.parentSnapshotId, datasetKey: current.datasetKey, retrievedAt: current.retrievedAt, availableAt: current.availableAt, lineage: current.lineage, revision }, null, 2)}</pre>}
      </div>
    </>}
  </div>;
}
