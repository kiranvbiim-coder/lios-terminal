/**
 * Engine readiness hooks: let any terminal panel check whether an engine
 * can run given the current connector/data state, and display actionable
 * readiness information to the user.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";

export type ReadinessState = "ready" | "partial" | "blocked" | "manual_input_required" | "not_configured";

export interface ContractReadiness {
  contractFamily: string;
  state: ReadinessState;
  availableFields: number;
  requiredFields: number;
  requiredMet: number;
}

export interface EngineReadinessResult {
  engineId: string;
  engineName: string;
  state: ReadinessState;
  contracts: ContractReadiness[];
  missingRequired: string[];
  manualInputsNeeded: Array<{ contractFamily: string; field: string; description: string }>;
}

export interface AllEngineReadiness {
  readiness: EngineReadinessResult[];
  availableCapabilities: string[];
  healthyConnectors: string[];
}

const READINESS_STALE_TIME = 30_000;

export function useAllEngineReadiness() {
  return useQuery<AllEngineReadiness>({
    queryKey: ["/api/readiness/engines"],
    queryFn: async () => (await apiRequest("GET", "/api/readiness/engines")).json(),
    staleTime: READINESS_STALE_TIME,
  });
}

export function useEngineReadiness(engineId: string | null) {
  return useQuery<EngineReadinessResult>({
    queryKey: ["/api/readiness/engines", engineId],
    queryFn: async () => (await apiRequest("GET", `/api/readiness/engines/${engineId}`)).json(),
    enabled: !!engineId,
    staleTime: READINESS_STALE_TIME,
  });
}

const READINESS_LABELS: Record<ReadinessState, string> = {
  ready: "Ready",
  partial: "Partial",
  blocked: "Blocked",
  manual_input_required: "Manual Input Required",
  not_configured: "Not Configured",
};

const READINESS_COLORS: Record<ReadinessState, string> = {
  ready: "text-emerald-400",
  partial: "text-[hsl(38,95%,55%)]",
  blocked: "text-rose-400",
  manual_input_required: "text-sky-400",
  not_configured: "text-muted-foreground",
};

const READINESS_BG: Record<ReadinessState, string> = {
  ready: "border-emerald-500/30 bg-emerald-500/5",
  partial: "border-[hsl(38,95%,50%)]/30 bg-[hsl(38,95%,50%)]/5",
  blocked: "border-rose-500/30 bg-rose-500/5",
  manual_input_required: "border-sky-500/30 bg-sky-500/5",
  not_configured: "border-border bg-[#070707]",
};

export function readinessLabel(state: ReadinessState): string {
  return READINESS_LABELS[state];
}

export function readinessColor(state: ReadinessState): string {
  return READINESS_COLORS[state];
}

export function readinessBg(state: ReadinessState): string {
  return READINESS_BG[state];
}
