import { Megaphone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaTopics } from "@/lib/useMedia";
import type { ViewMode } from "@/lib/terminalTypes";

function fmtTone(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toneClass(n: number | null) {
  if (n === null) return "text-muted-foreground";
  return n >= 0 ? "text-[hsl(142,71%,45%)]" : "text-[hsl(0,80%,55%)]";
}

interface Props {
  onNav: (v: ViewMode) => void;
}

export default function MediaDashboardPanel({ onNav }: Props) {
  const { data: topics, isLoading } = useMediaTopics();
  const anyLive = topics?.some((t) => t.isLive) ?? false;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4">
      <div className="flex items-center gap-2 mb-4">
        <Megaphone className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[11px] tracking-widest text-foreground">MEDIA TONE DASHBOARD — MARKETING, PR &amp; COMMUNICATIONS</span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-24 bg-border" />)}
        </div>
      ) : (
        <>
          {!anyLive && (
            <div className="mb-4 font-terminal text-[9px] text-muted-foreground border border-border px-3 py-2">
              GDELT MEDIA FEED UNREACHABLE (RATE-LIMITED OR OFFLINE) — VALUES BELOW WILL POPULATE ON NEXT SUCCESSFUL FETCH. HONEST STATE, NOT A BUG.
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {(topics ?? []).map((topic) => (
              <button
                key={topic.topicId}
                onClick={() => onNav("mediaindicators")}
                className="text-left border border-border bg-[#0a0a0a] hover:border-[hsl(38,95%,50%)]/40 transition-colors p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-terminal text-[9px] text-muted-foreground truncate pr-2">{topic.name.toUpperCase()}</span>
                  {!topic.isLive && (
                    <span className="font-terminal text-[8px] text-[hsl(0,80%,60%)] border border-[hsl(0,80%,60%)]/40 px-1 shrink-0">NO DATA</span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className={`font-terminal text-lg ${toneClass(topic.value)}`}>{fmtTone(topic.value)}</span>
                  {topic.changePercent !== null && (
                    <span className={`font-terminal text-[10px] ${toneClass(topic.change)}`}>
                      {topic.change !== null && `${topic.change >= 0 ? "+" : ""}${topic.change.toFixed(2)} vs prior day`}
                    </span>
                  )}
                </div>
                <div className="font-terminal text-[8px] text-muted-foreground">
                  {topic.asOf ? `AS OF ${fmtDate(topic.asOf).toUpperCase()}` : topic.unit}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
