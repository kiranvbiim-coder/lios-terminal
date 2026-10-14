import { useEffect, useRef, useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Flame, Play, Pause, RefreshCw, Sliders, Info } from "lucide-react";
import { formatPrice } from "@/lib/finance";
import { ConceptExplainer } from "./ConceptExplainer";

// Constants for Ising Model
const GRID_SIZE = 40; // 40x40 = 1600 traders
const COOP_CRITICAL = 0.44; // Critical coupling threshold (social contagion)

export default function IsingPanel({ symbol, onUpdateMagnetization }: { symbol: string; onUpdateMagnetization?: (mag: number) => void }) {
  const [coupling, setCoupling] = useState(0.35); // social copying J
  const [externalField, setExternalField] = useState(0.0); // news sentiment B
  const [temperature, setTemperature] = useState(1.0); // random noise T
  const [isPlaying, setIsPlaying] = useState(true);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Simulation states
  const gridRef = useRef<Int8Array>(new Int8Array(GRID_SIZE * GRID_SIZE));
  const priceHistoryRef = useRef<Array<{ tick: number; price: number; volume: number; mag: number }>>([]);
  const [currentStats, setCurrentStats] = useState({
    price: 100.0,
    magnetization: 0.0,
    activity: 0,
    step: 0,
  });

  // Initialize grid randomly
  const resetSimulation = () => {
    const grid = gridRef.current;
    for (let i = 0; i < grid.length; i++) {
      grid[i] = Math.random() > 0.5 ? 1 : -1;
    }
    priceHistoryRef.current = [{ tick: 0, price: 100.0, volume: 0, mag: 0.0 }];
    setCurrentStats({ price: 100.0, magnetization: 0.0, activity: 0, step: 0 });
  };

  // Run initial reset on mount
  useEffect(() => {
    resetSimulation();
  }, []);

  // Main simulation loop running at 30 FPS
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = 0;

    const stepSimulation = (timestamp: number) => {
      if (!isPlaying) {
        animationFrameId = requestAnimationFrame(stepSimulation);
        return;
      }

      // Throttle to ~30 FPS
      if (timestamp - lastTime < 33) {
        animationFrameId = requestAnimationFrame(stepSimulation);
        return;
      }
      lastTime = timestamp;

      const grid = gridRef.current;
      const J = coupling;
      const B = externalField;
      const T = temperature;
      
      let acceptedFlips = 0;
      const sweeps = 3; // Number of sweeps per frame
      const n = GRID_SIZE;

      // Metropolis-Hastings MCMC Sweeps
      for (let s = 0; s < sweeps; s++) {
        for (let idx = 0; idx < grid.length; idx++) {
          // Select random site
          const x = Math.floor(Math.random() * n);
          const y = Math.floor(Math.random() * n);
          const i = y * n + x;

          const s_i = grid[i];

          // Neighbors with periodic boundaries
          const s_up = grid[((y - 1 + n) % n) * n + x];
          const s_down = grid[((y + 1) % n) * n + x];
          const s_left = grid[y * n + ((x - 1 + n) % n)];
          const s_right = grid[y * n + ((x + 1) % n)];

          const neighborsSum = s_up + s_down + s_left + s_right;

          // Energy change if we flip s_i -> -s_i
          // dE = 2 * s_i * (J * sum_neighbors + B)
          const dE = 2 * s_i * (J * neighborsSum + B);

          if (dE <= 0 || Math.random() < Math.exp(-dE / T)) {
            grid[i] = -s_i;
            acceptedFlips++;
          }
        }
      }

      // Compute magnetization (consensus)
      let sumSpins = 0;
      for (let i = 0; i < grid.length; i++) {
        sumSpins += grid[i];
      }
      const M = sumSpins / grid.length;

      // Update Simulated Asset Price based on net magnetization
      const history = priceHistoryRef.current;
      const prevPrice = history[history.length - 1]?.price ?? 100.0;
      
      // Price changes proportional to trader alignment, plus minor white noise
      const priceReturn = M * 0.015 + (Math.random() - 0.5) * 0.004;
      const newPrice = Math.max(1, prevPrice * (1 + priceReturn));
      const nextTick = history.length;

      history.push({
        tick: nextTick,
        price: newPrice,
        volume: acceptedFlips,
        mag: M,
      });

      // Keep sliding window of history for performance
      if (history.length > 100) {
        history.shift();
      }

      setCurrentStats({
        price: newPrice,
        magnetization: M,
        activity: acceptedFlips,
        step: nextTick,
      });

      if (onUpdateMagnetization) {
        onUpdateMagnetization(M);
      }

      // Draw the canvas representation
      drawCanvas();

      animationFrameId = requestAnimationFrame(stepSimulation);
    };

    const drawCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const grid = gridRef.current;
      const cellWidth = canvas.width / GRID_SIZE;
      const cellHeight = canvas.height / GRID_SIZE;

      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          const s = grid[y * GRID_SIZE + x];
          // +1 buy (bright emerald green), -1 sell (bright red)
          ctx.fillStyle = s === 1 ? "rgb(34,197,94)" : "rgb(239,68,68)";
          ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
        }
      }
    };

    animationFrameId = requestAnimationFrame(stepSimulation);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, coupling, externalField, temperature]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      {/* Parameters Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-[hsl(38,95%,55%)] animate-pulse" />
          <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">ISING SOCIAL MARKET SIMULATOR</span>
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
            {isPlaying ? (
              <>
                <Pause className="w-3 h-3" /> PAUSE
              </>
            ) : (
              <>
                <Play className="w-3 h-3" /> START
              </>
            )}
          </button>

          <button
            onClick={resetSimulation}
            className="flex items-center gap-1.5 px-3 py-1 bg-border/20 border border-border text-foreground hover:bg-border/30 transition-colors font-terminal text-[9px] tracking-widest"
          >
            <RefreshCw className="w-3 h-3" /> RESET
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        {/* Left Column: Live Canvas Grid & Chart */}
        <div className="flex-1 p-4 flex flex-col md:flex-row gap-4 overflow-y-auto scrollbar-thin">
          {/* Canvas Box */}
          <div className="flex flex-col items-center shrink-0">
            <span className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2">TRADER OPINION GRID (40x40)</span>
            <div className="border-2 border-border p-1 bg-black">
              <canvas
                ref={canvasRef}
                width={280}
                height={280}
                style={{ imageRendering: "pixelated" }}
                className="w-[280px] h-[280px]"
              />
            </div>
            <div className="mt-2.5 flex gap-4 font-terminal text-[9px]">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-emerald-500 rounded-sm" />
                <span className="text-muted-foreground">BUY (+1)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-red-500 rounded-sm" />
                <span className="text-muted-foreground">SELL (-1)</span>
              </div>
            </div>
          </div>

          {/* Simulated Price Series */}
          <div className="flex-1 flex flex-col min-w-[280px]">
            <span className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2 uppercase">ENDOGENOUS PRICE EVOLUTION</span>
            <div className="flex-1 h-[250px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={priceHistoryRef.current} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                  <CartesianGrid stroke="#111" />
                  <XAxis dataKey="tick" stroke="#444" tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} />
                  <YAxis stroke="#444" domain={["auto", "auto"]} tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} />
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const pt = payload[0].payload;
                      return (
                        <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5">
                          <div className="text-muted-foreground font-bold">Step {pt.tick}</div>
                          <div className="text-foreground">Sim Price: {pt.price.toFixed(2)}</div>
                          <div className="text-foreground">Consensus (M): {(pt.mag * 100).toFixed(0)}%</div>
                        </div>
                      );
                    }}
                  />
                  <Line type="monotone" dataKey="price" stroke="hsl(38,95%,55%)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right Column: Physics Parameters & Statistics */}
        <div className="w-full xl:w-72 border-t xl:border-t-0 xl:border-l border-border bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
          {/* Section: Sliders */}
          <div className="p-4 border-b border-border space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Sliders className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">PHYSICS CONTROLS</span>
            </div>

            {/* Social Copying J */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">SOCIAL CONTAGION (J)</span>
                <span className={`font-mono font-bold ${coupling >= COOP_CRITICAL ? "text-red-500 animate-pulse" : "text-foreground"}`}>
                  {coupling.toFixed(3)}
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="0.8"
                step="0.01"
                value={coupling}
                onChange={(e) => setCoupling(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[8px] font-terminal text-muted-foreground">
                <span>0.0 (Independent)</span>
                <span className="text-amber-500 font-bold">J_c = {COOP_CRITICAL}</span>
                <span>0.8 (Herding)</span>
              </div>
            </div>

            {/* External Field B */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">NEWS SENTIMENT FLOW (B)</span>
                <span className="text-foreground font-mono font-bold">
                  {externalField > 0 ? "+" : ""}{externalField.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="-0.2"
                max="0.2"
                step="0.01"
                value={externalField}
                onChange={(e) => setExternalField(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[8px] font-terminal text-muted-foreground">
                <span>-0.2 (Bad News)</span>
                <span>Neutral</span>
                <span>+0.2 (Good News)</span>
              </div>
            </div>

            {/* Temperature T */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">RANDOM MARKET NOISE (T)</span>
                <span className="text-foreground font-mono font-bold">{temperature.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[8px] font-terminal text-muted-foreground">
                <span>0.2 (Low Noise)</span>
                <span>2.5 (High Noise)</span>
              </div>
            </div>
          </div>

          {/* Section: Live Stats */}
          <div className="p-4 flex-1 space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Info className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">THERMODYNAMIC STATS</span>
            </div>

            <div className="space-y-2.5">
              <div className="bg-[#080808] border border-border/60 p-3">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">SIMULATED SPOT PRICE</div>
                <div className="font-terminal text-base font-bold text-foreground font-mono">
                  {currentStats.price.toFixed(2)}
                </div>
              </div>

              <div className="bg-[#080808] border border-border/60 p-3">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">MARKET CONSENSUS (M)</div>
                <div className={`font-terminal text-base font-bold font-mono ${
                  currentStats.magnetization > 0.1 ? "text-up" :
                  currentStats.magnetization < -0.1 ? "text-down" : "text-muted-foreground"
                }`}>
                  {(currentStats.magnetization * 100).toFixed(0)}%
                  <span className="text-[9px] text-muted-foreground ml-1.5">
                    {currentStats.magnetization > 0.05 ? "🐂 BUYING" : currentStats.magnetization < -0.05 ? "🐻 SELLING" : "— BALANCED"}
                  </span>
                </div>
              </div>

              <div className="bg-[#080808] border border-border/60 p-3">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">CRITICAL HERD STATE Warning</div>
                <div className={`font-terminal text-[10px] font-bold ${
                  coupling >= COOP_CRITICAL ? "text-red-500 animate-pulse" : "text-muted-foreground"
                }`}>
                  {coupling >= COOP_CRITICAL
                    ? "⚠️ CRITICAL CONTAGION: SPONTANEOUS BUBBLES/CRASHES EXPECTED"
                    : "✓ STABLE STOCHASTIC RANDOM WALK STATE"
                  }
                </div>
              </div>
            </div>

            {/* Explanation box */}
            <ConceptExplainer title="PHYSICS PERSPECTIVE">
              <p>
                When herding strength (\(J\)) is below the critical threshold (\(J_c = 0.44\)), traders act independently, creating a standard random price walk.
              </p>
              <p>
                As \(J \ge J_c\), magnetic alignment occurs, causing traders to copy each other in cascades, triggering massive bubbles and crashes endogenously without any external news change.
              </p>
            </ConceptExplainer>
          </div>
        </div>
      </div>
    </div>
  );
}
