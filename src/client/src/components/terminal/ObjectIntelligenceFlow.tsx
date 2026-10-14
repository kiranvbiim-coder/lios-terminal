import { ArrowRight } from "lucide-react";

const STAGES = ["OBJECT", "EVIDENCE", "ENGINE", "SCENARIO", "DECISION", "RESEARCH"] as const;

export default function ObjectIntelligenceFlow({ objectLabel }: { objectLabel: string }) {
  return (
    <nav aria-label="Object intelligence workflow" className="border-b border-border bg-[#070707] px-4 py-2">
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        {STAGES.map((stage, index) => (
          <div key={stage} className="flex shrink-0 items-center gap-1">
            <div className={`border px-2 py-1 font-terminal text-[7.5px] font-bold tracking-widest ${index === 0 ? "border-amber-500/40 bg-amber-500/[0.07] text-amber-300" : "border-border text-muted-foreground"}`} title={index === 0 ? `Active object: ${objectLabel}` : stage}>
              {stage}{index === 0 ? ` · ${objectLabel}` : ""}
            </div>
            {index < STAGES.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </nav>
  );
}
