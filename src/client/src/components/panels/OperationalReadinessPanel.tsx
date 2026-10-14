import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, CircleAlert, LockKeyhole, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import P7ReleaseReadinessPanel from "./P7ReleaseReadinessPanel";

type Phase = "V4-25" | "V4-26" | "V4-27" | "V4-28" | "V4-29";
type Item = { id: string; phase: Phase; title: string; status: "ready" | "partial" | "blocked"; evidence: string[]; blockers: string[]; nextAction: string };
type Readiness = { status: "ready" | "partial" | "blocked"; generatedAt: string; items: Item[]; phases: Array<{ phase: Phase; status: Item["status"]; ready: number; partial: number; blocked: number; total: number }>; blockers: string[]; environment: Record<string, boolean | string> };
type ProviderAcceptanceRow = {
  id: string;
  label: string;
  category: "ai" | "data" | "sidecar" | "news" | "communications";
  state: "verified" | "degraded" | "blocked";
  configured: boolean;
  liveVerified: boolean;
  evidenceAt: string | null;
  evidence: string[];
  blockers: string[];
  nextAction: string;
};
type ProviderAcceptance = {
  generatedAt: string;
  status: "ready" | "partial";
  counts: { verified: number; degraded: number; blocked: number; total: number };
  rows: ProviderAcceptanceRow[];
};
type DesktopAcceptanceRow = {
  id: string;
  label: string;
  category: "custody" | "runtime" | "recovery" | "macos" | "windows" | "update" | "accessibility";
  state: "verified" | "degraded" | "blocked";
  evidenceAt: string | null;
  evidence: string[];
  blockers: string[];
  nextAction: string;
};
type DesktopAcceptance = {
  generatedAt: string;
  status: "ready" | "partial";
  counts: { verified: number; degraded: number; blocked: number; total: number };
  rows: DesktopAcceptanceRow[];
};
type ProductionAcceptanceRow = {
  id: string;
  label: string;
  category: "distribution" | "retention" | "custody" | "diagnostics" | "notifications" | "runbook";
  state: "verified" | "degraded" | "blocked";
  evidenceAt: string | null;
  evidence: string[];
  blockers: string[];
  nextAction: string;
};
type ProductionAcceptance = {
  generatedAt: string;
  status: "ready" | "partial";
  counts: { verified: number; degraded: number; blocked: number; total: number };
  rows: ProductionAcceptanceRow[];
};

const phaseLabels: Record<Phase, string> = {
  "V4-25": "SECURITY",
  "V4-26": "PERFORMANCE",
  "V4-27": "OBSERVABILITY",
  "V4-28": "ACCEPTANCE",
  "V4-29": "RELEASE",
};

function StatusIcon({ status }: { status: Item["status"] }) {
  if (status === "ready") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
  if (status === "blocked") return <LockKeyhole className="h-3.5 w-3.5 text-rose-300" />;
  return <CircleAlert className="h-3.5 w-3.5 text-amber-300" />;
}

function ProviderStateIcon({ state }: { state: ProviderAcceptanceRow["state"] | DesktopAcceptanceRow["state"] | ProductionAcceptanceRow["state"] }) {
  if (state === "verified") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
  if (state === "degraded") return <CircleAlert className="h-3.5 w-3.5 text-amber-300" />;
  return <LockKeyhole className="h-3.5 w-3.5 text-rose-300" />;
}

export default function OperationalReadinessPanel() {
  const [phase, setPhase] = useState<Phase>("V4-25");
  const { data, isLoading, isError, refetch, isFetching } = useQuery<Readiness>({
    queryKey: ["/api/operations/readiness"],
    queryFn: async () => (await apiRequest("GET", "/api/operations/readiness")).json(),
    staleTime: 30_000,
  });
  const { data: providerAcceptance, refetch: refetchProviderAcceptance, isFetching: isFetchingProviderAcceptance } = useQuery<ProviderAcceptance>({
    queryKey: ["/api/operations/provider-acceptance"],
    queryFn: async () => (await apiRequest("GET", "/api/operations/provider-acceptance")).json(),
    staleTime: 30_000,
  });
  const { data: desktopAcceptance, refetch: refetchDesktopAcceptance, isFetching: isFetchingDesktopAcceptance } = useQuery<DesktopAcceptance>({
    queryKey: ["/api/operations/desktop-acceptance"],
    queryFn: async () => (await apiRequest("GET", "/api/operations/desktop-acceptance")).json(),
    staleTime: 30_000,
  });
  const { data: productionAcceptance, refetch: refetchProductionAcceptance, isFetching: isFetchingProductionAcceptance } = useQuery<ProductionAcceptance>({
    queryKey: ["/api/operations/production-acceptance"],
    queryFn: async () => (await apiRequest("GET", "/api/operations/production-acceptance")).json(),
    staleTime: 30_000,
  });
  const phaseItems = useMemo(() => data?.items.filter((item) => item.phase === phase) ?? [], [data?.items, phase]);
  const phaseSummary = data?.phases.find((item) => item.phase === phase);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-300" /><span className="panel-label">V4 OPERATIONAL READINESS</span></div>
          <p className="mt-1 max-w-3xl font-ui text-[9px] text-muted-foreground">Local contracts and evidence are green; provider, signing, deployment, and platform gates remain explicitly partial until verified.</p>
        </div>
        <button onClick={() => { void refetch(); void refetchProviderAcceptance(); void refetchDesktopAcceptance(); void refetchProductionAcceptance(); }} className="flex items-center gap-1.5 border border-border px-2 py-1 font-terminal text-[8px] text-muted-foreground hover:text-foreground"><RefreshCw className={`h-3 w-3 ${isFetching || isFetchingProviderAcceptance || isFetchingDesktopAcceptance || isFetchingProductionAcceptance ? "animate-spin" : ""}`} /> REFRESH</button>
      </div>

      <P7ReleaseReadinessPanel />

      {isLoading && <div className="border border-border p-4 font-terminal text-[9px] text-muted-foreground">Loading readiness contract…</div>}
      {isError && <div className="border border-rose-400/30 bg-rose-400/5 p-4 font-terminal text-[9px] text-rose-200">Readiness API unavailable. Nothing is promoted to ready without the server contract.</div>}
      {data && (
        <>
          <div className="grid gap-2 sm:grid-cols-5">
            {data.phases.map((summary) => (
              <button key={summary.phase} onClick={() => setPhase(summary.phase)} className={`border p-3 text-left ${phase === summary.phase ? "border-cyan-300/60 bg-cyan-300/5" : "border-border bg-[#070707]"}`}>
                <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">{summary.phase} · {phaseLabels[summary.phase]}</div>
                <div className={`mt-1 font-terminal text-[10px] uppercase ${summary.status === "ready" ? "text-emerald-300" : summary.status === "blocked" ? "text-rose-300" : "text-amber-300"}`}>{summary.status}</div>
                <div className="mt-2 font-terminal text-[8px] text-muted-foreground">{summary.ready} ready · {summary.partial} partial · {summary.total} total</div>
              </button>
            ))}
          </div>

          <div className="border border-border bg-[#070707] p-3">
            <div className="flex items-center justify-between"><span className="font-terminal text-[9px] tracking-widest text-muted-foreground">{phase} CONTROL INVENTORY</span><span className={`font-terminal text-[9px] uppercase ${phaseSummary?.status === "ready" ? "text-emerald-300" : "text-amber-300"}`}>{phaseSummary?.status ?? "unknown"}</span></div>
            <div className="mt-3 space-y-2">
              {phaseItems.map((item) => (
                <article key={item.id} className="border border-border/60 p-3">
                  <div className="flex items-center gap-2"><StatusIcon status={item.status} /><span className="font-terminal text-[8px] tracking-widest text-cyan-200">{item.id}</span><span className="font-ui text-[10px] font-semibold text-foreground">{item.title}</span></div>
                  <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">Evidence: {item.evidence.join(" · ")}</div>
                  {item.blockers.length > 0 && <div className="mt-1 pl-5 font-ui text-[8px] text-amber-200">External gate: {item.blockers.join(" ")}</div>}
                  <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">Next: {item.nextAction}</div>
                </article>
              ))}
            </div>
          </div>
          {phase === "V4-28" && providerAcceptance && (
            <section className="border border-cyan-300/20 bg-cyan-300/[0.025] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-terminal text-[9px] tracking-widest text-cyan-200">P1 · PROVIDER & CREDENTIAL ACCEPTANCE</div>
                  <div className="mt-1 font-ui text-[8px] text-muted-foreground">Credential presence never counts as live verification. Every row needs dated live evidence or an explicit blocker.</div>
                </div>
                <div className="font-terminal text-[8px] text-muted-foreground">
                  {providerAcceptance.counts.verified} verified · {providerAcceptance.counts.degraded} degraded · {providerAcceptance.counts.blocked} blocked · {providerAcceptance.counts.total} total
                </div>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {providerAcceptance.rows.map((provider) => (
                  <article key={provider.id} className="border border-border/60 bg-[#060606] p-3">
                    <div className="flex items-center gap-2">
                      <ProviderStateIcon state={provider.state} />
                      <span className="font-terminal text-[8px] uppercase tracking-wider text-cyan-200">{provider.category}</span>
                      <span className="font-ui text-[10px] font-semibold text-foreground">{provider.label}</span>
                      <span className={`ml-auto font-terminal text-[8px] uppercase ${provider.state === "verified" ? "text-emerald-300" : provider.state === "degraded" ? "text-amber-300" : "text-rose-300"}`}>{provider.state}</span>
                    </div>
                    <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">Configured: {provider.configured ? "yes" : "no"} · Live evidence: {provider.liveVerified ? "yes" : "no"}{provider.evidenceAt ? ` · ${new Date(provider.evidenceAt).toLocaleString()}` : ""}</div>
                    {provider.evidence.length > 0 && <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">{provider.evidence.join(" ")}</div>}
                    {provider.blockers.length > 0 && <div className="mt-1 pl-5 font-ui text-[8px] text-amber-200">Blocker: {provider.blockers.join(" ")}</div>}
                    <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">Next: {provider.nextAction}</div>
                  </article>
                ))}
              </div>
              <div className="mt-2 font-terminal text-[8px] text-muted-foreground">Generated {new Date(providerAcceptance.generatedAt).toLocaleString()} · overall {providerAcceptance.status}</div>
            </section>
          )}

          {(phase === "V4-28" || phase === "V4-29") && desktopAcceptance && (
            <section className="border border-violet-300/20 bg-violet-300/[0.025] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-terminal text-[9px] tracking-widest text-violet-200">P2 · NATIVE DESKTOP & RELEASE ARTIFACT QUALIFICATION</div>
                  <div className="mt-1 font-ui text-[8px] text-muted-foreground">Packaged-runtime evidence is kept separate from source capability. Signing, clean-install, update/rollback and assistive-tech rows remain blocked until a real platform run exists.</div>
                </div>
                <div className="font-terminal text-[8px] text-muted-foreground">
                  {desktopAcceptance.counts.verified} verified · {desktopAcceptance.counts.degraded} degraded · {desktopAcceptance.counts.blocked} blocked · {desktopAcceptance.counts.total} total
                </div>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {desktopAcceptance.rows.map((item) => (
                  <article key={item.id} className="border border-border/60 bg-[#060606] p-3">
                    <div className="flex items-center gap-2">
                      <ProviderStateIcon state={item.state} />
                      <span className="font-terminal text-[8px] uppercase tracking-wider text-violet-200">{item.category}</span>
                      <span className="font-ui text-[10px] font-semibold text-foreground">{item.label}</span>
                      <span className={`ml-auto font-terminal text-[8px] uppercase ${item.state === "verified" ? "text-emerald-300" : item.state === "degraded" ? "text-amber-300" : "text-rose-300"}`}>{item.state}</span>
                    </div>
                    {item.evidenceAt && <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">Evidence timestamp: {new Date(item.evidenceAt).toLocaleString()}</div>}
                    {item.evidence.length > 0 && <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">{item.evidence.join(" ")}</div>}
                    {item.blockers.length > 0 && <div className="mt-1 pl-5 font-ui text-[8px] text-amber-200">Blocker: {item.blockers.join(" ")}</div>}
                    <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">Next: {item.nextAction}</div>
                  </article>
                ))}
              </div>
              <div className="mt-2 font-terminal text-[8px] text-muted-foreground">Generated {new Date(desktopAcceptance.generatedAt).toLocaleString()} · overall {desktopAcceptance.status}</div>
            </section>
          )}

          {(phase === "V4-27" || phase === "V4-28" || phase === "V4-29") && productionAcceptance && (
            <section className="border border-emerald-300/20 bg-emerald-300/[0.025] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-terminal text-[9px] tracking-widest text-emerald-200">P3 · PRODUCTION SERVICES & CONTROL PLANE</div>
                  <div className="mt-1 font-ui text-[8px] text-muted-foreground">Implemented controls stay separate from production proof. Public distribution, merchant, retention, custody, diagnostics, relay and notifications require dated live evidence before they turn green.</div>
                </div>
                <div className="font-terminal text-[8px] text-muted-foreground">
                  {productionAcceptance.counts.verified} verified · {productionAcceptance.counts.degraded} degraded · {productionAcceptance.counts.blocked} blocked · {productionAcceptance.counts.total} total
                </div>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {productionAcceptance.rows.map((item) => (
                  <article key={item.id} className="border border-border/60 bg-[#060606] p-3">
                    <div className="flex items-center gap-2">
                      <ProviderStateIcon state={item.state} />
                      <span className="font-terminal text-[8px] uppercase tracking-wider text-emerald-200">{item.category}</span>
                      <span className="font-ui text-[10px] font-semibold text-foreground">{item.label}</span>
                      <span className={`ml-auto font-terminal text-[8px] uppercase ${item.state === "verified" ? "text-emerald-300" : item.state === "degraded" ? "text-amber-300" : "text-rose-300"}`}>{item.state}</span>
                    </div>
                    {item.evidenceAt && <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">Evidence timestamp: {new Date(item.evidenceAt).toLocaleString()}</div>}
                    {item.evidence.length > 0 && <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">{item.evidence.join(" ")}</div>}
                    {item.blockers.length > 0 && <div className="mt-1 pl-5 font-ui text-[8px] text-amber-200">Blocker: {item.blockers.join(" ")}</div>}
                    <div className="mt-1 pl-5 font-ui text-[8px] text-muted-foreground">Next: {item.nextAction}</div>
                  </article>
                ))}
              </div>
              <div className="mt-2 font-terminal text-[8px] text-muted-foreground">Generated {new Date(productionAcceptance.generatedAt).toLocaleString()} · overall {productionAcceptance.status}</div>
            </section>
          )}

          <div className="border border-amber-300/20 bg-amber-300/[0.03] p-3 font-ui text-[8px] text-amber-100/80">Overall readiness: <span className="font-semibold uppercase">{data.status}</span> · {data.blockers.length} unique external blocker classes · generated {new Date(data.generatedAt).toLocaleString()}</div>
        </>
      )}
    </div>
  );
}
