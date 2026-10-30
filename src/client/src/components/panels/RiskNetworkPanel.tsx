import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Network, Activity, Zap } from "lucide-react";
import type { OHLCVSeries } from "@/lib/finance";
import { buildCorrelationMatrix, dailyReturnsFromBars } from "@/lib/correlationMatrix";

// Watchlist universe for the spillover map. Correlations and volatilities below are
// measured from each symbol's own daily price history, never assumed.
const NODES = [
  { id: "AAPL", name: "Apple Tech", x: 150, y: 50, color: "rgb(59, 130, 246)" },
  { id: "MSFT", name: "Microsoft Cloud", x: 250, y: 120, color: "rgb(99, 102, 241)" },
  { id: "RELIANCE.NS", name: "Reliance Energy", x: 210, y: 220, color: "rgb(34, 197, 94)" },
  { id: "INFY.NS", name: "Infosys IT", x: 90, y: 220, color: "rgb(16, 185, 129)" },
  { id: "BTC-USD", name: "Bitcoin Crypto", x: 50, y: 120, color: "rgb(245, 158, 11)" },
];
const TRADING_DAYS = 252;

export default function RiskNetworkPanel({ onSymbol }: { onSymbol: (sym: string) => void }) {
  const [shockedNode, setShockedNode] = useTerminalArtifactState<string | null>("RiskNetworkPanel.shockedNode", "BTC-USD");
  const [shockSize, setShockSize] = useTerminalArtifactState("RiskNetworkPanel.shockSize", 50);

  const results = useQueries({
    queries: NODES.map((node) => ({
      queryKey: ["/api/finance/ohlcv", node.id, "1Y", "1d"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol: node.id, range: "1Y", interval: "1d" });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed to fetch ${node.id}`);
        return res.json() as Promise<OHLCVSeries>;
      },
      staleTime: 60000,
    })),
  });
  const loading = results.some((result) => result.isLoading);
  const failed = results.filter((result) => result.isError).length;

  const measured = useMemo(() => {
    const returns = results.map((result) => dailyReturnsFromBars(result.data?.bars ?? [], 252));
    const { matrix, minPairObservations } = buildCorrelationMatrix(returns);
    const annualVol = returns.map((series) => {
      if (series.length < 20) return null;
      const mean = series.reduce((sum, point) => sum + point.value, 0) / series.length;
      const variance = series.reduce((sum, point) => sum + (point.value - mean) ** 2, 0) / (series.length - 1);
      return Math.sqrt(variance * TRADING_DAYS) * 100;
    });
    return { matrix, annualVol, minPairObservations };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, results.map((result) => result.dataUpdatedAt));

  const corr = (a: number, b: number) => measured.matrix[a][b].value;

  // Shocked volatility = measured annualised vol + shock * measured correlation (floored at 0).
  const propagated = useMemo(() => {
    const shockedIndex = NODES.findIndex((node) => node.id === shockedNode);
    return NODES.map((_, index) => {
      const base = measured.annualVol[index];
      if (base === null) return null;
      if (shockedIndex < 0) return base;
      if (index === shockedIndex) return base + shockSize;
      const rho = corr(shockedIndex, index);
      return rho === null ? base : base + shockSize * Math.max(0, rho);
    });
  }, [measured, shockedNode, shockSize]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">VOLATILITY SPILLOVER NETWORK</span>
        </div>
        <span className="font-terminal text-[8px] text-muted-foreground">
          {loading ? "Loading price history…" : `Measured from daily returns · min ${measured.minPairObservations} paired observations`}
        </span>
      </div>
      {failed > 0 && <p role="alert" className="px-4 py-2 text-sm text-amber-200">{failed} price histor{failed === 1 ? "y" : "ies"} could not be loaded. Affected nodes show no volatility and spread no shock.</p>}

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        <div className="flex-1 p-4 flex flex-col items-center justify-center overflow-y-auto scrollbar-thin border-b xl:border-b-0 xl:border-r border-border">
          {(
            <div className="relative w-[320px] h-[280px]">
              <span className="absolute -top-2 left-0 font-terminal text-[9px] tracking-widest text-muted-foreground block uppercase">
                REALISED-VOLATILITY SPILLOVER MAP (CLICK NODE TO SHOCK)
              </span>
              <svg width="100%" height="100%" className="overflow-visible">
                {/* Connection links */}
                {NODES.map((n1, idx1) =>
                  NODES.map((n2, idx2) => {
                    if (idx1 >= idx2) return null;
                    const cov = Math.max(0, corr(idx1, idx2) ?? 0);
                    const isShockedPath = n1.id === shockedNode || n2.id === shockedNode;

                    return (
                      <line
                        key={`${n1.id}-${n2.id}`}
                        x1={n1.x}
                        y1={n1.y}
                        x2={n2.x}
                        y2={n2.y}
                        stroke={isShockedPath ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.08)"}
                        strokeWidth={cov * 5}
                        strokeDasharray={isShockedPath ? "3 3" : undefined}
                      />
                    );
                  })
                )}

                {/* Nodes */}
                {NODES.map((node) => {
                  const nodeIndex = NODES.indexOf(node);
                  const vol = propagated[nodeIndex];
                  const isShocked = node.id === shockedNode;

                  return (
                    <g
                      key={node.id}
                      onClick={() => {
                        setShockedNode(node.id);
                        onSymbol(node.id);
                      }}
                      className="cursor-pointer group"
                    >
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={12 + (vol ?? 0) * 0.2}
                        fill={isShocked ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.05)"}
                        stroke={isShocked ? "rgb(239, 68, 68)" : node.color}
                        strokeWidth={isShocked ? 2.5 : 1.5}
                        className="transition-all duration-300 group-hover:scale-110"
                      />
                      <text
                        x={node.x}
                        y={node.y - 18 - (vol ?? 0) * 0.1}
                        fill="#fff"
                        fontSize={8}
                        fontFamily="'JetBrains Mono', monospace"
                        textAnchor="middle"
                        fontWeight="bold"
                      >
                        {node.id.replace(".NS", "")}
                      </text>
                      <text
                        x={node.x}
                        y={node.y + 3}
                        fill={isShocked ? "rgb(239, 68, 68)" : "#aaa"}
                        fontSize={7.5}
                        fontFamily="'JetBrains Mono', monospace"
                        textAnchor="middle"
                        fontWeight="bold"
                      >
                        {vol === null ? "n/a" : `${vol.toFixed(0)}%`}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>

        <div className="w-full xl:w-72 border-t xl:border-t-0 xl:border-l border-border bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
          <div className="p-4 flex-1 space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">NETWORK ANALYTICS</span>
            </div>
            <div className="space-y-4">
              <div className="bg-[#080808] border border-border/60 p-3 space-y-1.5">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-widest uppercase">ACTIVE VOLATILITY SHOCK</div>
                <div className="font-terminal text-sm font-bold text-red-500 flex items-center gap-1">
                  <Zap className="w-4 h-4" /> {shockedNode?.replace(".NS", "") ?? "None selected"}
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="risk-network-shock" className="flex items-center justify-between font-terminal text-[9px]">
                  <span className="text-muted-foreground">SHOCK MAGNITUDE</span>
                  <span className="text-foreground font-mono font-bold">+{shockSize} vol points</span>
                </label>
                <input id="risk-network-shock" type="range" min="10" max="100" step="5" value={shockSize} onChange={(e) => setShockSize(parseInt(e.target.value))} className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500" />
              </div>
              <div className="border border-border bg-[#080808] p-3 text-[8.5px] font-terminal text-muted-foreground leading-normal space-y-1">
                <span className="font-bold text-foreground block">How spillover is computed:</span>
                <p>
                  Node values are annualised realised volatility from one year of daily returns. A shock adds the chosen points to the selected asset and, to every other asset, the same points times its measured return correlation (negative correlations spread nothing). This is a scenario on measured relationships, not a forecast.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
