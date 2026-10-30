import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, RefreshCw, Server, Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface RuntimeHealthReport {
  componentId: string;
  state: string;
  detail?: string;
  checkedAt: string;
}

interface Measured<T> {
  data: T;
  /** Round-trip of the real request, measured in the renderer. */
  roundTripMs: number;
}

async function measuredJson<T>(url: string): Promise<Measured<T>> {
  const started = performance.now();
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const data = (await response.json()) as T;
  return { data, roundTripMs: performance.now() - started };
}

const REFRESH_MS = 15_000;

function NotMeasured({ reason }: { reason: string }) {
  return <span className="text-[8px] text-muted-foreground">{reason}</span>;
}

export default function DeveloperConsolePanel() {
  const cache = useQuery({ queryKey: ["developer-console", "cache"], queryFn: () => measuredJson<{ entries: number; inflight: number; limit: number }>("/api/data-fabric/cache"), refetchInterval: REFRESH_MS });
  const health = useQuery({ queryKey: ["developer-console", "runtime-health"], queryFn: () => measuredJson<{ health: RuntimeHealthReport[] }>("/api/runtime/foundation/health"), refetchInterval: REFRESH_MS });
  const control = useQuery({ queryKey: ["developer-console", "production-control"], queryFn: () => measuredJson<{ telemetryEnabled: boolean; counts: { diagnosticEvents: number; deletionReceipts: number; exportCustodyReceipts: number } }>("/api/admin/production-control/status"), refetchInterval: REFRESH_MS });

  const refetchAll = () => { void cache.refetch(); void health.refetch(); void control.refetch(); };
  const fetching = cache.isFetching || health.isFetching || control.isFetching;
  const reports = health.data?.data.health ?? [];
  const stateCounts = reports.reduce<Record<string, number>>((acc, report) => ({ ...acc, [report.state]: (acc[report.state] ?? 0) + 1 }), {});

  return (
    <div className="h-full flex flex-col bg-[#050505] text-foreground overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <Server className="w-4 h-4 text-cyan-400" />
        <span className="panel-label font-bold text-xs tracking-wider">SYSTEM STATUS</span>
        <button type="button" onClick={refetchAll} disabled={fetching} className="ml-auto flex min-h-8 items-center gap-1.5 rounded border border-border px-2 font-terminal text-[8px] tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Refresh system status">
          <RefreshCw className={`h-3 w-3 ${fetching ? "animate-spin" : ""}`} /> REFRESH
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-3 space-y-1">
              <span className="text-[8.5px] text-muted-foreground tracking-wider uppercase block">PROVIDER CACHE</span>
              {cache.data ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-cyan-400">{cache.data.data.entries}</span>
                  <span className="text-[8px] text-muted-foreground">/ {cache.data.data.limit} entries · {cache.data.data.inflight} in flight</span>
                </div>
              ) : <NotMeasured reason={cache.isError ? "Unavailable" : "Loading…"} />}
            </CardContent>
          </Card>

          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-3 space-y-1">
              <span className="text-[8.5px] text-muted-foreground tracking-wider uppercase block">API ROUND TRIP</span>
              {health.data ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-emerald-400">{health.data.roundTripMs.toFixed(0)} ms</span>
                  <span className="text-[8px] text-muted-foreground">runtime health request, last sample</span>
                </div>
              ) : <NotMeasured reason={health.isError ? "Unavailable" : "Loading…"} />}
            </CardContent>
          </Card>

          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-3 space-y-1">
              <span className="text-[8.5px] text-muted-foreground tracking-wider uppercase block">RUNTIME COMPONENTS</span>
              {health.data ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-amber-500">{reports.length}</span>
                  <span className="text-[8px] text-muted-foreground">{Object.entries(stateCounts).map(([state, count]) => `${count} ${state}`).join(" · ") || "none registered"}</span>
                </div>
              ) : <NotMeasured reason={health.isError ? "Unavailable" : "Loading…"} />}
            </CardContent>
          </Card>

          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-3 space-y-1">
              <span className="text-[8.5px] text-muted-foreground tracking-wider uppercase block">HEAP / CPU</span>
              <span className="text-sm font-bold text-muted-foreground">Not measured</span>
              <div><NotMeasured reason="The server exposes no process memory or CPU endpoint." /></div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 border border-border p-4 bg-[#070707]">
            <div className="flex items-center gap-1.5 mb-3">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-terminal text-[9px] font-bold text-muted-foreground uppercase">Runtime component health</span>
            </div>
            {health.isError ? (
              <div role="alert" className="font-terminal text-[9px] text-rose-300">Runtime health could not be loaded.</div>
            ) : reports.length === 0 ? (
              <div className="font-terminal text-[9px] text-muted-foreground">{health.isLoading ? "Loading…" : "No runtime components are registered."}</div>
            ) : (
              <ul className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
                {reports.map((report) => (
                  <li key={report.componentId} className="font-terminal text-[9px]">
                    <span className="text-foreground">{report.componentId}</span>
                    <span className="ml-2 uppercase tracking-wider text-cyan-300">{report.state}</span>
                    {report.detail && <div className="text-[8px] text-muted-foreground">{report.detail}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border border-border p-4 bg-[#070707]">
            <div className="flex items-center gap-1.5 mb-3">
              <Shield className="w-3.5 h-3.5 text-amber-500" />
              <span className="font-terminal text-[9px] font-bold text-muted-foreground uppercase">Production control</span>
            </div>
            {control.data ? (
              <dl className="space-y-1.5 font-terminal text-[9px]">
                <div className="flex justify-between"><dt className="text-muted-foreground">Telemetry</dt><dd>{control.data.data.telemetryEnabled ? "enabled" : "disabled"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Diagnostic events</dt><dd>{control.data.data.counts.diagnosticEvents}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Deletion receipts</dt><dd>{control.data.data.counts.deletionReceipts}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Export custody receipts</dt><dd>{control.data.data.counts.exportCustodyReceipts}</dd></div>
              </dl>
            ) : (
              <NotMeasured reason={control.isError ? "Unavailable for this role." : "Loading…"} />
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 font-terminal text-[8px] text-muted-foreground">
          <Activity className="w-3 h-3" /> Values refresh every {REFRESH_MS / 1000}s from the server; nothing on this screen is simulated.
        </div>
      </div>
    </div>
  );
}
