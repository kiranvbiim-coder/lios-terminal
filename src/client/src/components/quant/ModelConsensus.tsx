import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAudience } from "@/lib/audience";

/**
 * Model Consensus panel -- reusable infrastructure per the roadmap's
 * "AI validates, it never calculates" doctrine: run N independent
 * deterministic methods on the same question, display them side by side,
 * and let AI write only the one-line agree/disagree note underneath. AI
 * never touches the scores themselves -- it only reads the already-computed
 * verdicts and describes whether they line up.
 *
 * First real usage: EarningsQualityTab.tsx, pairing Altman/Piotroski/
 * Beneish/Ohlson. Every later quant addition (Merton/KMV, Model Battle,
 * etc.) should plug into this component rather than getting a bespoke
 * result UI of its own.
 *
 * The AI note is internal-build only -- it's an unmetered per-request AI
 * call (like /api/chat and /finance/news/ai-smart-search), so the backing
 * route stays internal-only rather than opening a new metered client AI
 * surface as a side effect of this component. The side-by-side comparison
 * itself is pure client-side rendering of already-computed values and
 * shows identically in both builds.
 */
export type ConsensusTone = "good" | "warn" | "bad" | "neutral";

export interface ConsensusMethod {
  name: string;
  value: string;
  verdict: string;
  tone: ConsensusTone;
  detail?: string;
}

const TONE_CLASS: Record<ConsensusTone, string> = {
  good: "text-[hsl(142,71%,55%)] border-[hsl(142,71%,45%)]/40",
  warn: "text-[hsl(38,95%,55%)] border-[hsl(38,95%,45%)]/40",
  bad: "text-[hsl(0,80%,60%)] border-[hsl(0,80%,50%)]/40",
  neutral: "text-muted-foreground border-border",
};

function MethodCard({ method }: { method: ConsensusMethod }) {
  const cls = TONE_CLASS[method.tone];
  return (
    <div className={`border p-2.5 ${cls.split(" ")[1]}`}>
      <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{method.name.toUpperCase()}</div>
      <div className="font-terminal text-base font-bold text-foreground mt-0.5">{method.value}</div>
      <div className={`font-terminal text-[8px] uppercase mt-0.5 ${cls.split(" ")[0]}`}>{method.verdict}</div>
      {method.detail && <div className="font-terminal text-[7px] text-muted-foreground/70 mt-1">{method.detail}</div>}
    </div>
  );
}

export default function ModelConsensus({ title, question, methods }: { title: string; question: string; methods: ConsensusMethod[] }) {
  const isInternal = useAudience() === "internal";
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isInternal || methods.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch("/api/quant/consensus-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, methods: methods.map((m) => ({ name: m.name, value: m.value, verdict: m.verdict })) }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { note: string }) => { if (!cancelled) setNote(data.note); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, JSON.stringify(methods.map((m) => [m.name, m.value, m.verdict]))]);

  const agreeCount = methods.filter((m) => m.tone === "good").length;
  const disagreeCount = methods.filter((m) => m.tone === "bad").length;
  const split = agreeCount > 0 && disagreeCount > 0;

  return (
    <div className="bg-[#080808] border border-border p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">{title.toUpperCase()}</span>
        {split && (
          <span className="font-terminal text-[8px] uppercase text-[hsl(38,95%,55%)] border border-[hsl(38,95%,45%)]/40 px-1.5 py-0.5">
            Models split
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mt-2">
        {methods.map((m) => <MethodCard key={m.name} method={m} />)}
      </div>

      {isInternal && (
        <div className="mt-3 pt-3 border-t border-border/40 flex items-start gap-2">
          <Sparkles className="w-3 h-3 text-[hsl(38,95%,55%)] mt-0.5 shrink-0" />
          <div className="font-terminal text-[9px] text-muted-foreground leading-relaxed">
            {loading ? "Reading the models..." : error ? "AI note unavailable right now." : note ?? ""}
          </div>
        </div>
      )}
    </div>
  );
}
