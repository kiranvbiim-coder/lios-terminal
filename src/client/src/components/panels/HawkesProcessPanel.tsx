import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useEffect, useRef, useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Activity, AlertTriangle, Zap, Play, Pause, RefreshCw } from "lucide-react";
import { ConceptExplainer } from "./ConceptExplainer";

interface Trade {
  id: number;
  time: number;
  type: "BUY" | "SELL";
  size: number;
  price: number;
}

interface VpinBucket {
  bucketIndex: number;
  buyVol: number;
  sellVol: number;
  vpin: number;
}

export default function HawkesProcessPanel({ onUpdateIntensity }: { onUpdateIntensity?: (intensity: number) => void }) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [mu, setMu] = useTerminalArtifactState("HawkesProcessPanel.mu", 0.4);
  const [alpha, setAlpha] = useTerminalArtifactState("HawkesProcessPanel.alpha", 0.5);
  const [beta, setBeta] = useTerminalArtifactState("HawkesProcessPanel.beta", 0.85); // Decay rate of excitement

  // Simulation states
  const [intensity, setIntensity] = useState(0.4);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [vpinHistory, setVpinHistory] = useState<VpinBucket[]>([]);
  
  const tradesRef = useRef<Trade[]>([]);
  const lastIntensityRef = useRef(0.4);
  const timeRef = useRef(0.0);
  const nextTradeIdRef = useRef(1);

  // Shock duration parameters
  const [activeShock, setActiveShock] = useState<"BUY_WALL" | "SELL_PANIC" | null>(null);
  const shockEndTimeRef = useRef(0);

  const resetSimulation = () => {
    tradesRef.current = [];
    lastIntensityRef.current = mu;
    timeRef.current = 0.0;
    nextTradeIdRef.current = 1;
    setTrades([]);
    setVpinHistory([]);
    setIntensity(mu);
  };

  const injectShock = (type: "BUY_WALL" | "SELL_PANIC") => {
    setActiveShock(type);
    shockEndTimeRef.current = timeRef.current + 5.0; // 5 seconds shock
  };

  // Main high-frequency simulation loop running at 100ms intervals
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const dt = 0.1; // 100ms step
      timeRef.current += dt;
      
      const currentTime = timeRef.current;
      const history = tradesRef.current;

      // Check if shock has expired
      if (activeShock && currentTime > shockEndTimeRef.current) {
        setActiveShock(null);
      }

      // Calculate Hawkes Intensity:
      // lambda(t) = mu + sum( alpha * exp(-beta * (t - t_i)) )
      // We can compute this recursively:
      // lambda(t) = mu + (lambda(t-dt) - mu) * exp(-beta * dt) + alpha * (number of trades in last step)
      let currentMu = mu;
      let currentAlpha = alpha;

      // Shocks boost background rate and excitation
      if (activeShock) {
        currentMu = mu * 3.5;
        currentAlpha = alpha * 1.5;
      }

      const prevIntensityPart = (lastIntensityRef.current - currentMu) * Math.exp(-beta * dt);
      let nextIntensity = currentMu + prevIntensityPart;

      // Check if we generate trades in this 100ms step
      // Probability of a trade in dt is lambda * dt
      const tradeProbability = nextIntensity * dt;
      const numGeneratedTrades = Math.random() < tradeProbability ? 1 : 0;

      if (numGeneratedTrades > 0) {
        // Add trade
        let type: "BUY" | "SELL" = Math.random() > 0.5 ? "BUY" : "SELL";
        if (activeShock === "BUY_WALL") type = Math.random() > 0.1 ? "BUY" : "SELL";
        if (activeShock === "SELL_PANIC") type = Math.random() > 0.1 ? "SELL" : "BUY";

        const size = Math.round(100 + Math.random() * 900);
        // Spot price walks slightly based on buy/sell order direction
        const prevPrice = history[history.length - 1]?.price ?? 150.0;
        const priceChange = (type === "BUY" ? 0.05 : -0.05) * (size / 500);
        const price = Math.max(10, prevPrice + priceChange);

        const newTrade: Trade = {
          id: nextTradeIdRef.current++,
          time: currentTime,
          type,
          size,
          price,
        };

        history.push(newTrade);
        // Excite the intensity for future steps
        nextIntensity += currentAlpha;
      }

      // Keep sliding window of trades tape (max 40)
      if (history.length > 40) {
        // We slice but preserve historical logs for VPIN calculation
      }

      lastIntensityRef.current = nextIntensity;
      setIntensity(nextIntensity);
      if (onUpdateIntensity) {
        onUpdateIntensity(nextIntensity);
      }
      setTrades([...history].slice(-25).reverse()); // newest first for scrolling tape

      // Update VPIN buckets (every 10 trades makes a volume bucket)
      const bucketSize = 10;
      if (history.length >= bucketSize) {
        const numBuckets = Math.floor(history.length / bucketSize);
        const newVpinHistory: VpinBucket[] = [];

        for (let b = 0; b < numBuckets; b++) {
          const bucketTrades = history.slice(b * bucketSize, (b + 1) * bucketSize);
          let buyVol = 0;
          let sellVol = 0;

          bucketTrades.forEach((t) => {
            if (t.type === "BUY") buyVol += t.size;
            else sellVol += t.size;
          });

          const totalVol = buyVol + sellVol;
          const vpin = totalVol > 0 ? (Math.abs(buyVol - sellVol) / totalVol) * 100 : 0;

          newVpinHistory.push({
            bucketIndex: b,
            buyVol,
            sellVol,
            vpin,
          });
        }

        // Limit chart history to last 30 buckets
        setVpinHistory(newVpinHistory.slice(-30));
      }

    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, mu, alpha, beta, activeShock]);

  // Imbalance alarm state
  const activeVPIN = vpinHistory[vpinHistory.length - 1]?.vpin ?? 0;
  const isToxic = activeVPIN > 70;

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      {/* Parameters Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[hsl(38,95%,55%)] animate-pulse" />
          <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">HAWKES PROCESS ORDER FLOW TOXICITY DESK</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`flex items-center gap-1.5 px-3 py-1 border font-terminal text-[9px] tracking-widest transition-colors ${
              isPlaying
                ? "bg-amber-500/10 border-amber-500/30 text-[hsl(38,95%,55%)]"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20"
            }`}
          >
            {isPlaying ? "PAUSE" : "START"}
          </button>
          
          <button
            onClick={resetSimulation}
            className="flex items-center gap-1.5 px-3 py-1 bg-border/20 border border-border text-foreground hover:bg-border/30 transition-colors font-terminal text-[9px] tracking-widest"
          >
            <RefreshCw className="w-3.5 h-3.5" /> RESET
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        {/* Left Column: High frequency tape and VPIN history chart */}
        <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4 border-b xl:border-b-0 xl:border-r border-border">
          
          {/* Intensity & VPIN Chart */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase">VPIN VOLATILITY HISTORY</span>
              <span className="font-terminal text-[9px] text-muted-foreground font-mono">
                Current Toxicity (VPIN): {activeVPIN.toFixed(1)}%
              </span>
            </div>
            <div className="h-[180px] w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={vpinHistory} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                  <CartesianGrid stroke="#111" />
                  <XAxis dataKey="bucketIndex" stroke="#555" tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} />
                  <YAxis stroke="#555" domain={[0, 100]} tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const pt = payload[0].payload;
                      return (
                        <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5 font-mono">
                          <div>Volume Bucket #{pt.bucketIndex}</div>
                          <div className="text-red-500 font-bold">VPIN: {pt.vpin.toFixed(2)}%</div>
                          <div className="text-muted-foreground">Buy Vol: {pt.buyVol} | Sell Vol: {pt.sellVol}</div>
                        </div>
                      );
                    }}
                  />
                  <Line type="monotone" dataKey="vpin" stroke="rgb(239,68,68)" strokeWidth={2} dot={true} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Scrolling HFT tape */}
          <div className="space-y-2">
            <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block">
              LIVE TRANSACTION FEED (HIGH FREQUENCY MICROSTRUCTURE TAPE)
            </span>
            <div className="border border-border rounded overflow-hidden bg-[#070707] h-[130px] overflow-y-auto scrollbar-thin">
              <div className="grid grid-cols-4 border-b border-border p-1 font-terminal text-[8px] font-bold text-muted-foreground text-center bg-[#090909]">
                <div>TRADE ID</div>
                <div>TIME (S)</div>
                <div>TYPE</div>
                <div>SIZE (SHARES)</div>
              </div>
              <div className="font-mono text-[9px] divide-y divide-border/40">
                {trades.map((t) => (
                  <div key={t.id} className="grid grid-cols-4 p-1 text-center hover:bg-white/[1%]">
                    <div className="text-muted-foreground">#{t.id}</div>
                    <div className="text-foreground">{t.time.toFixed(1)}s</div>
                    <div className={`font-bold ${t.type === "BUY" ? "text-up" : "text-down"}`}>
                      {t.type}
                    </div>
                    <div className="text-foreground">{t.size}</div>
                  </div>
                ))}
                {trades.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground uppercase font-terminal">
                    Waiting for trade arrivals...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Controls & Shock Injection */}
        <div className="w-full xl:w-72 bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin border-l border-border">
          {/* Section: Sliders */}
          <div className="p-4 border-b border-border space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">HAWKES PARAMETERS</span>
            </div>

            {/* Baseline rate mu */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">BACKGROUND RATE (MU)</span>
                <span className="text-foreground font-mono font-bold">{mu.toFixed(2)}/s</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.05"
                value={mu}
                onChange={(e) => setMu(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* Excitation alpha */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">EXCITATION (ALPHA)</span>
                <span className="text-foreground font-mono font-bold">{alpha.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={alpha}
                onChange={(e) => setAlpha(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>
          </div>

          {/* Section: Shock Injection */}
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">INJECT ORDER SHOCKS</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => injectShock("BUY_WALL")}
                disabled={activeShock !== null}
                className="px-2 py-1.5 border border-emerald-500/30 hover:border-emerald-500 bg-emerald-500/10 text-emerald-500 font-terminal text-[8px] tracking-widest transition-colors rounded uppercase disabled:opacity-30"
              >
                BUY WALL
              </button>
              <button
                onClick={() => injectShock("SELL_PANIC")}
                disabled={activeShock !== null}
                className="px-2 py-1.5 border border-red-500/30 hover:border-red-500 bg-red-500/10 text-red-500 font-terminal text-[8px] tracking-widest transition-colors rounded uppercase disabled:opacity-30"
              >
                SELL PANIC
              </button>
            </div>
          </div>

          {/* Section: Toxicity Alarms */}
          <div className="p-4 flex-1 space-y-3 bg-[#080808]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">FLOW TOXICITY MONITOR</span>
            </div>

            <div className="space-y-2">
              <div className="bg-[#050505] border border-border/80 p-2.5 flex justify-between items-center font-terminal text-[10px]">
                <span className="text-muted-foreground">TRADING INTENSITY (λ)</span>
                <span className="text-foreground font-mono font-bold">{intensity.toFixed(2)} trades/s</span>
              </div>

              <div className={`border p-2.5 rounded font-terminal text-[9px] leading-normal flex flex-col space-y-1.5 ${
                isToxic ? "bg-red-950/20 border-red-500 text-red-400 animate-pulse" : "bg-[#050505] border-border text-muted-foreground"
              }`}>
                <span className="font-bold text-foreground block">
                  {isToxic ? "⚠️ HIGH TOXICITY WARNING" : "✓ LIQUIDITY BALANCE STABLE"}
                </span>
                <p>
                  {isToxic
                    ? "VPIN has exceeded 70%! Informed order flow is dominating the book. Market makers are at risk of adverse selection and may withdraw liquidity, risking a flash crash."
                    : "Order imbalances are within normal bounds. Market maker inventory spreads remain stable."
                  }
                </p>
              </div>
            </div>

            <ConceptExplainer title="SELF-EXCITING PROCESS">
              <p>
                <strong>Background rate (μ):</strong> The baseline trade arrival rate with no contagion -- what order flow looks like on a quiet day.
              </p>
              <p>
                <strong>Excitation (α):</strong> How much each trade raises the odds of another trade arriving immediately after. This is what makes volatility cluster instead of arriving as independent, evenly-spaced events.
              </p>
              <p>
                <strong>Decay (β):</strong> How fast that elevated intensity fades back toward baseline once the triggering trades stop.
              </p>
            </ConceptExplainer>
          </div>
        </div>
      </div>
    </div>
  );
}
