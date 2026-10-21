import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState } from "react";
import { Leaf } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { ADVANCED_QUANT_EXAMPLES } from "@/lib/advancedQuantExamples";
import { InputSourceSelector, ModelInputEditor, ProvenanceReceipt, advancedInputProvenance, type InputSourceMode } from "./advancedOperationsClimate";
import type { JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";

// Environment & Sustainability domain's own real quant engine
// (LIMURIA_ENGINES port plan Phase 9) -- built directly inside the actual
// `environment_sustainability` domain's own sidebar section from the
// start, not in the cross-domain Quant Workbench (the placement mistake
// found and fixed in Phase 8 for Supply Chain).
//
// Both methods are inherently per-company tools (like Merton/KMV credit
// risk) -- real bulk aggregate FRED/World Bank emissions series don't
// supply company-level scope 1/2/3 emissions or EBITDA, so manual entry of
// a real client company's own figures is the correct real-scale input
// here, not synthetic bulk data or a live feed.

function fmt(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function statCard(label: string, value: string) {
  return (
    <div key={label} className="border border-border p-2.5">
      <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
      <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

type AdvancedClimateMethod = "financed-emissions" | "climate-var" | "abatement-curve" | "transition-pathway";
const ADVANCED_CLIMATE_METHODS: readonly AdvancedClimateMethod[] = ["financed-emissions", "climate-var", "abatement-curve", "transition-pathway"];
function isAdvancedClimateMethod(m: EnvironmentMethod): m is AdvancedClimateMethod {
  return (ADVANCED_CLIMATE_METHODS as readonly string[]).includes(m);
}
const ADVANCED_CLIMATE_EXAMPLES: Record<AdvancedClimateMethod, Record<string, unknown>> = {
  "financed-emissions": ADVANCED_QUANT_EXAMPLES["python.advanced.climate.financed-emissions"],
  "climate-var": ADVANCED_QUANT_EXAMPLES["python.advanced.climate.climate-var"],
  "abatement-curve": ADVANCED_QUANT_EXAMPLES["python.advanced.climate.abatement-curve"],
  "transition-pathway": ADVANCED_QUANT_EXAMPLES["python.advanced.climate.transition-pathway"],
};

const ADVANCED_CLIMATE_SCHEMAS: Record<AdvancedClimateMethod, JsonFieldSchema[]> = {
  "financed-emissions": [
    {
      kind: "objectArray", key: "assets", label: "ASSETS", default: ADVANCED_CLIMATE_EXAMPLES["financed-emissions"].assets as Record<string, unknown>[],
      itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "exposure", label: "EXPOSURE ($M)" },
        { kind: "number", key: "enterpriseValueIncludingCash", label: "ENTERPRISE VALUE INCL. CASH ($M)" },
        { kind: "number", key: "scope1", label: "SCOPE 1 (TONS CO2e)" },
        { kind: "number", key: "scope2", label: "SCOPE 2 (TONS CO2e)" },
        { kind: "number", key: "scope3", label: "SCOPE 3 (TONS CO2e)" },
        { kind: "number", key: "revenue", label: "REVENUE ($M)" },
      ],
    },
    { kind: "boolean", key: "includeScope3", label: "INCLUDE SCOPE 3", default: ADVANCED_CLIMATE_EXAMPLES["financed-emissions"].includeScope3 as boolean },
  ],
  "climate-var": [
    {
      kind: "objectArray", key: "assets", label: "ASSETS", default: ADVANCED_CLIMATE_EXAMPLES["climate-var"].assets as Record<string, unknown>[],
      itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "marketValue", label: "MARKET VALUE ($M)" },
        { kind: "number", key: "scope12Tonnes", label: "SCOPE 1+2 (TONS CO2e)" },
        { kind: "number", key: "annualRevenue", label: "ANNUAL REVENUE ($M)" },
        { kind: "number", key: "ebitdaMarginPct", label: "EBITDA MARGIN %" },
        { kind: "number", key: "carbonCostPassThroughPct", label: "CARBON COST PASS-THROUGH %" },
        { kind: "number", key: "physicalHazardExposurePct", label: "PHYSICAL HAZARD EXPOSURE %" },
        { kind: "number", key: "physicalDamageSensitivity", label: "PHYSICAL DAMAGE SENSITIVITY" },
        { kind: "number", key: "valuationMultiple", label: "VALUATION MULTIPLE" },
      ],
    },
    {
      kind: "objectArray", key: "scenarios", label: "SCENARIOS", default: ADVANCED_CLIMATE_EXAMPLES["climate-var"].scenarios as Record<string, unknown>[],
      itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "carbonPricePerTonne", label: "CARBON PRICE / TONNE" },
        { kind: "number", key: "demandShockPct", label: "DEMAND SHOCK %" },
        { kind: "number", key: "physicalHazardSeverity", label: "PHYSICAL HAZARD SEVERITY" },
      ],
    },
  ],
  "abatement-curve": [
    {
      kind: "objectArray", key: "projects", label: "PROJECTS", default: ADVANCED_CLIMATE_EXAMPLES["abatement-curve"].projects as Record<string, unknown>[],
      itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "annualAbatementTonnes", label: "ANNUAL ABATEMENT (TONS)" },
        { kind: "number", key: "annualizedCost", label: "ANNUALIZED COST" },
        { kind: "number", key: "implementationCapex", label: "IMPLEMENTATION CAPEX" },
      ],
    },
    { kind: "number", key: "carbonPricePerTonne", label: "CARBON PRICE / TONNE", default: ADVANCED_CLIMATE_EXAMPLES["abatement-curve"].carbonPricePerTonne as number },
    { kind: "number", key: "abatementTargetTonnes", label: "ABATEMENT TARGET (TONS)", default: ADVANCED_CLIMATE_EXAMPLES["abatement-curve"].abatementTargetTonnes as number },
  ],
  "transition-pathway": [
    { kind: "number", key: "baseEmissions", label: "BASE EMISSIONS (TONS CO2e)", default: ADVANCED_CLIMATE_EXAMPLES["transition-pathway"].baseEmissions as number },
    { kind: "numberArray", key: "years", label: "YEARS", itemLabel: "YEAR", default: ADVANCED_CLIMATE_EXAMPLES["transition-pathway"].years as number[] },
    { kind: "numberArray", key: "emissionsTargets", label: "EMISSIONS TARGETS (TONS CO2e)", default: ADVANCED_CLIMATE_EXAMPLES["transition-pathway"].emissionsTargets as number[] },
    { kind: "numberArray", key: "carbonPrices", label: "CARBON PRICES", default: ADVANCED_CLIMATE_EXAMPLES["transition-pathway"].carbonPrices as number[] },
    { kind: "numberArray", key: "revenueForecast", label: "REVENUE FORECAST", default: ADVANCED_CLIMATE_EXAMPLES["transition-pathway"].revenueForecast as number[] },
  ],
};

type EnvironmentMethod = "climate" | "carbon" | AdvancedClimateMethod;
const ENVIRONMENT_METHODS: { key: EnvironmentMethod; label: string }[] = [
  { key: "climate", label: "CLIMATE TRANSITION RISK (NGFS-STYLE)" },
  { key: "carbon", label: "CARBON CREDIT MRV VALUATION" },
  { key: "financed-emissions", label: "FINANCED EMISSIONS (PCAF)" },
  { key: "climate-var", label: "CLIMATE VALUE AT RISK" },
  { key: "abatement-curve", label: "MARGINAL ABATEMENT COST CURVE" },
  { key: "transition-pathway", label: "CLIMATE TRANSITION PATHWAY" },
];

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

export default function EnvironmentQuantPanel() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const [method, setMethod] = useTerminalArtifactState<EnvironmentMethod>("EnvironmentQuantPanel.method", "climate");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Climate transition risk ──
  const [scope1, setScope1] = useTerminalArtifactState("EnvironmentQuantPanel.scope1", "50000");
  const [scope2, setScope2] = useTerminalArtifactState("EnvironmentQuantPanel.scope2", "20000");
  const [scope3, setScope3] = useTerminalArtifactState("EnvironmentQuantPanel.scope3", "30000");
  const [ebitdaUsd, setEbitdaUsd] = useTerminalArtifactState("EnvironmentQuantPanel.ebitdaUsd", "50000000");
  const [carbonPrice, setCarbonPrice] = useTerminalArtifactState("EnvironmentQuantPanel.carbonPrice", "100");

  // ── Carbon credit MRV ──
  const [grossOffset, setGrossOffset] = useTerminalArtifactState("EnvironmentQuantPanel.grossOffset", "100000");
  const [permanenceRisk, setPermanenceRisk] = useTerminalArtifactState("EnvironmentQuantPanel.permanenceRisk", "10");
  const [additionality, setAdditionality] = useTerminalArtifactState("EnvironmentQuantPanel.additionality", "0.9");
  const [marketPrice, setMarketPrice] = useTerminalArtifactState("EnvironmentQuantPanel.marketPrice", "25");

  // ── Dark advanced climate routes (financed emissions / climate VaR / abatement curve / transition pathway) ──
  const [advancedSourceMode, setAdvancedSourceMode] = useTerminalArtifactState<InputSourceMode>("EnvironmentQuantPanel.advancedSourceMode", "manual");
  const [advancedInputs, setAdvancedInputs] = useTerminalArtifactState<Record<AdvancedClimateMethod, string>>("EnvironmentQuantPanel.advancedInputs", {
    "financed-emissions": JSON.stringify(ADVANCED_CLIMATE_EXAMPLES["financed-emissions"], null, 2),
    "climate-var": JSON.stringify(ADVANCED_CLIMATE_EXAMPLES["climate-var"], null, 2),
    "abatement-curve": JSON.stringify(ADVANCED_CLIMATE_EXAMPLES["abatement-curve"], null, 2),
    "transition-pathway": JSON.stringify(ADVANCED_CLIMATE_EXAMPLES["transition-pathway"], null, 2),
  });

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      let path = "", body: unknown;
      if (method === "climate") {
        path = "/api/quant/environment/climate-transition-risk";
        body = {
          scope1EmissionsTons: Number(scope1), scope2EmissionsTons: Number(scope2), scope3EmissionsTons: Number(scope3),
          ebitdaUsd: Number(ebitdaUsd), carbonPricePerTon: Number(carbonPrice),
        };
      } else if (method === "carbon") {
        path = "/api/quant/environment/carbon-credit-mrv";
        body = {
          grossOffsetTons: Number(grossOffset), permanenceRiskPct: Number(permanenceRisk),
          additionalityScore: Number(additionality), marketPricePerTon: Number(marketPrice),
        };
      } else {
        const parsed: unknown = JSON.parse(advancedInputs[method]);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Model input must be a JSON object.");
        const parameters = parsed as Record<string, unknown>;
        const advancedRes = await apiRequest("POST", `/api/quant/advanced/climate/${method}`, {
          ...parameters, inputProvenance: advancedInputProvenance(parameters, advancedSourceMode),
        });
        setResult(await advancedRes.json());
        return;
      }
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Environment engine unavailable right now.");
      }
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Environment engine unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4">
      <div className="flex items-center gap-2 mb-4">
        <Leaf className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[11px] tracking-widest text-foreground">SUSTAINABILITY ENGINE — CLIMATE TRANSITION RISK / CARBON CREDIT VALUATION</span>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={method} onChange={(e) => { setMethod(e.target.value as EnvironmentMethod); setResult(null); setError(null); }} className={inputCls}>
            {ENVIRONMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button onClick={run} disabled={loading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
            {loading ? "RUNNING..." : "RUN"}
          </button>
        </div>

        <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">
          PER-COMPANY TOOL — ENTER A REAL CLIENT COMPANY'S OWN FIGURES (NO LIVE PER-COMPANY EMISSIONS/EBITDA FEED EXISTS; AGGREGATE FRED/WORLD BANK SERIES ELSEWHERE IN THIS DOMAIN DON'T SUPPLY COMPANY-LEVEL DATA)
        </div>

        {method === "climate" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SCOPE 1 EMISSIONS (TONS CO₂e)</span><input value={scope1} onChange={(e) => setScope1(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SCOPE 2 EMISSIONS (TONS CO₂e)</span><input value={scope2} onChange={(e) => setScope2(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SCOPE 3 EMISSIONS (TONS CO₂e)</span><input value={scope3} onChange={(e) => setScope3(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">EBITDA (USD)</span><input value={ebitdaUsd} onChange={(e) => setEbitdaUsd(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CARBON PRICE ($/TON)</span><input value={carbonPrice} onChange={(e) => setCarbonPrice(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          </div>
        )}

        {method === "carbon" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">GROSS OFFSET (TONS)</span><input value={grossOffset} onChange={(e) => setGrossOffset(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">PERMANENCE RISK %</span><input value={permanenceRisk} onChange={(e) => setPermanenceRisk(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">ADDITIONALITY SCORE (0-1)</span><input value={additionality} onChange={(e) => setAdditionality(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MARKET PRICE ($/TON)</span><input value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          </div>
        )}

        {isAdvancedClimateMethod(method) && (() => {
          const activeMethod = method;
          return (
            <div className="space-y-3">
              <InputSourceSelector value={advancedSourceMode} onChange={setAdvancedSourceMode} domain="advanced climate model" />
              <ModelInputEditor
                value={advancedInputs[activeMethod]}
                onChange={(action) => setAdvancedInputs((prev) => ({
                  ...prev,
                  [activeMethod]: typeof action === "function" ? (action as (v: string) => string)(prev[activeMethod]) : action,
                }))}
                example={JSON.stringify(ADVANCED_CLIMATE_EXAMPLES[activeMethod])}
                schema={ADVANCED_CLIMATE_SCHEMAS[activeMethod]}
              />
            </div>
          );
        })()}

        {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}

        {result != null && method === "climate" && (() => {
          const r = result as { totalEmissionsTonsCo2e: number; carbonIntensityTonsPerMillionUsdEbitda: number; grossCarbonCostUsd: number; ebitdaImpactPct: number; transitionRiskRating: string };
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {statCard("TOTAL EMISSIONS (TONS CO₂e)", fmt(r.totalEmissionsTonsCo2e, 0))}
                {statCard("CARBON INTENSITY (TONS/$M EBITDA)", fmt(r.carbonIntensityTonsPerMillionUsdEbitda, 1))}
                {statCard("GROSS CARBON COST", `$${fmt(r.grossCarbonCostUsd, 0)}`)}
                {statCard("EBITDA IMPACT", `${fmt(r.ebitdaImpactPct, 2)}%`)}
              </div>
              <div className="font-terminal text-[9px] text-foreground">
                Transition risk rating: <span className={r.transitionRiskRating === "HIGH_EXPOSURE" ? "text-red-400" : "text-[hsl(142,71%,55%)]"}>{r.transitionRiskRating.replace(/_/g, " ")}</span>
                {r.transitionRiskRating === "HIGH_EXPOSURE" ? " — carbon costs exceed 5% of EBITDA at this carbon price." : " — carbon costs are under 5% of EBITDA at this carbon price."}
              </div>
            </>
          );
        })()}

        {result != null && method === "carbon" && (() => {
          const r = result as { verifiedNetCreditsTons: number; totalCreditPortfolioValueUsd: number; creditQualityRating: string };
          return (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {statCard("VERIFIED NET CREDITS (TONS)", fmt(r.verifiedNetCreditsTons, 0))}
                {statCard("PORTFOLIO VALUE", `$${fmt(r.totalCreditPortfolioValueUsd, 0)}`)}
              </div>
              <div className="font-terminal text-[9px] text-foreground">
                Credit quality rating: <span className={r.creditQualityRating === "HIGH_INTEGRITY_ADDITIONAL" ? "text-[hsl(142,71%,55%)]" : "text-[hsl(38,95%,55%)]"}>{r.creditQualityRating.replace(/_/g, " ")}</span>
              </div>
            </>
          );
        })()}

        {result != null && isAdvancedClimateMethod(method) && (() => {
          const { receipt, ...rest } = result as Record<string, unknown> & { receipt?: AdvancedReceipt };
          return (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap border border-border p-2.5 font-mono text-[8px] leading-relaxed text-muted-foreground">{JSON.stringify(rest, null, 2)}</pre>
              <ProvenanceReceipt receipt={receipt} />
            </>
          );
        })()}
      </div>
    </div>
  );
}
