import { useTerminalArtifactState, useTerminalArtifactContext } from "@/lib/terminalArtifactState";
import { useState, useMemo, type ChangeEvent } from "react";
import { Network } from "lucide-react";
import { ADVANCED_QUANT_EXAMPLES } from "@/lib/advancedQuantExamples";
import { InputSourceSelector, ModelInputEditor, ProvenanceReceipt, advancedInputProvenance, type InputSourceMode } from "./advancedOperationsClimate";
import type { JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";
import { useAdvancedWorkflow } from "./advancedMacroForecastResearch";
import { useTerminalQuantRun } from "@/lib/useTerminalQuantRun";

// Supply Chain domain's own real quant engine (LIMURIA_ENGINES port plan
// Phase 8) -- lives here, under the actual `supply_chain` domain's own
// sidebar section, not buried in the cross-domain Quant Workbench. Real
// defaults throughout rather than toy A/B/C examples: route optimization
// defaults to real major shipping ports with real lat/lon (Haversine-
// computed distances); network analysis defaults to a real-shaped
// multi-tier supplier network; safety stock and bullwhip both accept real
// CSV-uploaded demand/order history as the primary path.

function fmt(v: number | null | undefined, digits = 3): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

function parseNumList(input: string): number[] {
  return input.split(",").map((s) => s.trim()).filter((s) => s.length > 0).map(Number).filter((n) => Number.isFinite(n));
}

function parseSingleColumnCsv(text: string): number[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((line) => Number(line.split(",")[0].trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

function parseTwoColumnCsv(text: string): { a: number[]; b: number[] } {
  const a: number[] = [], b: number[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const cols = line.split(",").map((c) => c.trim());
    if (cols.length < 2) continue;
    const x = Number(cols[0]), y = Number(cols[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    a.push(x); b.push(y);
  }
  return { a, b };
}

// Box-Muller lognormal sampler for the labeled-synthetic bullwhip default.
function sampleLognormal(n: number, meanLog: number, sigmaLog: number, seed = 42): number[] {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rand(), 1e-12), u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out.push(Math.exp(meanLog + sigmaLog * z));
  }
  return out;
}

function statCard(label: string, value: string) {
  return (
    <div key={label} className="border border-border p-2.5">
      <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
      <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DEFAULT_PORTS: { name: string; lat: number; lon: number }[] = [
  { name: "Shanghai", lat: 31.23, lon: 121.47 },
  { name: "Singapore", lat: 1.35, lon: 103.82 },
  { name: "Rotterdam", lat: 51.92, lon: 4.48 },
  { name: "Los Angeles", lat: 33.74, lon: -118.27 },
  { name: "Jebel Ali (Dubai)", lat: 25.01, lon: 55.06 },
  { name: "Busan", lat: 35.10, lon: 129.04 },
];

type AdvancedSupplyChainMethod = "facility-location" | "stochastic-inventory" | "supplier-portfolio" | "disruption-simulation" | "resilience-frontier";
const ADVANCED_SUPPLY_CHAIN_METHODS: readonly AdvancedSupplyChainMethod[] = ["facility-location", "stochastic-inventory", "supplier-portfolio", "disruption-simulation", "resilience-frontier"];
function isAdvancedSupplyChainMethod(m: SupplyChainMethod): m is AdvancedSupplyChainMethod {
  return (ADVANCED_SUPPLY_CHAIN_METHODS as readonly string[]).includes(m);
}
const ADVANCED_SUPPLY_CHAIN_EXAMPLES: Record<AdvancedSupplyChainMethod, Record<string, unknown>> = {
  "facility-location": ADVANCED_QUANT_EXAMPLES["python.advanced.supply-chain.facility-location"],
  "stochastic-inventory": ADVANCED_QUANT_EXAMPLES["python.advanced.supply-chain.stochastic-inventory"],
  "supplier-portfolio": ADVANCED_QUANT_EXAMPLES["python.advanced.supply-chain.supplier-portfolio"],
  "disruption-simulation": ADVANCED_QUANT_EXAMPLES["python.advanced.supply-chain.disruption-simulation"],
  "resilience-frontier": ADVANCED_QUANT_EXAMPLES["python.advanced.supply-chain.resilience-frontier"],
};

const ADVANCED_SUPPLY_CHAIN_SCHEMAS: Record<AdvancedSupplyChainMethod, JsonFieldSchema[]> = {
  "facility-location": [
    {
      kind: "objectArray", key: "facilities", label: "FACILITIES", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["facility-location"].facilities as Record<string, unknown>[],
      itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "fixedCost", label: "FIXED COST" },
        { kind: "number", key: "capacity", label: "CAPACITY" },
      ],
    },
    { kind: "stringArray", key: "customerNames", label: "CUSTOMER NAMES", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["facility-location"].customerNames as string[] },
    { kind: "numberArray", key: "demand", label: "DEMAND", itemLabel: "CUSTOMER", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["facility-location"].demand as number[] },
    { kind: "numberMatrix", key: "transportCost", label: "TRANSPORT COST (FACILITY × CUSTOMER)", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["facility-location"].transportCost as number[][] },
    { kind: "number", key: "maxOpenFacilities", label: "MAX OPEN FACILITIES", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["facility-location"].maxOpenFacilities as number },
  ],
  "stochastic-inventory": [
    { kind: "numberArray", key: "demandScenarios", label: "DEMAND SCENARIOS", itemLabel: "SCENARIO", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["stochastic-inventory"].demandScenarios as number[] },
    { kind: "number", key: "unitPurchaseCost", label: "UNIT PURCHASE COST", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["stochastic-inventory"].unitPurchaseCost as number },
    { kind: "number", key: "holdingCostPerUnit", label: "HOLDING COST / UNIT", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["stochastic-inventory"].holdingCostPerUnit as number },
    { kind: "number", key: "stockoutCostPerUnit", label: "STOCKOUT COST / UNIT", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["stochastic-inventory"].stockoutCostPerUnit as number },
    { kind: "number", key: "salvageValuePerUnit", label: "SALVAGE VALUE / UNIT", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["stochastic-inventory"].salvageValuePerUnit as number },
    { kind: "number", key: "maxOrderQuantity", label: "MAX ORDER QUANTITY", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["stochastic-inventory"].maxOrderQuantity as number },
  ],
  "supplier-portfolio": [
    {
      kind: "objectArray", key: "suppliers", label: "SUPPLIERS", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["supplier-portfolio"].suppliers as Record<string, unknown>[],
      itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "unitCost", label: "UNIT COST" },
        { kind: "number", key: "capacity", label: "CAPACITY" },
        { kind: "number", key: "disruptionProbabilityPct", label: "DISRUPTION PROBABILITY %" },
        { kind: "number", key: "emissionsPerUnit", label: "EMISSIONS / UNIT" },
      ],
    },
    { kind: "number", key: "demand", label: "DEMAND", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["supplier-portfolio"].demand as number },
    { kind: "number", key: "riskPenaltyPerExpectedLostUnit", label: "RISK PENALTY / EXPECTED LOST UNIT", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["supplier-portfolio"].riskPenaltyPerExpectedLostUnit as number },
    { kind: "number", key: "carbonPricePerEmissionUnit", label: "CARBON PRICE / EMISSION UNIT", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["supplier-portfolio"].carbonPricePerEmissionUnit as number },
    { kind: "number", key: "concentrationPenalty", label: "CONCENTRATION PENALTY", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["supplier-portfolio"].concentrationPenalty as number },
    { kind: "number", key: "maxSupplierShare", label: "MAX SUPPLIER SHARE", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["supplier-portfolio"].maxSupplierShare as number },
  ],
  "disruption-simulation": [
    {
      kind: "objectArray", key: "suppliers", label: "SUPPLIERS", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["disruption-simulation"].suppliers as Record<string, unknown>[],
      itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "allocation", label: "ALLOCATION" },
        { kind: "number", key: "disruptionProbabilityPct", label: "DISRUPTION PROBABILITY %" },
        { kind: "number", key: "recoveryDaysMean", label: "RECOVERY DAYS (MEAN)" },
        { kind: "number", key: "recoveryDaysStd", label: "RECOVERY DAYS (STD)" },
        { kind: "number", key: "backupCostPremiumPct", label: "BACKUP COST PREMIUM %" },
      ],
    },
    { kind: "number", key: "dailyDemand", label: "DAILY DEMAND", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["disruption-simulation"].dailyDemand as number },
    { kind: "number", key: "inventoryBufferUnits", label: "INVENTORY BUFFER (UNITS)", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["disruption-simulation"].inventoryBufferUnits as number },
    { kind: "number", key: "unitBaseCost", label: "UNIT BASE COST", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["disruption-simulation"].unitBaseCost as number },
    { kind: "number", key: "simulations", label: "SIMULATIONS", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["disruption-simulation"].simulations as number },
    { kind: "number", key: "seed", label: "SEED", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["disruption-simulation"].seed as number },
  ],
  "resilience-frontier": [
    {
      kind: "objectArray", key: "suppliers", label: "SUPPLIERS", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["resilience-frontier"].suppliers as Record<string, unknown>[],
      itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "unitCost", label: "UNIT COST" },
        { kind: "number", key: "capacity", label: "CAPACITY" },
        { kind: "number", key: "disruptionProbabilityPct", label: "DISRUPTION PROBABILITY %" },
        { kind: "number", key: "emissionsPerUnit", label: "EMISSIONS / UNIT" },
      ],
    },
    { kind: "number", key: "demand", label: "DEMAND", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["resilience-frontier"].demand as number },
    { kind: "number", key: "carbonPricePerEmissionUnit", label: "CARBON PRICE / EMISSION UNIT", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["resilience-frontier"].carbonPricePerEmissionUnit as number },
    { kind: "number", key: "concentrationPenalty", label: "CONCENTRATION PENALTY", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["resilience-frontier"].concentrationPenalty as number },
    { kind: "number", key: "maxSupplierShare", label: "MAX SUPPLIER SHARE", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["resilience-frontier"].maxSupplierShare as number },
    { kind: "numberArray", key: "riskPenaltyGrid", label: "RISK PENALTY GRID", itemLabel: "STEP", default: ADVANCED_SUPPLY_CHAIN_EXAMPLES["resilience-frontier"].riskPenaltyGrid as number[] },
  ],
};
type AdvancedReceipt = {
  dataClassification?: string;
  modelPath?: string;
  modelVersion?: string;
  runId?: string;
  inputSnapshotHash?: string;
  outputSnapshotHash?: string;
  validationHash?: string;
  warnings?: string[];
  sourceBindings?: Array<{ field?: string; provider?: string; connectorId?: string; sourceReference?: string; asOf?: string; snapshot?: { id?: string; contentHash?: string } }>;
};

type SupplyChainMethod = "route" | "safetystock" | "bullwhip" | "network" | "resilience" | AdvancedSupplyChainMethod;
const SUPPLY_CHAIN_METHODS: { key: SupplyChainMethod; label: string }[] = [
  { key: "route", label: "ROUTE OPTIMIZATION (2-OPT TSP/VRP)" },
  { key: "safetystock", label: "MULTI-ECHELON SAFETY STOCK" },
  { key: "bullwhip", label: "BULLWHIP EFFECT INDEX" },
  { key: "network", label: "NETWORK ANALYSIS (MAX-FLOW / CENTRALITY)" },
  { key: "resilience", label: "RESILIENCE INDEX" },
  { key: "facility-location", label: "FACILITY LOCATION (MILP)" },
  { key: "stochastic-inventory", label: "STOCHASTIC INVENTORY OPTIMIZATION" },
  { key: "supplier-portfolio", label: "SUPPLIER PORTFOLIO OPTIMIZATION" },
  { key: "disruption-simulation", label: "DISRUPTION SIMULATION (MONTE CARLO)" },
  { key: "resilience-frontier", label: "RESILIENCE FRONTIER (RISK-COST TRADEOFF)" },
];

export default function SupplyChainQuantPanel() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const [method, setMethod] = useTerminalArtifactState<SupplyChainMethod>("SupplyChainQuantPanel.method", "route");
  const [localResult, setResult] = useState<{ method: string; output: unknown } | null>(null);
  const terminal = useTerminalArtifactContext();
  const native = useTerminalQuantRun();
  const legacyResult = terminal?.target ? native.stored?.[`supplychain.${method}`] : localResult?.method === method ? localResult.output : null;
  const nativeWorkflow = useAdvancedWorkflow("supply-chain", method);
  const result = ["route", "safetystock", "bullwhip", "network", "resilience"].includes(method) ? legacyResult : nativeWorkflow.result;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ports, setPorts] = useTerminalArtifactState("SupplyChainQuantPanel.ports", DEFAULT_PORTS);

  const [serviceLevelPct, setServiceLevelPct] = useTerminalArtifactState("SupplyChainQuantPanel.serviceLevelPct", "95");
  const [demandStdDev, setDemandStdDev] = useTerminalArtifactState("SupplyChainQuantPanel.demandStdDev", "250");
  const [echelonLTs, setEchelonLTs] = useTerminalArtifactState("SupplyChainQuantPanel.echelonLTs", "7,14,30");
  const [echelonNames, setEchelonNames] = useTerminalArtifactState("SupplyChainQuantPanel.echelonNames", "Retailer,Regional Depot,Central Factory");
  const [uploadedDemandForStdDev, setUploadedDemandForStdDev] = useTerminalArtifactState<number[] | null>("SupplyChainQuantPanel.uploadedDemandForStdDev", null);

  function handleDemandCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseSingleColumnCsv(String(reader.result ?? ""));
      if (parsed.length < 10) { setError("Need at least 10 valid rows -- a single demand-quantity column."); return; }
      setUploadedDemandForStdDev(parsed);
      const mean = parsed.reduce((s, v) => s + v, 0) / parsed.length;
      const std = Math.sqrt(parsed.reduce((s, v) => s + (v - mean) ** 2, 0) / (parsed.length - 1));
      setDemandStdDev(std.toFixed(2));
      setError(null); setResult(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const [uploadedBullwhip, setUploadedBullwhip] = useTerminalArtifactState<{ demand: number[]; orders: number[] } | null>("SupplyChainQuantPanel.uploadedBullwhip", null);
  const syntheticBullwhip = useMemo(() => {
    const demand = sampleLognormal(200, Math.log(1000), 0.05, 7).map((v) => Math.round(v));
    const orders = demand.map((d, i) => Math.round(d + (sampleLognormal(1, 0, 0.15, 900 + i)[0] - 1) * 400));
    return { demand, orders };
  }, []);
  const bullwhipSeries = uploadedBullwhip ?? syntheticBullwhip;

  function handleBullwhipCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTwoColumnCsv(String(reader.result ?? ""));
      if (parsed.a.length < 10) { setError("Need at least 10 valid rows -- expected columns: retail_demand,supplier_orders"); return; }
      setUploadedBullwhip({ demand: parsed.a, orders: parsed.b });
      setError(null); setResult(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const [networkNodesInput, setNetworkNodesInput] = useTerminalArtifactState("SupplyChainQuantPanel.networkNodesInput", "Supplier_Taiwan,Assembly_Shenzhen,Port_Shanghai,Port_LA,Distribution_Center");
  const [networkEdges, setNetworkEdges] = useTerminalArtifactState("SupplyChainQuantPanel.networkEdges", [
    { source: "Supplier_Taiwan", target: "Assembly_Shenzhen", weight: "80" },
    { source: "Assembly_Shenzhen", target: "Port_Shanghai", weight: "90" },
    { source: "Port_Shanghai", target: "Port_LA", weight: "70" },
    { source: "Port_LA", target: "Distribution_Center", weight: "100" },
  ]);
  const [sourceNode, setSourceNode] = useTerminalArtifactState("SupplyChainQuantPanel.sourceNode", "Supplier_Taiwan");
  const [sinkNode, setSinkNode] = useTerminalArtifactState("SupplyChainQuantPanel.sinkNode", "Distribution_Center");

  const [supplierCount, setSupplierCount] = useTerminalArtifactState("SupplyChainQuantPanel.supplierCount", "20");
  const [singleSourceCount, setSingleSourceCount] = useTerminalArtifactState("SupplyChainQuantPanel.singleSourceCount", "4");
  const [bufferDays, setBufferDays] = useTerminalArtifactState("SupplyChainQuantPanel.bufferDays", "30");

  // ── Dark advanced supply-chain routes (facility location / stochastic inventory / supplier portfolio / disruption sim / resilience frontier) ──
  const [advancedSourceMode, setAdvancedSourceMode] = useTerminalArtifactState<InputSourceMode>("SupplyChainQuantPanel.advancedSourceMode", "manual");
  const [advancedInputs, setAdvancedInputs] = useTerminalArtifactState<Record<AdvancedSupplyChainMethod, string>>("SupplyChainQuantPanel.advancedInputs", {
    "facility-location": JSON.stringify(ADVANCED_SUPPLY_CHAIN_EXAMPLES["facility-location"], null, 2),
    "stochastic-inventory": JSON.stringify(ADVANCED_SUPPLY_CHAIN_EXAMPLES["stochastic-inventory"], null, 2),
    "supplier-portfolio": JSON.stringify(ADVANCED_SUPPLY_CHAIN_EXAMPLES["supplier-portfolio"], null, 2),
    "disruption-simulation": JSON.stringify(ADVANCED_SUPPLY_CHAIN_EXAMPLES["disruption-simulation"], null, 2),
    "resilience-frontier": JSON.stringify(ADVANCED_SUPPLY_CHAIN_EXAMPLES["resilience-frontier"], null, 2),
  });

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      let path = "", body: unknown;
      if (method === "route") {
        const n = ports.length;
        const matrix = ports.map((p1) => ports.map((p2) => haversineKm(p1.lat, p1.lon, p2.lat, p2.lon)));
        if (n < 3) { setError("Need at least 3 locations."); setLoading(false); return; }
        path = "/api/quant/supplychain/route-optimization";
        body = { locationNames: ports.map((p) => p.name), distanceMatrix: matrix };
      } else if (method === "safetystock") {
        const lts = parseNumList(echelonLTs);
        const names = echelonNames.split(",").map((s) => s.trim()).filter(Boolean);
        if (lts.length === 0) { setError("Need at least one echelon lead time."); setLoading(false); return; }
        path = "/api/quant/supplychain/safety-stock";
        body = { serviceLevelPct: Number(serviceLevelPct), dailyDemandStdDev: Number(demandStdDev), echelonLeadTimesDays: lts, echelonNames: names.length === lts.length ? names : undefined };
      } else if (method === "bullwhip") {
        path = "/api/quant/supplychain/bullwhip";
        body = { retailDemandHistory: bullwhipSeries.demand, supplierOrdersHistory: bullwhipSeries.orders };
      } else if (method === "network") {
        const nodes = networkNodesInput.split(",").map((s) => s.trim()).filter(Boolean);
        const edges = networkEdges.map((e) => ({ source: e.source, target: e.target, weight: Number(e.weight) }));
        if (edges.some((e) => !Number.isFinite(e.weight) || e.weight <= 0)) { setError("All edge weights must be positive numbers."); setLoading(false); return; }
        path = "/api/quant/supplychain/network-analysis";
        body = { nodes, edges, sourceNode: sourceNode || undefined, sinkNode: sinkNode || undefined };
      } else if (method === "resilience") {
        path = "/api/quant/supplychain/resilience";
        body = { supplierNodesCount: Number(supplierCount), singleSourceNodesCount: Number(singleSourceCount), bufferInventoryDays: Number(bufferDays) };
      } else {
        const parsed: unknown = JSON.parse(advancedInputs[method]);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Model input must be a JSON object.");
        const parameters = parsed as Record<string, unknown>;
        await nativeWorkflow.run(parameters, advancedInputProvenance(parameters, advancedSourceMode));
        return;
      }
      const output = await native.run<Record<string, unknown>>(method, body as Record<string, unknown>, `supplychain.${method}`, path);
      if (!terminal?.target) setResult({ method, output });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Supply Chain engine unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4">
      <div className="flex items-center gap-2 mb-4">
        <Network className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[11px] tracking-widest text-foreground">SUPPLY CHAIN ENGINE — ROUTE / NETWORK / RISK ANALYSIS</span>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={method} onChange={(e) => { setMethod(e.target.value as SupplyChainMethod); setResult(null); setError(null); }} className={inputCls}>
            {SUPPLY_CHAIN_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button onClick={run} disabled={loading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
            {loading ? "RUNNING..." : "RUN"}
          </button>
        </div>

        {method === "route" && (
          <div className="space-y-2">
            <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">LOCATIONS — REAL MAJOR CONTAINER PORTS BY DEFAULT, REAL HAVERSINE DISTANCES (NOT HAND-TYPED)</div>
            {ports.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input value={p.name} onChange={(e) => setPorts((ps) => ps.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={`flex-1 ${inputCls}`} />
                <input value={p.lat} onChange={(e) => setPorts((ps) => ps.map((x, j) => j === i ? { ...x, lat: Number(e.target.value) } : x))} inputMode="decimal" placeholder="lat" className={`w-20 ${inputCls}`} />
                <input value={p.lon} onChange={(e) => setPorts((ps) => ps.map((x, j) => j === i ? { ...x, lon: Number(e.target.value) } : x))} inputMode="decimal" placeholder="lon" className={`w-20 ${inputCls}`} />
                <button onClick={() => setPorts((ps) => ps.filter((_, j) => j !== i))} className="px-1.5 py-1 border border-border text-muted-foreground hover:text-red-400 font-terminal text-[8px]">✕</button>
              </div>
            ))}
            <button onClick={() => setPorts((ps) => [...ps, { name: "New Location", lat: 0, lon: 0 }])} className="px-2 py-1 border border-border text-muted-foreground hover:text-[hsl(38,95%,55%)] font-terminal text-[8px]">+ ADD LOCATION</button>
          </div>
        )}

        {method === "safetystock" && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SERVICE LEVEL %</span><input value={serviceLevelPct} onChange={(e) => setServiceLevelPct(e.target.value)} inputMode="decimal" className={inputCls} /></label>
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">DAILY DEMAND STD DEV</span><input value={demandStdDev} onChange={(e) => setDemandStdDev(e.target.value)} inputMode="decimal" className={inputCls} disabled={!!uploadedDemandForStdDev} /></label>
            </div>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">ECHELON LEAD TIMES (DAYS)</span><input value={echelonLTs} onChange={(e) => setEchelonLTs(e.target.value)} className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">ECHELON NAMES (OPTIONAL, SAME ORDER)</span><input value={echelonNames} onChange={(e) => setEchelonNames(e.target.value)} className={inputCls} /></label>
            <div className="flex items-center gap-2">
              <label className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground cursor-pointer whitespace-nowrap">
                UPLOAD REAL DEMAND HISTORY CSV (COMPUTES STD DEV)
                <input type="file" accept=".csv,text/csv" onChange={handleDemandCsvUpload} className="hidden" />
              </label>
              {uploadedDemandForStdDev && <button onClick={() => setUploadedDemandForStdDev(null)} className="px-3 py-1.5 border border-border text-muted-foreground hover:text-red-400 font-terminal text-[8px]">CLEAR UPLOAD</button>}
              {uploadedDemandForStdDev && <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">{uploadedDemandForStdDev.length} real observations, std dev computed</span>}
            </div>
          </div>
        )}

        {method === "bullwhip" && (
          <div className="border border-border/60 p-2.5 space-y-1.5">
            <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">RETAIL DEMAND vs. SUPPLIER ORDERS — UPLOAD REAL DATA OR USE A LABELED SYNTHETIC DEFAULT</div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground cursor-pointer whitespace-nowrap">
                UPLOAD REAL CSV (retail_demand,supplier_orders)
                <input type="file" accept=".csv,text/csv" onChange={handleBullwhipCsvUpload} className="hidden" />
              </label>
              {uploadedBullwhip && <button onClick={() => setUploadedBullwhip(null)} className="px-3 py-1.5 border border-border text-muted-foreground hover:text-red-400 font-terminal text-[8px]">CLEAR UPLOAD</button>}
              <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">{bullwhipSeries.demand.length} observations {uploadedBullwhip ? "(real, uploaded)" : "(synthetic)"}</span>
            </div>
          </div>
        )}

        {method === "network" && (
          <div className="space-y-2">
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">NODES (COMMA-SEPARATED)</span><input value={networkNodesInput} onChange={(e) => setNetworkNodesInput(e.target.value)} className={inputCls} /></label>
            <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">EDGES (SOURCE → TARGET, WEIGHT/CAPACITY)</div>
            {networkEdges.map((e, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input value={e.source} onChange={(ev) => setNetworkEdges((es) => es.map((x, j) => j === i ? { ...x, source: ev.target.value } : x))} placeholder="source" className={`flex-1 ${inputCls}`} />
                <input value={e.target} onChange={(ev) => setNetworkEdges((es) => es.map((x, j) => j === i ? { ...x, target: ev.target.value } : x))} placeholder="target" className={`flex-1 ${inputCls}`} />
                <input value={e.weight} onChange={(ev) => setNetworkEdges((es) => es.map((x, j) => j === i ? { ...x, weight: ev.target.value } : x))} inputMode="decimal" placeholder="weight" className={`w-20 ${inputCls}`} />
                <button onClick={() => setNetworkEdges((es) => es.filter((_, j) => j !== i))} className="px-1.5 py-1 border border-border text-muted-foreground hover:text-red-400 font-terminal text-[8px]">✕</button>
              </div>
            ))}
            <button onClick={() => setNetworkEdges((es) => [...es, { source: "", target: "", weight: "1" }])} className="px-2 py-1 border border-border text-muted-foreground hover:text-[hsl(38,95%,55%)] font-terminal text-[8px]">+ ADD EDGE</button>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SOURCE (FOR MAX-FLOW)</span><input value={sourceNode} onChange={(e) => setSourceNode(e.target.value)} className={`w-40 ${inputCls}`} /></label>
              <label className="flex items-center gap-1.5"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SINK</span><input value={sinkNode} onChange={(e) => setSinkNode(e.target.value)} className={`w-40 ${inputCls}`} /></label>
            </div>
          </div>
        )}

        {method === "resilience" && (
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider"># SUPPLIER NODES</span><input value={supplierCount} onChange={(e) => setSupplierCount(e.target.value)} inputMode="numeric" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider"># SINGLE-SOURCE BOTTLENECKS</span><input value={singleSourceCount} onChange={(e) => setSingleSourceCount(e.target.value)} inputMode="numeric" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">BUFFER INVENTORY (DAYS)</span><input value={bufferDays} onChange={(e) => setBufferDays(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          </div>
        )}

        {isAdvancedSupplyChainMethod(method) && (() => {
          const activeMethod = method;
          return (
            <div className="space-y-3">
              <InputSourceSelector value={advancedSourceMode} onChange={setAdvancedSourceMode} domain="advanced supply chain model" />
              <ModelInputEditor
                value={advancedInputs[activeMethod]}
                onChange={(action) => setAdvancedInputs((prev) => ({
                  ...prev,
                  [activeMethod]: typeof action === "function" ? (action as (v: string) => string)(prev[activeMethod]) : action,
                }))}
                example={JSON.stringify(ADVANCED_SUPPLY_CHAIN_EXAMPLES[activeMethod])}
                schema={ADVANCED_SUPPLY_CHAIN_SCHEMAS[activeMethod]}
              />
            </div>
          );
        })()}

        {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}

        {result != null && method === "route" && (() => {
          const r = result as { optimalRouteNames: string[]; totalDistance: number; iterationsToConverge: number };
          return (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {statCard("TOTAL ROUTE DISTANCE (KM)", fmt(r.totalDistance, 1))}
                {statCard("ITERATIONS TO CONVERGE", String(r.iterationsToConverge))}
              </div>
              <div className="font-terminal text-[9px] text-foreground">{r.optimalRouteNames.join(" → ")}</div>
            </>
          );
        })()}

        {result != null && method === "safetystock" && (() => {
          const r = result as { serviceLevelZ: number; echelonBreakdown: { echelonName: string; leadTimeDays: number; cumulativeLeadTimeDays: number; safetyStockUnits: number }[]; totalMultiEchelonStockUnits: number };
          return (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {statCard("SERVICE LEVEL Z", fmt(r.serviceLevelZ, 4))}
                {statCard("TOTAL MULTI-ECHELON STOCK", fmt(r.totalMultiEchelonStockUnits, 1))}
              </div>
              <div className="border border-border overflow-x-auto scrollbar-thin">
                <table className="w-full font-terminal text-[8px]">
                  <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left p-1.5">ECHELON</th><th className="text-right p-1.5">LEAD TIME</th><th className="text-right p-1.5">CUMULATIVE LT</th><th className="text-right p-1.5">SAFETY STOCK</th></tr></thead>
                  <tbody>
                    {r.echelonBreakdown.map((e) => (
                      <tr key={e.echelonName} className="border-b border-border/30">
                        <td className="p-1.5">{e.echelonName}</td>
                        <td className="text-right p-1.5 tabular-nums">{fmt(e.leadTimeDays, 0)}</td>
                        <td className="text-right p-1.5 tabular-nums">{fmt(e.cumulativeLeadTimeDays, 0)}</td>
                        <td className="text-right p-1.5 tabular-nums">{fmt(e.safetyStockUnits, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}

        {result != null && method === "bullwhip" && (() => {
          const r = result as { retailDemandVariance: number; supplierOrdersVariance: number; bullwhipIndex: number; status: string };
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {statCard("RETAIL DEMAND VAR", fmt(r.retailDemandVariance, 2))}
              {statCard("SUPPLIER ORDERS VAR", fmt(r.supplierOrdersVariance, 2))}
              {statCard("BULLWHIP INDEX", fmt(r.bullwhipIndex, 3))}
              {statCard("STATUS", r.status.replace(/_/g, " "))}
            </div>
          );
        })()}

        {result != null && method === "network" && (() => {
          const r = result as { density: number; networkConnectivityPct: number; maxFlowUnits: number | null; criticalPathNodes: string[] | null; criticalPathBottleneckCapacity: number | null; betweennessCentralityTop: Record<string, number>; degreeCentralityTop: Record<string, number> };
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {statCard("NETWORK DENSITY", fmt(r.density, 3))}
                {statCard("CONNECTIVITY %", fmt(r.networkConnectivityPct, 1))}
                {r.maxFlowUnits != null && statCard("MAX FLOW", fmt(r.maxFlowUnits, 2))}
                {r.criticalPathBottleneckCapacity != null && statCard("BOTTLENECK CAPACITY", fmt(r.criticalPathBottleneckCapacity, 2))}
              </div>
              {r.criticalPathNodes && <div className="font-terminal text-[9px] text-foreground">Critical path: {r.criticalPathNodes.join(" → ")}</div>}
              <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">TOP NODES BY BETWEENNESS CENTRALITY (HUB IMPORTANCE)</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {Object.entries(r.betweennessCentralityTop).slice(0, 8).map(([k, v]) => statCard(k, fmt(v, 3)))}
              </div>
            </>
          );
        })()}

        {result != null && method === "resilience" && (() => {
          const r = result as { networkVulnerabilityScorePct: number; overallResilienceScore: number; resilienceRating: string; methodologyNote: string };
          return (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {statCard("VULNERABILITY SCORE", `${fmt(r.networkVulnerabilityScorePct, 1)}%`)}
                {statCard("RESILIENCE SCORE", `${fmt(r.overallResilienceScore, 1)} (${r.resilienceRating.replace(/_/g, " ")})`)}
              </div>
              <div className="font-terminal text-[7.5px] text-muted-foreground/70">{r.methodologyNote}</div>
            </>
          );
        })()}

        {result != null && isAdvancedSupplyChainMethod(method) && (() => {
          const { receipt, ...rest } = result as Record<string, unknown> & { receipt?: AdvancedReceipt };
          return (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap border border-border p-2.5 font-mono text-[8px] leading-relaxed text-muted-foreground">{JSON.stringify(rest, null, 2)}</pre>
              <ProvenanceReceipt receipt={receipt} />
            </>
          );
        })()}
        {result != null && !isAdvancedSupplyChainMethod(method) && <><p className="text-xs text-muted-foreground">Recorded original supply-chain engine result · explicit Run recalculates edited inputs on this same terminal Artifact.</p><ProvenanceReceipt receipt={(result as { receipt?: AdvancedReceipt }).receipt}/></>}
      </div>
    </div>
  );
}
