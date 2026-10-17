import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, BadgeCheck, Calculator, Check, ChevronRight, FileCheck2,
  GitBranch, History, Layers, Network, PieChart, Plus, RefreshCw, Save, Scale, ShieldAlert, TrendingUp, X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ConceptExplainer } from "./ConceptExplainer";
import { calculateClientScenarioActions } from "@/lib/scenarioActionClient";
import type { ScenarioActionInput, ScenarioActionResult } from "../../../../server/scenarioActionEngine";
import type { ScenarioPipelineResult } from "../../../../server/scenarioPipeline";
import { StructuredJsonEditor, type JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";
import { takePendingDecisionReview, subscribeDecisionReview } from "@/lib/decisionReviewNavigation";

type View = "receipt" | "challenge" | "monitoring" | "history";
type DecisionCase = {
  id: number; title: string; question: string; decisionType: string; materiality: "routine" | "material" | "critical";
  status: string; symbol: string | null; investigationId: number | null; brainRunId: number | null;
  finalDecision: string | null; decisionRationale: string | null; updatedAt: string; approvedReceiptVersionId: number | null;
};
type Receipt = {
  id: number; version: number; snapshotHash: string; recommendation: string; interpretation: string;
  confidence: { score?: number; label?: string; components?: Record<string, number>; caveat?: string };
  completeness: { complete?: boolean; missing?: string[] }; evidence: Array<{ id?: number; title?: string; supports?: string }>;
  assumptions: Array<Record<string, unknown>>; models: Array<Record<string, unknown>>; scenarios: Array<Record<string, unknown>>;
  calculations: Array<Record<string, unknown>>; alternatives: Array<Record<string, unknown>>; counterarguments: Array<Record<string, unknown>>;
  contradictions: Array<Record<string, unknown>>; monitoringTriggers: Array<Record<string, unknown>>; requiredEvidenceCount: number;
  sources?: Array<{ evidenceId?: number; title?: string; sourceName?: string; provider?: string; sourceUrl?: string; contentFingerprint?: string }>;
  provenance?: Array<{ taskId?: number; taskKey?: string; status?: string; deterministicRefs?: string[]; provenance?: unknown }>;
  scenarioActionArtifact?: { candidateHash: string; candidateStatus: "candidate"; recommendedAction: string | null; modelVersion: string; modelHash: string };
  createdAt: string;
};
type Approval = { id: number; outcome: string; receiptVersionId: number; snapshotHash: string; waiverReason: string | null; createdAt: string };
type Monitor = { id: number; name: string; indicator: string; operator: string; threshold: number; unit: string; action: string; status: string; currentValue: number | null; lastEvaluatedAt: string | null };
type Replay = { id: number; receiptVersionId: number; changed: boolean; replaySnapshotHash: string; asOf: string; result: { reproducible?: boolean; message?: string }; createdAt: string };
type Detail = { decision: DecisionCase; receipts: Receipt[]; approvals: Approval[]; monitoringRules: Monitor[]; replays: Replay[]; policyDigest: string; permissions: { read_decisions: boolean; author_decisions: boolean; review_decisions: boolean }; reviewDeniedReason: string | null };
type Investigation = { id: number; title: string; question: string; primarySymbol: string | null; organizationId: number | null };
type FinancialSnapshotRef = { id: string; contentHash: string; dataClass?: string; entityKey?: string; availableAt?: string; capturedAt?: string };
type FactorSnapshotListItem = { snapshotId: string; contentHash: string; request: { symbols: string[]; benchmarkSymbol: string; range: string; asOf: string }; capturedAt: string; expiresAt: number; organizationScope: string; included: string[]; excluded: Array<{ securityId: string; reason: string }>; periodCount: number };
type FactorSnapshotRef = { snapshotId: string; contentHash: string; request?: { symbols?: string[]; asOf?: string }; capturedAt?: string; securities?: Array<{ securityId: string }> };
type BrainRun = { id: number; title: string; question: string; status: string; investigationId: number | null };

const inputClass = "h-8 w-full border border-border bg-black px-2 font-mono text-[9px] outline-none focus:border-amber-400/60";
const areaClass = "w-full border border-border bg-black px-2 py-2 font-mono text-[9px] leading-relaxed outline-none focus:border-amber-400/60 resize-y";

const SCENARIO_STATUS_OPTIONS = ["manual", "source", "provider", "private"] as const;
const SCENARIO_ACTION_TYPE_OPTIONS = ["hold", "reduce", "increase", "hedge", "defer"] as const;

const SCENARIO_ASSET_IMPACT_ITEM_FIELDS: JsonFieldSchema[] = [
  { kind: "string", key: "assetId", label: "Asset ID" },
  { kind: "string", key: "node", label: "Node", optional: true, help: "Optional link to a scenario graph node." },
  { kind: "number", key: "scenarioImpact", label: "Scenario Impact", step: 0.0001, optional: true, help: "Return/impact for one unit of portfolio weight." },
  { kind: "number", key: "impact", label: "Impact (alias)", step: 0.0001, optional: true, help: "Alias accepted for scenarioImpact." },
  { kind: "number", key: "riskImpact", label: "Risk Impact", step: 0.0001, optional: true, help: "Defaults to |scenarioImpact| when omitted." },
  { kind: "number", key: "risk", label: "Risk (alias)", step: 0.0001, optional: true, help: "Alias accepted for riskImpact." },
  { kind: "number", key: "liquidity", label: "Liquidity", step: 0.01, optional: true },
  { kind: "select", key: "status", label: "Status", options: SCENARIO_STATUS_OPTIONS, default: "manual" },
  { kind: "string", key: "source", label: "Source", optional: true },
  { kind: "string", key: "provider", label: "Provider", optional: true },
  { kind: "string", key: "asOf", label: "As Of", optional: true, help: "ISO date." },
  { kind: "string", key: "period", label: "Period", optional: true },
  { kind: "string", key: "unit", label: "Unit", optional: true },
];
const SCENARIO_ASSET_IMPACTS_SCHEMA: JsonFieldSchema[] = [
  { kind: "objectArray", key: "assetImpacts", label: "ASSET IMPACT OBSERVATIONS", itemFields: SCENARIO_ASSET_IMPACT_ITEM_FIELDS, default: [] },
];

const SCENARIO_EXPOSURE_ITEM_FIELDS: JsonFieldSchema[] = [
  { kind: "string", key: "assetId", label: "Asset ID" },
  { kind: "number", key: "weight", label: "Weight", step: 0.0001, optional: true },
  { kind: "number", key: "exposure", label: "Exposure", step: 0.0001, optional: true },
];
const SCENARIO_EXPOSURES_SCHEMA: JsonFieldSchema[] = [
  { kind: "objectArray", key: "exposures", label: "CURRENT EXPOSURE / WEIGHT", itemFields: SCENARIO_EXPOSURE_ITEM_FIELDS, default: [] },
];

const SCENARIO_ACTION_ALTERNATIVE_ITEM_FIELDS: JsonFieldSchema[] = [
  { kind: "select", key: "type", label: "Type", options: SCENARIO_ACTION_TYPE_OPTIONS, default: "hold" },
  { kind: "string", key: "label", label: "Label", optional: true },
  { kind: "string", key: "assetId", label: "Asset ID", optional: true, help: "Omit to apply to all assets." },
  { kind: "number", key: "targetWeight", label: "Target Weight", step: 0.0001, optional: true },
  { kind: "number", key: "weightDelta", label: "Weight Delta", step: 0.0001, optional: true },
  { kind: "number", key: "cost", label: "Cost", step: 0.0001, optional: true, help: "Action-specific cost in expected-impact units." },
  { kind: "number", key: "hedgeRatio", label: "Hedge Ratio", step: 0.0001, optional: true, help: "Multiplier used by hedge actions." },
];
const SCENARIO_ACTION_ALTERNATIVES_SCHEMA: JsonFieldSchema[] = [
  { kind: "objectArray", key: "actionAlternatives", label: "ACTION ALTERNATIVES", itemFields: SCENARIO_ACTION_ALTERNATIVE_ITEM_FIELDS,
    default: [{ type: "hold" }, { type: "reduce" }, { type: "increase" }, { type: "hedge" }, { type: "defer" }] },
];

const SCENARIO_ACTION_CONSTRAINTS_SCHEMA: JsonFieldSchema[] = [
  { kind: "number", key: "maxWeight", label: "Max Weight", step: 0.01, default: 1, help: "Per-asset cap; use a flat cap here (per-asset maps are not supported by this form)." },
  { kind: "number", key: "minLiquidity", label: "Min Liquidity", step: 0.01, default: 0 },
  { kind: "number", key: "maxTurnover", label: "Max Turnover", step: 0.01, default: 1 },
  { kind: "number", key: "riskBudget", label: "Risk Budget", step: 0.01, default: 1 },
];

const SCENARIO_ACTION_COSTS_SCHEMA: JsonFieldSchema[] = [
  { kind: "record", key: "costs", label: "ACTION COSTS", valueKind: "number", default: {}, help: "Keyed by action label or type; subtracted from expected impact." },
];

function parseLines(value: string, fields: string[]) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split("|").map((part) => part.trim());
    return Object.fromEntries(fields.map((field, index) => [field, ["uncertainty", "probability", "outcome", "output", "methodologyQuality", "sourceCoverage", "validationScore", "independence", "threshold"].includes(field) ? Number(parts[index]) : parts[index] ?? ""]));
  });
}
function formatLines(items: Array<Record<string, unknown>>, fields: string[]) {
  return items.map((item) => fields.map((field) => String(item[field] ?? "")).join(" | ")).join("\n");
}
function splitRows(value: string): string[][] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.split("|").map((part) => part.trim()));
}
function fmtDate(value: string) { return new Date(value).toLocaleDateString(); }
function statusTone(status: string) {
  if (["approved", "active", "acknowledged"].includes(status)) return "text-emerald-300 border-emerald-400/30";
  if (["rejected", "breached", "expired"].includes(status)) return "text-red-300 border-red-400/30";
  return "text-amber-300 border-amber-400/30";
}
function scenarioFactorPnl(trace: ScenarioPipelineResult["trace"]): number | null {
  const scenario = trace.factorRisk.decomposition.result.scenario;
  if (!scenario) return null;
  const weights = trace.action.input.currentWeights ?? {};
  return scenario.securities.reduce((sum, row) => sum + (weights[row.securityId] ?? 0) * row.factorPnl, 0);
}

export default function DecisionEnginePanel({ symbol, role, initialDecisionId }: { symbol: string; role: string; initialDecisionId?: number }) {
  const authorRole = role === "internal_admin" || role === "internal_analyst";
  const reviewerRole = role === "internal_admin" || role === "internal_compliance";
  const [selectedId, setSelectedId] = useState<number | null>(() => initialDecisionId ?? takePendingDecisionReview());
  const [view, setView] = useState<View>("receipt");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [materiality, setMateriality] = useState("material");
  const [investigationId, setInvestigationId] = useState("");
  const [brainRunId, setBrainRunId] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [interpretation, setInterpretation] = useState("");
  const [requiredEvidenceCount, setRequiredEvidenceCount] = useState("3");
  const [assumptions, setAssumptions] = useState("Revenue growth | 12% | 0.30 | Filed guidance and operating history | Guidance falls below 8%");
  const [models, setModels] = useState("DCF | v1 | 100 | 0.90 | 0.90 | 0.80 | 0.75\nComparable companies | v1 | 105 | 0.80 | 0.80 | 0.75 | 0.90");
  const [scenarios, setScenarios] = useState("Bear | 0.25 | 80 | Defer\nBase | 0.50 | 100 | Proceed\nBull | 0.25 | 120 | Proceed");
  const [alternatives, setAlternatives] = useState("Proceed now | Execute the recommendation |\nDefer | Wait for stronger evidence | Opportunity cost exceeds benefit");
  const [counterarguments, setCounterarguments] = useState("Demand may be cyclical rather than structural | Monitor order growth and guidance");
  const [contradictions, setContradictions] = useState("");
  const [calculations, setCalculations] = useState("Base valuation | 100 | valuation:model-v1 | v1");
  const [triggers, setTriggers] = useState("Guidance break | Revenue growth | lt | 8 | percent | Reopen decision and rerun downside case |");
  const [finalDecision, setFinalDecision] = useState("");
  const [rationale, setRationale] = useState("");
  const [waiverReason, setWaiverReason] = useState("");
  const [monitorValues, setMonitorValues] = useState<Record<number, string>>({});
  const [reverseDcf, setReverseDcf] = useState({ enterpriseValue: "1500", currentFreeCashFlow: "100", forecastYears: "5", discountRate: "0.10", terminalGrowthRate: "0.03" });
  const [analysis, setAnalysis] = useState<Record<string, any> | null>(null);
  const [reverseResult, setReverseResult] = useState<Record<string, any> | null>(null);
  const [boundaryPoints, setBoundaryPoints] = useState("8 | 80\n12 | 100\n16 | 120");
  const [boundaryThreshold, setBoundaryThreshold] = useState("90");
  const [quantConsensus, setQuantConsensus] = useState<Record<string, any> | null>(null);
  const [mcdaCriteria, setMcdaCriteria] = useState("Valuation upside | 0.4 | maximize\nExecution risk | 0.35 | minimize\nTime to breakeven | 0.25 | minimize");
  const [mcdaAlternatives, setMcdaAlternatives] = useState("Proceed now | 22 | 6 | 18\nDefer | 10 | 2 | 9");
  const [mcdaResult, setMcdaResult] = useState<Record<string, any> | null>(null);
  const [voiStates, setVoiStates] = useState("Bull | 0.5\nBear | 0.5");
  const [voiAlternatives, setVoiAlternatives] = useState("Proceed now | 120 | 80\nDefer | 100 | 100");
  const [voiResult, setVoiResult] = useState<Record<string, any> | null>(null);
  const [uncertaintyEstimate, setUncertaintyEstimate] = useState("100");
  const [uncertaintyConfidence, setUncertaintyConfidence] = useState("95");
  const [uncertaintyFactors, setUncertaintyFactors] = useState("Revenue growth | 8 | 1.2 | market\nDiscount rate | 0.5 | -6 | model\nData completeness | 3 | 0.8 | data");
  const [uncertaintyResult, setUncertaintyResult] = useState<Record<string, any> | null>(null);
  const [scenarioNodes, setScenarioNodes] = useState("Revenue growth | 12 | market\nMargin | 20 | company\nValuation | 100 | company");
  const [scenarioEdges, setScenarioEdges] = useState("Revenue growth | Margin | 0.3 | elasticity |\nMargin | Valuation | 2 | elasticity |");
  const [scenarioShocks, setScenarioShocks] = useState("Revenue growth | -4");
  const [scenarioAssetImpacts, setScenarioAssetImpacts] = useState<Record<string, unknown>>({ assetImpacts: [] });
  const [scenarioExposures, setScenarioExposures] = useState<Record<string, unknown>>({ exposures: [] });
  const [scenarioActionAlternatives, setScenarioActionAlternatives] = useState<Record<string, unknown>>({
    actionAlternatives: [{ type: "hold" }, { type: "reduce" }, { type: "increase" }, { type: "hedge" }, { type: "defer" }],
  });
  const [scenarioActionConstraints, setScenarioActionConstraints] = useState<Record<string, unknown>>({ maxWeight: 1, minLiquidity: 0, maxTurnover: 1, riskBudget: 1 });
  const [scenarioActionCosts, setScenarioActionCosts] = useState<Record<string, unknown>>({ costs: {} });
  const [scenarioActionResult, setScenarioActionResult] = useState<ScenarioActionResult | null>(null);
  const [scenarioActionError, setScenarioActionError] = useState("");
  const [scenarioResult, setScenarioResult] = useState<Record<string, any> | null>(null);
  const [pipelineScenarioId, setPipelineScenarioId] = useState("");
  const [pipelineScenarioName, setPipelineScenarioName] = useState("");
  const [financialDatasetSnapshotId, setFinancialDatasetSnapshotId] = useState("");
  const [factorRiskSnapshotId, setFactorRiskSnapshotId] = useState("");
  const [pipelineProjectionYears, setPipelineProjectionYears] = useState("5");
  const [pipelineRevenueGrowth, setPipelineRevenueGrowth] = useState("0.12");
  const [pipelineDiscountRate, setPipelineDiscountRate] = useState("0.10");
  const [pipelineTerminalGrowth, setPipelineTerminalGrowth] = useState("0.03");
  const [pipelineNetDebt, setPipelineNetDebt] = useState("");
  const [pipelineSharesOutstanding, setPipelineSharesOutstanding] = useState("");
  const [scenarioPipelinePreview, setScenarioPipelinePreview] = useState<ScenarioPipelineResult | null>(null);
  const [scenarioPipelineError, setScenarioPipelineError] = useState("");
  const [scenarioPipelineAttached, setScenarioPipelineAttached] = useState(false);

  const { data: cases = [], isLoading } = useQuery<DecisionCase[]>({ queryKey: ["/api/decisions"] });
  const { data: investigations = [] } = useQuery<Investigation[]>({ queryKey: ["/api/research/investigations"] });
  const { data: brainRuns = [] } = useQuery<BrainRun[]>({ queryKey: ["/api/brain/runs"] });
  const detailPath = selectedId ? `/api/decisions/${selectedId}` : "";
  const { data: fetchedDetail, error: detailError, isFetching: detailFetching, refetch: refetchDetail } = useQuery<Detail>({ queryKey: [detailPath], enabled: Boolean(selectedId), retry: false });
  const detail = !detailError && !detailFetching && fetchedDetail?.decision.id === selectedId ? fetchedDetail : undefined;
  const canAuthor = authorRole && (!selectedId || detail?.permissions.author_decisions === true);
  const canReview = reviewerRole && detail?.permissions.review_decisions === true;
  useEffect(() => subscribeDecisionReview(id => { setSelectedId(id); setView("receipt"); setShowCreate(false); setMessage(""); }), []);
  const financialAsOf = useMemo(() => new Date().toISOString(), [symbol]);
  const { data: financialSnapshot } = useQuery<FinancialSnapshotRef>({
    queryKey: ["/api/data-snapshots/financials/as-of", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/data-snapshots/financials/${encodeURIComponent(symbol)}/as-of?asOf=${encodeURIComponent(financialAsOf)}`)).json() as Promise<FinancialSnapshotRef>,
    enabled: Boolean(symbol),
    retry: false,
    staleTime: 60_000,
  });
  const { data: factorSnapshots = [] } = useQuery<FactorSnapshotListItem[]>({
    queryKey: ["/api/factor-risk/snapshots", "list", symbol],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/factor-risk/snapshots?symbol=${encodeURIComponent(symbol)}&limit=100`);
      const body = await response.json() as { items?: FactorSnapshotListItem[] };
      return body.items ?? [];
    },
    enabled: Boolean(symbol),
    retry: false,
    staleTime: 60_000,
  });
  const { data: factorSnapshot, error: factorSnapshotError } = useQuery<FactorSnapshotRef>({
    queryKey: ["/api/factor-risk/snapshots", factorRiskSnapshotId],
    queryFn: async () => (await apiRequest("GET", `/api/factor-risk/snapshots/${encodeURIComponent(factorRiskSnapshotId)}`)).json() as Promise<FactorSnapshotRef>,
    enabled: Boolean(factorRiskSnapshotId.trim()),
    retry: false,
    staleTime: 60_000,
  });
  const { data: financialSnapshots = [] } = useQuery<FinancialSnapshotRef[]>({
    queryKey: ["/api/data-snapshots", "financials", symbol],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/data-snapshots?entityKey=${encodeURIComponent(symbol)}&limit=100`);
      const rows = await response.json() as FinancialSnapshotRef[];
      return Array.isArray(rows) ? rows.filter((row) => row.dataClass === "financial_statements") : [];
    },
    enabled: Boolean(symbol),
    retry: false,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (financialSnapshot?.id && !financialDatasetSnapshotId) setFinancialDatasetSnapshotId(financialSnapshot.id);
  }, [financialSnapshot?.id, financialDatasetSnapshotId]);
  const latest = detail?.receipts[0];

  useEffect(() => { if (!selectedId && cases.length) setSelectedId(cases[0].id); }, [cases, selectedId]);
  useEffect(() => {
    if (symbol && !title) setTitle(`${symbol.toUpperCase()} decision`);
  }, [symbol, title]);
  useEffect(() => {
    if (!latest) return;
    setRecommendation(latest.recommendation);
    setInterpretation(latest.interpretation);
    setRequiredEvidenceCount(String(latest.requiredEvidenceCount));
    setAssumptions(formatLines(latest.assumptions, ["label", "value", "uncertainty", "basis", "invalidationCondition"]));
    setModels(formatLines(latest.models, ["name", "version", "output", "methodologyQuality", "sourceCoverage", "validationScore", "independence"]));
    setScenarios(formatLines(latest.scenarios, ["name", "probability", "outcome", "decision"]));
    setAlternatives(formatLines(latest.alternatives, ["name", "description", "rejectedReason"]));
    setCounterarguments(formatLines(latest.counterarguments, ["argument", "response"]));
    setContradictions(formatLines(latest.contradictions, ["description", "resolved", "resolution"]));
    setCalculations(formatLines(latest.calculations, ["name", "value", "deterministicRef", "modelVersion"]));
    setTriggers(formatLines(latest.monitoringTriggers, ["name", "indicator", "operator", "threshold", "unit", "action", "sourceUrl"]));
  }, [latest?.id]);
  useEffect(() => {
    setScenarioPipelinePreview(null);
    setScenarioPipelineError("");
    setScenarioPipelineAttached(false);
  }, [pipelineScenarioId, financialDatasetSnapshotId, factorRiskSnapshotId, selectedId]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/decisions"] });
    if (selectedId) await queryClient.invalidateQueries({ queryKey: [detailPath] });
  };
  const parsed = useMemo(() => ({
    assumptions: parseLines(assumptions, ["label", "value", "uncertainty", "basis", "invalidationCondition"]),
    models: parseLines(models, ["name", "version", "output", "methodologyQuality", "sourceCoverage", "validationScore", "independence"]),
    scenarios: parseLines(scenarios, ["name", "probability", "outcome", "decision"]),
    alternatives: parseLines(alternatives, ["name", "description", "rejectedReason"]),
    counterarguments: parseLines(counterarguments, ["argument", "response"]),
    contradictions: parseLines(contradictions, ["description", "resolved", "resolution"]).map((item) => ({ ...item, resolved: String(item.resolved).toLowerCase() === "true" })),
    calculations: parseLines(calculations, ["name", "value", "deterministicRef", "modelVersion"]),
    monitoringTriggers: parseLines(triggers, ["name", "indicator", "operator", "threshold", "unit", "action", "sourceUrl"]).map((item) => ({ ...item, sourceUrl: item.sourceUrl || undefined })),
  }), [assumptions, models, scenarios, alternatives, counterarguments, contradictions, calculations, triggers]);
  const boundary = useMemo(() => {
    const points = splitRows(boundaryPoints).map(([assumptionValue, outcome]) => ({ assumptionValue: Number(assumptionValue), outcome: Number(outcome) })).filter((point) => Number.isFinite(point.assumptionValue) && Number.isFinite(point.outcome));
    const threshold = Number(boundaryThreshold);
    return points.length >= 2 && Number.isFinite(threshold) ? { points, threshold } : null;
  }, [boundaryPoints, boundaryThreshold]);
  const mcdaParsed = useMemo(() => {
    const criteria = splitRows(mcdaCriteria).map(([name, weight, direction]) => ({ name, weight: Number(weight), direction: (direction.trim().toLowerCase() === "minimize" ? "minimize" : "maximize") as "maximize" | "minimize" }));
    const alternatives = splitRows(mcdaAlternatives).map(([name, ...values]) => ({ name, values: Object.fromEntries(criteria.map((criterion, index) => [criterion.name, Number(values[index])])) }));
    return { criteria, alternatives };
  }, [mcdaCriteria, mcdaAlternatives]);
  const voiParsed = useMemo(() => {
    const states = splitRows(voiStates).map(([name, probability]) => ({ name, probability: Number(probability) }));
    const alternatives = splitRows(voiAlternatives).map(([name, ...payoffs]) => ({ name, payoffs: payoffs.map(Number) }));
    return { stateNames: states.map((state) => state.name), stateProbabilities: states.map((state) => state.probability), alternatives };
  }, [voiStates, voiAlternatives]);
  const uncertaintyParsed = useMemo(() => ({
    centralEstimate: Number(uncertaintyEstimate),
    confidencePct: Number(uncertaintyConfidence),
    factors: splitRows(uncertaintyFactors).map(([name, standardDeviation, sensitivity, category]) => ({
      name, standardDeviation: Number(standardDeviation), sensitivity: Number(sensitivity),
      category: (["data", "model", "market", "scenario", "parameter"].includes(category) ? category : "parameter") as "data" | "model" | "market" | "scenario" | "parameter",
    })),
  }), [uncertaintyEstimate, uncertaintyConfidence, uncertaintyFactors]);
  const scenarioParsed = useMemo(() => ({
    nodes: splitRows(scenarioNodes).map(([name, baseline, domain]) => ({ name, baseline: Number(baseline), domain: domain || "general" })),
    edges: splitRows(scenarioEdges).map(([source, target, coefficient, mode, label]) => ({
      source, target, coefficient: Number(coefficient),
      mode: (["absolute", "elasticity", "percent_to_absolute"].includes(mode) ? mode : "absolute") as "absolute" | "elasticity" | "percent_to_absolute",
      label: label || undefined,
    })),
    shocks: splitRows(scenarioShocks).map(([node, change]) => ({ node, change: Number(change) })),
  }), [scenarioNodes, scenarioEdges, scenarioShocks]);
  const scenarioActionPayload = useMemo<{ input: ScenarioActionInput | null; error: string }>(() => {
    const assetImpacts = (scenarioAssetImpacts.assetImpacts ?? []) as ScenarioActionInput["assetImpacts"];
    const exposures = (scenarioExposures.exposures ?? []) as ScenarioActionInput["exposures"];
    const actionAlternatives = (scenarioActionAlternatives.actionAlternatives ?? []) as ScenarioActionInput["actionAlternatives"];
    const constraints = scenarioActionConstraints as ScenarioActionInput["constraints"];
    const costs = (scenarioActionCosts.costs ?? {}) as Record<string, number>;
    const graphTotalChanges = scenarioResult?.totalChanges && typeof scenarioResult.totalChanges === "object"
      ? scenarioResult.totalChanges as Record<string, number>
      : undefined;
    const nodeImpacts = graphTotalChanges ?? Object.fromEntries(
      scenarioParsed.shocks.filter((shock) => Number.isFinite(shock.change)).map((shock) => [shock.node, shock.change]),
    );
    return {
      input: { nodeImpacts, assetImpacts, exposures, actionAlternatives, constraints, costs, source: { status: "manual" } },
      error: "",
    };
  }, [scenarioAssetImpacts, scenarioExposures, scenarioActionAlternatives, scenarioActionConstraints, scenarioActionCosts, scenarioParsed.shocks, scenarioResult]);
  const scenarioPipelineInputs = useMemo<{ payload: Record<string, unknown> | null; error: string; portfolioCount: number }>(() => {
    const scenarioId = pipelineScenarioId.trim();
    const scenarioName = pipelineScenarioName.trim();
    const datasetId = financialDatasetSnapshotId.trim();
    const factorId = factorRiskSnapshotId.trim();
    if (!scenarioId || !scenarioName) return { payload: null, error: "Enter a scenario ID and scenario name; the pipeline never invents scenario identity.", portfolioCount: 0 };
    if (!datasetId) return { payload: null, error: "A financial dataset snapshot ID is required. Capture or select a point-in-time financial snapshot before running.", portfolioCount: 0 };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(datasetId)) return { payload: null, error: "Financial dataset snapshot ID must be a UUID.", portfolioCount: 0 };
    if (!factorId) return { payload: null, error: "A factor-risk snapshot ID is required. Capture a factor-risk snapshot before running; no factor evidence is fabricated.", portfolioCount: 0 };
    const projectionYears = Number(pipelineProjectionYears);
    const revenueGrowth = Number(pipelineRevenueGrowth);
    const discountRate = Number(pipelineDiscountRate);
    const terminalGrowth = Number(pipelineTerminalGrowth);
    const netDebt = Number(pipelineNetDebt);
    const sharesOutstanding = Number(pipelineSharesOutstanding);
    if (!Number.isInteger(projectionYears) || projectionYears < 1 || projectionYears > 10 || !Number.isFinite(revenueGrowth) || revenueGrowth < -0.9 || revenueGrowth > 5) return { payload: null, error: "Scenario overrides require projection years 1-10 and revenue growth from -0.9 to 5.", portfolioCount: 0 };
    if (![discountRate, terminalGrowth, netDebt, sharesOutstanding].every(Number.isFinite) || sharesOutstanding <= 0 || discountRate <= terminalGrowth) return { payload: null, error: "Valuation requires finite discount rate, terminal growth, net debt, positive shares outstanding, and discount rate greater than terminal growth.", portfolioCount: 0 };

    const rows = Array.isArray(scenarioExposures.exposures) ? scenarioExposures.exposures : [];
    const portfolioWeights: Record<string, number> = {};
    for (const row of rows) {
      if (!row || typeof row !== "object") return { payload: null, error: "Portfolio exposure rows must contain an asset ID and a finite weight.", portfolioCount: 0 };
      const entry = row as Record<string, unknown>;
      const assetId = typeof entry.assetId === "string" ? entry.assetId : "";
      const weight = entry.weight ?? entry.exposure;
      const numericWeight = typeof weight === "number" ? weight : Number.NaN;
      if (!assetId.trim() || !Number.isFinite(numericWeight)) return { payload: null, error: "Portfolio exposure rows must contain an asset ID and a finite weight; no unknown asset is normalized.", portfolioCount: 0 };
      if (Object.prototype.hasOwnProperty.call(portfolioWeights, assetId)) return { payload: null, error: `Portfolio asset ${assetId} appears more than once; preserve one exact weight per asset.`, portfolioCount: 0 };
      portfolioWeights[assetId] = weight as number;
    }
    if (!Object.keys(portfolioWeights).length) return { payload: null, error: "Add exact portfolio weights in CURRENT EXPOSURE / WEIGHT before running; the pipeline has no hidden default portfolio.", portfolioCount: 0 };

    const factorShocks: Record<string, number> = {};
    for (const shock of scenarioParsed.shocks) {
      if (!shock.node || !Number.isFinite(shock.change)) return { payload: null, error: "Factor shocks require a non-empty factor ID and finite shock value.", portfolioCount: Object.keys(portfolioWeights).length };
      if (Object.prototype.hasOwnProperty.call(factorShocks, shock.node)) return { payload: null, error: `Factor ${shock.node} appears more than once; enter one exact shock per factor.`, portfolioCount: Object.keys(portfolioWeights).length };
      factorShocks[shock.node] = shock.change;
    }
    if (!Object.keys(factorShocks).length) return { payload: null, error: "Add at least one factor shock in the existing scenario SHOCKS input.", portfolioCount: Object.keys(portfolioWeights).length };
    return {
      payload: {
        scenarioId, scenarioName, financialDatasetSnapshotId: datasetId,
        scenarioAssumptions: { projectionYears, revenueGrowth },
        valuation: { discountRate, terminalGrowth, netDebt, sharesOutstanding },
        factorRiskSnapshotId: factorId, portfolioWeights, factorShocks,
        actionAlternatives: scenarioActionAlternatives.actionAlternatives,
        constraints: scenarioActionConstraints, costs: scenarioActionCosts.costs,
        source: { status: "manual", source: "Decision Engine terminal scenario pipeline input" },
      },
      error: "",
      portfolioCount: Object.keys(portfolioWeights).length,
    };
  }, [pipelineScenarioId, pipelineScenarioName, financialDatasetSnapshotId, factorRiskSnapshotId, pipelineProjectionYears, pipelineRevenueGrowth, pipelineDiscountRate, pipelineTerminalGrowth, pipelineNetDebt, pipelineSharesOutstanding, scenarioExposures, scenarioParsed.shocks, scenarioActionAlternatives.actionAlternatives, scenarioActionConstraints, scenarioActionCosts.costs]);
  const runScenarioPipelinePreview = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiRequest("POST", "/api/scenario-pipeline/preview", payload)).json() as Promise<ScenarioPipelineResult>,
    onSuccess: (result: ScenarioPipelineResult) => {
      setScenarioPipelineError("");
      setScenarioPipelineAttached(false);
      setScenarioPipelinePreview(result);
    },
    onError: (error: Error) => {
      setScenarioPipelinePreview(null);
      setScenarioPipelineError(error.message);
    },
  });
  const validPipelineCalculation = Boolean(
    scenarioPipelinePreview?.receiptCalculation
      && scenarioPipelinePreview.receiptCalculation.name === "Scenario-to-action pipeline"
      && typeof scenarioPipelinePreview.receiptCalculation.deterministicRef === "string"
      && typeof scenarioPipelinePreview.receiptCalculation.modelVersion === "string"
      && Number.isFinite(scenarioPipelinePreview.receiptCalculation.value)
      && scenarioPipelinePreview.receiptCalculation.scenarioPipelineArtifact?.traceHash
      && scenarioPipelinePreview.receiptCalculation.scenarioPipelineArtifact.traceHash === scenarioPipelinePreview.trace.traceHash,
  );
  const attachScenarioPipeline = useMutation({
    mutationFn: async () => {
      if (!selectedId || !latest?.id || !scenarioPipelinePreview || !validPipelineCalculation) throw new Error("Run a valid pipeline preview with an existing decision receipt selected first.");
      return (await apiRequest("POST", `/api/decisions/${selectedId}/scenario-pipeline`, {
        receiptVersionId: latest.id,
        pipelineCalculation: scenarioPipelinePreview.receiptCalculation,
      })).json() as Promise<Receipt>;
    },
    onSuccess: async (receipt: Receipt) => {
      setScenarioPipelineAttached(true);
      setMessage(`Scenario pipeline attached to receipt v${receipt.version}; approval remains required.`);
      await refresh();
      await refetchDetail();
    },
    onError: (error: Error) => setScenarioPipelineError(error.message),
  });
  const pipelineStageStatus = scenarioPipelinePreview ? "COMPLETE" : scenarioPipelineInputs.payload ? "READY" : "BLOCKED";

  const createCase = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/decisions", {
      title, question, materiality, decisionType: "investment", symbol: symbol || null,
      investigationId: investigationId ? Number(investigationId) : null,
      brainRunId: brainRunId ? Number(brainRunId) : null,
    })).json(),
    onSuccess: async (created: DecisionCase) => { setSelectedId(created.id); setShowCreate(false); setTitle(""); setQuestion(""); setMessage("Decision case created."); await refresh(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const saveReceipt = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/decisions/${selectedId}/receipts`, {
      recommendation, interpretation, requiredEvidenceCount: Number(requiredEvidenceCount), evidenceAssessments: [], ...parsed,
    })).json(),
    onSuccess: async (receipt: Receipt) => { setMessage(`Receipt v${receipt.version} sealed with hash ${receipt.snapshotHash.slice(0, 12)}.`); await refresh(); await refetchDetail(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const review = useMutation({
    mutationFn: async (outcome: "approved" | "rejected" | "waived") => (await apiRequest("POST", `/api/decisions/${selectedId}/approval`, {
      receiptVersionId: latest?.id, policyDigest: detail?.policyDigest, outcome, finalDecision, rationale, waiverReason: outcome === "waived" ? waiverReason : undefined,
    })).json(),
    onSuccess: async () => { setMessage("Review decision recorded against the exact receipt hash."); await refresh(); await refetchDetail(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const replay = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/decisions/${selectedId}/replay`, { receiptVersionId: latest?.id, asOf: new Date().toISOString(), inputs: {} })).json(),
    onSuccess: async () => { setMessage("Historical receipt replayed."); await refetchDetail(); setView("history"); },
    onError: (error: Error) => setMessage(error.message),
  });
  const runAnalysis = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/decision-analysis", { evidence: latest?.evidence ?? [], assumptions: parsed.assumptions, models: parsed.models, scenarios: parsed.scenarios, contradictions: parsed.contradictions, boundary: boundary ?? undefined })).json(),
    onSuccess: setAnalysis,
    onError: (error: Error) => setMessage(error.message),
  });
  const runReverseDcf = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/decision-analysis/reverse-dcf", Object.fromEntries(Object.entries(reverseDcf).map(([key, value]) => [key, key === "forecastYears" ? Number.parseInt(value) : Number(value)])))).json(),
    onSuccess: setReverseResult,
    onError: (error: Error) => setMessage(error.message),
  });
  const runQuantConsensus = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/quant/advanced/decision/model-tournament", {
      candidates: parsed.models.map((entry: Record<string, unknown>) => ({
        name: entry.name,
        estimate: entry.output,
        assuranceScore: Math.max(1e-6, Math.min(100, Number(entry.methodologyQuality) * 100)),
        validationScore: Math.max(1e-6, Math.min(100, Number(entry.validationScore) * 100)),
        dataQualityScore: Math.max(1e-6, Math.min(100, Number(entry.sourceCoverage) * 100)),
        suitabilityScore: Math.max(1e-6, Math.min(100, Number(entry.independence) * 100)),
      })),
    })).json(),
    onSuccess: setQuantConsensus,
    onError: (error: Error) => setMessage(error.message),
  });
  const runMcda = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/quant/advanced/decision/mcda", mcdaParsed)).json(),
    onSuccess: setMcdaResult,
    onError: (error: Error) => setMessage(error.message),
  });
  const runVoi = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/quant/advanced/decision/value-of-information", voiParsed)).json(),
    onSuccess: setVoiResult,
    onError: (error: Error) => setMessage(error.message),
  });
  const runUncertainty = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/quant/advanced/decision/uncertainty", uncertaintyParsed)).json(),
    onSuccess: setUncertaintyResult,
    onError: (error: Error) => setMessage(error.message),
  });
  const runScenarioGraph = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/quant/advanced/decision/scenario-graph", scenarioParsed)).json(),
    onSuccess: setScenarioResult,
    onError: (error: Error) => setMessage(error.message),
  });
  const runScenarioActions = () => {
    if (!scenarioActionPayload.input) {
      setScenarioActionResult(null);
      setScenarioActionError(scenarioActionPayload.error);
      return;
    }
    setScenarioActionResult(calculateClientScenarioActions(scenarioActionPayload.input));
    setScenarioActionError("");
  };
  const saveScenarioDecision = useMutation({
    mutationFn: async () => {
      if (!selectedId || !latest?.id || !scenarioActionPayload.input) throw new Error(scenarioActionPayload.error || "Calculate scenario candidates first.");
      return (await apiRequest("POST", `/api/decisions/${selectedId}/scenario-actions`, {
        receiptVersionId: latest.id,
        scenarioInputs: scenarioActionPayload.input,
        modelVersion: "scenario-action-engine-v1",
      })).json() as Promise<Receipt>;
    },
    onSuccess: async (receipt: Receipt) => {
      setMessage(`Scenario candidates saved to receipt v${receipt.version}; candidate ${receipt.scenarioActionArtifact?.candidateHash?.slice(0, 12) ?? "hash"} remains approval-required.`);
      await refresh();
      await refetchDetail();
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const createScenarioMonitor = useMutation({
    mutationFn: async () => {
      if (!selectedId || !latest?.id || !latest.scenarioActionArtifact) throw new Error("Approve the scenario receipt before creating a monitor.");
      const action = latest.scenarioActionArtifact.recommendedAction ?? "review scenario action candidates";
      return (await apiRequest("POST", `/api/decisions/${selectedId}/scenario-actions/monitor`, {
        receiptVersionId: latest.id,
        trigger: {
          name: `Scenario action: ${action}`.slice(0, 160),
          indicator: "scenario_action_candidate",
          operator: "eq",
          threshold: 1,
          unit: "candidate",
          action: `Review approved scenario action candidate: ${action}`.slice(0, 1000),
        },
      })).json() as Promise<Monitor>;
    },
    onSuccess: async (monitor: Monitor) => {
      setMessage(`Monitor trigger ${monitor.name} created from the approved scenario receipt.`);
      await refetchDetail();
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const evaluateMonitor = async (monitor: Monitor) => {
    try {
      await apiRequest("PATCH", `/api/decision-monitors/${monitor.id}/evaluate`, { currentValue: Number(monitorValues[monitor.id]) });
      setMessage(`${monitor.name} evaluated.`); await refetchDetail();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Evaluation failed."); }
  };

  return <div className="h-full min-h-0 flex flex-col bg-[#050505]">
    <header className="shrink-0 border-b border-border px-4 py-3 flex flex-wrap items-center gap-3 bg-[#070707]">
      <Scale className="w-4 h-4 text-amber-300" />
      <div><div className="font-terminal text-[10px] tracking-widest">DECISION ENGINE</div><div className="font-terminal text-[7px] text-muted-foreground mt-0.5">CHALLENGE, VERSION, APPROVE, MONITOR, AND REPLAY</div></div>
      <button title="Refresh" onClick={refresh} className="ml-auto w-8 h-8 border border-border flex items-center justify-center text-muted-foreground hover:text-amber-300"><RefreshCw className="w-3.5 h-3.5" /></button>
      {canAuthor && <button title="New decision" onClick={() => setShowCreate(true)} className="h-8 px-3 border border-amber-400/40 text-amber-300 flex items-center gap-2 font-terminal text-[8px]"><Plus className="w-3.5 h-3.5" /> NEW CASE</button>}
    </header>
    {message && <button onClick={() => setMessage("")} className="shrink-0 px-4 py-2 text-left border-b border-border font-terminal text-[8px] text-amber-300">{message}</button>}
    {detailError && <div role="alert" className="border-b border-border p-4 text-sm text-amber-200">Canonical case {selectedId} unavailable: {detailError.message}. No other case is substituted. Current server role and organization grants control access.<button type="button" onClick={() => void refetchDetail()} className="ml-2 underline">Recheck server access</button></div>}
    {detailFetching && <p role="status" className="p-3 text-sm">Checking exact canonical case {selectedId}…</p>}
    {detail?.reviewDeniedReason && <p role="status" className="border-b border-border p-3 text-sm text-amber-200">{detail.reviewDeniedReason} Presentation preferences cannot grant review permission.</p>}

    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-h-0 border-b lg:border-b-0 lg:border-r border-border flex flex-col max-h-48 lg:max-h-none">
        <div className="shrink-0 px-3 py-2 border-b border-border font-terminal text-[7px] text-muted-foreground">DECISION QUEUE / {cases.length}</div>
        <div className="overflow-y-auto">
          {isLoading && <div className="p-4 font-terminal text-[8px] text-muted-foreground">Loading cases...</div>}
          {cases.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full text-left px-3 py-3 border-b border-border/70 ${selectedId === item.id ? "bg-amber-400/[0.06] border-l-2 border-l-amber-400" : "hover:bg-white/[0.02]"}`}>
            <div className="flex items-start gap-2"><span className="font-terminal text-[9px] flex-1 line-clamp-2">{item.title}</span><ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" /></div>
            <div className="mt-2 flex items-center gap-1.5"><span className={`px-1.5 py-0.5 border font-terminal text-[6px] uppercase ${statusTone(item.status)}`}>{item.status}</span><span className="font-mono text-[7px] text-muted-foreground uppercase">{item.materiality}</span></div>
          </button>)}
          {!isLoading && !cases.length && <div className="p-4 font-terminal text-[8px] text-muted-foreground">No decision cases yet.</div>}
        </div>
      </aside>

      <main className="min-h-0 flex flex-col overflow-hidden">
        {!detail ? <div className="p-8 max-w-lg space-y-4"><FileCheck2 className="w-6 h-6 text-muted-foreground/50" /><div className="mt-3 font-terminal text-[9px] text-muted-foreground">Select or create a decision case.</div><ConceptExplainer title="WHAT IS A DECISION CASE?"><p>A decision case is one question you need to answer -- buy, hold, defer, escalate -- documented with the evidence, models, scenarios, and counterarguments behind it.</p><p>Saving it produces a <strong>receipt</strong>: a versioned, hash-sealed snapshot of exactly what you knew and assumed at the time. If a decision goes wrong later, the receipt shows whether the process was sound, not just the outcome.</p></ConceptExplainer></div> : <>
          <section className="shrink-0 px-4 py-3 border-b border-border grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-3">
            <div><div className="flex flex-wrap gap-2 items-center"><h2 className="font-terminal text-[11px] text-amber-200">{detail.decision.title}</h2><span className={`px-1.5 py-0.5 border font-terminal text-[6px] uppercase ${statusTone(detail.decision.status)}`}>{detail.decision.status}</span></div><p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{detail.decision.question}</p></div>
            <div className="flex items-center gap-3 font-mono text-[7px] text-muted-foreground"><span>RECEIPTS {detail.receipts.length}</span><span>TRIGGERS {detail.monitoringRules.length}</span><span>REPLAYS {detail.replays.length}</span></div>
          </section>
          <nav className="h-10 shrink-0 px-2 border-b border-border flex items-stretch overflow-x-auto">
            {(["receipt", "challenge", "monitoring", "history"] as View[]).map((item) => <button key={item} onClick={() => setView(item)} className={`px-3 border-b-2 whitespace-nowrap font-terminal text-[8px] uppercase ${view === item ? "border-amber-400 text-amber-300" : "border-transparent text-muted-foreground"}`}>{item}</button>)}
          </nav>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {view === "receipt" && <div>
              {latest && <section className="px-4 py-3 border-b border-border grid grid-cols-1 xl:grid-cols-[180px_minmax(0,1fr)] gap-4 bg-[#080808]">
                <div><div className="font-terminal text-[7px] text-muted-foreground">LATEST RECEIPT</div><div className="font-mono text-2xl mt-1 text-amber-200">{latest.confidence.score ?? 0}</div><div className="font-terminal text-[7px] uppercase text-muted-foreground">confidence / {latest.confidence.label}</div></div>
                <div><div className="flex flex-wrap gap-2"><span className={`px-2 py-1 border font-terminal text-[7px] ${latest.completeness.complete ? "text-emerald-300 border-emerald-400/30" : "text-red-300 border-red-400/30"}`}>{latest.completeness.complete ? "APPROVAL READY" : "INCOMPLETE"}</span><span className="px-2 py-1 border border-border font-mono text-[7px]">V{latest.version} / {latest.snapshotHash.slice(0, 16)}</span></div>{!latest.completeness.complete && <p className="mt-2 text-[9px] text-red-300">Missing: {latest.completeness.missing?.join(", ")}</p>}<p className="mt-2 text-[9px] text-muted-foreground">{latest.confidence.caveat}</p></div>
              </section>}
              {latest && (
                <section className="px-4 py-3 border-b border-border bg-[#060606]">
                  <div className="font-terminal text-[8px] text-muted-foreground mb-2">BOUND EVIDENCE / PROVENANCE</div>
                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                    <div className="border border-border p-2">
                      <div className="font-terminal text-[7px] text-muted-foreground mb-1">RESEARCH EVIDENCE</div>
                      {latest.evidence.length ? latest.evidence.slice(0, 4).map((item, index) => (
                        <div key={item.id ?? index} className="font-mono text-[8px] text-muted-foreground truncate">{item.id ? `#${item.id} ` : ""}{item.title ?? "Untitled"} / {item.supports ?? "neutral"}</div>
                      )) : <div className="font-mono text-[8px] text-muted-foreground">No linked investigation evidence.</div>}
                    </div>
                    <div className="border border-border p-2">
                      <div className="font-terminal text-[7px] text-muted-foreground mb-1">SOURCE FINGERPRINTS</div>
                      {latest.sources?.length ? latest.sources.slice(0, 4).map((source, index) => (
                        <div key={source.evidenceId ?? index} className="font-mono text-[8px] text-muted-foreground truncate">{source.provider ?? "source"} / {(source.contentFingerprint ?? "").slice(0, 14)}</div>
                      )) : <div className="font-mono text-[8px] text-muted-foreground">No source fingerprints on this receipt.</div>}
                    </div>
                    <div className="border border-border p-2">
                      <div className="font-terminal text-[7px] text-muted-foreground mb-1">BRAIN PROVENANCE</div>
                      {latest.provenance?.length ? latest.provenance.slice(0, 4).map((task, index) => (
                        <div key={task.taskId ?? index} className="font-mono text-[8px] text-muted-foreground truncate">{task.taskKey ?? "task"} / {task.status ?? "unknown"} / {(task.deterministicRefs ?? []).length} refs</div>
                      )) : <div className="font-mono text-[8px] text-muted-foreground">No brain run bound.</div>}
                    </div>
                  </div>
                </section>
              )}
              {canAuthor && !["approved", "rejected", "superseded"].includes(detail.decision.status) && <section className="px-4 py-4 border-b border-border space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3"><Field label="RECOMMENDATION"><textarea rows={3} value={recommendation} onChange={(event) => setRecommendation(event.target.value)} className={areaClass} /></Field><Field label="INTERPRETATION"><textarea rows={3} value={interpretation} onChange={(event) => setInterpretation(event.target.value)} className={areaClass} /></Field></div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <LineEditor label="ASSUMPTIONS" hint="label | value | uncertainty 0-1 | basis | invalidation condition" value={assumptions} setValue={setAssumptions} />
                  <LineEditor label="MODELS / MODEL WARS" hint="name | version | output | method quality | source coverage | validation | independence" value={models} setValue={setModels} />
                  <LineEditor label="SCENARIOS / BULL VS BEAR" hint="name | probability | outcome | resulting decision" value={scenarios} setValue={setScenarios} />
                  <LineEditor label="ALTERNATIVES" hint="name | description | rejected reason" value={alternatives} setValue={setAlternatives} />
                  <LineEditor label="COUNTERARGUMENTS / RED TEAM" hint="argument | response" value={counterarguments} setValue={setCounterarguments} />
                  <LineEditor label="CONTRADICTIONS" hint="description | true/false resolved | resolution" value={contradictions} setValue={setContradictions} />
                  <LineEditor label="CALCULATIONS" hint="name | value | deterministic reference | model version" value={calculations} setValue={setCalculations} />
                  <LineEditor label="REVERSAL TRIGGERS" hint="name | indicator | gt/gte/lt/lte/eq | threshold | unit | action | source URL" value={triggers} setValue={setTriggers} />
                </div>
                <div className="flex flex-wrap items-end gap-3"><Field label="REQUIRED EVIDENCE"><input type="number" min="1" max="100" value={requiredEvidenceCount} onChange={(event) => setRequiredEvidenceCount(event.target.value)} className={`${inputClass} w-28`} /></Field><button onClick={() => saveReceipt.mutate()} disabled={saveReceipt.isPending} className="h-8 px-3 border border-amber-400/40 text-amber-300 flex items-center gap-2 font-terminal text-[8px] disabled:opacity-40"><Save className="w-3.5 h-3.5" /> SEAL NEW VERSION</button></div>
              </section>}
              {canReview && latest && !["approved", "rejected"].includes(detail.decision.status) && <section className="px-4 py-4 border-b border-border">
                <div className="font-terminal text-[8px] text-muted-foreground mb-3">REVIEW AND APPROVAL GATE</div><div className="grid grid-cols-1 xl:grid-cols-2 gap-3"><Field label="FINAL DECISION"><textarea rows={2} value={finalDecision} onChange={(event) => setFinalDecision(event.target.value)} className={areaClass} /></Field><Field label="RATIONALE"><textarea rows={2} value={rationale} onChange={(event) => setRationale(event.target.value)} className={areaClass} /></Field></div>
                {role === "internal_admin" && !latest.completeness.complete && <Field label="DOCUMENTED WAIVER"><input value={waiverReason} onChange={(event) => setWaiverReason(event.target.value)} className={inputClass} /></Field>}
                <div className="mt-3 flex flex-wrap gap-2"><ActionButton icon={Check} label="APPROVE" onClick={() => review.mutate("approved")} disabled={!latest.completeness.complete || review.isPending} tone="green" /><ActionButton icon={X} label="REJECT" onClick={() => review.mutate("rejected")} disabled={review.isPending} tone="red" />{role === "internal_admin" && !latest.completeness.complete && <ActionButton icon={ShieldAlert} label="WAIVE WITH REASON" onClick={() => review.mutate("waived")} disabled={!waiverReason || review.isPending} tone="amber" />}</div>
              </section>}
            </div>}

            {view === "challenge" && <div>
              <section className="px-4 py-4 border-b border-border space-y-3">
                <div className="flex flex-wrap items-center gap-3"><ShieldAlert className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-[9px]">KILL MY THESIS / DECISION TOURNAMENT</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">Uses the structured receipt inputs; ranking rewards validation and source coverage, never the highest output.</div></div><button onClick={() => runAnalysis.mutate()} className="ml-auto h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px]">RUN CHALLENGE</button></div>
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_140px] gap-3 pt-2 border-t border-border/60">
                  <LineEditor label="DECISION BOUNDARY / BREAK-EVEN POINTS" hint="assumption value | resulting outcome at that assumption value (>= 2 rows spanning the threshold)" value={boundaryPoints} setValue={setBoundaryPoints} />
                  <Field label="REVERSAL THRESHOLD"><input value={boundaryThreshold} onChange={(event) => setBoundaryThreshold(event.target.value)} className={inputClass} /></Field>
                </div>
              </section>
              {analysis && <section className="border-b border-border grid grid-cols-1 xl:grid-cols-3">
                <div className="p-4 border-b xl:border-b-0 xl:border-r border-border"><div className="font-terminal text-[7px] text-muted-foreground">THESIS VERDICT</div><div className="font-terminal text-[12px] text-amber-200 mt-2 uppercase">{String(analysis.thesisStress?.verdict ?? "unavailable").replaceAll("_", " ")}</div><div className="font-mono text-[9px] mt-2">{analysis.thesisStress?.killSignalCount ?? 0} kill signals</div></div>
                <div className="p-4 border-b xl:border-b-0 xl:border-r border-border"><div className="font-terminal text-[7px] text-muted-foreground">MODEL TOURNAMENT / GOVERNANCE TRUST-WEIGHTING</div>{analysis.tournament?.ranked?.map((model: any, index: number) => <div key={`${model.name}-${model.version}`} className="mt-2 flex items-center gap-2 font-mono text-[9px]"><span className="text-muted-foreground">{index + 1}</span><span className="flex-1">{model.name} / {model.version}</span><span>{model.score}</span></div>)}</div>
                <div className="p-4"><div className="font-terminal text-[7px] text-muted-foreground">DECISION BOUNDARY</div>{analysis.decisionBoundary ? <><div className="font-terminal text-[12px] text-amber-200 mt-2">{analysis.decisionBoundary.assumptionValue}</div><p className="mt-2 text-[9px] text-muted-foreground">The decision reverses once this assumption crosses {analysis.decisionBoundary.assumptionValue} (outcome threshold {analysis.decisionBoundary.threshold}).</p></> : <div className="mt-2 font-mono text-[9px] text-muted-foreground">Enter at least two boundary points bracketing the threshold above to locate the reversal point.</div>}</div>
              </section>}
              <section className="px-4 py-4 border-b border-border"><div className="flex items-center gap-2 mb-3"><Calculator className="w-4 h-4 text-amber-300" /><div className="font-terminal text-[9px]">REVERSE DCF / MARKET-IMPLIED EXPECTATIONS</div></div><div className="grid grid-cols-2 xl:grid-cols-5 gap-2">{Object.entries(reverseDcf).map(([key, value]) => <Field key={key} label={key.replace(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase()}><input value={value} onChange={(event) => setReverseDcf((current) => ({ ...current, [key]: event.target.value }))} className={inputClass} /></Field>)}</div><button onClick={() => runReverseDcf.mutate()} className="mt-3 h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px]">SOLVE IMPLIED GROWTH</button>{reverseResult && <div className="mt-3 font-mono text-[10px] text-emerald-300">Implied growth {reverseResult.impliedGrowthPercent}% / reproduced EV {reverseResult.reproducedEnterpriseValue}</div>}</section>
              {canAuthor && <section className="px-4 py-4 border-b border-border">
                <div className="flex items-center gap-2 mb-1"><TrendingUp className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-[9px]">QUANTITATIVE CONSENSUS</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">Different question from Model Tournament above: robust statistical blending of the models' numeric outputs (MAD-outlier detection + inverse-variance weighting), not governance/quality trust-weighting.</div></div></div>
                <button onClick={() => runQuantConsensus.mutate()} disabled={parsed.models.length < 2 || runQuantConsensus.isPending} className="mt-2 h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px] disabled:opacity-40">BLEND MODEL OUTPUTS</button>
                {quantConsensus && <div className="mt-3 font-mono text-[9px] space-y-1">
                  <div>Blended estimate <span className="text-amber-200">{Number(quantConsensus.weightedEstimate).toFixed(2)}</span> range [{Number(quantConsensus.weightedLowerBound).toFixed(2)}, {Number(quantConsensus.weightedUpperBound).toFixed(2)}]</div>
                  <div>Disagreement {Number(quantConsensus.disagreementPctOfEstimate).toFixed(1)}% of estimate / {quantConsensus.disagreementBand} band</div>
                  <div>Effective model count {Number(quantConsensus.effectiveModelCount).toFixed(2)} of {parsed.models.length} submitted</div>
                  <div>Consensus models: {(quantConsensus.consensusModels ?? []).join(", ") || "none"}</div>
                  {(quantConsensus.outlierModels ?? []).length > 0 && <div className="text-red-300">Outliers flagged: {quantConsensus.outlierModels.join(", ")}</div>}
                </div>}
              </section>}

              {canAuthor && <section className="px-4 py-4 border-b border-border space-y-3">
                <div className="flex items-center gap-2"><Layers className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-[9px]">RANK ALTERNATIVES / MCDA (TOPSIS)</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">Ranks alternatives against weighted criteria by distance to the ideal solution. Separate grid from the free-text ALTERNATIVES editor above, which has a different shape.</div></div></div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <LineEditor label="CRITERIA" hint="name | weight greater than 0 | maximize or minimize (at least 2 rows)" value={mcdaCriteria} setValue={setMcdaCriteria} />
                  <LineEditor label="ALTERNATIVE VALUES" hint="name | one value per criterion above, in the same order (at least 2 rows)" value={mcdaAlternatives} setValue={setMcdaAlternatives} />
                </div>
                <button onClick={() => runMcda.mutate()} disabled={mcdaParsed.criteria.length < 2 || mcdaParsed.alternatives.length < 2 || runMcda.isPending} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px] disabled:opacity-40">RANK ALTERNATIVES</button>
                {mcdaResult && <div className="mt-1 font-mono text-[9px] space-y-1">{(mcdaResult.ranking ?? []).map((name: string, index: number) => <div key={name} className="flex items-center gap-2"><span className="text-muted-foreground">{index + 1}</span><span className="flex-1">{name}</span><span>{Number(mcdaResult.scores?.[name]).toFixed(4)}</span></div>)}</div>}
              </section>}

              {canAuthor && <section className="px-4 py-4 border-b border-border space-y-3">
                <div className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-[9px]">VALUE OF INFORMATION / MINIMAX REGRET</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">Is it worth gathering more information before deciding? Compares the best choice under current uncertainty against a perfect-information benchmark.</div></div></div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <LineEditor label="STATES" hint="state name | probability, summing to 1 (at least 2 rows)" value={voiStates} setValue={setVoiStates} />
                  <LineEditor label="ALTERNATIVE PAYOFFS" hint="name | one payoff per state above, in the same order (at least 2 rows)" value={voiAlternatives} setValue={setVoiAlternatives} />
                </div>
                <button onClick={() => runVoi.mutate()} disabled={voiParsed.stateNames.length < 2 || voiParsed.alternatives.length < 2 || runVoi.isPending} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px] disabled:opacity-40">SOLVE VALUE OF INFORMATION</button>
                {voiResult && <div className="mt-1 font-mono text-[9px] space-y-1">
                  <div>Best choice now: <span className="text-amber-200">{voiResult.bestAlternative}</span>, expected value {Number(voiResult.bestExpectedValue).toFixed(2)}</div>
                  <div>Value of perfect information: <span className="text-emerald-300">{Number(voiResult.valueOfPerfectInformation).toFixed(2)}</span> -- worth researching further only if that research costs less than this.</div>
                  <div>Minimax-regret pick: <span className="text-amber-200">{voiResult.minimaxRegretAlternative}</span></div>
                  {Object.entries(voiResult.maximumRegret ?? {}).map(([name, regret]) => <div key={name} className="text-muted-foreground">{name} maximum regret {Number(regret as number).toFixed(2)}</div>)}
                </div>}
              </section>}

              {canAuthor && <section className="px-4 py-4 border-b border-border space-y-3">
                <div className="flex items-center gap-2"><PieChart className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-[9px]">UNCERTAINTY DECOMPOSITION</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">Linear variance decomposition: which category of uncertainty -- data, model, market, scenario, parameter -- actually drives the confidence interval.</div></div></div>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                  <Field label="CENTRAL ESTIMATE"><input value={uncertaintyEstimate} onChange={(event) => setUncertaintyEstimate(event.target.value)} className={inputClass} /></Field>
                  <Field label="CONFIDENCE PERCENT"><input value={uncertaintyConfidence} onChange={(event) => setUncertaintyConfidence(event.target.value)} className={inputClass} /></Field>
                </div>
                <LineEditor label="UNCERTAINTY FACTORS" hint="name | standard deviation | sensitivity (change in output per unit of factor) | category: data, model, market, scenario, or parameter" value={uncertaintyFactors} setValue={setUncertaintyFactors} />
                <button onClick={() => runUncertainty.mutate()} disabled={uncertaintyParsed.factors.length < 1 || runUncertainty.isPending} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px] disabled:opacity-40">DECOMPOSE UNCERTAINTY</button>
                {uncertaintyResult && <div className="mt-1 font-mono text-[9px] space-y-1">
                  <div>{Number(uncertaintyResult.centralEstimate).toFixed(2)} plus or minus {Number(uncertaintyResult.standardDeviation).toFixed(2)}, range [{Number(uncertaintyResult.lowerBound).toFixed(2)}, {Number(uncertaintyResult.upperBound).toFixed(2)}]</div>
                  {Object.entries(uncertaintyResult.categoryVarianceContributionsPct ?? {}).map(([category, pct]) => <div key={category}>{category}: {Number(pct as number).toFixed(1)} percent of variance</div>)}
                  {uncertaintyResult.dominantUncertainty && <div className="text-amber-200">Dominant uncertainty: {uncertaintyResult.dominantUncertainty}</div>}
                </div>}
              </section>}

              {canAuthor && <section className="px-4 py-4 border-b border-border space-y-3">
                <div className="flex items-center gap-2"><Network className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-[9px]">CROSS-DOMAIN SCENARIO PROPAGATION</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">Shocks propagate through a calibrated transmission graph across domains. The graph must be acyclic.</div></div></div>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                  <LineEditor label="NODES" hint="name | baseline value | domain (optional)" value={scenarioNodes} setValue={setScenarioNodes} />
                  <LineEditor label="EDGES" hint="source | target | coefficient | mode: absolute, elasticity, or percent_to_absolute (optional) | label (optional)" value={scenarioEdges} setValue={setScenarioEdges} />
                  <LineEditor label="SHOCKS" hint="node | change" value={scenarioShocks} setValue={setScenarioShocks} />
                </div>
                <button onClick={() => runScenarioGraph.mutate()} disabled={scenarioParsed.nodes.length < 1 || runScenarioGraph.isPending} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px] disabled:opacity-40">PROPAGATE SHOCK</button>
                {scenarioResult && <div className="mt-1 font-mono text-[9px] space-y-2">
                  <div>Propagation order: {(scenarioResult.propagationOrder ?? []).join(" then ")}</div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                    <div>{Object.entries(scenarioResult.shockedValues ?? {}).map(([name, value]) => <div key={name}>{name}: {Number(value as number).toFixed(2)} (change {Number((scenarioResult.totalChanges ?? {})[name] ?? 0).toFixed(2)})</div>)}</div>
                    <div>{Object.entries(scenarioResult.domainImpacts ?? {}).map(([domain, impact]) => <div key={domain}>{domain} domain impact: {Number(impact as number).toFixed(2)}</div>)}</div>
                  </div>
                </div>}
              </section>}
              {canAuthor && <section className="px-4 py-4 border-b border-border space-y-3" data-testid="scenario-pipeline">
                <div className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-[9px]">SCENARIO → MODEL → VALUATION → PORTFOLIO RISK → ACTION → RECEIPT</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">Connected, review-only pipeline. Every ID and portfolio weight must resolve to supplied evidence; no orders are approved or executed.</div></div></div>
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-2">
                  <Field label="SCENARIO ID"><input aria-label="Pipeline scenario ID" value={pipelineScenarioId} onChange={(event) => setPipelineScenarioId(event.target.value)} placeholder="source scenario identifier" className={inputClass} /></Field>
                  <Field label="SCENARIO NAME"><input aria-label="Pipeline scenario name" value={pipelineScenarioName} onChange={(event) => setPipelineScenarioName(event.target.value)} placeholder="e.g. margin compression" className={inputClass} /></Field>
                  <Field label="FINANCIAL DATASET SNAPSHOT ID">
                    <select aria-label="Financial dataset snapshot selector" value={financialDatasetSnapshotId} onChange={(event) => setFinancialDatasetSnapshotId(event.target.value)} className={inputClass}>
                      <option value="">SELECT SOURCE SNAPSHOT</option>
                      {financialSnapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.id.slice(0, 16)} / {(snapshot.contentHash ?? "").slice(0, 12)}{snapshot.availableAt ? ` / ${snapshot.availableAt.slice(0, 10)}` : ""}</option>)}
                    </select>
                  </Field>
                  <Field label="FACTOR-RISK SNAPSHOT ID">
                    <select aria-label="Factor-risk snapshot selector" value={factorRiskSnapshotId} onChange={(event) => setFactorRiskSnapshotId(event.target.value)} className={inputClass}>
                      <option value="">SELECT SOURCE SNAPSHOT</option>
                      {factorSnapshots.map((snapshot) => <option key={snapshot.snapshotId} value={snapshot.snapshotId}>{snapshot.snapshotId.slice(0, 24)} / {snapshot.request.asOf} / {snapshot.included.length} INCLUDED</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 font-mono text-[7px]">
                  <div className={`border px-2 py-1.5 ${financialSnapshot?.id ? "border-emerald-400/30 text-emerald-300" : "border-amber-400/30 text-amber-200"}`}>{financialSnapshot?.id ? `SOURCE-BOUND DATASET ${financialSnapshot.id.slice(0, 16)} / HASH ${(financialSnapshot.contentHash ?? "").slice(0, 16)}` : "NO FINANCIAL SNAPSHOT AVAILABLE FOR THIS SYMBOL — capture a point-in-time financial snapshot; no dataset ID is fabricated."}</div>
                  <div className={`border px-2 py-1.5 ${factorSnapshot ? "border-emerald-400/30 text-emerald-300" : "border-amber-400/30 text-amber-200"}`}>{factorSnapshot ? `SOURCE-BOUND FACTOR SNAPSHOT ${factorSnapshot.snapshotId.slice(0, 16)} / HASH ${factorSnapshot.contentHash.slice(0, 16)}` : factorRiskSnapshotId ? `FACTOR SNAPSHOT QUERY DID NOT RESOLVE${factorSnapshotError ? ` — ${factorSnapshotError.message}` : ""}` : "NO FACTOR SNAPSHOT QUERY DATA — capture a factor-risk snapshot and paste its exact ID; no factor evidence is fabricated."}</div>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <div className="border border-border/70 p-2 space-y-2">
                    <div className="font-terminal text-[8px] text-muted-foreground">MODEL OVERRIDES</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="PROJECTION YEARS / YEARS"><input type="number" min="1" max="10" step="1" aria-label="Pipeline projection years" value={pipelineProjectionYears} onChange={(event) => setPipelineProjectionYears(event.target.value)} className={inputClass} /></Field>
                      <Field label="REVENUE GROWTH / DECIMAL"><input type="number" min="-0.9" max="5" step="0.01" aria-label="Pipeline revenue growth" value={pipelineRevenueGrowth} onChange={(event) => setPipelineRevenueGrowth(event.target.value)} className={inputClass} /></Field>
                    </div>
                    <div className="font-mono text-[7px] text-muted-foreground">Explicit scenarioAssumptions overrides only; 0.12 means 12%. Base assumptions remain dataset-derived by the server.</div>
                  </div>
                  <div className="border border-border/70 p-2 space-y-2">
                    <div className="font-terminal text-[8px] text-muted-foreground">VALUATION INPUTS</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="DISCOUNT RATE / DECIMAL"><input type="number" step="0.01" aria-label="Pipeline discount rate" value={pipelineDiscountRate} onChange={(event) => setPipelineDiscountRate(event.target.value)} className={inputClass} /></Field>
                      <Field label="TERMINAL GROWTH / DECIMAL"><input type="number" step="0.01" aria-label="Pipeline terminal growth" value={pipelineTerminalGrowth} onChange={(event) => setPipelineTerminalGrowth(event.target.value)} className={inputClass} /></Field>
                      <Field label="NET DEBT / DATASET CURRENCY"><input type="number" step="any" aria-label="Pipeline net debt" value={pipelineNetDebt} onChange={(event) => setPipelineNetDebt(event.target.value)} placeholder="explicit amount" className={inputClass} /></Field>
                      <Field label="SHARES OUTSTANDING / SHARES"><input type="number" min="0" step="any" aria-label="Pipeline shares outstanding" value={pipelineSharesOutstanding} onChange={(event) => setPipelineSharesOutstanding(event.target.value)} placeholder="explicit count" className={inputClass} /></Field>
                    </div>
                    <div className="font-mono text-[7px] text-muted-foreground">Discount rate must exceed terminal growth. Currency and share units must match the supplied financial dataset.</div>
                  </div>
                </div>
                <div className="border border-border/70 p-2">
                  <div className="flex flex-wrap items-center gap-2 font-terminal text-[7px] text-muted-foreground">
                    {["SCENARIO", "MODEL", "VALUATION", "PORTFOLIO RISK", "ACTION", "RECEIPT"].map((stage) => <span key={stage} className={`border px-2 py-1 ${pipelineStageStatus === "COMPLETE" ? "border-emerald-400/30 text-emerald-300" : scenarioPipelineInputs.payload ? "border-amber-400/30 text-amber-200" : "border-red-400/30 text-red-300"}`}>{stage} / {pipelineStageStatus}</span>)}
                  <div className="mt-2 font-mono text-[7px] text-muted-foreground">Factor shocks use the existing scenario SHOCKS node column as exact factor IDs (not graph labels). Exact portfolio weights and action alternatives come from the structured scenario action editor below; unknown assets are not normalized.</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button data-testid="preview-scenario-pipeline" onClick={() => { if (!scenarioPipelineInputs.payload) { setScenarioPipelineError(scenarioPipelineInputs.error); return; } setScenarioPipelineError(""); runScenarioPipelinePreview.mutate(scenarioPipelineInputs.payload); }} disabled={runScenarioPipelinePreview.isPending} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px] disabled:opacity-40">{runScenarioPipelinePreview.isPending ? "RUNNING PIPELINE…" : "PREVIEW PIPELINE"}</button>
                  {validPipelineCalculation && selectedId && latest?.id && <button data-testid="attach-scenario-pipeline" onClick={() => attachScenarioPipeline.mutate()} disabled={scenarioPipelineAttached || attachScenarioPipeline.isPending} className="h-8 px-3 border border-emerald-400/40 text-emerald-300 font-terminal text-[8px] disabled:opacity-40">{scenarioPipelineAttached ? "ATTACHED — APPROVAL REQUIRED" : attachScenarioPipeline.isPending ? "ATTACHING…" : "ATTACH PIPELINE TO RECEIPT"}</button>}
                  {!latest && <span className="font-mono text-[7px] text-amber-200">Select an existing decision receipt before attachment.</span>}
                </div>
                {(scenarioPipelineError || (scenarioPipelineInputs.error && !scenarioPipelinePreview)) && <div role="alert" className="border border-red-400/30 px-2 py-2 font-mono text-[8px] text-red-300">{scenarioPipelineError || scenarioPipelineInputs.error}</div>}
                {scenarioPipelinePreview && <div className="border border-emerald-400/30 bg-[#080808] p-3 space-y-2 font-mono text-[8px]" aria-live="polite">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-terminal text-[8px] text-emerald-300">PIPELINE PREVIEW COMPLETE</span><span className="text-muted-foreground">TRACE {scenarioPipelinePreview.trace.traceHash}</span></div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-1">
                    <div>MODEL BASELINE CHECKS: {scenarioPipelinePreview.trace.models.baselineChecks.passed ? "PASS" : "FAIL"} / SCENARIO: {scenarioPipelinePreview.trace.models.scenarioChecks.passed ? "PASS" : "FAIL"}</div>
                    <div>FACTOR P&amp;L / WEIGHTED: {scenarioFactorPnl(scenarioPipelinePreview.trace) === null ? "unavailable" : scenarioFactorPnl(scenarioPipelinePreview.trace)!.toFixed(4)}</div>
                    <div>PORTFOLIO P&amp;L: {Number(scenarioPipelinePreview.trace.factorRisk.decomposition.result.scenario?.portfolioPnl ?? 0).toFixed(4)} / COVERAGE {scenarioPipelinePreview.trace.action.coverage.assetsWithExposure}/{scenarioPipelinePreview.trace.action.coverage.assets}</div>
                    <div>ACTION CANDIDATE IMPACT: {Number(scenarioPipelinePreview.trace.action.result.candidates[0]?.expectedImpact ?? 0).toFixed(4)}</div>
                    <div>CANDIDATE RECOMMENDATION: <span className="text-amber-200">{scenarioPipelinePreview.trace.recommendation ?? scenarioPipelinePreview.trace.rankedCandidates[0]?.label ?? "none"}</span></div>
                    <div>RECEIPT VALUE: {Number(scenarioPipelinePreview.receiptCalculation.value).toFixed(4)} / {scenarioPipelinePreview.receiptCalculation.deterministicRef}</div>
                  </div>
                  <div className="text-muted-foreground">LIMITATIONS: {scenarioPipelinePreview.trace.limitations.length ? scenarioPipelinePreview.trace.limitations.join(" / ") : "none reported"}</div>
                  {validPipelineCalculation && <div className="text-emerald-300">HASH-SEALED RECEIPT CALCULATION READY — attachment remains approval-gated.</div>}
                </div>}
              </section>}
              {canAuthor && <section className="px-4 py-4 border-b border-border space-y-3" data-testid="scenario-action-candidates">
                <div className="flex items-center gap-2"><Network className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-[9px]">SCENARIO → ACTION CANDIDATES</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">Review-only constrained recommendations built from this graph's propagated changes and explicit portfolio observations. No orders are submitted.</div></div></div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <div>
                    <span className="block mb-1 font-terminal text-[7px] text-muted-foreground">ASSET IMPACT OBSERVATIONS</span>
                    <StructuredJsonEditor schema={SCENARIO_ASSET_IMPACTS_SCHEMA} value={scenarioAssetImpacts} onChange={setScenarioAssetImpacts} />
                  </div>
                  <div>
                    <span className="block mb-1 font-terminal text-[7px] text-muted-foreground">CURRENT EXPOSURE / WEIGHT</span>
                    <StructuredJsonEditor schema={SCENARIO_EXPOSURES_SCHEMA} value={scenarioExposures} onChange={setScenarioExposures} />
                  </div>
                  <div>
                    <span className="block mb-1 font-terminal text-[7px] text-muted-foreground">ACTION ALTERNATIVES</span>
                    <StructuredJsonEditor schema={SCENARIO_ACTION_ALTERNATIVES_SCHEMA} value={scenarioActionAlternatives} onChange={setScenarioActionAlternatives} />
                  </div>
                  <div>
                    <span className="block mb-1 font-terminal text-[7px] text-muted-foreground">PORTFOLIO CONSTRAINTS</span>
                    <StructuredJsonEditor schema={SCENARIO_ACTION_CONSTRAINTS_SCHEMA} value={scenarioActionConstraints} onChange={setScenarioActionConstraints} />
                  </div>
                  <div>
                    <span className="block mb-1 font-terminal text-[7px] text-muted-foreground">ACTION COSTS</span>
                    <StructuredJsonEditor schema={SCENARIO_ACTION_COSTS_SCHEMA} value={scenarioActionCosts} onChange={setScenarioActionCosts} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button data-testid="run-scenario-action-candidates" aria-label="Calculate scenario action candidates" onClick={runScenarioActions} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px]">CALCULATE CANDIDATES</button>
                  <span className="font-mono text-[7px] text-muted-foreground">INPUT STATUS: MANUAL / PROVIDER AND AS-OF ARE preserved when supplied in JSON</span>
                </div>
                {scenarioActionError && <div role="alert" className="border border-red-400/30 px-2 py-2 font-mono text-[8px] text-red-300">{scenarioActionError}</div>}
                {scenarioActionResult && <div className="border border-border bg-[#080808] p-3 space-y-3" aria-live="polite">
                  <div className="flex flex-wrap items-center gap-2"><span className="px-2 py-1 border border-amber-400/40 text-amber-300 font-terminal text-[7px]">APPROVAL REQUIRED</span><span className="px-2 py-1 border border-border text-muted-foreground font-terminal text-[7px]">REVIEW ONLY / NO EXECUTION</span><span className="font-mono text-[7px] text-muted-foreground">STATUS {scenarioActionResult.source?.status ?? "manual"} / SOURCE {scenarioActionResult.source?.source ?? "manual input"} / PROVIDER {scenarioActionResult.source?.provider ?? "not supplied"} / AS-OF {scenarioActionResult.source?.asOf ?? "not supplied"} / PERIOD {scenarioActionResult.source?.period ?? "not supplied"} / UNIT {scenarioActionResult.source?.unit ?? "as supplied"}</span></div>
                  <div className="font-mono text-[8px] text-muted-foreground">Coverage: {scenarioActionResult.inputCoverage?.assetsWithImpact ?? 0}/{scenarioActionResult.inputCoverage?.assets ?? 0} asset impacts and {scenarioActionResult.inputCoverage?.assetsWithExposure ?? 0}/{scenarioActionResult.inputCoverage?.assets ?? 0} exposures supplied. Ranked feasible candidates appear first.</div>
                  <div className="space-y-2">{scenarioActionResult.candidates.map((candidate) => <article key={`${candidate.rank}-${candidate.label}`} className="border border-border/70 p-2" data-testid={`scenario-action-candidate-${candidate.rank}`}>
                    <div className="flex flex-wrap items-center gap-2"><span className="font-terminal text-[8px] text-muted-foreground">#{candidate.rank}</span><span className="font-terminal text-[9px] text-amber-200">{candidate.label}</span><span className={`px-1.5 py-0.5 border font-terminal text-[6px] uppercase ${candidate.status === "feasible" ? "text-emerald-300 border-emerald-400/30" : "text-red-300 border-red-400/30"}`}>{candidate.status}</span><span className="ml-auto font-mono text-[7px] text-muted-foreground">STATUS {candidate.source?.status ?? "manual"} / AS-OF {candidate.source?.asOf ?? "not supplied"} / UNIT {candidate.source?.unit ?? "as supplied"}</span></div>
                    <div className="mt-2 grid grid-cols-2 xl:grid-cols-5 gap-2 font-mono text-[8px]"><span>Impact: {candidate.expectedImpact === null ? "unavailable" : Number(candidate.expectedImpact).toFixed(4)}</span><span>Net: {candidate.netExpectedImpact === null ? "unavailable" : Number(candidate.netExpectedImpact).toFixed(4)}</span><span>Risk: {candidate.residualRisk === null ? "unavailable" : Number(candidate.residualRisk).toFixed(4)}</span><span>Turnover: {candidate.turnover === null ? "unavailable" : Number(candidate.turnover).toFixed(4)}</span><span>Cost: {Number(candidate.cost).toFixed(4)}</span></div>
                    <div className="mt-2 font-mono text-[8px] text-muted-foreground">Targets: {JSON.stringify(candidate.targetWeights)}</div>
                    {candidate.constraintViolations.length > 0 && <div className="mt-2 text-[8px] text-red-300"><div className="font-terminal text-[7px]">CONSTRAINT FAILURES</div>{candidate.constraintViolations.map((violation, index) => <div key={`${violation.constraint}-${index}`}>{violation.message} / actual {violation.actual === null ? "unavailable" : violation.actual} / limit {violation.limit === null ? "not supplied" : violation.limit}</div>)}</div>}
                    <div className="mt-2 text-[8px] text-muted-foreground">{candidate.rationale}</div>
                    {candidate.requiredEvidence.length > 0 && <div className="mt-2 text-[8px] text-amber-200"><div className="font-terminal text-[7px]">REQUIRED EVIDENCE</div>{candidate.requiredEvidence.map((evidence, index) => <div key={`${evidence.requirement}-${index}`}>{evidence.requirement}{evidence.assetId ? ` / ${evidence.assetId}` : ""} / status {evidence.status ?? "manual"} / source {evidence.source ?? "not supplied"} / provider {evidence.provider ?? "not supplied"} / as-of {evidence.asOf ?? "not supplied"} / period {evidence.period ?? "not supplied"} / unit {evidence.unit ?? "as supplied"}</div>)}</div>}
                  </article>)}</div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                    <button data-testid="save-scenario-decision" onClick={() => saveScenarioDecision.mutate()} disabled={!latest || saveScenarioDecision.isPending} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px] disabled:opacity-40">
                      <Save className="mr-1 inline h-3.5 w-3.5" /> SAVE TO DECISION RECEIPT
                    </button>
                    {detail.decision.status === "approved" && latest?.scenarioActionArtifact && <button data-testid="create-scenario-monitor" onClick={() => createScenarioMonitor.mutate()} disabled={createScenarioMonitor.isPending} className="h-8 px-3 border border-cyan-400/40 text-cyan-300 font-terminal text-[8px] disabled:opacity-40">
                      <Activity className="mr-1 inline h-3.5 w-3.5" /> CREATE MONITOR TRIGGER
                    </button>}
                    {latest?.scenarioActionArtifact && <span className="font-mono text-[7px] text-muted-foreground">
                      CANDIDATE HASH {latest.scenarioActionArtifact.candidateHash.slice(0, 16)} / {latest.scenarioActionArtifact.candidateStatus.toUpperCase()} / MODEL {latest.scenarioActionArtifact.modelVersion}
                    </span>}
                  </div>
                  </div>}
              </section>}
            </div>}

            {view === "monitoring" && <section>
              {!detail.monitoringRules.length ? <div className="p-8 font-terminal text-[9px] text-muted-foreground">No reversal triggers have been versioned.</div> : detail.monitoringRules.map((monitor) => <article key={monitor.id} className="px-4 py-3 border-b border-border grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
                <div><div className="flex flex-wrap items-center gap-2"><Activity className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[9px]">{monitor.name}</span><span className={`px-1.5 py-0.5 border font-terminal text-[6px] uppercase ${statusTone(monitor.status)}`}>{monitor.status}</span></div><div className="mt-2 font-mono text-[8px] text-muted-foreground">{monitor.indicator} {monitor.operator} {monitor.threshold} {monitor.unit} / {monitor.action}</div></div>
                {canAuthor && <div className="flex items-center gap-2"><input aria-label={`Current value for ${monitor.name}`} value={monitorValues[monitor.id] ?? ""} onChange={(event) => setMonitorValues((current) => ({ ...current, [monitor.id]: event.target.value }))} className={`${inputClass} w-28`} placeholder="current" /><button title="Evaluate trigger" onClick={() => evaluateMonitor(monitor)} className="w-8 h-8 border border-border flex items-center justify-center"><ChevronRight className="w-3.5 h-3.5" /></button></div>}
              </article>)}
            </section>}

            {view === "history" && <div>
              <section className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3"><History className="w-4 h-4 text-amber-300" /><div className="font-terminal text-[9px]">RECEIPT LEDGER AND REPLAY</div>{canAuthor && latest && <button onClick={() => replay.mutate()} className="ml-auto h-8 px-3 border border-border font-terminal text-[8px] text-amber-300">REPLAY LATEST</button>}</section>
              {detail.receipts.map((receipt) => <article key={receipt.id} className="px-4 py-3 border-b border-border"><div className="flex flex-wrap items-center gap-2"><FileCheck2 className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[9px]">RECEIPT V{receipt.version}</span><span className="font-mono text-[7px] text-muted-foreground">{receipt.snapshotHash}</span><span className="ml-auto font-mono text-[7px] text-muted-foreground">{fmtDate(receipt.createdAt)}</span></div><div className="mt-2 text-[10px] text-muted-foreground">{receipt.recommendation}</div></article>)}
              {detail.approvals.map((approval) => <article key={approval.id} className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2"><BadgeCheck className="w-3.5 h-3.5 text-emerald-300" /><span className="font-terminal text-[8px] uppercase">{approval.outcome}</span><span className="font-mono text-[7px] text-muted-foreground">RECEIPT {approval.receiptVersionId} / {approval.snapshotHash.slice(0, 16)}</span></article>)}
              {detail.replays.map((item) => <article key={item.id} className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2"><GitBranch className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[8px]">REPLAY / {item.changed ? "UPDATED INPUTS" : "ORIGINAL INPUTS"}</span><span className="font-mono text-[7px] text-muted-foreground">{item.replaySnapshotHash.slice(0, 16)} / {fmtDate(item.createdAt)}</span></article>)}
            </div>}
          </div>
        </>}
      </main>
    </div>

    {showCreate && <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}><form onSubmit={(event) => { event.preventDefault(); createCase.mutate(); }} onClick={(event) => event.stopPropagation()} className="w-full max-w-2xl border border-border bg-[#080808] p-5 space-y-3"><div className="flex items-center"><div className="font-terminal text-[10px]">NEW DECISION CASE</div><button type="button" title="Close" onClick={() => setShowCreate(false)} className="ml-auto w-8 h-8 flex items-center justify-center"><X className="w-4 h-4" /></button></div><Field label="TITLE"><input required value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} /></Field><Field label="DECISION QUESTION"><textarea required rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} className={areaClass} /></Field><div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Field label="MATERIALITY"><select value={materiality} onChange={(event) => setMateriality(event.target.value)} className={inputClass}><option value="routine">Routine</option><option value="material">Material</option><option value="critical">Critical</option></select></Field><Field label="RESEARCH INVESTIGATION"><select value={investigationId} onChange={(event) => setInvestigationId(event.target.value)} className={inputClass}><option value="">None</option>{investigations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field><Field label="BRAIN RUN"><select value={brainRunId} onChange={(event) => setBrainRunId(event.target.value)} className={inputClass}><option value="">None</option>{brainRuns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field></div><button disabled={createCase.isPending} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px]">CREATE CASE</button></form></div>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="block mb-1 font-terminal text-[7px] text-muted-foreground">{label}</span>{children}</label>; }
function LineEditor({ label, hint, value, setValue }: { label: string; hint: string; value: string; setValue: (value: string) => void }) { return <Field label={label}><div className="mb-1 font-mono text-[7px] text-muted-foreground">{hint}</div><textarea rows={4} value={value} onChange={(event) => setValue(event.target.value)} className={areaClass} /></Field>; }
function ActionButton({ icon: Icon, label, onClick, disabled, tone }: { icon: typeof Check; label: string; onClick: () => void; disabled: boolean; tone: "green" | "red" | "amber" }) { const color = tone === "green" ? "border-emerald-400/40 text-emerald-300" : tone === "red" ? "border-red-400/40 text-red-300" : "border-amber-400/40 text-amber-300"; return <button onClick={onClick} disabled={disabled} className={`h-8 px-3 border flex items-center gap-2 font-terminal text-[8px] disabled:opacity-30 ${color}`}><Icon className="w-3.5 h-3.5" />{label}</button>; }
