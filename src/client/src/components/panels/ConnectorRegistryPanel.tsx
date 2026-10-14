import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Plug, CheckCircle2, AlertTriangle, Ban, CircleDashed, KeyRound, ShieldCheck, Clock } from "lucide-react";

interface ConnectorDef {
  id: string;
  name: string;
  category: string;
  sourceType: string;
  authMode: string;
  custodyMode: string;
  capabilities: Array<{ contractFamily: string; fields?: string[]; coverage?: string }>;
  setupGuide: string;
  builtIn: boolean;
}

interface ConnectorHealth {
  connectorId: string;
  state: "catalog_only" | "adapter_available" | "credential_configured" | "live_verified" | "degraded" | "rate_limited" | "disabled";
  detail: string;
  checkedAt: string;
  adapterImplemented: boolean;
  lastVerifiedAt: string | null;
}

interface RegistrySnapshot {
  connectors: ConnectorDef[];
  health: ConnectorHealth[];
}

const STATE_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; color: string; bg: string }> = {
  catalog_only: { label: "Catalog only", icon: CircleDashed, color: "text-muted-foreground", bg: "border-border bg-[#070707]" },
  adapter_available: { label: "Adapter ready", icon: KeyRound, color: "text-muted-foreground", bg: "border-border bg-[#070707]" },
  credential_configured: { label: "Credential configured", icon: ShieldCheck, color: "text-cyan-400", bg: "border-cyan-500/30 bg-cyan-500/5" },
  live_verified: { label: "Live verified", icon: CheckCircle2, color: "text-emerald-400", bg: "border-emerald-500/30 bg-emerald-500/5" },
  degraded: { label: "Degraded", icon: AlertTriangle, color: "text-[hsl(38,95%,55%)]", bg: "border-[hsl(38,95%,50%)]/30 bg-[hsl(38,95%,50%)]/5" },
  rate_limited: { label: "Rate limited", icon: Clock, color: "text-orange-400", bg: "border-orange-500/30 bg-orange-500/5" },
  disabled: { label: "Disabled", icon: Ban, color: "text-muted-foreground", bg: "border-border bg-[#070707]" },
};

export default function ConnectorRegistryPanel() {
  const { data, isLoading } = useQuery<RegistrySnapshot>({
    queryKey: ["/api/admin/connectors"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/connectors")).json(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="h-full flex items-center justify-center"><span className="font-terminal text-[10px] text-muted-foreground animate-pulse">Loading connectors...</span></div>;
  }
  if (!data) {
    return <div className="h-full flex items-center justify-center"><span className="font-terminal text-[10px] text-muted-foreground">Unable to load connectors.</span></div>;
  }

  const healthMap = new Map(data.health.map((h) => [h.connectorId, h]));
  const verified = data.health.filter((h) => h.state === "live_verified" || h.state === "credential_configured").length;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <Plug className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">CONNECTOR REGISTRY</span>
        <span className="font-terminal text-[9px] text-muted-foreground ml-auto">
          {verified}/{data.connectors.length} verified
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {data.connectors.map((connector) => {
            const health = healthMap.get(connector.id);
            const state = health?.state ?? "catalog_only";
            const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.catalog_only;
            const Icon = cfg.icon;
            return (
              <div key={connector.id} className={`border p-3 ${cfg.bg}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                  <span className="font-terminal text-[10px] text-foreground font-bold uppercase tracking-wider">{connector.name}</span>
                  <span className={`ml-auto font-terminal text-[7px] uppercase tracking-widest ${cfg.color}`}>{cfg.label}</span>
                </div>
                <div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-widest mb-1">
                  {connector.category} · {connector.sourceType} · {connector.custodyMode}
                </div>
                <div className={`font-terminal text-[9px] ${cfg.color}`}>
                  {health?.detail ?? connector.setupGuide}
                </div>
                {health?.adapterImplemented === false && (
                  <div className="font-terminal text-[7px] text-muted-foreground uppercase tracking-widest mt-1 border border-border px-1 py-0.5 inline-block">
                    Catalog only — not yet implemented
                  </div>
                )}
                {health?.lastVerifiedAt && (
                  <div className="font-terminal text-[7px] text-muted-foreground mt-1">
                    verified {health.lastVerifiedAt}
                  </div>
                )}
                <div className="flex gap-1 mt-2 flex-wrap">
                  {connector.capabilities.map((cap, i) => (
                    <span key={i} className="font-terminal text-[7px] px-1 py-0.5 border border-border text-muted-foreground">
                      {cap.contractFamily}{cap.coverage ? ` (${cap.coverage})` : ""}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
