import { Activity, Info } from "lucide-react";
import {
  ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import { useMarketBreadth } from "@/lib/useFinance";
import { Skeleton } from "@/components/ui/skeleton";
import {
  breadthSignalClass,
  interpretAdvanceDecline,
  interpretHighLow,
  interpretMcClellan,
  interpretTrin,
  type BreadthSignal,
} from "@/lib/marketBreadthSignals";

function fmt(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

function SignalBadge({ signal }: { signal: BreadthSignal }) {
  return (
    <div className={`mt-2 inline-flex border px-1.5 py-0.5 font-terminal text-[7px] font-semibold tracking-widest ${breadthSignalClass(signal.tone)}`} title={signal.detail}>
      {signal.label}
    </div>
  );
}

export default function MarketBreadthPanel() {
  const { data, isLoading } = useMarketBreadth();

  if (isLoading || !data) {
    return (
      <div className="h-full p-6 space-y-4 bg-[#050505]">
        <Skeleton className="h-8 w-1/3 bg-border" />
        <Skeleton className="h-64 w-full bg-border" />
      </div>
    );
  }

  const { latest, series, universeSize } = data;
  const armsIsBullish = latest?.armsIndex !== null && latest?.armsIndex !== undefined && latest.armsIndex < 1;
  const mcClellanBullish = (latest?.mcClellanOscillator ?? 0) > 0;
  const advanceDeclineSignal = latest ? interpretAdvanceDecline(latest.advances, latest.declines) : null;
  const highLowSignal = latest ? interpretHighLow(latest.newHighs, latest.newLows) : null;
  const trinSignal = interpretTrin(latest?.armsIndex);
  const mcClellanSignal = interpretMcClellan(latest?.mcClellanOscillator);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0" data-workstation-toolbar>
        <Activity className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">MARKET BREADTH</span>
        <span className="font-terminal text-[8px] text-muted-foreground ml-2">US LARGE-CAP UNIVERSE ({universeSize} NAMES)</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">BRDTH</span>
      </div>

      {!latest ? (
        <div className="flex-1 flex items-center justify-center font-terminal text-[10px] text-muted-foreground">
          NOT ENOUGH OVERLAPPING TRADING-DAY DATA TO COMPUTE BREADTH RIGHT NOW.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-4">
            <div className="border border-border bg-[#0a0a0a] p-3" data-analytical-role="output">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1.5">ADVANCE / DECLINE</div>
              <div className="flex items-center gap-2">
                <span className="font-terminal text-lg font-bold text-up">{latest.advances}</span>
                <span className="font-terminal text-[10px] text-muted-foreground">/</span>
                <span className="font-terminal text-lg font-bold text-down">{latest.declines}</span>
              </div>
              <div className="h-1.5 bg-[#111] mt-2 flex overflow-hidden">
                <div className="h-full" style={{ width: `${(latest.advances / universeSize) * 100}%`, backgroundColor: "hsl(var(--up))" }} />
                <div className="h-full" style={{ width: `${(latest.declines / universeSize) * 100}%`, backgroundColor: "hsl(var(--down))" }} />
              </div>
              {advanceDeclineSignal && <SignalBadge signal={advanceDeclineSignal} />}
              <div className="font-terminal text-[7px] text-muted-foreground mt-1">{latest.unchanged} UNCHANGED · AS OF {latest.date}</div>
            </div>

            <div className="border border-border bg-[#0a0a0a] p-3" data-analytical-role="output">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1.5">NEW HIGHS / NEW LOWS</div>
              <div className="flex items-center gap-2">
                <span className="font-terminal text-lg font-bold text-up">{latest.newHighs}</span>
                <span className="font-terminal text-[10px] text-muted-foreground">/</span>
                <span className="font-terminal text-lg font-bold text-down">{latest.newLows}</span>
              </div>
              {highLowSignal && <SignalBadge signal={highLowSignal} />}
              <div className="font-terminal text-[7px] text-muted-foreground mt-1 uppercase">{highLowSignal?.detail}</div>
            </div>

            <div className="border border-border bg-[#0a0a0a] p-3" data-analytical-role="output">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1.5">ARMS INDEX (TRIN)</div>
              <div className={`font-terminal text-lg font-bold tabular-nums ${latest.armsIndex === null ? "text-muted-foreground" : armsIsBullish ? "text-up" : "text-down"}`}>
                {fmt(latest.armsIndex, 3)}
              </div>
              <SignalBadge signal={trinSignal} />
              <div className="font-terminal text-[7px] text-muted-foreground mt-1 uppercase">{trinSignal.detail}</div>
            </div>

            <div className="border border-border bg-[#0a0a0a] p-3" data-analytical-role="output">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1.5">MCCLELLAN OSCILLATOR</div>
              <div className={`font-terminal text-lg font-bold tabular-nums ${latest.mcClellanOscillator === null ? "text-muted-foreground" : mcClellanBullish ? "text-up" : "text-down"}`}>
                {fmt(latest.mcClellanOscillator, 2)}
              </div>
              <SignalBadge signal={mcClellanSignal} />
              <div className="font-terminal text-[7px] text-muted-foreground mt-1 uppercase">{mcClellanSignal.detail}</div>
            </div>
          </div>

          <div data-analytical-role="evidence">
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">ADVANCE/DECLINE LINE (CUMULATIVE, {series.length}D)</div>
            <div className="h-44 border border-border bg-[#0a0a0a] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="adLineFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(0,0%,12%)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={40} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [v.toFixed(0), "A/D Line"]} labelFormatter={(l) => l} />
                  <Area type="monotone" dataKey="advanceDeclineLine" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#adLineFill)" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div data-analytical-role="evidence">
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">MCCLELLAN OSCILLATOR (EMA19 − EMA39 OF NET ADVANCES)</div>
            <div className="h-32 border border-border bg-[#0a0a0a] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(0,0%,12%)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={40} />
                  <ReferenceLine y={0} stroke="hsl(0,0%,30%)" />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [v.toFixed(2), "McClellan"]} />
                  <Bar dataKey="mcClellanOscillator">
                    {series.map((point, i) => (
                      <Cell key={i} fill={(point.mcClellanOscillator ?? 0) >= 0 ? "hsl(var(--up))" : "hsl(var(--down))"} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="font-terminal text-[7.5px] text-muted-foreground/70 flex items-start gap-1.5" data-analytical-role="evidence">
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              Computed over a fixed {universeSize}-name US large-cap universe (not the full market), so read these directionally rather than against textbook full-market thresholds (e.g. McClellan ±100) which assume thousands of issues.
              Put/Call Ratio is not shown — this app has no live options-volume data source, and a fabricated number would be worse than an honest gap.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
