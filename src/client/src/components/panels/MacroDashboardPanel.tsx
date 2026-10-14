import { Landmark, TrendingUp, Waves } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useIndicators, useYieldCurve } from "@/lib/useEconomics";
import type { ViewMode } from "@/lib/terminalTypes";
import { useAudience } from "@/lib/audience";
import { FusionDataBar, FusionEmptyState, FusionMetric, FusionMetricGrid, FusionSection, FusionSparkline } from "@/components/terminal/FusionPrimitives";
import { toneForChange } from "@/lib/fusionExperience";

function fmtValue(value: number | null, unit: string) {
  if (value === null) return "—";
  const formatted = Math.abs(value) >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : value.toFixed(2);
  return unit === "%" ? `${formatted}%` : formatted;
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  onNav: (v: ViewMode) => void;
}

function bucketForIndicator(name: string, seriesId: string) {
  const haystack = `${name} ${seriesId}`.toLowerCase();
  if (/cpi|inflation|pce|price/.test(haystack)) return "INFLATION";
  if (/unemployment|payroll|employment|labor|labour/.test(haystack)) return "LABOUR";
  if (/yield|rate|fed|treasury|interest/.test(haystack)) return "RATES";
  if (/gdp|industrial|production|retail|income/.test(haystack)) return "GROWTH";
  if (/dollar|fx|currency|exchange/.test(haystack)) return "FX";
  return "OTHER";
}

export default function MacroDashboardPanel({ onNav }: Props) {
  const isClient = useAudience() === "client";
  const { data: indicators, isLoading } = useIndicators();
  const { data: yieldCurve, isLoading: curveLoading } = useYieldCurve();
  const anyLive = indicators?.some((i) => i.isLive) ?? false;
  const liveIndicators = indicators ?? [];
  const maxMove = Math.max(1, ...liveIndicators.map((item) => Math.abs(item.changePercent ?? 0)));
  const curveValues = (yieldCurve?.curve ?? []).map((point) => point.yield);
  const curveFinite = curveValues.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const curveSlope = curveFinite.length >= 2 ? curveFinite[curveFinite.length - 1] - curveFinite[0] : null;

  const tabs: readonly { label: string; view: ViewMode }[] = [
    { label: "Overview", view: "macrodashboard" },
    { label: "Data", view: "indicatorexplorer" },
    { label: "Signals", view: "econsignals" },
    { label: "Policy", view: "econpolicyquant" },
    { label: "Calendar", view: "ecalendar" },
    { label: "FX", view: "forex" },
  ];

  const buckets = ["GROWTH", "INFLATION", "LABOUR", "RATES", "FX"] as const;

  return (
    <div className="h-full overflow-y-auto bg-[#050505] scrollbar-thin">
      {isClient && (
        <nav className="sticky top-0 z-10 flex overflow-x-auto border-b border-border bg-[#090909] px-2" aria-label="Macro analysis">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              onClick={() => tab.view !== "macrodashboard" && onNav(tab.view)}
              aria-current={tab.view === "macrodashboard" ? "page" : undefined}
              className={`shrink-0 border-b-2 px-3 py-2 font-ui text-[8px] font-semibold ${tab.view === "macrodashboard" ? "border-amber-300 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      <div className="p-3">
        <div className="mb-3 flex items-center gap-2">
          <Landmark className="h-3.5 w-3.5 text-amber-300" />
          <div className="min-w-0 flex-1">
            <div className="font-terminal text-[10px] font-bold tracking-[0.14em] text-foreground">{isClient ? "MACRO INTELLIGENCE" : "MACRO DASHBOARD — ECONOMICS & PUBLIC POLICY"}</div>
            <div className="mt-0.5 font-terminal text-[7px] text-muted-foreground">Growth, inflation, labour, rates and FX on one linked surface.</div>
          </div>
          <button onClick={() => onNav("econsignals")} className="border border-cyan-400/25 px-2 py-1 font-terminal text-[7px] text-cyan-200 hover:bg-cyan-400/[0.04]">SIGNALS</button>
        </div>

        {!anyLive && !isLoading && (
          <div className="mb-3 border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground">
            {isClient ? "MACRO DATA IS NOT CONNECTED. ADD A SOURCE IN DATA TO POPULATE THIS VIEW." : "NO LIVE FEED CONFIGURED — VALUES REMAIN UNAVAILABLE RATHER THAN FABRICATED."}
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">{Array(10).fill(0).map((_, i) => <Skeleton key={i} className="h-16 bg-border" />)}</div>
        ) : (
          <>
            <FusionMetricGrid>
              {buckets.map((bucket) => {
                const members = liveIndicators.filter((item) => bucketForIndicator(item.name, item.seriesId) === bucket);
                const primary = members.find((item) => item.isLive) ?? members[0];
                return (
                  <FusionMetric
                    key={bucket}
                    label={bucket}
                    value={primary ? fmtValue(primary.value, primary.unit) : "—"}
                    secondary={primary ? primary.name : "No mapped series"}
                    change={primary?.changePercent == null ? undefined : `${primary.changePercent >= 0 ? "+" : ""}${primary.changePercent.toFixed(2)}%`}
                    tone={toneForChange(primary?.changePercent)}
                    onClick={() => onNav("indicatorexplorer")}
                  />
                );
              })}
              <FusionMetric
                label="CURVE SLOPE"
                value={curveSlope == null ? "—" : `${curveSlope >= 0 ? "+" : ""}${curveSlope.toFixed(2)} pp`}
                secondary={yieldCurve?.isLive ? "Live yield-curve endpoints" : "Yield curve unavailable"}
                tone={toneForChange(curveSlope)}
                onClick={() => onNav("yieldcurve")}
              />
            </FusionMetricGrid>

            <div className="fusion-dashboard-grid mt-3">
              <FusionSection title="Macro Monitor" eyebrow="LIVE INDICATORS" action={<button onClick={() => onNav("indicatorexplorer")} className="fusion-section-action">ALL DATA</button>}>
                {liveIndicators.length ? (
                  <div className="space-y-1 p-2">
                    {liveIndicators.slice(0, 12).map((ind) => (
                      <button key={ind.seriesId} onClick={() => onNav("indicatorexplorer")} className="block w-full text-left">
                        <FusionDataBar
                          label={ind.name}
                          value={ind.changePercent}
                          max={maxMove}
                          valueLabel={<>{fmtValue(ind.value, ind.unit)} {ind.changePercent == null ? "" : <span className={ind.changePercent >= 0 ? "text-up" : "text-down"}>{ind.changePercent >= 0 ? "+" : ""}{ind.changePercent.toFixed(2)}%</span>}</>}
                          tone={toneForChange(ind.changePercent)}
                        />
                      </button>
                    ))}
                  </div>
                ) : <FusionEmptyState>No macro indicators available.</FusionEmptyState>}
              </FusionSection>

              <FusionSection title="Yield Curve" eyebrow="TERM STRUCTURE" action={<button onClick={() => onNav("yieldcurve")} className="fusion-section-action">DETAIL</button>}>
                {curveLoading ? <FusionEmptyState>Loading curve…</FusionEmptyState> : curveFinite.length ? (
                  <div className="p-3">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <div><div className="font-terminal text-[7px] text-muted-foreground">SHAPE</div><div className="mt-1 font-terminal text-[14px] font-bold text-foreground">{curveSlope == null ? "—" : curveSlope > .25 ? "STEEP" : curveSlope < -.25 ? "INVERTED" : "FLAT"}</div></div>
                      <div className="text-right"><div className="font-terminal text-[7px] text-muted-foreground">ENDPOINT Δ</div><div className={`mt-1 font-terminal text-[11px] font-bold ${curveSlope == null ? "text-muted-foreground" : curveSlope >= 0 ? "text-up" : "text-down"}`}>{curveSlope == null ? "—" : `${curveSlope >= 0 ? "+" : ""}${curveSlope.toFixed(2)} pp`}</div></div>
                    </div>
                    <FusionSparkline values={curveValues} height={70} className="h-[70px] w-full text-cyan-300" label="Yield curve shape" />
                    <div className="mt-2 flex justify-between font-terminal text-[6px] text-muted-foreground">
                      {(yieldCurve?.curve ?? []).filter((_, index, all) => index === 0 || index === all.length - 1 || index === Math.floor(all.length / 2)).map((point) => <span key={point.seriesId}>{point.label} {point.yield == null ? "—" : `${point.yield.toFixed(2)}%`}</span>)}
                    </div>
                  </div>
                ) : <FusionEmptyState>Connect a rates source to populate the curve.</FusionEmptyState>}
              </FusionSection>

              <FusionSection title="Macro Workflows" eyebrow="NEXT MOVES">
                <div className="grid gap-px bg-border/60">
                  {[
                    { label: "Signals", view: "econsignals" as ViewMode, description: "Detect direction, acceleration and unusual changes.", Icon: TrendingUp },
                    { label: "Policy", view: "econpolicyquant" as ViewMode, description: "Move from observations into policy analysis.", Icon: Landmark },
                    { label: "Cross Asset", view: "crossasset" as ViewMode, description: "Relate macro conditions to market behaviour.", Icon: Waves },
                    { label: "Calendar", view: "ecalendar" as ViewMode, description: "See upcoming releases and decision points.", Icon: Landmark },
                  ].map(({ label, view, description, Icon }) => (
                    <button key={view} onClick={() => onNav(view)} className="fusion-continuity-card bg-[#080909]">
                      <Icon className="h-3.5 w-3.5 text-cyan-300" />
                      <span><strong>{label}</strong><small>{description}</small></span>
                    </button>
                  ))}
                </div>
              </FusionSection>
            </div>

            {liveIndicators.length > 0 && (
              <FusionSection title="Data Freshness" eyebrow="AS-OF MAP" className="mt-3">
                <div data-fusion-responsive-grid="four" className="grid grid-cols-2 gap-px bg-border/60 md:grid-cols-4">
                  {liveIndicators.slice(0, 8).map((ind) => (
                    <div key={ind.seriesId} className="bg-[#080909] p-2">
                      <div className="truncate font-terminal text-[7px] text-foreground">{ind.name}</div>
                      <div className="mt-1 font-terminal text-[6px] text-muted-foreground">{ind.asOf ? fmtDate(ind.asOf).toUpperCase() : "NO AS-OF DATE"}</div>
                    </div>
                  ))}
                </div>
              </FusionSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}
