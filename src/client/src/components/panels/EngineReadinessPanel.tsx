import {
  useAllEngineReadiness,
  readinessLabel,
  readinessColor,
  readinessBg,
  type EngineReadinessResult,
  type ReadinessState,
} from "@/lib/useEngineReadiness";
import { Activity, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";

const STATE_ICON: Record<ReadinessState, typeof CheckCircle2> = {
  ready: CheckCircle2,
  partial: AlertTriangle,
  blocked: XCircle,
  manual_input_required: HelpCircle,
  not_configured: HelpCircle,
};

function ReadinessCard({ engine }: { engine: EngineReadinessResult }) {
  const Icon = STATE_ICON[engine.state];
  return (
    <div className={`border p-3 ${readinessBg(engine.state)}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-3.5 h-3.5 ${readinessColor(engine.state)}`} />
        <span className="font-terminal text-[10px] text-foreground font-bold uppercase tracking-wider">{engine.engineName}</span>
        <span className={`font-terminal text-[8px] uppercase tracking-widest ml-auto ${readinessColor(engine.state)}`}>
          {readinessLabel(engine.state)}
        </span>
      </div>

      {engine.missingRequired.length > 0 && (
        <div className="font-terminal text-[9px] text-rose-300 mt-1">
          Missing: {engine.missingRequired.join(", ")}
        </div>
      )}

      {engine.manualInputsNeeded.length > 0 && engine.state === "manual_input_required" && (
        <div className="font-terminal text-[9px] text-sky-300 mt-1">
          Manual inputs: {engine.manualInputsNeeded.map((m) => m.field).join(", ")}
        </div>
      )}

      <div className="flex gap-1 mt-2 flex-wrap">
        {engine.contracts.map((contract) => (
          <span
            key={contract.contractFamily}
            className={`font-terminal text-[8px] px-1.5 py-0.5 border ${readinessBg(contract.state)} ${readinessColor(contract.state)}`}
          >
            {contract.contractFamily}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function EngineReadinessPanel() {
  const { data, isLoading } = useAllEngineReadiness();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="font-terminal text-[10px] text-muted-foreground animate-pulse">Checking engine readiness...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="font-terminal text-[10px] text-muted-foreground">Unable to load readiness data.</span>
      </div>
    );
  }

  const ready = data.readiness.filter((r) => r.state === "ready");
  const partial = data.readiness.filter((r) => r.state === "partial" || r.state === "manual_input_required");
  const blocked = data.readiness.filter((r) => r.state === "blocked" || r.state === "not_configured");

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <Activity className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">ENGINE READINESS</span>
        <span className="font-terminal text-[9px] text-muted-foreground ml-auto">
          {data.healthyConnectors.length} connectors healthy · {data.availableCapabilities.length} contract families available
        </span>
      </div>

      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="font-terminal text-[9px] text-emerald-400">{ready.length} Ready</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[hsl(38,95%,55%)]" />
          <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)]">{partial.length} Partial</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          <span className="font-terminal text-[9px] text-rose-400">{blocked.length} Blocked</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {data.readiness.map((engine) => (
            <ReadinessCard key={engine.engineId} engine={engine} />
          ))}
        </div>
      </div>
    </div>
  );
}
