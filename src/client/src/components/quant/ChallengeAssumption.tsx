import { useEffect, useState } from "react";
import { Sparkles, ShieldQuestion } from "lucide-react";
import { useAudience } from "@/lib/audience";

/**
 * "Challenge My Assumptions" -- Consultant Copilot, reframed (Major Bet,
 * Roadmap Rev.3): "A consultant enters an assumption ('revenue grows
 * 15%'); AI doesn't change the number, it asks what supports it, what
 * invalidates it, what happens at 10%/5% -- then the quant engine tests the
 * alternatives. AI as devil's advocate, not calculator." Same shape as
 * ModelConsensus.tsx -- deterministic results computed by the caller
 * (already-run through the real engine, e.g. ValuationPanel.tsx's DCF
 * worksheet recomputed at each tested value), AI only ever writes a short
 * critique of results it's handed, never a number of its own.
 *
 * Internal only, unlike ModelConsensus (whose comparison grid is useful to
 * clients even without the AI note) -- the roadmap scopes this whole
 * mechanism as part of Consultant Copilot, which is explicitly internal-only,
 * so callers should gate the trigger itself behind isInternal too.
 */
export interface AssumptionTestResult {
  testedValue: string;
  outputLabel: string;
  outputValue: string;
}

export default function ChallengeAssumption({
  assumptionLabel, assumptionValue, results,
}: { assumptionLabel: string; assumptionValue: string; results: AssumptionTestResult[] }) {
  const isInternal = useAudience() === "internal";
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isInternal || results.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch("/api/quant/challenge-assumption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assumptionLabel, assumptionValue, results }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { note: string }) => { if (!cancelled) setNote(data.note); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assumptionLabel, assumptionValue, JSON.stringify(results)]);

  if (!isInternal) return null;

  return (
    <div className="bg-[#080808] border border-border p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <ShieldQuestion className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">
          CHALLENGE THIS ASSUMPTION — {assumptionLabel.toUpperCase()} = {assumptionValue}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
        {results.map((r) => (
          <div key={r.testedValue} className="border border-border p-2.5">
            <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">IF {assumptionLabel.toUpperCase()} = {r.testedValue}</div>
            <div className="font-terminal text-sm font-bold text-foreground mt-0.5">{r.outputValue}</div>
            <div className="font-terminal text-[7px] text-muted-foreground/70 mt-0.5">{r.outputLabel}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-border/40 flex items-start gap-2">
        <Sparkles className="w-3 h-3 text-[hsl(38,95%,55%)] mt-0.5 shrink-0" />
        <div className="font-terminal text-[9px] text-muted-foreground leading-relaxed">
          {loading ? "The model is interrogating this assumption..." : error ? "AI critique unavailable right now." : note ?? ""}
        </div>
      </div>
    </div>
  );
}
