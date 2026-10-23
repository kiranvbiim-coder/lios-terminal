import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useEffect, useRef, useState, useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Play, Pause, RefreshCw, Sliders, Info } from "lucide-react";
import { formatPrice } from "@/lib/finance";
import { ConceptExplainer } from "./ConceptExplainer";

const N = 80; // Grid cells representing price levels
const PRICE_MIN = 60;
const PRICE_MAX = 140;

export default function QuantumFinancePanel({ symbol, externalBarrierMod }: { symbol: string; externalBarrierMod?: number }) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [barrierPos, setBarrierPos] = useTerminalArtifactState("QuantumFinancePanel.barrierPos", 115.0);
  const [barrierHeight, setBarrierHeight] = useTerminalArtifactState("QuantumFinancePanel.barrierHeight", 12.0);
  const [barrierWidth, setBarrierWidth] = useTerminalArtifactState("QuantumFinancePanel.barrierWidth", 3.0); // Width of wall
  const [momentum, setMomentum] = useTerminalArtifactState("QuantumFinancePanel.momentum", 1.5);
  const [uncertainty, setUncertainty] = useTerminalArtifactState("QuantumFinancePanel.uncertainty", 4.0);

  const activeBarrierHeight = externalBarrierMod !== undefined
    ? Math.max(0.5, barrierHeight * (1 - Math.abs(externalBarrierMod) * 0.8))
    : barrierHeight;

  // Simulation numerical states
  const waveReal = useRef(new Float64Array(N));
  const waveImag = useRef(new Float64Array(N));
  const [waveData, setWaveData] = useState<Array<{ price: number; probability: number; barrier: number }>>([]);
  const [stats, setStats] = useState({ step: 0, breakoutPct: 0, reboundPct: 0 });

  // Initialize Wave Packet as a Gaussian
  const resetWave = () => {
    const x0 = 85.0; // Initial price center
    const p0 = momentum; // Initial momentum
    const sigma = uncertainty;

    const dx = (PRICE_MAX - PRICE_MIN) / N;

    let normSum = 0;
    for (let i = 0; i < N; i++) {
      const price = PRICE_MIN + i * dx;
      
      // Gaussian envelope: exp(-(x-x0)^2 / (2 * sigma^2))
      const env = Math.exp(-Math.pow(price - x0, 2) / (2 * Math.pow(sigma, 2)));
      // Phase term: exp(i * p0 * x) => cos(p0 * x) + i * sin(p0 * x)
      const phaseReal = Math.cos(p0 * price * 0.4);
      const phaseImag = Math.sin(p0 * price * 0.4);

      waveReal.current[i] = env * phaseReal;
      waveImag.current[i] = env * phaseImag;

      normSum += Math.pow(waveReal.current[i], 2) + Math.pow(waveImag.current[i], 2);
    }

    // Normalize
    const norm = Math.sqrt(normSum);
    for (let i = 0; i < N; i++) {
      waveReal.current[i] /= norm;
      waveImag.current[i] /= norm;
    }

    setStats({ step: 0, breakoutPct: 0, reboundPct: 100 });
    updateChartData(0);
  };

  const updateChartData = (step: number) => {
    const real = waveReal.current;
    const imag = waveImag.current;
    const dx = (PRICE_MAX - PRICE_MIN) / N;
    
    let totalProb = 0;
    let breakoutProb = 0;

    const chartPoints = [];
    for (let i = 0; i < N; i++) {
      const price = PRICE_MIN + i * dx;
      const prob = Math.pow(real[i], 2) + Math.pow(imag[i], 2);
      
      // Define potential barrier V(x)
      const isInsideBarrier = Math.abs(price - barrierPos) <= barrierWidth / 2;

      chartPoints.push({
        price: parseFloat(price.toFixed(1)),
        probability: prob * 100, // percentage
        barrier: isInsideBarrier ? activeBarrierHeight * 5 : 0, // scale for chart overlay
      });

      totalProb += prob;
      if (price > barrierPos) {
        breakoutProb += prob;
      }
    }

    const bPct = totalProb > 0 ? (breakoutProb / totalProb) * 100 : 0;

    setWaveData(chartPoints);
    setStats((prev) => ({
      step,
      breakoutPct: bPct,
      reboundPct: Math.max(0, 100 - bPct),
    }));
  };

  // Run initial reset on mount or parameter shifts
  useEffect(() => {
    resetWave();
  }, [momentum, uncertainty]);

  // Schrodinger simulation step
  useEffect(() => {
    let animationFrameId: number;
    let stepCount = 0;

    const stepSimulation = () => {
      if (!isPlaying) {
        animationFrameId = requestAnimationFrame(stepSimulation);
        return;
      }

      const real = waveReal.current;
      const imag = waveImag.current;
      const nextReal = new Float64Array(N);
      const nextImag = new Float64Array(N);

      // Numerical constants for finite difference solver
      const hbar = 1.0;
      const mass = 1.0;
      const dx = (PRICE_MAX - PRICE_MIN) / N;
      const dt = 0.08; // timestep
      
      // Kinetic coefficient: hbar / (2 * mass * dx^2)
      const kCoeff = hbar / (2 * mass * Math.pow(dx, 2));

      // Compute Potential energy barrier profile V
      const V = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const price = PRICE_MIN + i * dx;
        const isInsideBarrier = Math.abs(price - barrierPos) <= barrierWidth / 2;
        V[i] = isInsideBarrier ? activeBarrierHeight : 0.0;
      }

      // Finite difference second derivative updates
      // Boundary conditions: Psi(0) = Psi(N) = 0
      for (let i = 1; i < N - 1; i++) {
        // -hbar^2 / (2m) * d^2Psi/dx^2 + V * Psi
        // d^2Psi/dx^2 = (Psi[i+1] - 2*Psi[i] + Psi[i-1]) / dx^2
        const kinReal = -kCoeff * (real[i + 1] - 2 * real[i] + real[i - 1]);
        const kinImag = -kCoeff * (imag[i + 1] - 2 * imag[i] + imag[i - 1]);

        const hamReal = kinReal + V[i] * real[i];
        const hamImag = kinImag + V[i] * imag[i];

        // i * hbar * dPsi/dt = H * Psi
        // => dReal/dt = H_imag / hbar
        // => dImag/dt = -H_real / hbar
        nextReal[i] = real[i] + (hamImag / hbar) * dt;
        nextImag[i] = imag[i] - (hamReal / hbar) * dt;
      }

      // Check normalization to prevent floating-point blowout
      let normSum = 0;
      for (let i = 0; i < N; i++) {
        normSum += Math.pow(nextReal[i], 2) + Math.pow(nextImag[i], 2);
      }

      if (normSum > 0) {
        const norm = Math.sqrt(normSum);
        for (let i = 0; i < N; i++) {
          waveReal.current[i] = nextReal[i] / norm;
          waveImag.current[i] = nextImag[i] / norm;
        }
      }

      stepCount++;
      // Redraw chart every 2 steps for smoothness
      if (stepCount % 2 === 0) {
        updateChartData(stepCount);
      }

      animationFrameId = requestAnimationFrame(stepSimulation);
    };

    animationFrameId = requestAnimationFrame(stepSimulation);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, barrierPos, activeBarrierHeight, barrierWidth]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      {/* Parameters Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">SCHRÖDINGER PRICE WAVE PACKET DESK</span>
          <span className="font-terminal text-[10px] text-foreground font-bold">{symbol}</span>
          {externalBarrierMod !== undefined && (
            <div className="bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded text-[8px] font-terminal text-[hsl(38,95%,55%)] flex items-center gap-1.5 animate-pulse select-none">
              <span>⚡ LINKED TO ISING MAGNETIZATION</span>
              <span className="font-mono font-bold">({(externalBarrierMod * 100).toFixed(0)}% field)</span>
            </div>
          )}
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
            onClick={resetWave}
            className="flex items-center gap-1.5 px-3 py-1 bg-border/20 border border-border text-foreground hover:bg-border/30 transition-colors font-terminal text-[9px] tracking-widest"
          >
            <RefreshCw className="w-3.5 h-3.5" /> RESET
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        {/* Left Column: Wave Chart visualizer */}
        <div className="flex-1 p-4 flex flex-col overflow-hidden border-b xl:border-b-0 xl:border-r border-border">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase">WAVEFUNCTION PROBABILITY DENSITY OVERLAY</span>
            <span className="font-terminal text-[9px] text-muted-foreground">
              Step: {stats.step} · Target Breakout: {stats.breakoutPct.toFixed(1)}%
            </span>
          </div>

          <div className="flex-1 min-h-[240px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={waveData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid stroke="#111" />
                <XAxis dataKey="price" stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
                <YAxis stroke="#555" domain={[0, "auto"]} tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
                <Tooltip
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0].payload;
                    return (
                      <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5 font-mono">
                        <div>Price Level: {pt.price}</div>
                        <div className="text-amber-500 font-bold">Probability: {pt.probability.toFixed(2)}%</div>
                        {pt.barrier > 0 && <div className="text-red-500">Resistance Wall: {barrierHeight}x</div>}
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="probability" fill="rgba(245,158,11,0.25)" stroke="hsl(38,95%,55%)" strokeWidth={2} name="Psi^2 Probability" />
                <Area type="step" dataKey="barrier" fill="rgba(239,68,68,0.1)" stroke="rgba(239,68,68,0.3)" strokeWidth={1} name="Resistance" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Parameters and Quantum stats */}
        <div className="w-full xl:w-72 bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
          {/* Section: Wave Sliders */}
          <div className="p-4 border-b border-border space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Sliders className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">WAVE PACKET SHAPE</span>
            </div>

            {/* Momentum (Velocity) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">DRIFT VELOCITY (MOMENTUM)</span>
                <span className="text-foreground font-mono font-bold">{momentum.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="4.0"
                step="0.1"
                value={momentum}
                onChange={(e) => setMomentum(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* Uncertainty (Vol) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">PRICE VOLATILITY (UNCERTAINTY)</span>
                <span className="text-foreground font-mono font-bold">{uncertainty.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="2.0"
                max="8.0"
                step="0.1"
                value={uncertainty}
                onChange={(e) => setUncertainty(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>
          </div>

          {/* Section: Barrier Sliders */}
          <div className="p-4 border-b border-border space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Sliders className="w-3.5 h-3.5 text-red-500" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">RESISTANCE POTENTIAL WALL</span>
            </div>

            {/* Position */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">RESISTANCE LEVEL (PRICE)</span>
                <span className="text-foreground font-mono font-bold">{barrierPos.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="95"
                max="135"
                step="0.5"
                value={barrierPos}
                onChange={(e) => setBarrierPos(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* Height */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">BARRIER STRENGTH (HEIGHT)</span>
                <span className="text-foreground font-mono font-bold">{barrierHeight.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0"
                max="35"
                step="0.5"
                value={barrierHeight}
                onChange={(e) => setBarrierHeight(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>
          </div>

          {/* Section: Wave Statistics */}
          <div className="p-4 flex-1 space-y-3 bg-[#080808]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Info className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">QUANTUM BREAKOUT METRICS</span>
            </div>

            <div className="space-y-2">
              <div className="bg-[#050505] border border-border/80 p-2.5 flex justify-between items-center font-terminal text-[10px]">
                <span className="text-muted-foreground">BREAKOUT PROBABILITY (TUNNELING)</span>
                <span className="text-emerald-500 font-bold font-mono text-xs">{stats.breakoutPct.toFixed(1)}%</span>
              </div>

              <div className="bg-[#050505] border border-border/80 p-2.5 flex justify-between items-center font-terminal text-[10px]">
                <span className="text-muted-foreground">REBOUND/PULLBACK PROBABILITY</span>
                <span className="text-foreground font-bold font-mono text-xs">{stats.reboundPct.toFixed(1)}%</span>
              </div>

              <ConceptExplainer title="WHAT IS TUNNELING?">
                <p>
                  Classical particles bounce back completely if energy is below the potential wall. In quantum finance, the wavefunction probability leaking through the barrier represents the probability of a sudden price break of support/resistance.
                </p>
              </ConceptExplainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
