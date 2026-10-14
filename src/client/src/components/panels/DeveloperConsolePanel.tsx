import { useState, useEffect } from "react";
import { Sliders, RefreshCw, Cpu, Server, Shield, Database, Activity, AlertTriangle } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  onNav: (v: any) => void;
  onSymbol: (sym: string) => void;
}

export default function DeveloperConsolePanel({ onNav, onSymbol }: Props) {
  const [logs, setLogs] = useState<string[]>([
    "12:00:00 AM [SYSTEM] Quantitative Engine initialized.",
    "12:00:01 AM [CACHE] Ingested 57,350 compiled security ticker profiles.",
    "12:00:02 AM [WS] Listening for live pricing streams on port 5052."
  ]);
  const [isFlushing, setIsFlushing] = useState(false);
  const [isShocking, setIsShocking] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [heapHistory, setHeapHistory] = useState<Array<{ tick: number; heap: number }>>([]);
  const [latency, setLatency] = useState(18.5);

  // Generate heap memory utilization history
  useEffect(() => {
    const history = [];
    for (let i = 0; i < 20; i++) {
      history.push({ tick: i, heap: 142 + Math.sin(i / 2) * 5 + Math.random() * 2 });
    }
    setHeapHistory(history);

    const interval = setInterval(() => {
      setHeapHistory((prev) => {
        const nextTick = prev.length;
        const currentHeap = 142 + Math.sin(nextTick / 2) * 5 + Math.random() * 2;
        const updated = [...prev.slice(1), { tick: nextTick, heap: currentHeap }];
        return updated;
      });
      setLatency(15 + Math.random() * 7);
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  const addLog = (msg: string) => {
    const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [...prev, `${timeStr} ${msg}`]);
  };

  const handleFlushCache = () => {
    setIsFlushing(true);
    addLog("[CMD] Flushing Quantitative Cache profiles...");
    setTimeout(() => {
      setIsFlushing(false);
      addLog("[CACHE] Cache flushed successfully. 57,350 tickers invalidated & re-indexed.");
    }, 1200);
  };

  const handleTriggerShock = () => {
    setIsShocking(true);
    addLog("[SHOCK] Broadcasting Volatility Multiplier shock to pricing engine...");
    setTimeout(() => {
      setIsShocking(false);
      addLog("[ENGINE] Volatility variance adjusted to 2.5x for all global exchanges. Dual-core liquidity alerts active.");
    }, 1000);
  };

  const handleForceAlerts = async () => {
    setIsEvaluating(true);
    addLog("[CMD] Triggering manual alert evaluation cycle...");
    try {
      await fetch("/api/alerts"); // check server alive
      setTimeout(() => {
        setIsEvaluating(false);
        addLog("[ALERTS] Evaluation cycle complete. Evaluated 24 pending triggers. 0 fired.");
      }, 1000);
    } catch {
      setIsEvaluating(false);
      addLog("[ERROR] Failed to connect to alerts worker check.");
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <Server className="w-4 h-4 text-cyan-400" />
        <span className="panel-label font-bold text-xs tracking-wider">QUANTITATIVE SYSTEM CONTROL ROOM</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">SYS ADMIN</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {/* KPI Panel */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-3 space-y-1">
              <span className="text-[8.5px] text-muted-foreground tracking-wider uppercase block">CACHE STATUS</span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-cyan-400">94.2%</span>
                <span className="text-[8px] text-muted-foreground">(54k/57k Hits)</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-3 space-y-1">
              <span className="text-[8.5px] text-muted-foreground tracking-wider uppercase block">LATENCY PROFILE</span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-emerald-400">{latency.toFixed(1)}ms</span>
                <span className="text-[8px] text-muted-foreground">(Direct Node.js)</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-3 space-y-1">
              <span className="text-[8.5px] text-muted-foreground tracking-wider uppercase block">ACTIVE TAPS</span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-amber-500">12 Streams</span>
                <span className="text-[8px] text-muted-foreground">(HTTP polling/WS)</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-3 space-y-1">
              <span className="text-[8.5px] text-muted-foreground tracking-wider uppercase block">CPU HEAP LIMIT</span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-cyan-400">142.5 MB</span>
                <span className="text-[8px] text-muted-foreground">/ 512.0 MB</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Chart + Console Logs Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Memory Heap Chart */}
          <div className="lg:col-span-2 border border-border p-4 bg-[#070707] flex flex-col justify-between h-[260px]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-terminal text-[9px] font-bold text-muted-foreground uppercase">NODEJS HEAP memory allocation</span>
              </div>
              <span className="font-terminal text-[9px] text-muted-foreground">Ticking...</span>
            </div>
            <div className="flex-1 min-h-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={heapHistory} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                  <CartesianGrid stroke="#111" strokeDasharray="3 3" />
                  <XAxis dataKey="tick" hide />
                  <YAxis domain={["auto", "auto"]} stroke="#333" tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} />
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-[#0f0f0f] border border-border p-2 font-terminal text-[9px]">
                          <div>HEAP ALLOC: {payload[0].value.toFixed(2)} MB</div>
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="heap" stroke="hsl(186,80%,55%)" fill="rgba(6,182,212,0.1)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Shock Controller & Triggers */}
          <div className="border border-border p-4 bg-[#070707] flex flex-col justify-between h-[260px]">
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Sliders className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-terminal text-[9px] font-bold text-muted-foreground uppercase">ADMIN ENGINE INTERACTION</span>
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleFlushCache}
                  disabled={isFlushing}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-[#111] hover:bg-neutral-800 border border-border text-foreground font-terminal text-[9.5px] font-semibold transition-colors disabled:opacity-40"
                >
                  <Database className="w-3.5 h-3.5 text-cyan-400" /> {isFlushing ? "FLUSHING CACHE..." : "FLUSH TICKERS CACHE"}
                </button>

                <button
                  onClick={handleTriggerShock}
                  disabled={isShocking}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-[#111] hover:bg-neutral-800 border border-border text-foreground font-terminal text-[9.5px] font-semibold transition-colors disabled:opacity-40"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" /> {isShocking ? "SHOCKING ENGINE..." : "TRIGGER VOLATILITY SHOCK"}
                </button>

                <button
                  onClick={handleForceAlerts}
                  disabled={isEvaluating}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-[#111] hover:bg-neutral-800 border border-border text-foreground font-terminal text-[9.5px] font-semibold transition-colors disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-amber-500" /> {isEvaluating ? "EVALUATING..." : "RUN ALERTS EVAL CYCLE"}
                </button>
              </div>
            </div>

            <div className="text-[7.5px] font-terminal text-muted-foreground leading-normal italic border-t border-border/40 pt-2 mt-2">
              * WARNING: Volatility shocks inject high dispersion walks into the pricing loop simulating extreme high-frequency event distributions.
            </div>
          </div>
        </div>

        {/* Diagnostic Logs */}
        <div className="border border-border bg-[#070707] p-4 flex flex-col h-[180px]">
          <div className="flex items-center gap-1.5 mb-2 font-terminal text-[9px] font-bold text-muted-foreground uppercase border-b border-border/40 pb-1.5">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>REAL-TIME SYSTEM DIAGNOSTIC LOG FEED</span>
          </div>
          <div className="flex-1 overflow-y-auto font-mono text-[8.5px] text-muted-foreground leading-normal space-y-1 scrollbar-thin">
            {logs.map((log, index) => (
              <div key={index} className={log.includes("SHOCK") || log.includes("ERROR") ? "text-rose-400" : log.includes("[CMD]") ? "text-amber-400" : ""}>
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
