import { useState, useMemo } from "react";
import { Network, Activity, ShieldAlert, Sliders, Info, Zap } from "lucide-react";
import { getCurrencySymbol, formatPrice } from "@/lib/finance";

const NODES = [
  { id: "AAPL", name: "Apple Tech", x: 150, y: 50, color: "rgb(59, 130, 246)", sector: "US Tech" },
  { id: "MSFT", name: "Microsoft Cloud", x: 250, y: 120, color: "rgb(99, 102, 241)", sector: "US Tech" },
  { id: "RELIANCE.NS", name: "Reliance Energy", x: 210, y: 220, color: "rgb(34, 197, 94)", sector: "IN Energy" },
  { id: "INFY.NS", name: "Infosys IT", x: 90, y: 220, color: "rgb(16, 185, 129)", sector: "IN IT" },
  { id: "BTC-USD", name: "Bitcoin Crypto", x: 50, y: 120, color: "rgb(245, 158, 11)", sector: "Crypto" },
];

// Covariance weights (spillover factors) proxy table
const COV_MATRIX_PROXY: Record<string, Record<string, number>> = {
  AAPL: { AAPL: 1.0, MSFT: 0.72, "RELIANCE.NS": 0.28, "INFY.NS": 0.35, "BTC-USD": 0.45 },
  MSFT: { AAPL: 0.72, MSFT: 1.0, "RELIANCE.NS": 0.22, "INFY.NS": 0.38, "BTC-USD": 0.42 },
  "RELIANCE.NS": { AAPL: 0.28, MSFT: 0.22, "RELIANCE.NS": 1.0, "INFY.NS": 0.45, "BTC-USD": 0.18 },
  "INFY.NS": { AAPL: 0.35, MSFT: 0.38, "RELIANCE.NS": 0.45, "INFY.NS": 1.0, "BTC-USD": 0.25 },
  "BTC-USD": { AAPL: 0.45, MSFT: 0.42, "RELIANCE.NS": 0.18, "INFY.NS": 0.25, "BTC-USD": 1.0 },
};

// Supply chain nodes
const SUPPLY_NODES = [
  { id: "ASML", name: "ASML Lithography", role: "Supplier", x: 50, y: 40, capVal: 100 },
  { id: "TSMC", name: "TSMC Foundry", role: "Supplier", x: 50, y: 140, capVal: 100 },
  { id: "NVDA", name: "NVIDIA GPUs", role: "Manufacturer", x: 190, y: 40, capVal: 100 },
  { id: "AAPL", name: "Apple Hardware", role: "Manufacturer", x: 190, y: 140, capVal: 100 },
  { id: "MSFT", name: "Microsoft Cloud", role: "Consumer", x: 330, y: 40, capVal: 100 },
  { id: "RETAIL", name: "Global Retailers", role: "Consumer", x: 330, y: 140, capVal: 100 },
];

export default function RiskNetworkPanel({ onSymbol }: { onSymbol: (sym: string) => void }) {
  // Tab toggle: "volatility", "supplychain", "orderbook"
  const [activeTab, setActiveTab] = useState<"volatility" | "supplychain" | "orderbook">("volatility");

  // Volatility shock state
  const [shockedNode, setShockedNode] = useState<string | null>("BTC-USD");
  const [shockSize, setShockSize] = useState(50); // % volatility increase

  // Supply chain disruption state
  const [disruptedNode, setDisruptedNode] = useState<string>("TSMC");
  const [disruptionLevel, setDisruptionLevel] = useState(40); // % output cut

  // Live order book depth simulator data
  const spotPrice = 240.0;
  const simulatedBook = useMemo(() => {
    // Generate bid & ask stacks around spot price
    const bookSize = 7;
    const priceStep = 0.5;
    const bids = [];
    const asks = [];

    // Bids (buying below spot)
    for (let i = 1; i <= bookSize; i++) {
      const p = spotPrice - i * priceStep;
      // High volume "walls" at round boundaries (e.g. 237, 238)
      const isWall = p % 2 === 0 || p % 5 === 0;
      const size = Math.round((isWall ? 4500 + Math.random() * 2000 : 800 + Math.random() * 1000));
      bids.push({ price: p, size });
    }

    // Asks (selling above spot)
    for (let i = 1; i <= bookSize; i++) {
      const p = spotPrice + i * priceStep;
      const isWall = p % 2 === 0 || p % 5 === 0;
      const size = Math.round((isWall ? 4800 + Math.random() * 1800 : 900 + Math.random() * 1100));
      asks.push({ price: p, size });
    }

    const totalBidSize = bids.reduce((s, v) => s + v.size, 0);
    const totalAskSize = asks.reduce((s, v) => s + v.size, 0);
    // Imbalance calculation: (bid - ask) / (bid + ask) * 100
    const imbalance = ((totalBidSize - totalAskSize) / (totalBidSize + totalAskSize)) * 100;

    return { bids, asks, totalBidSize, totalAskSize, imbalance };
  }, [spotPrice]);

  // Compute shocked volatilities for covariance map
  const propagatedShocks = useMemo(() => {
    const shocks: Record<string, number> = {};
    NODES.forEach((node) => {
      shocks[node.id] = 15; // baseline volatility %
    });

    if (shockedNode) {
      shocks[shockedNode] = 15 + shockSize; // Apply direct shock
      const shockCoeffs = COV_MATRIX_PROXY[shockedNode] || {};
      
      NODES.forEach((node) => {
        if (node.id !== shockedNode) {
          const correlation = shockCoeffs[node.id] ?? 0;
          // Volatility spillover propagation: shock * correlation coefficient
          shocks[node.id] = 15 + shockSize * correlation * 0.7;
        }
      });
    }
    return shocks;
  }, [shockedNode, shockSize]);

  // Compute supply chain node capacities based on disruptions
  const supplyCapacities = useMemo(() => {
    const caps: Record<string, number> = {};
    SUPPLY_NODES.forEach((n) => {
      caps[n.id] = 100; // baseline capacity %
    });

    if (disruptedNode) {
      caps[disruptedNode] = 100 - disruptionLevel;
      // Propagate down the supply chain
      if (disruptedNode === "ASML") {
        caps["TSMC"] = Math.round(100 - disruptionLevel * 0.8);
        caps["NVDA"] = Math.round(100 - disruptionLevel * 0.75);
        caps["AAPL"] = Math.round(100 - disruptionLevel * 0.7);
        caps["MSFT"] = Math.round(100 - disruptionLevel * 0.65);
        caps["RETAIL"] = Math.round(100 - disruptionLevel * 0.6);
      } else if (disruptedNode === "TSMC") {
        caps["NVDA"] = Math.round(100 - disruptionLevel * 0.9);
        caps["AAPL"] = Math.round(100 - disruptionLevel * 0.85);
        caps["MSFT"] = Math.round(100 - disruptionLevel * 0.8);
        caps["RETAIL"] = Math.round(100 - disruptionLevel * 0.75);
      } else if (disruptedNode === "NVDA") {
        caps["MSFT"] = Math.round(100 - disruptionLevel * 0.85);
      } else if (disruptedNode === "AAPL") {
        caps["RETAIL"] = Math.round(100 - disruptionLevel * 0.9);
      }
    }
    return caps;
  }, [disruptedNode, disruptionLevel]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      {/* Parameters Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">RISK NETWORKS & depth matrix</span>
        </div>

        <div className="flex items-center gap-1 bg-[#0d0d0d] border border-border p-0.5">
          {(["volatility", "supplychain", "orderbook"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 font-terminal text-[9px] tracking-widest transition-colors uppercase ${
                activeTab === tab ? "bg-amber-500/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "volatility" ? "Volatility Spillovers" : tab === "supplychain" ? "Supply Chain Map" : "L2 Order Book"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        {/* Left Column: Interactive Diagram */}
        <div className="flex-1 p-4 flex flex-col items-center justify-center overflow-y-auto scrollbar-thin border-b xl:border-b-0 xl:border-r border-border bg-[#020202]">
          {activeTab === "volatility" && (
            <div className="relative w-[320px] h-[280px]">
              <span className="absolute -top-2 left-0 font-terminal text-[9px] tracking-widest text-muted-foreground block uppercase">
                VOLATILITY SPILLOVER MATRIX MAP (CLICK NODE TO SHOCK)
              </span>
              <svg width="100%" height="100%" className="overflow-visible">
                {/* Connection links */}
                {NODES.map((n1, idx1) =>
                  NODES.map((n2, idx2) => {
                    if (idx1 >= idx2) return null;
                    const cov = COV_MATRIX_PROXY[n1.id]?.[n2.id] ?? 0;
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
                  const vol = propagatedShocks[node.id];
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
                        r={12 + vol * 0.2}
                        fill={isShocked ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.05)"}
                        stroke={isShocked ? "rgb(239, 68, 68)" : node.color}
                        strokeWidth={isShocked ? 2.5 : 1.5}
                        className="transition-all duration-300 group-hover:scale-110"
                      />
                      <text
                        x={node.x}
                        y={node.y - 18 - vol * 0.1}
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
                        {vol.toFixed(0)}%
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}

          {activeTab === "supplychain" && (
            <div className="relative w-[380px] h-[220px]">
              <span className="absolute -top-6 left-0 font-terminal text-[9px] tracking-widest text-muted-foreground block uppercase">
                SUPPLY CHAIN DISRUPTION PROPAGATOR (CLICK TO CUT OUTPUT)
              </span>
              <svg width="100%" height="100%" className="overflow-visible">
                {/* Supplier -> Manufacturer connections */}
                <line x1={50} y1={40} x2={190} y2={40} stroke="rgba(255,255,255,0.1)" strokeWidth={1.5} />
                <line x1={50} y1={140} x2={190} y2={40} stroke="rgba(255,255,255,0.1)" strokeWidth={1.5} />
                <line x1={50} y1={140} x2={190} y2={140} stroke="rgba(255,255,255,0.1)" strokeWidth={1.5} />
                {/* Manufacturer -> Consumer connections */}
                <line x1={190} y1={40} x2={330} y2={40} stroke="rgba(255,255,255,0.1)" strokeWidth={1.5} />
                <line x1={190} y1={140} x2={330} y2={140} stroke="rgba(255,255,255,0.1)" strokeWidth={1.5} />

                {/* Draw Nodes */}
                {SUPPLY_NODES.map((node) => {
                  const cap = supplyCapacities[node.id] ?? 100;
                  const isDisrupted = node.id === disruptedNode;
                  const isDownstreamHit = cap < 100 && !isDisrupted;

                  return (
                    <g
                      key={node.id}
                      onClick={() => {
                        if (node.role === "Supplier" || node.role === "Manufacturer") {
                          setDisruptedNode(node.id);
                        }
                      }}
                      className="cursor-pointer group"
                    >
                      <rect
                        x={node.x - 45}
                        y={node.y - 18}
                        width={90}
                        height={36}
                        rx={3}
                        fill={isDisrupted ? "rgba(239,68,68,0.15)" : isDownstreamHit ? "rgba(245,158,11,0.1)" : "rgba(30,41,59,0.2)"}
                        stroke={isDisrupted ? "rgb(239, 68, 68)" : isDownstreamHit ? "rgb(245, 158, 11)" : "rgba(255,255,255,0.2)"}
                        strokeWidth={isDisrupted ? 2 : 1}
                      />
                      <text
                        x={node.x}
                        y={node.y - 4}
                        fill="#fff"
                        fontSize={7.5}
                        fontFamily="'JetBrains Mono', monospace"
                        textAnchor="middle"
                        fontWeight="bold"
                      >
                        {node.name}
                      </text>
                      <text
                        x={node.x}
                        y={node.y + 10}
                        fill={isDisrupted ? "rgb(239,68,68)" : isDownstreamHit ? "rgb(245, 158, 11)" : "rgb(34, 197, 94)"}
                        fontSize={8.5}
                        fontFamily="'JetBrains Mono', monospace"
                        textAnchor="middle"
                        fontWeight="black"
                      >
                        CAP: {cap}%
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}

          {activeTab === "orderbook" && (
            <div className="w-full max-w-sm space-y-4">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block text-center">
                L2 ORDER BOOK MARKET DEPTH WALLS
              </span>

              <div className="border border-border rounded overflow-hidden bg-[#070707] font-mono text-[9px] p-2">
                {/* Asks (Sell, Red) */}
                <div className="space-y-0.5 border-b border-border/40 pb-2 mb-2">
                  <div className="grid grid-cols-3 text-red-500 font-bold text-center border-b border-border/20 pb-1">
                    <span>PRICE</span>
                    <span>SIZE</span>
                    <span>DEPTH</span>
                  </div>
                  {simulatedBook.asks.map((ask, idx) => (
                    <div key={ask.price} className="grid grid-cols-3 text-center text-red-400 opacity-90 relative">
                      <div className="absolute right-0 top-0 bottom-0 bg-red-950/10 pointer-events-none" style={{ width: `${(ask.size / 6000) * 100}%` }} />
                      <span>{ask.price.toFixed(2)}</span>
                      <span className="text-right pr-6">{ask.size.toLocaleString()}</span>
                      <span className="text-right pr-4 font-bold">
                        {simulatedBook.asks.slice(0, idx + 1).reduce((s, v) => s + v.size, 0).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Bids (Buy, Green) */}
                <div className="space-y-0.5">
                  <div className="grid grid-cols-3 text-emerald-500 font-bold text-center border-b border-border/20 pb-1">
                    <span>PRICE</span>
                    <span>SIZE</span>
                    <span>DEPTH</span>
                  </div>
                  {simulatedBook.bids.map((bid, idx) => (
                    <div key={bid.price} className="grid grid-cols-3 text-center text-emerald-400 opacity-90 relative">
                      <div className="absolute right-0 top-0 bottom-0 bg-emerald-950/10 pointer-events-none" style={{ width: `${(bid.size / 6000) * 100}%` }} />
                      <span>{bid.price.toFixed(2)}</span>
                      <span className="text-right pr-6">{bid.size.toLocaleString()}</span>
                      <span className="text-right pr-4 font-bold">
                        {simulatedBook.bids.slice(0, idx + 1).reduce((s, v) => s + v.size, 0).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Controls & Analytics */}
        <div className="w-full xl:w-72 border-t xl:border-t-0 xl:border-l border-border bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
          <div className="p-4 flex-1 space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">NETWORK ANALYTICS</span>
            </div>

            {/* Volatility Tab Controls */}
            {activeTab === "volatility" && (
              <div className="space-y-4">
                <div className="bg-[#080808] border border-border/60 p-3 space-y-1.5">
                  <div className="font-terminal text-[8px] text-muted-foreground tracking-widest uppercase">ACTIVE VOLATILITY SHOCK</div>
                  <div className="font-terminal text-sm font-bold text-red-500 flex items-center gap-1">
                    <Zap className="w-4 h-4 animate-bounce" /> {shockedNode?.replace(".NS", "")}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-terminal text-[9px]">
                    <span className="text-muted-foreground">SHOCK MAGNITUDE</span>
                    <span className="text-foreground font-mono font-bold">+{shockSize}% volatility</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={shockSize}
                    onChange={(e) => setShockSize(parseInt(e.target.value))}
                    className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>

                <div className="border border-border bg-[#080808] p-3 text-[8.5px] font-terminal text-muted-foreground leading-normal space-y-1">
                  <span className="font-bold text-foreground block">Volatility Spillover Logic:</span>
                  <p>
                    Volatility spreads through a covariance transmission matrix. Shocking a high-beta asset like Crypto spreads larger secondary shocks compared to local utility sectors.
                  </p>
                </div>
              </div>
            )}

            {/* Supply Chain Tab Controls */}
            {activeTab === "supplychain" && (
              <div className="space-y-4">
                <div className="bg-[#080808] border border-border/60 p-3">
                  <div className="font-terminal text-[8px] text-muted-foreground tracking-widest uppercase">ACTIVE SUPPLY SHOCK SOURCE</div>
                  <div className="font-terminal text-sm font-bold text-[hsl(38,95%,55%)]">{disruptedNode}</div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-terminal text-[9px]">
                    <span className="text-muted-foreground">OUTPUT CAPACITY CUT</span>
                    <span className="text-foreground font-mono font-bold">-{disruptionLevel}% capacity</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="90"
                    step="5"
                    value={disruptionLevel}
                    onChange={(e) => setDisruptionLevel(parseInt(e.target.value))}
                    className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>

                <div className="border border-border bg-[#080808] p-3 text-[8.5px] font-terminal text-muted-foreground leading-normal space-y-1">
                  <span className="font-bold text-foreground block">Supply Dependency Propagation:</span>
                  <p>
                    Capacity cuts propagate downstream based on dependency coefficients: ASML output cuts TSMC wafer foundry output, reducing GPU (NVDA) and iPhone (AAPL) supplies.
                  </p>
                </div>
              </div>
            )}

            {/* Order Book Tab Controls */}
            {activeTab === "orderbook" && (
              <div className="space-y-4">
                <div className="bg-[#080808] border border-border/60 p-3 space-y-1.5">
                  <div className="font-terminal text-[8px] text-muted-foreground tracking-widest uppercase">BID-ASK VOLUME IMBALANCE</div>
                  <div className={`font-terminal text-lg font-bold font-mono ${
                    simulatedBook.imbalance > 5.0 ? "text-up" :
                    simulatedBook.imbalance < -5.0 ? "text-down" : "text-muted-foreground"
                  }`}>
                    {simulatedBook.imbalance > 0 ? "+" : ""}{simulatedBook.imbalance.toFixed(2)}%
                  </div>
                  <div className="font-terminal text-[8px] text-muted-foreground uppercase">
                    {simulatedBook.imbalance > 5.0 ? "🐂 BUYING PRESSURE WALLS" : simulatedBook.imbalance < -5.0 ? "🐻 SELLING PRESSURE WALLS" : "✓ NEUTRAL BALANCE"}
                  </div>
                </div>

                <div className="bg-[#080808] border border-border/60 p-3 space-y-1">
                  <div className="font-terminal text-[8px] text-muted-foreground tracking-widest uppercase">L2 LIQUIDITY DEPTH TOTALS</div>
                  <div className="font-terminal text-[10px] text-foreground font-semibold flex justify-between">
                    <span>Total Bid Depth:</span>
                    <span>{simulatedBook.totalBidSize.toLocaleString()}</span>
                  </div>
                  <div className="font-terminal text-[10px] text-foreground font-semibold flex justify-between">
                    <span>Total Ask Depth:</span>
                    <span>{simulatedBook.totalAskSize.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
