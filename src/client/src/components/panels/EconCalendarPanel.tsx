import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { CalendarDays, Database, ShieldCheck } from "lucide-react";
import { useEconomicCalendar } from "@/lib/useFinance";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props { onNav: (v: ViewMode) => void; onSymbol: (s: string) => void; }
type ImpactFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";

function impactBadge(impact: string) {
  const normalized = impact.toUpperCase();
  const cls = normalized === "HIGH"
    ? "bg-[hsl(0,80%,20%)] text-[hsl(0,80%,65%)] border-[hsl(0,80%,30%)]"
    : normalized === "MEDIUM"
      ? "bg-[hsl(38,95%,15%)] text-[hsl(38,95%,60%)] border-[hsl(38,95%,30%)]"
      : "bg-border/20 text-muted-foreground border-border/30";
  return <span className={`px-1.5 py-0.5 font-terminal text-[7px] border tracking-widest ${cls}`}>{normalized}</span>;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replaceAll(",", "").replace(/[%$£€¥₹]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatEventValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export default function EconCalendarPanel(_props: Props) {
  const { data: events = [], isLoading } = useEconomicCalendar();
  const [filter, setFilter] = useTerminalArtifactState<ImpactFilter>("EconCalendarPanel.filter", "ALL");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "ALL") return events;
    return events.filter((event: any) => String(event.impact ?? "LOW").toUpperCase() === filter);
  }, [events, filter]);

  const byDate = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const event of filtered as any[]) {
      const date = String(event.date ?? "").split("T")[0] || "Unknown";
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(event);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const today = new Date().toISOString().slice(0, 10);
  const daysUntil = (date: string) => {
    if (date === "Unknown") return null;
    const millis = new Date(`${date}T12:00:00Z`).getTime() - Date.now();
    return Number.isFinite(millis) ? Math.round(millis / 86_400_000) : null;
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <CalendarDays className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">ECONOMIC CALENDAR</span>
        <span className="flex items-center gap-1 border border-emerald-500/25 bg-emerald-500/[0.04] px-2 py-0.5 font-terminal text-[7px] tracking-widest text-emerald-300">
          <Database className="w-3 h-3" /> SOURCE-BACKED EVENTS ONLY
        </span>
        <div className="ml-auto flex items-center gap-1">
          {(["ALL", "HIGH", "MEDIUM", "LOW"] as const).map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => setFilter(value)}
              className={`px-2.5 py-0.5 font-terminal text-[8px] border transition-all ${filter === value ? "border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)/10%] text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 flex items-start gap-2 border-b border-cyan-500/20 bg-cyan-500/[0.025] px-4 py-2 font-terminal text-[7.5px] leading-4 text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
        <span><span className="font-bold tracking-widest text-cyan-300">TRUST CHANGE:</span> legacy hard-coded central-bank rate probabilities and dated meeting presets were removed. LIOS now displays only events returned by the economic-calendar data hook; implied-rate probabilities stay unavailable until a real source is connected.</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-8 text-center font-terminal text-[10px] text-muted-foreground">LOADING ECONOMIC CALENDAR…</div>
        ) : byDate.length === 0 ? (
          <div className="p-8 text-center font-terminal text-[10px] text-muted-foreground">NO SOURCE-BACKED EVENTS AVAILABLE FOR THIS WINDOW</div>
        ) : (
          byDate.map(([date, dateEvents]) => {
            const deltaDays = daysUntil(date);
            const isToday = date === today;
            return (
              <div key={date}>
                <div className={`sticky top-0 z-10 flex items-center gap-3 px-4 py-1.5 border-b border-border ${isToday ? "bg-[hsl(38,95%,50%)/10%]" : "bg-[#080808]"}`}>
                  <span className={`font-terminal text-[9px] font-bold tracking-widest ${isToday ? "text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>
                    {isToday ? "⬤ TODAY — " : ""}{date === "Unknown" ? "UNDATED" : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <span className="font-terminal text-[7.5px] text-muted-foreground">
                    {dateEvents.length} event{dateEvents.length === 1 ? "" : "s"}{deltaDays === null ? "" : ` · ${deltaDays >= 0 ? `T+${deltaDays}d` : `T${deltaDays}d`}`}
                  </span>
                </div>

                {dateEvents.map((event: any, index: number) => {
                  const key = `${date}:${event.time ?? ""}:${event.event ?? "event"}:${index}`;
                  const isExpanded = expandedKey === key;
                  const actual = toFiniteNumber(event.actual);
                  const consensus = toFiniteNumber(event.consensus);
                  const surprisePct = actual !== null && consensus !== null && consensus !== 0
                    ? ((actual - consensus) / Math.abs(consensus)) * 100
                    : null;
                  const provider = event.provider ?? event.source ?? event.sourceName ?? null;
                  const retrievedAt = event.retrievedAt ?? event.asOf ?? event.updatedAt ?? null;

                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setExpandedKey(isExpanded ? null : key)}
                      className="w-full border-b border-border/30 px-4 py-2.5 text-left hover:bg-white/[1.5%]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-14 shrink-0 font-terminal text-[8px] text-muted-foreground">{event.time ?? "--:--"}</div>
                        <div className="w-16 shrink-0">{impactBadge(String(event.impact ?? "LOW"))}</div>
                        <div className="min-w-0 flex-1">
                          <div className="font-terminal text-[9px] text-foreground">{event.event ?? event.name ?? "Unnamed economic event"}</div>
                          <div className="font-terminal text-[7.5px] text-muted-foreground">{event.country ?? event.region ?? "—"}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-right shrink-0">
                          <div><div className="font-terminal text-[7px] text-muted-foreground">PREV</div><div className="font-terminal text-[9px] tabular-nums">{formatEventValue(event.previous)}</div></div>
                          <div><div className="font-terminal text-[7px] text-muted-foreground">CONSENSUS</div><div className="font-terminal text-[9px] tabular-nums">{formatEventValue(event.consensus)}</div></div>
                          <div><div className="font-terminal text-[7px] text-muted-foreground">ACTUAL</div><div className="font-terminal text-[9px] tabular-nums font-bold">{event.actual === undefined || event.actual === null ? "PENDING" : formatEventValue(event.actual)}</div></div>
                        </div>
                      </div>

                      {surprisePct !== null ? (
                        <div className={`mt-1 font-terminal text-[7.5px] ${surprisePct > 0 ? "text-[hsl(142,71%,55%)]" : surprisePct < 0 ? "text-[hsl(0,80%,55%)]" : "text-muted-foreground"}`}>
                          {surprisePct > 0 ? "▲ ABOVE CONSENSUS" : surprisePct < 0 ? "▼ BELOW CONSENSUS" : "IN LINE"} · {Math.abs(surprisePct).toFixed(1)}%
                        </div>
                      ) : null}

                      {isExpanded ? (
                        <div className="mt-2 grid grid-cols-1 gap-2 border-t border-border/50 pt-2 md:grid-cols-3">
                          <div><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">PROVIDER / SOURCE</div><div className="mt-0.5 font-terminal text-[8px] text-foreground">{provider ?? "Not disclosed by calendar response"}</div></div>
                          <div><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">AS-OF / RETRIEVED</div><div className="mt-0.5 font-terminal text-[8px] text-foreground">{retrievedAt ?? "Not disclosed by calendar response"}</div></div>
                          <div><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">EVENT ID</div><div className="mt-0.5 font-mono text-[8px] text-foreground">{event.id ?? event.eventId ?? "—"}</div></div>
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
