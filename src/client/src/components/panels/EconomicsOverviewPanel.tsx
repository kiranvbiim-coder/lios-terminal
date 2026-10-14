import { CalendarDays, ChevronRight, Globe2 } from "lucide-react";

import DataStatusBadge from "@/components/data/DataStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import type { EconomicCalendarEvent, EconomicsSnapshotMetric } from "@/lib/finance";
import { useEconomicCalendar, useEconomics } from "@/lib/useFinance";

interface Props {
  onOpenCalendar?: () => void;
}

function formatMetricValue(metric: EconomicsSnapshotMetric) {
  if (metric.value === null) return "—";
  if (metric.unit === "%") return `${metric.value.toFixed(2)}%`;
  if (Math.abs(metric.value) < 10) return metric.value.toFixed(4);
  return metric.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDelta(metric: EconomicsSnapshotMetric) {
  if (metric.value === null || metric.prev === null) return "Δ —";
  const delta = metric.value - metric.prev;
  const sign = delta >= 0 ? "+" : "";
  return `Δ ${sign}${delta.toFixed(metric.unit === "%" ? 2 : Math.abs(delta) < 10 ? 4 : 2)}${metric.unit}`;
}

function formatEventDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).toUpperCase();
}

function categoryLabel(category: EconomicCalendarEvent["category"]) {
  const labels: Record<EconomicCalendarEvent["category"], string> = {
    inflation: "INFLATION",
    labor: "LABOR",
    growth: "GROWTH",
    policy: "POLICY",
    consumption: "CONSUMPTION",
    activity: "ACTIVITY",
    housing: "HOUSING",
  };
  return labels[category];
}

function snapshotRows(metrics: Array<{ key: string; metric: EconomicsSnapshotMetric }>) {
  return metrics.map(({ key, metric }) => {
    const delta = metric.value !== null && metric.prev !== null ? metric.value - metric.prev : null;
    return (
      <div key={key} className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-border/50 px-3 py-2 hover:bg-white/[0.025]">
        <span className="truncate font-terminal text-[9px] text-foreground">{metric.label.toUpperCase()}</span>
        <span className="font-terminal text-[9px] tabular-nums text-right text-foreground">{formatMetricValue(metric)}</span>
        <span className={`font-terminal text-[9px] tabular-nums text-right ${delta === null ? "text-muted-foreground" : delta >= 0 ? "text-up" : "text-down"}`}>
          {delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(metric.unit === "%" ? 2 : Math.abs(delta) < 10 ? 4 : 2)}`}
        </span>
      </div>
    );
  });
}

function EconCard({ metric }: { metric: EconomicsSnapshotMetric }) {
  return (
    <div className="bg-[#080808] border border-border px-3 py-2.5 hover:border-[hsl(38,95%,50%)/40%] transition-colors">
      <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{metric.label}</div>
      <div className="mt-1 font-terminal text-base font-bold tabular-nums text-foreground">{formatMetricValue(metric)}</div>
      <div className="mt-0.5 font-terminal text-[8px] tabular-nums text-muted-foreground">{formatDelta(metric)}</div>
    </div>
  );
}

function RateSignal({ label, value, detail, tone = "text-foreground" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="min-w-0 bg-[#080808] px-3 py-2.5">
      <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-terminal text-base font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-0.5 truncate font-terminal text-[7px] text-muted-foreground">{detail}</div>
    </div>
  );
}

export default function EconomicsOverviewPanel({ onOpenCalendar }: Props = {}) {
  const { data: econ, isLoading: snapshotLoading } = useEconomics();
  const { data: calendar = [], isLoading: calendarLoading } = useEconomicCalendar();
  const spread10s2s = econ && econ.t10y.value !== null && econ.t2y.value !== null ? (econ.t10y.value - econ.t2y.value) * 100 : null;
  const upcomingEvents = calendar.slice(0, 5);
  const highImpactCount = calendar.filter((event) => event.importance === "high").length;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]" data-macro-overview>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-[#070707]">
        <Globe2 className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">MACRO SNAPSHOT</span>
        {econ?.status && <span className="ml-auto"><DataStatusBadge status={econ.status} compact /></span>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="p-3 space-y-3">
          <section>
            <div className="panel-label mb-1.5">US MACRO</div>
            {snapshotLoading ? (
              <div className="grid grid-cols-2 gap-px bg-border xl:grid-cols-4">
                {Array(4).fill(0).map((_, index) => <Skeleton key={index} className="h-16 bg-border" />)}
              </div>
            ) : econ ? (
              <div className="grid grid-cols-2 gap-px bg-border xl:grid-cols-4">
                <EconCard metric={econ.gdp} />
                <EconCard metric={econ.cpi} />
                <EconCard metric={econ.unemployment} />
                <EconCard metric={econ.fedFunds} />
              </div>
            ) : null}
          </section>

          <section>
            <div className="panel-label mb-1.5">RATES</div>
            {snapshotLoading || !econ ? (
              <Skeleton className="h-20 bg-border" />
            ) : (
              <div className="grid grid-cols-2 gap-px border border-border bg-border xl:grid-cols-4" data-macro-rates-snapshot>
                <RateSignal label="US 2Y" value={econ.t2y.value !== null ? `${econ.t2y.value.toFixed(2)}%` : "—"} detail={formatDelta(econ.t2y)} />
                <RateSignal label="US 10Y" value={econ.t10y.value !== null ? `${econ.t10y.value.toFixed(2)}%` : "—"} detail={formatDelta(econ.t10y)} />
                <RateSignal label="US 30Y" value={econ.t30y.value !== null ? `${econ.t30y.value.toFixed(2)}%` : "—"} detail={formatDelta(econ.t30y)} />
                <RateSignal
                  label="10s2s SLOPE"
                  value={`${spread10s2s !== null && spread10s2s >= 0 ? "+" : ""}${spread10s2s?.toFixed(0) ?? "—"}bp`}
                  detail={spread10s2s === null ? "Curve unavailable" : spread10s2s < 0 ? "INVERTED CURVE" : "POSITIVE SLOPE"}
                  tone={spread10s2s === null ? "text-muted-foreground" : spread10s2s < 0 ? "text-down" : "text-up"}
                />
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <section>
              <div className="panel-label mb-1.5">FX</div>
              <div className="bg-[#080808] border border-border">
                <div className="grid grid-cols-[1fr_auto_auto] px-3 py-1.5 border-b border-border font-terminal text-[7px] text-muted-foreground">
                  <span>PAIR</span><span className="text-right">LAST</span><span className="text-right">Δ</span>
                </div>
                {snapshotLoading || !econ ? (
                  <div className="p-2 space-y-1">{Array(4).fill(0).map((_, index) => <Skeleton key={index} className="h-7 bg-border" />)}</div>
                ) : snapshotRows([
                  { key: "eurusd", metric: econ.eurUsd },
                  { key: "gbpusd", metric: econ.gbpUsd },
                  { key: "usdjpy", metric: econ.usdJpy },
                  { key: "dxy", metric: econ.dolllarIndex },
                ])}
              </div>
            </section>

            <section>
              <div className="panel-label mb-1.5">COMMODITIES</div>
              <div className="bg-[#080808] border border-border">
                <div className="grid grid-cols-[1fr_auto_auto] px-3 py-1.5 border-b border-border font-terminal text-[7px] text-muted-foreground">
                  <span>CONTRACT</span><span className="text-right">LAST</span><span className="text-right">Δ</span>
                </div>
                {snapshotLoading || !econ ? (
                  <div className="p-2 space-y-1">{Array(2).fill(0).map((_, index) => <Skeleton key={index} className="h-7 bg-border" />)}</div>
                ) : snapshotRows([
                  { key: "gold", metric: econ.gold },
                  { key: "oil", metric: econ.oil },
                ])}
              </div>
            </section>
          </div>

          <section>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-3 w-3 text-amber-300" />
                <div className="panel-label">NEXT EVENTS</div>
                {!calendarLoading && <span className="font-terminal text-[7px] text-muted-foreground">{highImpactCount} HIGH IMPACT / 30D</span>}
              </div>
              {onOpenCalendar && (
                <button type="button" onClick={onOpenCalendar} className="flex items-center gap-1 font-terminal text-[7px] tracking-widest text-amber-300 hover:text-amber-200">
                  OPEN CALENDAR <ChevronRight className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="border border-border bg-[#080808]">
              {calendarLoading ? (
                <div className="p-2 space-y-1">{Array(4).fill(0).map((_, index) => <Skeleton key={index} className="h-8 bg-border" />)}</div>
              ) : upcomingEvents.length === 0 ? (
                <div className="px-3 py-4 font-terminal text-[8px] text-muted-foreground">NO SOURCE-BACKED EVENTS IN THE CURRENT WINDOW</div>
              ) : (
                upcomingEvents.map((event) => (
                  <button
                    type="button"
                    key={event.id}
                    onClick={onOpenCalendar}
                    disabled={!onOpenCalendar}
                    className="grid w-full grid-cols-[76px_1fr_auto] items-center gap-2 border-b border-border/50 px-3 py-2 text-left last:border-b-0 hover:bg-white/[0.025] disabled:cursor-default"
                  >
                    <span className="font-terminal text-[7px] text-muted-foreground">{formatEventDate(event.date)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-terminal text-[9px] text-foreground">{event.title}</span>
                      <span className="mt-0.5 block font-terminal text-[7px] text-muted-foreground">{event.timeCt} · {categoryLabel(event.category)}</span>
                    </span>
                    <span className={`border px-1.5 py-0.5 font-terminal text-[7px] tracking-widest ${event.importance === "high" ? "border-red-500/30 text-red-300" : "border-border text-muted-foreground"}`}>
                      {event.importance.toUpperCase()}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
