import { useState, useMemo } from "react";
import { Megaphone } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaTopics, useMediaTopicDetail, useWikipediaPageviews } from "@/lib/useMedia";
import { computeDescriptiveStats, zScoreSeries } from "@/lib/statistics";

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

export default function MediaTopicPanel() {
  const { data: topics, isLoading: listLoading } = useMediaTopics();
  const [selected, setSelected] = useState<string | null>(null);
  const activeTopicId = selected ?? topics?.[0]?.topicId ?? "";
  const { data: detail, isLoading: detailLoading } = useMediaTopicDetail(activeTopicId);
  const { data: pageviews, isLoading: pageviewsLoading } = useWikipediaPageviews(detail?.wikipediaArticle ?? null);

  // Mention-volume z-score: a real spike-detection signal (this topic is
  // getting N std devs more coverage than its own recent normal), distinct
  // from tone -- volume spikes regardless of whether the coverage is
  // favorable or not.
  const volumeZ = useMemo(() => {
    if (!detail?.volume.length) return [];
    const zs = zScoreSeries(detail.volume.map((v) => v.value));
    return detail.volume.map((v, i) => ({ date: v.date, z: zs[i] ?? 0 }));
  }, [detail]);
  const currentVolumeZ = volumeZ.length ? volumeZ[volumeZ.length - 1].z : null;

  const pageviewStats = useMemo(() => {
    if (!pageviews?.history.length) return null;
    return computeDescriptiveStats(pageviews.history.map((h) => h.views));
  }, [pageviews]);

  return (
    <div className="h-full flex">
      <div className="w-56 shrink-0 border-r border-border overflow-y-auto scrollbar-thin">
        <div className="px-3 py-2 border-b border-border">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">TRACKED TOPICS &amp; BRANDS</span>
        </div>
        {listLoading ? (
          <div className="p-3 space-y-2">
            {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-8 bg-border" />)}
          </div>
        ) : (
          (topics ?? []).map((topic) => (
            <button
              key={topic.topicId}
              onClick={() => setSelected(topic.topicId)}
              className={`w-full text-left px-3 py-2 border-b border-border/50 transition-colors ${
                topic.topicId === activeTopicId ? "bg-[hsl(38,95%,50%)]/10 border-l-2 border-l-[hsl(38,95%,55%)]" : "hover:bg-white/5"
              }`}
            >
              <div className="font-terminal text-[9px] text-foreground truncate">{topic.name.toUpperCase()}</div>
              <div className="font-terminal text-[8px] text-muted-foreground">{topic.topicId}</div>
            </button>
          ))
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
        {detailLoading || !detail ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64 bg-border" />
            <Skeleton className="h-40 w-full bg-border" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Megaphone className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[10px] tracking-widest text-foreground">{detail.quote.name.toUpperCase()}</span>
              {!detail.quote.isLive && (
                <span className="font-terminal text-[8px] text-[hsl(0,80%,60%)] border border-[hsl(0,80%,60%)]/40 px-1.5 py-0.5">NOT LIVE</span>
              )}
            </div>
            <div className="font-terminal text-[9px] text-muted-foreground mb-4">GDELT QUERY: &quot;{detail.quote.topicId}&quot;</div>

            <div className="flex items-baseline gap-4 mb-5">
              <span className={`font-terminal text-3xl ${toneClass(detail.quote.value)}`}>{fmtTone(detail.quote.value)}</span>
              {detail.quote.change !== null && (
                <span className={`font-terminal text-sm ${toneClass(detail.quote.change)}`}>
                  {detail.quote.change >= 0 ? "+" : ""}{detail.quote.change.toFixed(2)} vs prior day
                </span>
              )}
            </div>

            {detail.quote.asOf && (
              <div className="font-terminal text-[9px] text-muted-foreground mb-4">AS OF {fmtDate(detail.quote.asOf).toUpperCase()}</div>
            )}

            <div className="h-64 border border-border bg-[#0a0a0a] p-3 mb-4">
              {detail.history.length < 2 ? (
                <div className="h-full flex items-center justify-center font-terminal text-[9px] text-muted-foreground">
                  NO HISTORICAL DATA AVAILABLE
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={detail.history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="mediaTopicFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                    <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={false} tickLine={false} width={50} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "#0a0a0a", border: "1px solid hsl(0,0%,15%)", fontSize: 11 }}
                      formatter={(v: number) => [fmtTone(v), detail.quote.name]}
                    />
                    <Area type="monotone" dataKey="value" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#mediaTopicFill)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="font-terminal text-[9px] text-muted-foreground mb-6">
              UNIT: {detail.quote.unit} (GDELT average tone, roughly -10 to +10)
            </div>

            {/* Mention volume z-score -- spike detection independent of tone. */}
            <div className="flex items-center gap-2 mb-2">
              <span className="font-terminal text-[9px] text-muted-foreground tracking-widest">MENTION VOLUME Z-SCORE (COVERAGE INTENSITY)</span>
              {currentVolumeZ !== null && (
                <span className={`font-terminal text-[8px] px-1.5 py-0.5 border tracking-wider ${
                  currentVolumeZ >= 2 ? "text-[hsl(0,80%,60%)] border-[hsl(0,80%,60%)]/40" : "text-[hsl(142,71%,50%)] border-[hsl(142,71%,30%)]/40"
                }`}>
                  {currentVolumeZ >= 0 ? "+" : ""}{currentVolumeZ.toFixed(2)}σ {currentVolumeZ >= 2 ? "— TRENDING" : ""}
                </span>
              )}
            </div>
            <div className="h-24 border border-border bg-[#0a0a0a] p-3 mb-6">
              {volumeZ.length < 2 ? (
                <div className="h-full flex items-center justify-center font-terminal text-[9px] text-muted-foreground">NO VOLUME DATA AVAILABLE</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeZ} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                    <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={30} />
                    <ReferenceLine y={2} stroke="hsl(0,80%,50%)" strokeDasharray="3 3" strokeOpacity={0.5} />
                    <ReferenceLine y={0} stroke="hsl(0,0%,30%)" />
                    <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v.toFixed(2)}σ`, "Volume Z-Score"]} />
                    <Bar dataKey="z">
                      {volumeZ.map((row, i) => <Cell key={i} fill={row.z >= 2 ? "hsl(0,80%,55%)" : "hsl(199,89%,55%)"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Wikipedia Pageviews -- independent public-attention signal. */}
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">WIKIPEDIA PAGEVIEWS — READER ATTENTION (INDEPENDENT OF NEWS TONE)</div>
            {pageviewsLoading ? (
              <div className="font-terminal text-[9px] text-muted-foreground mb-4">LOADING...</div>
            ) : !pageviews?.isLive ? (
              <div className="border border-border bg-[#0a0a0a] p-3 mb-4 font-terminal text-[9px] text-muted-foreground">NO PAGEVIEWS DATA AVAILABLE.</div>
            ) : (
              <>
                {pageviewStats && (
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    {[
                      { label: "DAILY MEAN", val: Math.round(pageviewStats.mean).toLocaleString() },
                      { label: "STD DEV", val: Math.round(pageviewStats.stdDev).toLocaleString() },
                      { label: "MIN", val: Math.round(pageviewStats.min).toLocaleString() },
                      { label: "MAX", val: Math.round(pageviewStats.max).toLocaleString() },
                    ].map((k) => (
                      <div key={k.label} className="border border-border bg-[#0a0a0a] p-2 text-center">
                        <div className="font-terminal text-[6.5px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                        <div className="font-terminal text-[11px] font-bold tabular-nums text-foreground">{k.val}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="h-32 border border-border bg-[#0a0a0a] p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pageviews.history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="pageviewsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(199,89%,55%)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="hsl(199,89%,55%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                      <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={45} />
                      <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [v.toLocaleString(), "Pageviews"]} />
                      <Area type="monotone" dataKey="views" stroke="hsl(199,89%,55%)" strokeWidth={1.5} fill="url(#pageviewsFill)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
