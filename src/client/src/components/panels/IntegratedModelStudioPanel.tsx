import { useTerminalArtifactState, useTerminalArtifactContext } from "@/lib/terminalArtifactState";
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, Database, ExternalLink, Play, RefreshCw, Save, ShieldAlert } from "lucide-react";
import type { IntegratedFinancialModelResult, IntegratedModelAssumptions, SpecializedModelSchedules } from "@shared/integratedFinancialModel";
import type { PointInTimeDatasetSnapshot } from "@shared/pointInTimeData";
import { formatLiosAddress } from "@shared/liosAddress";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { setExperienceSurface } from "@/lib/experienceShell";
import { saveIntegratedModelRunArtifact, useInvalidateArtifacts, useArtifact } from "@/lib/useArtifacts";
import { useInvalidateProjects, useProjects, useProjectSessions } from "@/lib/useProjects";
import {
  initialModelArtifactSaveState, isDisplayedModelSaved, modelArtifactSaveNotice, modelArtifactSaveReducer,
  selectedModelArtifactProject,
} from "@/lib/integratedModelArtifactSave";
import type { SavedModelArtifact, ModelArtifactSaveRequest } from "@/lib/integratedModelArtifactSave";
import { modelRunReviewKey, verifiedReopenedModelRun, savedModelArtifactMatchesReceipt } from "@/lib/reviewedModelRunArtifact";
import { StructuredJsonEditor, type JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";

const ArtifactPane = lazy(() => import("@/components/terminal/ArtifactPane").then((module) => ({ default: module.ArtifactPane })));

type ModelResponse = {
  result: IntegratedFinancialModelResult;
  receipt: { runId: string; resultHash: string; datasetSnapshotId: string; datasetContentHash: string; inputHash?: string; calculatedAt: string; deterministic: boolean };
  lineage?: {
    modelInput: { id: string; datasetVersionId: string; sourceCellRefs: string[]; targetCellRefs: string[]; inputHash: string } | null;
    valuation: { id: string; outputName: string; outputValue: number; currency: string; inputLineageIds: string[]; outputHash: string } | null;
  };
};

type RevisionReport = { status: "initial" | "unchanged" | "revised"; changedFields: number; materialChanges: number; addedPeriods: string[] };
type VarianceReport = { runs: Array<{ runId: string; status: "measured" | "pending_actuals"; rows: unknown[] }> };
type StatementTab = "income" | "cashflow" | "balance" | "debt" | "tax" | "leases" | "equity" | "specialized";
type AssumptionUnit = "%" | "days" | "years" | "number" | "money";

const ASSUMPTION_FIELDS: Array<{ key: keyof IntegratedModelAssumptions; label: string; unit: AssumptionUnit }> = [
  { key: "projectionYears", label: "Projection", unit: "years" },
  { key: "revenueGrowth", label: "Revenue growth", unit: "%" },
  { key: "priceGrowth", label: "Price growth", unit: "%" },
  { key: "volumeGrowth", label: "Volume growth", unit: "%" },
  { key: "cogsPercentRevenue", label: "COGS / revenue", unit: "%" },
  { key: "sgaPercentRevenue", label: "SG&A / revenue", unit: "%" },
  { key: "taxRate", label: "Tax rate", unit: "%" },
  { key: "openingNol", label: "Opening NOL", unit: "money" },
  { key: "nolUtilizationLimit", label: "NOL use limit", unit: "%" },
  { key: "dso", label: "DSO", unit: "days" },
  { key: "dio", label: "DIO", unit: "days" },
  { key: "dpo", label: "DPO", unit: "days" },
  { key: "capexPercentRevenue", label: "Capex / revenue", unit: "%" },
  { key: "depreciationPercentRevenue", label: "D&A / revenue", unit: "%" },
  { key: "interestRate", label: "Interest rate", unit: "%" },
  { key: "minimumCashPercentRevenue", label: "Minimum cash", unit: "%" },
  { key: "dividendPayout", label: "Dividend payout", unit: "%" },
  { key: "leaseAdditionsPercentRevenue", label: "Lease additions", unit: "%" },
  { key: "leaseAssetAmortizationRate", label: "Lease amortization", unit: "%" },
  { key: "leaseInterestRate", label: "Lease interest", unit: "%" },
  { key: "leasePrincipalRepaymentRate", label: "Lease principal", unit: "%" },
  { key: "stockCompPercentRevenue", label: "Stock comp / revenue", unit: "%" },
  { key: "stockCompDilutionPercent", label: "SBC dilution", unit: "%" },
  { key: "buybackPercentRevenue", label: "Buyback / revenue", unit: "%" },
  { key: "sharePrice", label: "Share price", unit: "money" },
  { key: "sharePriceGrowth", label: "Share price growth", unit: "%" },
  { key: "circularMaxIterations", label: "Max iterations", unit: "number" },
  { key: "circularTolerance", label: "Circular tolerance", unit: "money" },
];

const SPECIALIZED_SCHEDULE_SCHEMA: JsonFieldSchema[] = [
  {
    kind: "objectArray", key: "segments", label: "SEGMENTS", default: [],
    itemFields: [
      { kind: "string", key: "name", label: "Name", default: "" },
      { kind: "number", key: "openingRevenue", label: "Opening revenue", min: 0, step: 1, default: 0 },
      { kind: "number", key: "revenueGrowth", label: "Revenue growth", min: -0.9, max: 5, step: 0.01, default: 0 },
      { kind: "number", key: "cogsPercentRevenue", label: "COGS % revenue", min: 0, max: 2, step: 0.01, default: 0 },
      { kind: "number", key: "sgaPercentRevenue", label: "SG&A % revenue", min: 0, max: 2, step: 0.01, default: 0 },
    ],
  },
  {
    kind: "object", key: "pension", label: "PENSION",
    default: { openingObligation: 0, openingPlanAssets: 0, serviceCost: 0, discountRate: 0, expectedReturn: 0, cashContribution: 0, benefitsPaid: 0 },
    fields: [
      { kind: "number", key: "openingObligation", label: "Opening obligation", min: 0, step: 1, default: 0 },
      { kind: "number", key: "openingPlanAssets", label: "Opening plan assets", min: 0, step: 1, default: 0 },
      { kind: "number", key: "serviceCost", label: "Service cost", min: 0, step: 1, default: 0 },
      { kind: "number", key: "discountRate", label: "Discount rate", min: 0, max: 2, step: 0.01, default: 0 },
      { kind: "number", key: "expectedReturn", label: "Expected return", min: 0, max: 2, step: 0.01, default: 0 },
      { kind: "number", key: "cashContribution", label: "Cash contribution", min: 0, step: 1, default: 0 },
      { kind: "number", key: "benefitsPaid", label: "Benefits paid", min: 0, step: 1, default: 0 },
    ],
  },
  {
    kind: "objectArray", key: "associates", label: "ASSOCIATES", default: [],
    itemFields: [
      { kind: "string", key: "name", label: "Name", default: "" },
      { kind: "number", key: "openingCarryingValue", label: "Opening carrying value", min: 0, step: 1, default: 0 },
      { kind: "number", key: "ownershipPercent", label: "Ownership %", min: 0, max: 1, step: 0.01, default: 0 },
      { kind: "number", key: "annualInvesteeIncome", label: "Annual investee income", step: 1, default: 0 },
      { kind: "number", key: "annualDividends", label: "Annual dividends", min: 0, step: 1, default: 0 },
    ],
  },
  {
    kind: "object", key: "minority", label: "MINORITY INTEREST (NCI)",
    default: { openingNonControllingInterest: 0, shareOfConsolidatedIncome: 0 },
    fields: [
      { kind: "number", key: "openingNonControllingInterest", label: "Opening NCI", min: 0, step: 1, default: 0 },
      { kind: "number", key: "shareOfConsolidatedIncome", label: "Share of consolidated income", min: 0, max: 1, step: 0.01, default: 0 },
    ],
  },
  {
    kind: "object", key: "transaction", label: "TRANSACTION / M&A",
    default: {
      closeProjectionYear: 1, purchasePrice: 0, acquiredCash: 0, identifiableNetAssets: 0, intangibleAssets: 0, intangibleLifeYears: 5,
      acquiredRevenue: 0, acquiredRevenueGrowth: 0, acquiredEbitMargin: 0, cashConsiderationPercent: 0, debtConsiderationPercent: 0,
    },
    fields: [
      { kind: "number", key: "closeProjectionYear", label: "Close year", min: 1, max: 10, step: 1, default: 1 },
      { kind: "number", key: "purchasePrice", label: "Purchase price", min: 0, step: 1, default: 0 },
      { kind: "number", key: "acquiredCash", label: "Acquired cash", min: 0, step: 1, default: 0 },
      { kind: "number", key: "identifiableNetAssets", label: "Identifiable net assets", step: 1, default: 0 },
      { kind: "number", key: "intangibleAssets", label: "Intangible assets", min: 0, step: 1, default: 0 },
      { kind: "number", key: "intangibleLifeYears", label: "Intangible life (years)", min: 0.01, step: 1, default: 5 },
      { kind: "number", key: "acquiredRevenue", label: "Acquired revenue", min: 0, step: 1, default: 0 },
      { kind: "number", key: "acquiredRevenueGrowth", label: "Acquired revenue growth", min: -0.9, max: 5, step: 0.01, default: 0 },
      { kind: "number", key: "acquiredEbitMargin", label: "Acquired EBIT margin", min: -2, max: 2, step: 0.01, default: 0 },
      { kind: "number", key: "cashConsiderationPercent", label: "Cash consideration %", min: 0, max: 1, step: 0.01, default: 0 },
      { kind: "number", key: "debtConsiderationPercent", label: "Debt consideration %", min: 0, max: 1, step: 0.01, default: 0 },
    ],
  },
];

const ROWS: Record<StatementTab, Array<{ key: string; label: string }>> = {
  income: [
    { key: "revenue", label: "Revenue" }, { key: "costOfRevenue", label: "Cost of revenue" },
    { key: "grossProfit", label: "Gross profit" }, { key: "sga", label: "SG&A" },
    { key: "stockCompensation", label: "Stock compensation" }, { key: "depreciationAndAmortization", label: "D&A" },
    { key: "leaseAssetAmortization", label: "Lease amortization" }, { key: "ebit", label: "EBIT" },
    { key: "debtInterestExpense", label: "Debt interest" }, { key: "leaseInterestExpense", label: "Lease interest" },
    { key: "interestExpense", label: "Interest expense" }, { key: "incomeBeforeTax", label: "Pre-tax income" },
    { key: "incomeTaxExpense", label: "Tax expense" }, { key: "netIncome", label: "Net income" }, { key: "dilutedEps", label: "Diluted EPS" },
  ],
  cashflow: [
    { key: "netIncome", label: "Net income" }, { key: "depreciationAndAmortization", label: "D&A" }, { key: "leaseAssetAmortization", label: "Lease amortization" }, { key: "stockCompensation", label: "Stock compensation" },
    { key: "changeInNetWorkingCapital", label: "Change in NWC" }, { key: "cashFromOperations", label: "Cash from operations" },
    { key: "capitalExpenditure", label: "Capital expenditure" }, { key: "cashFromInvesting", label: "Cash from investing" },
    { key: "debtDraw", label: "Debt draw" }, { key: "debtRepayment", label: "Debt repayment" }, { key: "leasePrincipalRepayment", label: "Lease principal" },
    { key: "dividends", label: "Dividends" }, { key: "shareRepurchases", label: "Share repurchases" }, { key: "cashFromFinancing", label: "Cash from financing" },
    { key: "netChangeInCash", label: "Net change in cash" },
  ],
  balance: [
    { key: "cash", label: "Cash" }, { key: "accountsReceivable", label: "Accounts receivable" },
    { key: "inventory", label: "Inventory" }, { key: "propertyPlantEquipmentNet", label: "Net PP&E" },
    { key: "leaseRightOfUseAsset", label: "Lease ROU asset" }, { key: "otherAssets", label: "Other assets" }, { key: "totalAssets", label: "Total assets" },
    { key: "accountsPayable", label: "Accounts payable" }, { key: "totalDebt", label: "Total debt" },
    { key: "leaseLiability", label: "Lease liability" }, { key: "otherLiabilities", label: "Other liabilities" }, { key: "stockholdersEquity", label: "Stockholders' equity" },
    { key: "totalLiabilitiesAndEquity", label: "Liabilities & equity" },
  ],
  debt: [
    { key: "netWorkingCapital", label: "Net working capital" }, { key: "openingDebt", label: "Opening debt" },
    { key: "closingDebt", label: "Closing debt" }, { key: "openingPpe", label: "Opening PP&E" },
    { key: "closingPpe", label: "Closing PP&E" }, { key: "circularIterations", label: "Circular iterations" }, { key: "circularDifference", label: "Circular difference" },
  ],
  tax: [
    { key: "openingNol", label: "Opening NOL" }, { key: "nolGenerated", label: "NOL generated" }, { key: "nolUsed", label: "NOL utilized" },
    { key: "taxableIncome", label: "Taxable income" }, { key: "closingNol", label: "Closing NOL" },
  ],
  leases: [
    { key: "openingLeaseAsset", label: "Opening ROU asset" }, { key: "leaseAdditions", label: "Lease additions" }, { key: "closingLeaseAsset", label: "Closing ROU asset" },
    { key: "openingLeaseLiability", label: "Opening lease liability" }, { key: "closingLeaseLiability", label: "Closing lease liability" },
  ],
  equity: [
    { key: "openingDilutedShares", label: "Opening diluted shares" }, { key: "stockCompDilutionShares", label: "SBC dilution shares" },
    { key: "repurchasedShares", label: "Repurchased shares" }, { key: "closingDilutedShares", label: "Closing diluted shares" }, { key: "impliedSharePrice", label: "Implied share price" },
  ],
  specialized: [
    { key: "openingPensionObligation", label: "Opening pension obligation" }, { key: "pensionServiceCost", label: "Pension service cost" },
    { key: "pensionInterestCost", label: "Pension interest cost" }, { key: "pensionExpectedReturn", label: "Expected plan return" },
    { key: "pensionContribution", label: "Cash contribution" }, { key: "closingPensionObligation", label: "Closing pension obligation" },
    { key: "closingPensionPlanAssets", label: "Closing plan assets" }, { key: "openingAssociateValue", label: "Opening associates" },
    { key: "associateIncome", label: "Associate income" }, { key: "associateDividends", label: "Associate dividends" },
    { key: "closingAssociateValue", label: "Closing associates" }, { key: "nciIncome", label: "NCI income" },
    { key: "closingNci", label: "Closing NCI" }, { key: "transactionCashConsideration", label: "Cash consideration" },
    { key: "transactionDebtConsideration", label: "Debt consideration" }, { key: "goodwill", label: "Goodwill" },
    { key: "acquiredIntangibles", label: "Acquired intangibles" }, { key: "intangibleAmortization", label: "Intangible amortization" },
    { key: "specializedBalanceReconciliation", label: "Explicit reconciliation" },
  ],
};

function formatNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (magnitude >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}

function shortDate(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "UNAVAILABLE";
}

export default function IntegratedModelStudioPanel({ symbol }: { symbol?: string }) {
  const terminalContext = useTerminalArtifactContext();
  const [activeSymbol, setActiveSymbol] = useTerminalArtifactState("IntegratedModelStudioPanel.activeSymbol", (symbol || "AAPL").toUpperCase());
  const [snapshot, setSnapshot] = useState<PointInTimeDatasetSnapshot | null>(null);
  const [runId, setRunId] = useTerminalArtifactState<string | null>("IntegratedModelStudioPanel.runId", null);
  const [loadedModel, setModel] = useState<ModelResponse | null>(null);
  const model = loadedModel?.receipt.runId === runId ? loadedModel : null;
  const [authoredAssumptions, setAssumptions] = useTerminalArtifactState<IntegratedModelAssumptions | null>("IntegratedModelStudioPanel.assumptions", null);
  const assumptions = authoredAssumptions ?? model?.result.assumptions ?? null;
  const [scheduleState, setScheduleState] = useTerminalArtifactState<Record<string, unknown>>("IntegratedModelStudioPanel.scheduleState", {});
  const [tab, setTab] = useTerminalArtifactState<StatementTab>("IntegratedModelStudioPanel.tab", "income");
  const [revisions, setRevisions] = useState<RevisionReport | null>(null);
  const [variance, setVariance] = useState<VarianceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectsQuery = useProjects();
  const invalidateArtifacts = useInvalidateArtifacts();
  const invalidateProjects = useInvalidateProjects();
  const [destination, setDestination] = useTerminalArtifactState("IntegratedModelStudioPanel.destination", "");
  const [localArtifactSave, dispatchArtifactSave] = useReducer(modelArtifactSaveReducer, initialModelArtifactSaveState);
  const [savedOutput, setSavedOutput] = useTerminalArtifactState<{ request: ModelArtifactSaveRequest; artifactId: string; version: number } | null>("IntegratedModelStudioPanel.savedOutput", null);
  const savedOutputQuery = useArtifact(savedOutput?.artifactId ?? null, savedOutput?.version ?? null);
  const reopenedSaved: SavedModelArtifact | null = savedOutput && savedOutputQuery.data?.artifact.id === savedOutput.artifactId && savedOutputQuery.data.version.version === savedOutput.version && !savedOutputQuery.isPlaceholderData
    ? { request: savedOutput.request, detail: savedOutputQuery.data } : null;
  const artifactSave = { ...localArtifactSave, saved: localArtifactSave.saved ?? reopenedSaved };
  const [openedArtifact, setOpenedArtifact] = useState<SavedModelArtifact | null>(null);
  const [reviewedSaveKey, setReviewedSaveKey] = useState<string | null>(null);
  const [saveReviewError, setSaveReviewError] = useState<string | null>(null);
  const sessionsQuery = useProjectSessions(openedArtifact?.detail.artifact.projectId ?? null);
  const saveInFlight = useRef(false);
  const saveRequestId = useRef(0);
  const modelInFlight = useRef(false);
  const destinationProject = selectedModelArtifactProject(destination, projectsQuery.data ?? []);
  const chatDestination = destination === "chat" && terminalContext?.target?.projectId === null ? terminalContext.target.owningChatId : null;
  const selectedDestination = chatDestination ? { projectId: null, owningChatId: chatDestination, destinationLabel: "this Chat" }
    : destinationProject ? { projectId: destinationProject.id, destinationLabel: destinationProject.name } : null;
  const currentSaveReviewKey = modelRunReviewKey(model, selectedDestination);
  const currentSaveReviewKeyRef = useRef(currentSaveReviewKey);
  currentSaveReviewKeyRef.current = currentSaveReviewKey;
  const saveIsReviewed = currentSaveReviewKey !== null && reviewedSaveKey === currentSaveReviewKey;
  const saveNotice = modelArtifactSaveNotice(artifactSave, model?.receipt.runId ?? null);
  const displayedRunSaved = isDisplayedModelSaved(artifactSave.saved, model?.receipt.runId ?? null, selectedDestination?.projectId ?? null, chatDestination ?? undefined);
  const setEditing = terminalContext?.setEditing;
  useEffect(() => {
    setEditing?.("integrated-model-execution", busy || artifactSave.pending !== null);
    return () => setEditing?.("integrated-model-execution", false);
  }, [busy, artifactSave.pending, setEditing]);

  useEffect(() => { if (symbol) setActiveSymbol(symbol.toUpperCase()); }, [symbol]);
  useEffect(() => {
    if (!runId || loadedModel?.receipt.runId === runId) return;
    let current = true;
    setBusy(true); setError(null);
    void apiRequest("GET", `/api/financial-models/integrated/runs/${encodeURIComponent(runId)}`)
      .then(response => response.json() as Promise<ModelResponse & { snapshot: PointInTimeDatasetSnapshot }>)
      .then(body => {
        if (!current) return;
        setSnapshot(body.snapshot);
        setModel(body);
      })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : "Saved model run is unavailable."); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [runId]);

  async function runModel(datasetSnapshotId: string, overrides?: IntegratedModelAssumptions, schedules?: Partial<SpecializedModelSchedules>) {
    const response = await apiRequest("POST", "/api/financial-models/integrated", {
      datasetSnapshotId,
      ...(overrides ? { assumptions: overrides } : {}), ...(schedules ? { schedules } : {}),
    });
    const body = await response.json() as ModelResponse;
    setModel(body);
    setRunId(body.receipt.runId);
    setAssumptions(body.result.assumptions);
    setScheduleState(body.result.specializedSchedules as unknown as Record<string, unknown>);
    const varianceResponse = await apiRequest("GET", `/api/financial-models/integrated/variance?symbol=${encodeURIComponent(body.result.symbol)}`);
    setVariance(await varianceResponse.json() as VarianceReport);
  }

  async function captureAndRun(event?: FormEvent) {
    event?.preventDefault();
    const cleanSymbol = activeSymbol.trim().toUpperCase();
    if (!cleanSymbol) return;
    if (modelInFlight.current) return;
    terminalContext?.setSymbol(cleanSymbol);
    modelInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest("POST", `/api/data-snapshots/financials/${encodeURIComponent(cleanSymbol)}`, {});
      const body = await response.json() as { snapshot: PointInTimeDatasetSnapshot; created: boolean };
      setSnapshot(body.snapshot);
      const revisionResponse = await apiRequest("GET", `/api/data-snapshots/${body.snapshot.id}/revisions`);
      setRevisions(await revisionResponse.json() as RevisionReport);
      await runModel(body.snapshot.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to capture model inputs.");
    } finally {
      modelInFlight.current = false;
      setBusy(false);
    }
  }

  async function rerun() {
    if (!snapshot || !assumptions || modelInFlight.current) return;
    modelInFlight.current = true;
    setBusy(true);
    setError(null);
    try { await runModel(snapshot.id, assumptions, scheduleState as Partial<SpecializedModelSchedules>); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to run the model."); }
    finally { modelInFlight.current = false; setBusy(false); }
  }

  async function saveCompletedRun() {
    if (!model || !selectedDestination || !saveIsReviewed || busy || saveInFlight.current ||
      !chatDestination && projectsQuery.isError) return;
    const capturedKey = currentSaveReviewKey;
    if (!capturedKey) return;
    saveInFlight.current = true;
    setSaveReviewError(null);
    const displayed = model;
    const request = {
      id: ++saveRequestId.current,
      runId: displayed.receipt.runId,
      ...selectedDestination,
    };
    dispatchArtifactSave({ type: "started", request });
    try {
      // The P11 server reopens the actual owned run and rechecks the current
      // dataset/source entitlement, financial outputs and calculated hashes.
      const res = await apiRequest("GET", `/api/financial-models/integrated/runs/${encodeURIComponent(request.runId)}`);
      const reopened = await res.json() as ModelResponse;
      if (!verifiedReopenedModelRun(displayed, reopened) ||
        currentSaveReviewKeyRef.current !== capturedKey)
        throw new Error("The selected run, approved destination, source access or receipt changed. Review again; no save was submitted.");
      const detail = await saveIntegratedModelRunArtifact(request.runId, {
        projectId: request.projectId,
        ...("owningChatId" in request ? { owningChatId: request.owningChatId } : {}),
      });
      // A successful response is not enough to declare which run was saved:
      // require the engine-produced immutable P4 source/version references.
      if (!savedModelArtifactMatchesReceipt(detail, displayed.receipt, request)) {
        throw new Error("Save returned a workbook with an unexpected run/dataset receipt or destination. Check the Library before retrying; the server may have committed it.");
      }
      invalidateArtifacts(detail.artifact.projectId, detail.artifact.id);
      invalidateProjects(detail.artifact.projectId);
      dispatchArtifactSave({ type: "saved", request, detail });
      setSavedOutput({ request, artifactId: detail.artifact.id, version: detail.version.version });
      setReviewedSaveKey(null);
    } catch (cause) {
      dispatchArtifactSave({ type: "failed", request, message: cause instanceof Error ? cause.message : "Unable to verify this reviewed engine run before saving." });
      setReviewedSaveKey(null);
    } finally {
      saveInFlight.current = false;
    }
  }

  function updateAssumption(key: keyof IntegratedModelAssumptions, raw: string, unit: AssumptionUnit) {
    if (!assumptions) return;
    const number = Number(raw);
    if (!Number.isFinite(number)) return;
    setAssumptions({ ...assumptions, [key]: unit === "%" ? number / 100 : number });
  }

  const statement = useMemo(() => model?.result.forecast.map((period) => ({
    year: period.fiscalYear,
    values: (["income", "cashflow", "balance"].includes(tab) ? period[tab as "income" | "cashflow" | "balance"] : period.schedules) as unknown as Record<string, number>,
  })) ?? [], [model, tab]);

  if (openedArtifact) {
    return <div className="h-full overflow-auto bg-[#050607] p-3 text-foreground font-terminal" data-testid="integrated-model-artifact">
      <button type="button" data-testid="integrated-model-back" onClick={() => setOpenedArtifact(null)} className="mb-3 border border-border px-3 py-2 text-[10px]">Back to Model</button>
      <p className="mb-3 break-words text-[10px] text-muted-foreground">Canonical Artifact {openedArtifact.detail.artifact.id} · saved v{openedArtifact.detail.version.version} · from run {openedArtifact.request.runId}</p>
      <Suspense fallback={<p role="status">Opening canonical Artifact…</p>}>
        <ArtifactPane artifactId={openedArtifact.detail.artifact.id} projectId={openedArtifact.detail.artifact.projectId} sessions={sessionsQuery.data ?? []}
          onClose={() => setOpenedArtifact(null)}
          onAsk={(id, title, stagedPrompt) => {
            if (terminalContext?.onAsk) { terminalContext.onAsk(id, title, stagedPrompt); return; }
            if (openedArtifact.request.projectId !== null) {
              window.location.hash = formatLiosAddress({ kind: "project", projectId: openedArtifact.request.projectId });
              setExperienceSurface("projects");
            }
          }} />
      </Suspense>
    </div>;
  }

  return (
    <div className="h-full overflow-auto bg-[#050607] text-foreground font-terminal" data-testid="integrated-model-studio" data-model-run-id={model?.receipt.runId}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-[#080a0b] px-3 py-2">
        <div className="mr-auto">
          <div className="text-[11px] tracking-[0.18em] text-[hsl(38,95%,55%)]">INTEGRATED MODEL STUDIO</div>
          <div className="text-[8px] tracking-widest text-muted-foreground">POINT-IN-TIME MODEL INPUT / DETERMINISTIC ACCOUNTING ENGINE</div>
        </div>
        <form className="flex items-center gap-1.5" onSubmit={captureAndRun}>
          <input aria-label="Model symbol" value={activeSymbol} onChange={(event) => setActiveSymbol(event.target.value.toUpperCase())}
            className="h-7 w-24 border border-border bg-black px-2 text-[10px] text-[hsl(186,80%,60%)] outline-none focus:border-[hsl(38,95%,50%)]" />
          <button type="submit" data-testid="integrated-model-capture-run" disabled={busy} className="flex h-7 items-center gap-1.5 border border-[hsl(38,95%,45%)] px-2.5 text-[9px] tracking-wider text-[hsl(38,95%,58%)] disabled:opacity-50">
            {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />} CAPTURE & RUN
          </button>
          <button type="button" data-testid="integrated-model-run-scenario" onClick={rerun} disabled={busy || !assumptions} title="Run current assumptions against the frozen snapshot"
            className="flex h-7 items-center gap-1.5 border border-border px-2.5 text-[9px] tracking-wider text-foreground disabled:opacity-40">
            <Play className="h-3 w-3" /> RUN SCENARIO
          </button>
        </form>
      </div>

      {error && <div className="border-b border-red-900/60 bg-red-950/20 px-3 py-2 text-[9px] text-red-400">{error}</div>}

      {model && (
        <section aria-label="Save completed model run" className="border-b border-border bg-[#080a0b] px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[9px] text-muted-foreground">
              SAVE DESTINATION
              <select aria-label="Model Artifact destination" data-testid="integrated-model-project" value={destination} onChange={(event) => setDestination(event.target.value)}
                disabled={Boolean(artifactSave.pending)} className="h-8 max-w-[280px] border border-border bg-black px-2 text-[10px] text-foreground disabled:opacity-50">
                <option value="" disabled>Choose a Chat or Project…</option>
                {terminalContext?.target?.projectId === null && terminalContext.target.owningChatId && <option value="chat">This Chat</option>}
                {(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <button type="button" data-testid="integrated-model-save-artifact" onClick={() => void saveCompletedRun()}
              disabled={busy || Boolean(artifactSave.pending) || !saveIsReviewed || !selectedDestination || !chatDestination && projectsQuery.isError} aria-busy={Boolean(artifactSave.pending)}
              className="flex h-8 items-center gap-1.5 border border-[hsl(38,95%,45%)] px-3 text-[9px] text-[hsl(38,95%,58%)] disabled:opacity-40">
              {artifactSave.pending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {artifactSave.pending ? "Saving model Artifact…" : displayedRunSaved ? "Save same run again" : "Save completed run"}
            </button>
            {artifactSave.saved && <button type="button" data-testid="integrated-model-open-artifact" onClick={() => setOpenedArtifact(artifactSave.saved)}
              className="flex h-8 items-center gap-1.5 border border-border px-3 text-[9px] text-foreground">
              <ExternalLink className="h-3 w-3" /> Open saved Artifact
            </button>}
          </div>
          <div className="mt-3 rounded-lg border border-border/65 bg-background/45 p-3" data-testid="integrated-model-save-review">
            <p className="font-ui text-xs font-semibold text-foreground">Review the completed calculation before saving</p>
            <dl className="mt-2 grid gap-2 font-ui text-xs sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Run ID</dt><dd className="break-all font-mono">{model.receipt.runId}</dd></div>
              <div><dt className="text-muted-foreground">Result SHA-256</dt><dd className="break-all font-mono">{model.receipt.resultHash}</dd></div>
              <div><dt className="text-muted-foreground">Dataset snapshot</dt><dd className="break-all font-mono">{model.receipt.datasetSnapshotId}</dd></div>
              <div><dt className="text-muted-foreground">Dataset SHA-256</dt><dd className="break-all font-mono">{model.receipt.datasetContentHash}</dd></div>
              <div><dt className="text-muted-foreground">Input SHA-256</dt><dd className="break-all font-mono">{model.receipt.inputHash ?? "Not returned in current response; verified on server reopening"}</dd></div>
              <div><dt className="text-muted-foreground">Destination</dt><dd className="break-words">{selectedDestination?.destinationLabel ?? "Choose a Chat or Project"}</dd></div>
              <div><dt className="text-muted-foreground">Engine checks</dt><dd>{model.result.checks.passed && model.result.checks.circularConverged ? "Passed · converged" : "Failed or not converged"}</dd></div>
            </dl>
            <p className="mt-2 font-ui text-xs text-muted-foreground">Only the completed P11 run will be saved, not any later unsent assumptions. Verify the current destination and hashes. P4 rechecks your present source access before writing a versioned workbook.</p>
            <button type="button" data-testid="integrated-model-confirm-review"
              disabled={busy || Boolean(artifactSave.pending) || !currentSaveReviewKey}
              aria-pressed={saveIsReviewed}
              onClick={() => { setReviewedSaveKey(currentSaveReviewKey); setSaveReviewError(null); }}
              className="mt-3 min-h-10 rounded-lg border border-amber-300/40 px-3 font-ui text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-40">
              {saveIsReviewed ? "Receipt and destination reviewed" : "Confirm this receipt and destination"}
            </button>
            {saveReviewError && <p role="alert" className="mt-2 text-xs text-red-400">{saveReviewError}</p>}
            {!currentSaveReviewKey && <p role="alert" className="mt-2 font-ui text-xs text-amber-200">Saving is unavailable until the deterministic engine receipt, dataset hashes, destination and model checks are valid.</p>}
          </div>
          <p className="mt-2 text-[9px] text-muted-foreground">Saves the displayed completed run, not unsent edits. Run Scenario first to include edited assumptions or schedules.</p>
          {projectsQuery.isLoading && <p role="status" className="mt-2 text-[10px] text-muted-foreground">Loading destination Projects…</p>}
          {projectsQuery.isError && <p role="alert" className="mt-2 text-[10px] text-red-400">Unable to load destination Projects. <button type="button" onClick={() => void projectsQuery.refetch()} className="underline">Retry</button></p>}
          {!terminalContext?.target?.owningChatId && !projectsQuery.isLoading && !projectsQuery.isError && !(projectsQuery.data ?? []).length && <p className="mt-2 text-[10px] text-muted-foreground">Choose or create a persistent Project before saving this run.</p>}
          {saveNotice && <p role={artifactSave.failure ? "alert" : "status"} aria-live="polite" data-testid="integrated-model-artifact-status"
            data-artifact-id={artifactSave.saved?.detail.artifact.id} data-artifact-version={artifactSave.saved?.detail.version.version}
            data-saved-run-id={artifactSave.saved?.request.runId}
            className={cn("mt-2 break-words text-[10px]", artifactSave.failure ? "text-red-400" : "text-[hsl(186,80%,60%)]")}>{saveNotice}</p>}
        </section>
      )}

      {!model || !snapshot || !assumptions ? (
        <div className="flex h-[calc(100%-48px)] items-center justify-center px-8 text-center">
          <div>
            <Database className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
            <div className="text-[10px] tracking-widest text-muted-foreground">CAPTURE A FROZEN FINANCIAL DATASET TO BEGIN</div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-[calc(100%-48px)] grid-cols-1 xl:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="border-b border-border p-3 xl:border-b-0 xl:border-r">
            <div className="mb-3 grid grid-cols-3 gap-px bg-border">
              <Metric label="QUALITY" value={`${(snapshot.quality.score * 100).toFixed(0)}%`} />
              <Metric label="PERIODS" value={String(snapshot.payload.periods.length)} />
              <Metric label="CHECKS" value={model.result.checks.passed ? "PASS" : "FAIL"} good={model.result.checks.passed} />
            </div>
            <SectionTitle>ASSUMPTIONS</SectionTitle>
            <label className="mb-2 flex h-7 items-center justify-between border border-border bg-black px-2 text-[8px] text-muted-foreground">
              PRICE × VOLUME DRIVERS
              <input type="checkbox" checked={assumptions.usePriceVolumeDrivers} onChange={(event) => setAssumptions({ ...assumptions, usePriceVolumeDrivers: event.target.checked })} />
            </label>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 xl:grid-cols-1">
              {ASSUMPTION_FIELDS.map((field) => {
                const value = assumptions[field.key];
                const display = field.unit === "%" ? Number(value) * 100 : Number(value);
                return <label key={field.key} className="grid grid-cols-[1fr_78px] items-center gap-2 text-[8px] text-muted-foreground">
                  <span>{field.label.toUpperCase()}</span>
                  <span className="flex items-center border border-border bg-black">
                    <input type="number" step={field.unit === "years" ? 1 : 0.1} value={Number(display.toFixed(3))}
                      onChange={(event) => updateAssumption(field.key, event.target.value, field.unit)}
                      className="h-6 min-w-0 flex-1 bg-transparent px-1.5 text-right text-[9px] text-foreground outline-none" />
                    <span className="pr-1 text-[7px]">{field.unit === "years" ? "Y" : field.unit === "days" ? "D" : field.unit === "%" ? "%" : field.unit === "money" ? "$" : "#"}</span>
                  </span>
                </label>;
              })}
            </div>
            <details className="mt-3 border-t border-border pt-2">
              <summary className="cursor-pointer text-[8px] tracking-widest text-[hsl(38,95%,55%)]">SPECIALIZED SCHEDULE INPUT</summary>
              <StructuredJsonEditor schema={SPECIALIZED_SCHEDULE_SCHEMA} value={scheduleState} onChange={setScheduleState} className="mt-2" />
            </details>
          </aside>

          <main className="min-w-0">
            <section className="grid grid-cols-2 gap-px border-b border-border bg-border lg:grid-cols-5">
              <Clock label="EFFECTIVE" value={shortDate(snapshot.effectiveAt)} />
              <Clock label="PUBLISHED" value={shortDate(snapshot.publishedAt)} />
              <Clock label="RETRIEVED" value={shortDate(snapshot.retrievedAt)} />
              <Clock label="AVAILABLE" value={shortDate(snapshot.availableAt)} />
              <Clock label="CREATED" value={shortDate(snapshot.createdAt)} />
            </section>

            <section className="border-b border-border px-3 py-2 text-[8px] text-muted-foreground">
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span>PROVIDER <b className="text-foreground">{snapshot.provider}</b></span>
                <span>CURRENCY <b className="text-foreground">{snapshot.currency || "MIXED"}</b></span>
                <span>SCHEMA <b className="text-foreground">{snapshot.schemaVersion}</b></span>
                <span>SNAPSHOT <b className="text-[hsl(186,80%,60%)]">{snapshot.id.slice(0, 12)}</b></span>
                <span>CONTENT HASH <b className="text-foreground">{snapshot.contentHash.slice(0, 16)}</b></span>
                <span>RESTATEMENT <b className={revisions?.materialChanges ? "text-amber-400" : "text-foreground"}>{revisions ? `${revisions.status.toUpperCase()} / ${revisions.materialChanges} MATERIAL` : "LOADING"}</b></span>
                <span>ACTUAL BRIDGE <b className="text-foreground">{variance?.runs[0]?.status === "measured" ? `${variance.runs[0].rows.length} MEASURED` : "PENDING"}</b></span>
              </div>
              {(snapshot.quality.missingCriticalFields.length > 0 || model.result.checks.warnings.length > 0) && (
                <div className="mt-2 flex gap-2 text-amber-400"><ShieldAlert className="h-3 w-3 shrink-0" />
                  <span>{[...snapshot.quality.missingCriticalFields.map((field) => `Missing ${field}`), ...model.result.checks.warnings].join(" | ")}</span>
                </div>
              )}
            </section>

            {(model.lineage?.modelInput || model.lineage?.valuation) && (
              <section className="border-b border-border bg-[#060708] px-3 py-2 text-[8px] text-muted-foreground">
                <div className="mb-1 text-[hsl(38,95%,55%)] tracking-widest">MODEL INPUT LINEAGE</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {model.lineage.modelInput && (
                    <>
                      <span>INPUT <b className="text-[hsl(186,80%,60%)]">{model.lineage.modelInput.id.slice(0, 12)}</b></span>
                      <span>SOURCES <b className="text-foreground">{model.lineage.modelInput.sourceCellRefs.length}</b></span>
                      <span>TARGETS <b className="text-foreground">{model.lineage.modelInput.targetCellRefs.length}</b></span>
                      <span>INPUT HASH <b className="text-foreground">{model.lineage.modelInput.inputHash.slice(0, 16)}</b></span>
                    </>
                  )}
                  {model.lineage.valuation && (
                    <>
                      <span>VALUATION <b className="text-[hsl(186,80%,60%)]">{model.lineage.valuation.id.slice(0, 12)}</b></span>
                      <span>OUTPUT <b className="text-foreground">{model.lineage.valuation.outputName}</b></span>
                      <span>OUTPUT HASH <b className="text-foreground">{model.lineage.valuation.outputHash.slice(0, 16)}</b></span>
                    </>
                  )}
                </div>
              </section>
            )}

            <div className="flex items-center border-b border-border bg-[#080a0b] px-3">
              {(["income", "cashflow", "balance", "debt", "tax", "leases", "equity", "specialized"] as StatementTab[]).map((item) => (
                <button key={item} onClick={() => setTab(item)} className={cn("h-8 border-b-2 px-3 text-[8px] tracking-widest", tab === item ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,58%)]" : "border-transparent text-muted-foreground")}>{item.toUpperCase()}</button>
              ))}
              <div className="ml-auto flex items-center gap-1 text-[8px] text-emerald-400"><CheckCircle2 className="h-3 w-3" /> LINKED</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] border-collapse text-[9px]">
                <thead><tr className="border-b border-border bg-[#080a0b] text-muted-foreground">
                  <th className="sticky left-0 bg-[#080a0b] px-3 py-2 text-left font-normal">USD / REPORTED UNITS</th>
                  {statement.map((period) => <th key={period.year} className="px-3 py-2 text-right font-normal">{period.year}E</th>)}
                </tr></thead>
                <tbody>{ROWS[tab].map((row, index) => <tr key={row.key} className={cn("border-b border-border/50", index % 2 === 1 && "bg-white/[0.015]")}>
                  <td className="sticky left-0 bg-[#050607] px-3 py-2 text-muted-foreground">{row.label}</td>
                  {statement.map((period) => <td key={period.year} className="px-3 py-2 text-right tabular-nums text-foreground">{formatNumber(period.values[row.key] ?? 0)}</td>)}
                </tr>)}</tbody>
              </table>
            </div>

            <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border px-3 py-2 text-[8px] text-muted-foreground">
              <span>MODEL <b className="text-foreground">v{model.result.modelVersion}</b></span>
              <span>BALANCE MAX <b className="text-emerald-400">{model.result.checks.maxBalanceDifference.toExponential(1)}</b></span>
              <span>CASH MAX <b className="text-emerald-400">{model.result.checks.maxCashDifference.toExponential(1)}</b></span>
              <span>RECEIPT <b className="text-[hsl(186,80%,60%)]">{model.receipt.resultHash.slice(0, 16)}</b></span>
              <span>RUN <b className="text-foreground">{model.receipt.runId.slice(0, 12)}</b></span>
              <span>CIRCULAR <b className={model.result.checks.circularConverged ? "text-emerald-400" : "text-red-400"}>{model.result.checks.circularConverged ? "CONVERGED" : "FAILED"}</b></span>
              <span>{model.receipt.deterministic ? "DETERMINISTIC" : "NON-DETERMINISTIC"}</span>
            </footer>
          </main>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className="bg-[#080a0b] px-2 py-2"><div className="text-[7px] text-muted-foreground">{label}</div><div className={cn("mt-0.5 text-[11px]", good && "text-emerald-400")}>{value}</div></div>;
}

function Clock({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#080a0b] px-3 py-2"><div className="text-[7px] text-muted-foreground">{label}</div><div className="mt-0.5 text-[9px] text-foreground">{value}</div></div>;
}

function SectionTitle({ children }: { children: string }) {
  return <div className="mb-2 border-b border-border pb-1 text-[8px] tracking-widest text-[hsl(38,95%,55%)]">{children}</div>;
}
