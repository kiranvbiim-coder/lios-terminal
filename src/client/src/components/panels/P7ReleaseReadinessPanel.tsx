import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import type { P7ReleaseReadinessSnapshot, P7ReleaseReadinessRow } from "@shared/p7ReleaseContracts";
import { apiRequest } from "@/lib/queryClient";

function stateIcon(row: P7ReleaseReadinessRow) {
  if (row.state === "ready" || row.state === "verified") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
  if (row.state === "blocked") return <LockKeyhole className="h-3.5 w-3.5 text-rose-300" />;
  return <CircleAlert className="h-3.5 w-3.5 text-amber-300" />;
}

export default function P7ReleaseReadinessPanel() {
  const query = useQuery<P7ReleaseReadinessSnapshot>({
    queryKey: ["/api/operations/p7-release-readiness"],
    queryFn: async () => (await apiRequest("GET", "/api/operations/p7-release-readiness")).json(),
    staleTime: 30_000,
  });
  const data = query.data;

  return (
    <section className="border border-orange-300/25 bg-orange-300/[0.025] p-3" data-p7-release-readiness>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-terminal text-[9px] tracking-widest text-orange-200">
            <ShieldCheck className="h-4 w-4" /> ACTIVE P7 · DESKTOP & ENTERPRISE RELEASE
          </div>
          <p className="mt-1 max-w-3xl font-ui text-[8px] leading-4 text-muted-foreground">
            Engineering completion is intentionally separate from release certification. Real signing, clean-machine, assistive-tech, security-review and tenant deployment evidence stays external until actually verified.
          </p>
        </div>
        <button type="button" onClick={() => void query.refetch()} className="flex items-center gap-1.5 border border-border px-2 py-1 font-terminal text-[8px] text-muted-foreground hover:text-foreground">
          <RefreshCw className={`h-3 w-3 ${query.isFetching ? "animate-spin" : ""}`} /> REFRESH
        </button>
      </div>

      {query.isLoading && <div className="mt-3 font-terminal text-[8px] text-muted-foreground">Loading active P7 release readiness…</div>}
      {query.isError && <div className="mt-3 border border-rose-400/30 bg-rose-400/5 p-3 font-terminal text-[8px] text-rose-200">P7 readiness unavailable. Release state is not promoted without the server contract.</div>}

      {data && (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <Metric label="ENGINEERING" value={data.engineeringComplete ? "COMPLETE" : "BLOCKED"} good={data.engineeringComplete} />
            <Metric label="RELEASE" value={data.releaseCertified ? "CERTIFIED" : "EVIDENCE REQUIRED"} good={data.releaseCertified} />
            <Metric label="ENGINEERING CHECKS" value={`${data.counts.engineeringReady} READY`} good={data.counts.engineeringBlocked === 0} />
            <Metric label="EXTERNAL GATES" value={String(data.counts.externalRequired)} good={data.counts.externalRequired === 0} />
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {data.rows.map((row) => (
              <article key={row.id} className="border border-border/60 bg-[#060606] p-2.5">
                <div className="flex items-center gap-2">
                  {stateIcon(row)}
                  <span className="font-terminal text-[7px] uppercase tracking-wider text-orange-200">{row.category.replaceAll("_", " ")}</span>
                  <span className="font-ui text-[9px] font-semibold text-foreground">{row.label}</span>
                  <span className={`ml-auto font-terminal text-[7px] uppercase ${row.state === "ready" || row.state === "verified" ? "text-emerald-300" : row.state === "blocked" ? "text-rose-300" : "text-amber-300"}`}>{row.state.replaceAll("_", " ")}</span>
                </div>
                <div className="mt-1 pl-5 font-terminal text-[6px] uppercase text-muted-foreground">OWNER · {row.owner.replaceAll("_", " ")}{row.requiredForRelease ? " · RELEASE GATE" : ""}</div>
                {row.evidence.length > 0 && <div className="mt-1 pl-5 font-ui text-[8px] leading-4 text-muted-foreground">{row.evidence[0]}</div>}
                {row.blockers.length > 0 && <div className="mt-1 pl-5 font-ui text-[8px] leading-4 text-amber-200">{row.blockers[0]}</div>}
              </article>
            ))}
          </div>

          <div className="mt-3 border border-border/60 bg-black/20 p-2.5 font-ui text-[8px] text-muted-foreground">
            Status: <span className={data.engineeringComplete ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"}>{data.status.replaceAll("_", " ").toUpperCase()}</span>
            {" · "}Engineering blockers: {data.engineeringBlockers.length}
            {" · "}External/deployment evidence items: {data.externalBlockers.length}
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="border border-border/60 bg-black/20 p-2.5">
    <div className="font-terminal text-[6px] tracking-wider text-muted-foreground">{label}</div>
    <div className={`mt-1 font-terminal text-[9px] ${good ? "text-emerald-300" : "text-amber-300"}`}>{value}</div>
  </div>;
}
