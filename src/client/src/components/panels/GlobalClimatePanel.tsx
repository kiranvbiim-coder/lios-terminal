import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState } from "react";
import { CloudSun, Ship, Palmtree } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useClimateAll, useClimateSnapshot, type LocationTag } from "@/lib/useOfficialSources";

const TAGS: { value: LocationTag | "all"; label: string; icon: typeof Ship }[] = [
  { value: "all", label: "ALL LOCATIONS", icon: CloudSun },
  { value: "port", label: "MAJOR PORTS", icon: Ship },
  { value: "tourist_hub", label: "TOURIST HUBS", icon: Palmtree },
];

function fmt(v: number | null, digits = 1, suffix = ""): string {
  return v === null ? "—" : `${v.toFixed(digits)}${suffix}`;
}

export default function GlobalClimatePanel() {
  const [tag, setTag] = useTerminalArtifactState<LocationTag | "all">("GlobalClimatePanel.tag", "all");
  const { data: snapshots, isLoading } = useClimateAll(tag === "all" ? undefined : tag);
  const [focusCode, setFocusCode] = useState<string | null>(null);

  const activeCode = focusCode ?? snapshots?.[0]?.location.code ?? "";
  const { data: focus, isLoading: focusLoading } = useClimateSnapshot(activeCode, 10);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <CloudSun className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">GLOBAL CLIMATE & PORTS MONITOR — NASA POWER</span>
        <span className="font-terminal text-[7px] text-[hsl(142,71%,50%)] tracking-widest border border-[hsl(142,71%,30%)]/40 px-1.5 py-0.5">OFFICIAL · NO KEY</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">GCLM</span>
      </div>

      <div className="flex border-b border-border bg-[#060606] shrink-0">
        {TAGS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTag(t.value)}
            className={`flex items-center gap-1.5 px-3 py-2 font-terminal text-[8px] tracking-wider border-r border-border/50 ${
              tag === t.value ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="w-3 h-3" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 shrink-0 border-r border-border overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <div className="p-3 font-terminal text-[9px] text-muted-foreground">LOADING...</div>
          ) : !snapshots?.length ? (
            <div className="p-3 font-terminal text-[9px] text-muted-foreground">NO CLIMATE DATA AVAILABLE.</div>
          ) : (
            snapshots.map((s) => (
              <button
                key={s.location.code}
                onClick={() => setFocusCode(s.location.code)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors ${
                  s.location.code === activeCode ? "bg-[hsl(38,95%,50%)]/10 border-l-2 border-l-[hsl(38,95%,55%)]" : "hover:bg-white/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-terminal text-[9px] text-foreground truncate">{s.location.name}</span>
                  <span className="font-terminal text-[10px] font-bold tabular-nums text-foreground shrink-0 ml-2">{fmt(s.latest?.tempAvgC ?? null, 0, "°C")}</span>
                </div>
                <div className="font-terminal text-[7.5px] text-muted-foreground mt-0.5">
                  {s.latest ? `PRECIP ${fmt(s.latest.precipMm, 1, "mm")} · WIND ${fmt(s.latest.windSpeedMs, 1, "m/s")}` : "NO RECENT DATA"}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
          {focusLoading || !focus ? (
            <div className="font-terminal text-[9px] text-muted-foreground">SELECT A LOCATION TO VIEW ITS RECENT CLIMATE HISTORY.</div>
          ) : !focus.isLive ? (
            <div className="font-terminal text-[9px] text-muted-foreground">NO DATA AVAILABLE FOR THIS LOCATION.</div>
          ) : (
            <>
              <div className="font-terminal text-[10px] tracking-widest text-foreground mb-1">{focus.location.name.toUpperCase()}</div>
              <div className="font-terminal text-[8px] text-muted-foreground mb-4">
                {focus.location.lat.toFixed(2)}, {focus.location.lon.toFixed(2)} · LAST {focus.readings.length} DAYS · AS OF {focus.latest?.date}
              </div>

              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { label: "TEMP (AVG)", val: fmt(focus.latest?.tempAvgC ?? null, 1, "°C") },
                  { label: "TEMP (MAX)", val: fmt(focus.latest?.tempMaxC ?? null, 1, "°C") },
                  { label: "PRECIP", val: fmt(focus.latest?.precipMm ?? null, 1, "mm") },
                  { label: "WIND", val: fmt(focus.latest?.windSpeedMs ?? null, 1, "m/s") },
                ].map((k) => (
                  <div key={k.label} className="border border-border bg-[#0a0a0a] p-2.5 text-center">
                    <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                    <div className="font-terminal text-[13px] font-bold tabular-nums text-foreground">{k.val}</div>
                  </div>
                ))}
              </div>

              <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">TEMPERATURE TREND</div>
              <div className="h-40 border border-border bg-[#0a0a0a] p-3 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={focus.readings} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="climFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="hsl(0,0%,10%)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={30} />
                    <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={35} domain={["auto", "auto"]} tickFormatter={(v) => `${v}°`} />
                    <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v.toFixed(1)}°C`, "Avg Temp"]} />
                    <Area type="monotone" dataKey="tempAvgC" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#climFill)" dot={{ r: 2, fill: "hsl(38,95%,55%)" }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">PRECIPITATION (DISRUPTION RISK)</div>
              <div className="h-32 border border-border bg-[#0a0a0a] p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={focus.readings} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={30} />
                    <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={35} tickFormatter={(v) => `${v}mm`} />
                    <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v.toFixed(1)}mm`, "Precipitation"]} />
                    <Area type="monotone" dataKey="precipMm" stroke="hsl(199,89%,55%)" strokeWidth={1.5} fill="hsl(199,89%,55%)" fillOpacity={0.15} dot={{ r: 2, fill: "hsl(199,89%,55%)" }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="px-4 py-1.5 border-t border-border bg-[#060606] shrink-0">
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">NASA POWER satellite meteorology — official, free, no key required. Major ports double as weather-disruption risk signals; tourist hubs as destination-climate reference.</span>
      </div>
    </div>
  );
}
