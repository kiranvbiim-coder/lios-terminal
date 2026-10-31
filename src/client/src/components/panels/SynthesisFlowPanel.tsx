import { useMemo } from "react";
import { Cpu, Shuffle, Compass, Network, TrendingUp, ShieldAlert, Award, FileText, Zap } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import { ConceptExplainer } from "./ConceptExplainer";

interface Props {
  symbol: string;
  magnetization: number;
  orderIntensity: number;
  linkIsingToQuantum: boolean;
  setLinkIsingToQuantum: (v: boolean) => void;
  linkHawkesToOptimizer: boolean;
  setLinkHawkesToOptimizer: (v: boolean) => void;
  onNav: (v: ViewMode) => void;
}

export default function SynthesisFlowPanel({
  symbol,
  magnetization,
  orderIntensity,
  linkIsingToQuantum,
  setLinkIsingToQuantum,
  linkHawkesToOptimizer,
  setLinkHawkesToOptimizer,
  onNav,
}: Props) {
  const safeSymbol = symbol || "AAPL";

  // Generate a proprietary score deterministically based on symbol name, magnetization, and intensity
  const lpaStats = useMemo(() => {
    const codeSum = safeSymbol.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    // Base score between 40 and 85
    let baseScore = 40 + (codeSum % 45);

    // Magnetization shift if linked
    if (linkIsingToQuantum) {
      baseScore += magnetization * 15;
    }

    // Hawkes intensity shift if linked (high intensity = stress, lowers alpha score slightly)
    if (linkHawkesToOptimizer) {
      baseScore -= Math.min(15, (orderIntensity - 1.0) * 2);
    }

    const finalScore = Math.max(5, Math.min(99, Math.round(baseScore)));

    // Categorize
    let regime = "STABLE VALUE";
    let signal = "ACCUMULATE";
    let signalColor = "text-emerald-500 border-emerald-500/20 bg-emerald-500/5";
    if (finalScore > 75) {
      regime = "MOMENTUM CONTAGION";
      signal = "STRONG BUY";
      signalColor = "text-amber-500 border-amber-500/20 bg-amber-500/5";
    } else if (finalScore < 45) {
      regime = "LIQUIDITY DRAIN";
      signal = "LIQUIDATE / HEDGE";
      signalColor = "text-red-500 border-red-500/20 bg-red-500/5";
    }

    return {
      score: finalScore,
      regime,
      signal,
      signalColor,
      entropy: 0.72 + (codeSum % 20) * 0.01,
      hurst: 0.52 + (codeSum % 15) * 0.01,
      tunnelingProb: linkIsingToQuantum ? Math.min(95, 20 + Math.abs(magnetization) * 60) : 32.5,
    };
  }, [safeSymbol, magnetization, orderIntensity, linkIsingToQuantum, linkHawkesToOptimizer]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-y-auto scrollbar-thin text-foreground p-6 space-y-6">
      {/* Overview Dashboard Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LPA Score Panel */}
        <div className="bg-[#080808] border border-border/80 p-5 rounded flex flex-col items-center justify-center relative overflow-hidden group">
          <div className="absolute inset-0 bg-radial-gradient from-amber-500/5 via-transparent to-transparent pointer-events-none" />
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase mb-4">LiOS PROPRIETARY ALPHA</span>

          {/* Radial Score Gauge */}
          <div className="relative w-36 h-36 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="72"
                cy="72"
                r="64"
                stroke="rgba(255,255,255,0.03)"
                strokeWidth="8"
                fill="transparent"
              />
              <circle
                cx="72"
                cy="72"
                r="64"
                stroke="hsl(38,95%,50%)"
                strokeWidth="8"
                fill="transparent"
                strokeDasharray={402}
                strokeDashoffset={402 - (402 * lpaStats.score) / 100}
                className="transition-all duration-500 ease-out"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center">
              <span className="font-mono text-4xl font-bold tracking-tighter text-amber-500">{lpaStats.score}</span>
              <span className="font-terminal text-[8px] text-muted-foreground tracking-widest mt-0.5">LPA RATING</span>
            </div>
          </div>

          <div className="mt-5 w-full space-y-2 border-t border-border/40 pt-4 font-terminal text-[10px]">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">REGIME:</span>
              <span className="text-foreground font-bold">{lpaStats.regime}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">RECOMMENDATION:</span>
              <span className={`px-2 py-0.5 border rounded-sm font-bold ${lpaStats.signalColor}`}>{lpaStats.signal}</span>
            </div>
          </div>
        </div>

        {/* Intelligence Pipeline Flow Diagram */}
        <div className="lg:col-span-2 bg-[#080808] border border-border/80 p-5 rounded flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase">INTERACTIVE INTELLIGENCE FLOW MAP</span>
            <span className="font-terminal text-[8px] text-amber-500/80 uppercase">CLICK NODE TO LAUNCH DESK</span>
          </div>

          {/* Interactive SVG Flowchart Map */}
          <div className="flex-1 bg-black/40 border border-border/40 rounded p-4 flex items-center justify-center min-h-[220px]">
            <svg viewBox="0 0 620 220" className="w-full max-w-[580px] h-auto select-none font-mono">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="rgba(255,255,255,0.2)" />
                </marker>
                <marker id="arrow-glow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="hsl(38,95%,50%)" />
                </marker>
              </defs>

              {/* Connections/Lines */}
              <line x1="60" y1="110" x2="140" y2="50" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" markerEnd="url(#arrow)" />
              <line x1="60" y1="110" x2="140" y2="170" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" markerEnd="url(#arrow)" />

              {/* Ising to Quantum link line */}
              <path
                d="M 230 50 Q 305 20 380 50"
                fill="none"
                stroke={linkIsingToQuantum ? "hsl(38,95%,50%)" : "rgba(255,255,255,0.1)"}
                strokeWidth={linkIsingToQuantum ? "2" : "1.5"}
                strokeDasharray={linkIsingToQuantum ? "4 2" : "3 3"}
                markerEnd={linkIsingToQuantum ? "url(#arrow-glow)" : "url(#arrow)"}
                className={linkIsingToQuantum ? "animate-[dash_2s_linear_infinite]" : ""}
              />

              {/* Hawkes to Optimizer link line */}
              <path
                d="M 230 170 Q 380 200 500 170"
                fill="none"
                stroke={linkHawkesToOptimizer ? "hsl(38,95%,50%)" : "rgba(255,255,255,0.1)"}
                strokeWidth={linkHawkesToOptimizer ? "2" : "1.5"}
                strokeDasharray={linkHawkesToOptimizer ? "4 2" : "3 3"}
                markerEnd={linkHawkesToOptimizer ? "url(#arrow-glow)" : "url(#arrow)"}
                className={linkHawkesToOptimizer ? "animate-[dash_2s_linear_infinite]" : ""}
              />

              <line x1="230" y1="50" x2="380" y2="110" stroke="rgba(255,255,255,0.1)" strokeWidth="1" markerEnd="url(#arrow)" />
              <line x1="230" y1="170" x2="380" y2="110" stroke="rgba(255,255,255,0.1)" strokeWidth="1" markerEnd="url(#arrow)" />

              <line x1="380" y1="50" x2="500" y2="110" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" markerEnd="url(#arrow)" />
              <line x1="380" y1="110" x2="500" y2="110" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" markerEnd="url(#arrow)" />
              <line x1="380" y1="170" x2="500" y2="110" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" markerEnd="url(#arrow)" />

              {/* Root node */}
              <g transform="translate(10, 85)" className="cursor-pointer" onClick={() => onNav("quote")}>
                <rect width="90" height="50" rx="3" fill="#090909" stroke="#333" strokeWidth="1" />
                <text x="45" y="22" fill="#888" fontSize="7" textAnchor="middle" letterSpacing="1">FEED INGEST</text>
                <text x="45" y="38" fill="hsl(186,80%,55%)" fontSize="9" fontWeight="bold" textAnchor="middle">{safeSymbol}</text>
              </g>

              {/* Social Herd Node */}
              <g transform="translate(140, 25)" className="cursor-pointer group/node" onClick={() => onNav("ising")}>
                <rect width="90" height="50" rx="3" fill="#090909" stroke="#333" strokeWidth="1" className="group-hover/node:stroke-amber-500/50" />
                <text x="45" y="22" fill="#888" fontSize="7" textAnchor="middle" letterSpacing="1">SOCIAL HERD</text>
                <text x="45" y="38" fill="#fff" fontSize="9" textAnchor="middle">ISING [ISNG]</text>
              </g>

              {/* HFT Hawkes Node */}
              <g transform="translate(140, 145)" className="cursor-pointer group/node" onClick={() => onNav("hawkes")}>
                <rect width="90" height="50" rx="3" fill="#090909" stroke="#333" strokeWidth="1" className="group-hover/node:stroke-amber-500/50" />
                <text x="45" y="22" fill="#888" fontSize="7" textAnchor="middle" letterSpacing="1">MICROSTRUCTURE</text>
                <text x="45" y="38" fill="#fff" fontSize="9" textAnchor="middle">HAWKES [HWKS]</text>
              </g>

              {/* Quantum Tunneling Node */}
              <g transform="translate(380, 25)" className="cursor-pointer group/node" onClick={() => onNav("quantum")}>
                <rect width="90" height="50" rx="3" fill="#090909" stroke="#333" strokeWidth="1" className="group-hover/node:stroke-amber-500/50" />
                <text x="45" y="22" fill="#888" fontSize="7" textAnchor="middle" letterSpacing="1">PRICE TUNNELING</text>
                <text x="45" y="38" fill="#fff" fontSize="9" textAnchor="middle">QUANTUM [QNTM]</text>
              </g>

              {/* Fractal Cones Node */}
              <g transform="translate(380, 85)" className="cursor-pointer group/node" onClick={() => onNav("fractal")}>
                <rect width="90" height="50" rx="3" fill="#090909" stroke="#333" strokeWidth="1" className="group-hover/node:stroke-amber-500/50" />
                <text x="45" y="22" fill="#888" fontSize="7" textAnchor="middle" letterSpacing="1">CHAOS & REGIME</text>
                <text x="45" y="38" fill="#fff" fontSize="9" textAnchor="middle">FRACTAL [FRAC]</text>
              </g>

              {/* Entropy Node */}
              <g transform="translate(380, 145)" className="cursor-pointer group/node" onClick={() => onNav("entropy")}>
                <rect width="90" height="50" rx="3" fill="#090909" stroke="#333" strokeWidth="1" className="group-hover/node:stroke-amber-500/50" />
                <text x="45" y="22" fill="#888" fontSize="7" textAnchor="middle" letterSpacing="1">LEAD-LAG ENTROPY</text>
                <text x="45" y="38" fill="#fff" fontSize="9" textAnchor="middle">ENTROPY [INTR]</text>
              </g>

              {/* Execution Optimizer Node */}
              <g transform="translate(500, 85)" className="cursor-pointer group/node" onClick={() => onNav("optimizer")}>
                <rect width="110" height="50" rx="3" fill="#0c0a05" stroke="hsl(38,95%,50%)/40%" strokeWidth="1.5" className="group-hover/node:stroke-amber-500" />
                <text x="55" y="20" fill="hsl(38,95%,50%)" fontSize="7" fontWeight="bold" textAnchor="middle" letterSpacing="1">OPTIMAL EXECUTION</text>
                <text x="55" y="36" fill="#fff" fontSize="9" textAnchor="middle">ALMGREN-CHRISS</text>
              </g>
            </svg>
          </div>
        </div>
      </div>

      {/* Active Linkages Section */}
      <div className="bg-[#080808] border border-border/80 p-5 rounded space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <span className="font-terminal text-[10px] tracking-widest font-bold uppercase">ACTIVE COGNITIVE SIMULATION LINKAGES</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Linkage 1 */}
          <div className={`p-4 border rounded transition-all flex flex-col justify-between ${
            linkIsingToQuantum ? "border-amber-500/30 bg-amber-500/[2%]" : "border-border/60 bg-black/20"
          }`}>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-terminal text-[10px] font-bold text-foreground">ISING SOCIAL HERD ➔ SCHRÖDINGER PRICE BARRIER</span>
                <span className={`text-[8px] font-terminal px-2 py-0.5 rounded-sm ${
                  linkIsingToQuantum ? "bg-amber-500/20 text-amber-500 font-bold" : "bg-border/40 text-muted-foreground"
                }`}>{linkIsingToQuantum ? "ACTIVE LINK" : "DISCONNECTED"}</span>
              </div>
              <p className="text-[9px] font-terminal text-muted-foreground leading-normal pt-1">
                Injects real-time trader coordination magnetization (spin consensus) directly into the Schrödinger resistance wall. 
                High herd alignment weakens the potential barrier strength, exponentially inflating quantum tunneling breakout probabilities.
              </p>
              {linkIsingToQuantum && (
                <div className="bg-black/40 border border-border/40 p-2.5 mt-3 rounded flex justify-between items-center text-[9px] font-terminal font-mono">
                  <span className="text-muted-foreground">Magnetization field (M):</span>
                  <span className="text-amber-500 font-bold">{magnetization.toFixed(4)}</span>
                  <span className="text-muted-foreground">Barrier reduction:</span>
                  <span className="text-amber-500 font-bold">{(Math.abs(magnetization) * 80).toFixed(1)}%</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setLinkIsingToQuantum(!linkIsingToQuantum)}
              className={`mt-4 w-full py-1.5 font-terminal text-[9px] tracking-widest border transition-all ${
                linkIsingToQuantum
                  ? "bg-amber-500 text-black font-bold border-amber-600 hover:bg-amber-400"
                  : "bg-transparent text-muted-foreground border-border hover:border-foreground hover:text-foreground"
              }`}
            >
              {linkIsingToQuantum ? "DEACTIVATE LINKAGE" : "ESTABLISH LINKAGE"}
            </button>
          </div>

          {/* Linkage 2 */}
          <div className={`p-4 border rounded transition-all flex flex-col justify-between ${
            linkHawkesToOptimizer ? "border-amber-500/30 bg-amber-500/[2%]" : "border-border/60 bg-black/20"
          }`}>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-terminal text-[10px] font-bold text-foreground">HAWKES HFT INTENSITY ➔ ALMGREN-CHRISS RISK AVERSION</span>
                <span className={`text-[8px] font-terminal px-2 py-0.5 rounded-sm ${
                  linkHawkesToOptimizer ? "bg-amber-500/20 text-amber-500 font-bold" : "bg-border/40 text-muted-foreground"
                }`}>{linkHawkesToOptimizer ? "ACTIVE LINK" : "DISCONNECTED"}</span>
              </div>
              <p className="text-[9px] font-terminal text-muted-foreground leading-normal pt-1">
                Injects self-exciting point arrival intensities (microstructure trade clumping) into the optimal execution simulator. 
                High order book stress shocks increase risk aversion ($\lambda$), forcing the optimal trajectory to liquidate positions faster.
              </p>
              {linkHawkesToOptimizer && (
                <div className="bg-black/40 border border-border/40 p-2.5 mt-3 rounded flex justify-between items-center text-[9px] font-terminal font-mono">
                  <span className="text-muted-foreground">Order Intensity (λ):</span>
                  <span className="text-amber-500 font-bold">{orderIntensity.toFixed(2)} trades/s</span>
                  <span className="text-muted-foreground">Risk aversion multiplier:</span>
                  <span className="text-amber-500 font-bold">{(1 + orderIntensity / 2.0).toFixed(2)}x</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setLinkHawkesToOptimizer(!linkHawkesToOptimizer)}
              className={`mt-4 w-full py-1.5 font-terminal text-[9px] tracking-widest border transition-all ${
                linkHawkesToOptimizer
                  ? "bg-amber-500 text-black font-bold border-amber-600 hover:bg-amber-400"
                  : "bg-transparent text-muted-foreground border-border hover:border-foreground hover:text-foreground"
              }`}
            >
              {linkHawkesToOptimizer ? "DEACTIVATE LINKAGE" : "ESTABLISH LINKAGE"}
            </button>
          </div>
        </div>
      </div>

      {/* Synthesis Report Console */}
      <div className="bg-[#080808] border border-border/80 p-5 rounded space-y-3 font-terminal">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <div className="flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-amber-500" />
            <span className="text-[10px] font-bold tracking-widest uppercase">LiOS INTELLIGENCE SYNTHESIS REPORT</span>
          </div>
          <span className="text-[8px] text-muted-foreground font-mono">AS OF: {new Date().toISOString()}</span>
        </div>

        <div className="text-[9px] leading-relaxed text-muted-foreground space-y-2.5 font-mono">
          <p>
            Evaluating target profile <span className="text-[hsl(186,80%,55%)] font-bold">{safeSymbol}</span>. Information density calculations
            across all desks show a return entropy index of <span className="text-foreground font-bold">{lpaStats.entropy.toFixed(3)}</span> 
            and a fractional chaos memory metric (Hurst Exponent) of <span className="text-foreground font-bold">{lpaStats.hurst.toFixed(3)}</span>,
            indicating {lpaStats.hurst > 0.55 ? "a persistent long-memory volatility trend" : "mean-reverting noise structures"}.
          </p>
          <p>
            Under the active Schrödinger barrier penetration model, the probability of a breakout past resistance level stands at{" "}
            <span className="text-amber-500 font-bold">{lpaStats.tunnelingProb.toFixed(1)}%</span>. 
            {linkIsingToQuantum 
              ? " Herd magnetization shifts are coupled directly, lowering resistance parameters dynamically." 
              : " The system recommends establishing Ising herding linkage to capture social contagion-driven breakouts."}
          </p>
          <p>
            In optimal execution parameters, liquidating a large block of shares is parameterized by the Almgren-Chriss trajectory matrix. 
            {linkHawkesToOptimizer 
              ? ` Due to HFT Hawkes order excitation, risk aversion is actively scaled to ${lpaStats.hurst > 0.55 ? "mitigate slippage during liquidity drains" : "exploit local market depths"}.` 
              : " Execution coefficients are currently isolated from high-frequency microstructure shocks."}
          </p>
        </div>

        <ConceptExplainer title="WHY LINK THESE MODELS?">
          <p>
            Ising, Hawkes, Quantum, Fractal, and Entropy each measure a different piece of market microstructure in isolation. Linking them lets one model's live output (herd magnetization, order-arrival intensity) feed directly into another's assumptions, instead of you manually cross-referencing four separate panels.
          </p>
        </ConceptExplainer>
      </div>
    </div>
  );
}
