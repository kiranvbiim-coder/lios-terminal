import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Pin, PinOff, RefreshCw, XCircle } from "lucide-react";

type SourceStatus = "LIVE" | "CACHED" | "HISTORICAL" | "MANUAL";
type ConflictStatus = "agreement" | "disagreement" | "insufficient";

interface Observation {
  providerId: string;
  provider: string;
  source: string;
  value: unknown;
  asOf: string;
  retrievedAt: string;
  status: SourceStatus;
  temporalStatus: "CURRENT" | "HISTORICAL";
  snapshotId: string;
  contentHash: string;
  observationHash: string;
}

interface Group {
  metric: string;
  period: string;
  status: ConflictStatus;
  unresolved: boolean;
  conflictHash: string;
  observations: Observation[];
}

interface ConflictView {
  symbol: string;
  metric: string;
  requestedPeriod: string;
  groups: Group[];
  limitations: string[];
}

/** Mirrors shared/dataStackPins.ts's DataStackPin -- kept as a local,
 * narrower client-side shape (this panel only ever reads/writes
 * scope:"metric" pins scoped to "statements") rather than importing the
 * full server/shared type surface into a single presentational component. */
interface ConflictPin {
  id: string;
  scope: "global" | "family" | "symbol" | "metric";
  family: string | null;
  symbol: string | null;
  metric: string | null;
  providerId: string;
  reason: string | null;
  createdAt: string;
}

export interface ProviderConflictPanelProps {
  symbol: string;
  metric: string;
  period: string;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "non-finite";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function badgeClass(status: SourceStatus | "CURRENT" | "HISTORICAL"): string {
  if (status === "LIVE") return "border-emerald-500/40 text-emerald-400 bg-emerald-500/5";
  if (status === "MANUAL") return "border-violet-500/40 text-violet-300 bg-violet-500/5";
  if (status === "HISTORICAL") return "border-cyan-500/40 text-cyan-300 bg-cyan-500/5";
  return "border-border text-muted-foreground";
}

function statusLabel(group: Group): string {
  if (group.status === "disagreement") return "UNRESOLVED DISAGREEMENT";
  if (group.status === "agreement") return "AGREEMENT";
  return "INSUFFICIENT SOURCES";
}

export default function ProviderConflictPanel({ symbol, metric, period }: ProviderConflictPanelProps) {
  const [view, setView] = useState<ConflictView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pins, setPins] = useState<ConflictPin[]>([]);
  const [pinBusyProviderId, setPinBusyProviderId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const cleanSymbol = symbol.trim().toUpperCase();
  const cleanMetric = metric.trim();
  const cleanPeriod = period.trim();

  const refreshPins = useCallback(() => {
    void fetch("/api/data-truth/pins")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`);
        return response.json() as Promise<{ pins: ConflictPin[] }>;
      })
      .then((payload) => setPins(payload.pins))
      .catch(() => setPins([]));
  }, []);

  useEffect(() => {
    if (!cleanSymbol || !cleanMetric || !cleanPeriod) {
      setView(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/data-truth/conflicts?symbol=${encodeURIComponent(cleanSymbol)}&metric=${encodeURIComponent(cleanMetric)}&period=${encodeURIComponent(cleanPeriod)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`);
        return response.json() as Promise<ConflictView>;
      })
      .then(setView)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setView(null);
        setError(reason instanceof Error ? reason.message : "Provider conflict lookup failed.");
      })
      .finally(() => setLoading(false));
    refreshPins();
    return () => controller.abort();
  }, [cleanSymbol, cleanMetric, cleanPeriod, refreshPins]);

  // The statements family is what /api/data-truth/conflicts is scoped to
  // today (financial_statements_conflicts snapshots) -- a metric-scoped
  // pin here always targets family:"statements", matching what
  // dataStackService.ts's resolveFamilyProviderOrder actually looks up for
  // resolveFinancialStatements/getFinancialReportsWithFallback.
  const pinnedProviderId = pins.find((p) => p.scope === "metric" && p.family === "statements" && p.symbol === cleanSymbol && p.metric === cleanMetric)?.providerId ?? null;

  async function pinProvider(providerId: string) {
    setPinBusyProviderId(providerId);
    setPinError(null);
    try {
      const response = await fetch("/api/data-truth/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "metric", family: "statements", symbol: cleanSymbol, metric: cleanMetric, providerId }),
      });
      if (!response.ok) throw new Error(`Pin request failed with HTTP ${response.status}.`);
      refreshPins();
    } catch (reason) {
      setPinError(reason instanceof Error ? reason.message : "Failed to pin this source.");
    } finally {
      setPinBusyProviderId(null);
    }
  }

  async function unpin(pinId: string) {
    setPinBusyProviderId(pinId);
    setPinError(null);
    try {
      const response = await fetch(`/api/data-truth/pins/${encodeURIComponent(pinId)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error(`Unpin request failed with HTTP ${response.status}.`);
      refreshPins();
    } catch (reason) {
      setPinError(reason instanceof Error ? reason.message : "Failed to remove this pin.");
    } finally {
      setPinBusyProviderId(null);
    }
  }

  return (
    <section className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <RefreshCw className={`w-3.5 h-3.5 text-[hsl(38,95%,55%)] ${loading ? "animate-spin" : ""}`} />
        <span className="panel-label">PROVIDER CONFLICTS</span>
        <span className="font-terminal text-[9px] text-muted-foreground ml-auto">{symbol.toUpperCase()} · {metric} · {period.toUpperCase()}</span>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {loading && <div className="font-terminal text-[9px] text-muted-foreground">Reading immutable source captures...</div>}
        {error && <div className="flex items-center gap-2 font-terminal text-[9px] text-[hsl(0,80%,60%)]"><XCircle className="w-3.5 h-3.5" />{error}</div>}
        {pinError && <div className="flex items-center gap-2 font-terminal text-[9px] text-[hsl(0,80%,60%)] mb-2"><XCircle className="w-3.5 h-3.5" />{pinError}</div>}
        {pinnedProviderId && (
          <div className="mb-3 flex items-center gap-2 border border-[hsl(38,95%,55%)]/30 bg-[hsl(38,95%,55%)]/5 px-3 py-2 font-terminal text-[8px] text-[hsl(38,95%,55%)]">
            <Pin className="w-3 h-3" /> This metric is pinned to a specific source. Resolution always uses it first, ahead of your ranked provider stack.
          </div>
        )}
        {!loading && !error && view && view.groups.length === 0 && (
          <div className="border border-border p-3 font-terminal text-[9px] text-muted-foreground">No permitted observation is linked to an immutable conflict capture for this metric and period.</div>
        )}
        {!loading && !error && view && view.groups.length > 0 && (
          <div className="space-y-3">
            {view.groups.map((group) => (
              <article key={`${group.metric}:${group.period}`} className="border border-border">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  {group.status === "disagreement" ? <AlertTriangle className="w-3.5 h-3.5 text-[hsl(0,80%,60%)]" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  <span className={`font-terminal text-[9px] uppercase tracking-widest ${group.status === "disagreement" ? "text-[hsl(0,80%,60%)]" : "text-muted-foreground"}`}>{group.period} · {statusLabel(group)}</span>
                  <span className="font-terminal text-[8px] text-muted-foreground ml-auto" title={group.conflictHash}>HASH {group.conflictHash.slice(0, 12)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full font-terminal text-[9px]">
                    <thead><tr className="text-muted-foreground uppercase text-[8px] border-b border-border"><th className="text-left px-3 py-1.5">Provider / source</th><th className="text-right px-3 py-1.5">Value</th><th className="text-left px-3 py-1.5">Status</th><th className="text-left px-3 py-1.5">As of / retrieved</th><th className="text-left px-3 py-1.5">Snapshot</th><th className="text-left px-3 py-1.5">Pin</th></tr></thead>
                    <tbody>
                      {group.observations.map((observation) => {
                        const isPinned = pinnedProviderId === observation.providerId;
                        const activePin = pins.find((p) => p.scope === "metric" && p.family === "statements" && p.symbol === cleanSymbol && p.metric === cleanMetric && p.providerId === observation.providerId);
                        return (
                          <tr key={`${observation.providerId}:${observation.observationHash}`} className="border-b border-border/50 last:border-0">
                            <td className="px-3 py-1.5 text-foreground">{observation.provider}<span className="block text-[8px] text-muted-foreground">{observation.source}</span></td>
                            <td className="px-3 py-1.5 text-right text-foreground">{formatValue(observation.value)}</td>
                            <td className="px-3 py-1.5"><span className={`inline-block border px-1.5 py-0.5 text-[8px] ${badgeClass(observation.status)}`}>{observation.status}</span><span className={`ml-1 inline-block border px-1.5 py-0.5 text-[8px] ${badgeClass(observation.temporalStatus)}`}>{observation.temporalStatus}</span></td>
                            <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{observation.asOf.slice(0, 10)}<span className="block text-[8px]">{observation.retrievedAt.slice(0, 19).replace("T", " ")}Z</span></td>
                            <td className="px-3 py-1.5 text-muted-foreground" title={`${observation.snapshotId} · ${observation.contentHash}`}>{observation.snapshotId.slice(0, 8)} · {observation.contentHash.slice(0, 8)}</td>
                            <td className="px-3 py-1.5">
                              {isPinned && activePin ? (
                                <button
                                  type="button"
                                  onClick={() => unpin(activePin.id)}
                                  disabled={pinBusyProviderId !== null}
                                  className="inline-flex items-center gap-1 border border-[hsl(38,95%,55%)]/50 text-[hsl(38,95%,55%)] px-1.5 py-0.5 text-[8px] uppercase tracking-widest hover:bg-[hsl(38,95%,55%)]/10 disabled:opacity-50"
                                  title="Remove this pin -- resolution returns to your ranked provider stack for this metric."
                                >
                                  <PinOff className="w-3 h-3" /> Pinned
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => pinProvider(observation.providerId)}
                                  disabled={pinBusyProviderId !== null}
                                  className="inline-flex items-center gap-1 border border-border text-muted-foreground px-1.5 py-0.5 text-[8px] uppercase tracking-widest hover:border-[hsl(38,95%,55%)]/50 hover:text-[hsl(38,95%,55%)] disabled:opacity-50"
                                  title="Always use this source for this symbol+metric, ahead of your ranked provider stack."
                                >
                                  <Pin className="w-3 h-3" /> Pin
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {group.unresolved && <div className="px-3 py-2 border-t border-[hsl(0,80%,60%)]/20 bg-[hsl(0,80%,60%)]/5 font-terminal text-[8px] text-[hsl(0,80%,60%)]">Values differ. No source was selected or marked resolved.</div>}
              </article>
            ))}
            {view.limitations.map((limitation) => <div key={limitation} className="font-terminal text-[8px] text-muted-foreground">[LIMITATION] {limitation}</div>)}
          </div>
        )}
      </div>
    </section>
  );
}
