import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useGatewayEvent, useGatewayReady } from "@/lib/gateway/GatewayProvider";
import { useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle2, Clock, Copy, FlaskConical, GitCompareArrows, Link, Loader2, Play, Plus, RefreshCw, Save, Square, XCircle } from "lucide-react";
import type { QuantModelRegistryEntry } from "@shared/quantModelRegistry";
import type { QuantWorkspace } from "@shared/quantLab";
import { apiRequest } from "@/lib/queryClient";
import { ADVANCED_QUANT_EXAMPLES } from "@/lib/advancedQuantExamples";
import { StructuredJsonEditor, applySchemaDefaults } from "@/components/ui/StructuredJsonEditor";
import { QUANT_LAB_MODEL_SCHEMAS } from "@/lib/quantLabModelSchemas";
import { buildDynamicAnalyticsCatalog, buildQuantSeries } from "@shared/waveCContracts";

type LabModel = QuantModelRegistryEntry & { workspace: QuantWorkspace; executable: boolean };
type Experiment = { id: string; name: string; description: string; workspace: QuantWorkspace; status: "active" | "archived"; modelId: string; modelVersion: string; parameters: Record<string, unknown>; datasetSnapshotIds: string[]; seed: number | null; timeoutMs: number; investigationId: number | null; organizationId: number | null; parentExperimentId: string | null; updatedAt: string };
type Run = { id: string; experimentId: string; sequence: number; status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out"; progressPct: number; modelId: string; modelVersion: string; seed: number | null; inputHash: string; outputHash: string | null; cachedFromRunId: string | null; output: unknown; diagnostics: Record<string, unknown>; warnings: string[]; error: string | null; queuedAt: string; durationMs: number | null };
type Runtime = { version: string; concurrency: number; active: number; queued: number; executableModels: number; limits: Record<string, number> };
type Snapshot = { id: string; entityKey: string; dataClass: string; provider: string; contentHash: string; availableAt: string };
type CompareResult = { comparison: { equal: boolean; comparedPaths: number; changedPaths: number; changes: Array<{ path: string; left: unknown; right: unknown; delta: number | null; deltaPct: number | null }>; truncated: boolean } };

const WORKSPACES: Array<{ id: QuantWorkspace; label: string }> = [
  { id: "dataset", label: "DATASET" }, { id: "statistics", label: "STATISTICS" },
  { id: "econometrics", label: "ECONOMETRICS" }, { id: "forecasting", label: "FORECASTING" },
  { id: "risk", label: "RISK" }, { id: "portfolio", label: "PORTFOLIO" },
  { id: "derivatives", label: "DERIVATIVES" }, { id: "backtest", label: "BACKTEST" },
  { id: "ml", label: "ML" }, { id: "results", label: "RESULTS" }, { id: "registry", label: "REGISTRY" },
];

const EXAMPLES: Record<string, Record<string, unknown>> = {
  ...ADVANCED_QUANT_EXAMPLES,
  "python.stats.normality": { data: [1.2, 1.8, 2.1, 2.4, 2.9, 3.2, 3.8, 4.1, 4.7, 5.2] },
  "python.stats.correlation": { x: [1, 2, 3, 4, 5, 6], y: [1.2, 1.9, 3.1, 3.8, 5.2, 5.9] },
  "python.stats.ols-diagnostics": { y: [2.1, 3.9, 6.2, 7.8, 10.1, 11.9], x: [[1, 2, 3, 4, 5, 6]] },
  "python.stats.descriptive-diagnostics": { data: [101, 102, 99, 103, null, 100, 98, 104, 101, 135], trimProportion: 0.05, winsorProportion: 0.05, outlierZThreshold: 3.5 },
  "python.stats.distribution-fit": { data: [0.8, 1.1, 1.3, 1.4, 1.8, 2.0, 2.2, 2.5, 3.1, 3.8, 4.2, 5.1], distributions: ["normal", "student_t", "lognormal", "gamma"], nMcSamples: 499, seed: 42 },
  "python.stats.professional-inference": { group1: [0.12, 0.08, 0.15, 0.11, 0.09, 0.14, 0.13, 0.1], group2: [0.06, 0.05, 0.09, 0.07, 0.04, 0.08, 0.06, 0.05], paired: false, alpha: 0.05, alternative: "two-sided", targetPower: 0.8 },
  "python.stats.seeded-resampling": { data: [0.01, -0.004, 0.008, 0.012, -0.006, 0.015, 0.003, -0.002, 0.009, 0.005, -0.007, 0.011], group2: [0.003, -0.006, 0.004, 0.007, -0.009, 0.008, 0.001, -0.005, 0.006, 0.002, -0.008, 0.005], statistic: "mean", confidence: 0.95, iterations: 2000, blockLength: 4, seed: 42 },
  "python.stats.multiple-testing": { pValues: [0.001, 0.01, 0.03, 0.08, 0.2, 0.7], labels: ["VALUE", "QUALITY", "MOMENTUM", "LOW_VOL", "SIZE", "LIQUIDITY"], alpha: 0.05 },
  "python.stats.multivariate-structure": { data: [[1, 1.1, 4], [2, 1.9, 3.8], [3, 3.2, 3.1], [4, 3.9, 2.9], [5, 5.1, 2.2], [6, 5.8, 2], [7, 7.2, 1.4], [8, 7.9, 1.1], [9, 9.1, 0.7], [10, 9.8, 0.4]], featureNames: ["VALUE", "QUALITY", "DEFENSIVE"], nComponents: 2, maxClusters: 4, seed: 42 },
  "python.stats.bayesian-normal": { data: [0.02, 0.01, 0.03, -0.01, 0.015, 0.025, 0.005, 0.018, 0.012, 0.022], priorMean: 0, priorKappa: 0.01, priorAlpha: 2, priorBeta: 0.001, confidence: 0.95, draws: 4000, seed: 42 },
  "python.fixed-income.bond-price": { faceValue: 1000, couponRatePct: 5, frequency: 2, yearsToMaturity: 7, marketYieldPct: 4.5, dayCount: "30/360" },
  "python.portfolio.min-variance": { assets: ["AAPL", "MSFT", "NVDA"], expectedReturns: [0.1, 0.09, 0.14], covMatrix: [[0.04, 0.012, 0.018], [0.012, 0.03, 0.014], [0.018, 0.014, 0.07]], allowShort: false },
  "python.forecasting.sarimax": { series: [100, 102, 101, 104, 106, 105, 108, 110, 109, 112, 114, 113, 116, 118, 117, 120, 122, 121, 124, 126, 125, 128, 130, 129], order: [1, 1, 1], horizon: 6, confidenceLevel: 0.95 },
};

const QUANT_NUMERIC_FIELDS = buildDynamicAnalyticsCatalog().filter((field) => field.numeric);
const QUANT_NUMERIC_FIELD_IDS = new Set(QUANT_NUMERIC_FIELDS.map((field) => field.id));

function loadDataFabricFields(key: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.filter((value): value is string => typeof value === "string" && QUANT_NUMERIC_FIELD_IDS.has(value)))].slice(-12) : [];
  } catch { return []; }
}

function tone(status: Run["status"]) {
  if (status === "succeeded") return "text-emerald-300 border-emerald-400/30";
  if (status === "queued" || status === "running") return "text-sky-300 border-sky-400/30";
  if (status === "cancelled") return "text-muted-foreground border-border";
  return "text-red-300 border-red-400/30";
}

function date(value: string | null | undefined) { return value ? new Date(value).toISOString().replace("T", " ").slice(0, 19) : "-"; }
function pretty(value: unknown) { return JSON.stringify(value, null, 2); }

function QuantResultReceipt({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || !("result" in value) || !("diagnostics" in value)) {
    return <pre className="font-mono text-[7px] whitespace-pre-wrap break-words text-muted-foreground">{pretty(value)}</pre>;
  }
  const receipt = value as { result: unknown; diagnostics: Record<string, unknown>; warnings?: string[] };
  return <div>
    {receipt.warnings?.length ? <div className="mb-3 border-y border-amber-400/25 bg-amber-400/[0.04] px-3 py-2">{receipt.warnings.map((warning) => <div key={warning} className="font-mono text-[7px] leading-relaxed text-amber-200">{warning}</div>)}</div> : null}
    <div className="mb-3 grid grid-cols-2 gap-px border border-border bg-border md:grid-cols-3">{Object.entries(receipt.diagnostics).slice(0, 9).map(([label, item]) => <div key={label} className="min-w-0 bg-background p-2"><div className="truncate font-terminal text-[6px] text-muted-foreground">{label.replaceAll("_", " ").toUpperCase()}</div><div className="mt-1 break-words font-mono text-[7px] text-sky-200">{typeof item === "object" ? pretty(item) : String(item)}</div></div>)}</div>
    <div className="mb-1 font-terminal text-[7px] text-muted-foreground">STATISTICAL RESULT</div>
    <pre className="font-mono text-[7px] whitespace-pre-wrap break-words text-muted-foreground">{pretty(receipt.result)}</pre>
  </div>;
}

export default function QuantLabPanel() {
  const [workspace, setWorkspace] = useTerminalArtifactState<QuantWorkspace>("QuantLabPanel.workspace", "statistics");
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [models, setModels] = useState<LabModel[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedExperimentId, setSelectedExperimentId] = useTerminalArtifactState<string | null>("QuantLabPanel.selectedExperimentId", null);
  const [selectedRunId, setSelectedRunId] = useTerminalArtifactState<string | null>("QuantLabPanel.selectedRunId", null);
  const [compareIds, setCompareIds] = useTerminalArtifactState<string[]>("QuantLabPanel.compareIds", []);
  const [comparison, setComparison] = useState<CompareResult | null>(null);
  const [name, setName] = useTerminalArtifactState("QuantLabPanel.name", "Untitled Quant Experiment");
  const [description, setDescription] = useTerminalArtifactState("QuantLabPanel.description", "");
  const [modelId, setModelId] = useTerminalArtifactState("QuantLabPanel.modelId", "");
  const [parameters, setParameters] = useTerminalArtifactState<Record<string, unknown>>("QuantLabPanel.parameters", {});
  const [rawParameters, setRawParameters] = useTerminalArtifactState("QuantLabPanel.rawParameters", "{}");
  const [datasetIds, setDatasetIds] = useTerminalArtifactState("QuantLabPanel.datasetIds", "");
  const [dataFabricFieldIds, setDataFabricFieldIds] = useState<string[]>(() => loadDataFabricFields("lios.waveC.selectedFields"));
  const [dataFabricFieldId, setDataFabricFieldId] = useTerminalArtifactState("QuantLabPanel.dataFabricFieldId", QUANT_NUMERIC_FIELDS[0]?.id ?? "");
  const [seed, setSeed] = useTerminalArtifactState("QuantLabPanel.seed", "42");
  const [timeoutMs, setTimeoutMs] = useTerminalArtifactState("QuantLabPanel.timeoutMs", "30000");
  const [investigationId, setInvestigationId] = useTerminalArtifactState("QuantLabPanel.investigationId", "");
  const [organizationId, setOrganizationId] = useTerminalArtifactState("QuantLabPanel.organizationId", "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspaceModels = useMemo(() => models.filter((model) => model.workspace === workspace && model.executable), [models, workspace]);
  const selectedModel = models.find((item) => item.id === modelId) ?? null;
  const selectedExperiment = experiments.find((item) => item.id === selectedExperimentId) ?? null;
  const selectedRun = runs.find((item) => item.id === selectedRunId) ?? null;
  const workspaceExperiments = experiments.filter((item) => item.workspace === workspace || workspace === "results");

  async function load() {
    const [runtimeRes, modelsRes, experimentsRes, runsRes, snapshotsRes] = await Promise.all([
      apiRequest("GET", "/api/quant-lab/runtime"), apiRequest("GET", "/api/quant-lab/models"),
      apiRequest("GET", "/api/quant-lab/experiments"), apiRequest("GET", "/api/quant-lab/runs"),
      apiRequest("GET", "/api/quant-lab/datasets?limit=250"),
    ]);
    setRuntime(await runtimeRes.json()); setModels(await modelsRes.json()); setExperiments(await experimentsRes.json());
    setRuns(await runsRes.json()); setSnapshots(await snapshotsRes.json());
  }

  useEffect(() => { load().catch((cause) => setError(cause instanceof Error ? cause.message : "Quant Lab unavailable.")); }, []);
  // Run state changes are pushed by the Home (Gateway `data.invalidate`), so the panel reloads on them, not on a timer.
  useGatewayEvent("data.invalidate", (payload) => { if (payload.topics.includes("quantlab")) load().catch(() => undefined); });
  useGatewayReady(() => { load().catch(() => undefined); });
  useEffect(() => {
    const first = workspaceModels[0]; if (!first || workspace === "results" || workspace === "dataset" || workspace === "registry") return;
    if (!workspaceModels.some((model) => model.id === modelId)) selectModel(first.id);
  }, [workspace, models]);

  function seedParameters(id: string, example: Record<string, unknown>) {
    const schema = QUANT_LAB_MODEL_SCHEMAS[id];
    if (schema) setParameters(applySchemaDefaults(schema, example));
    else setRawParameters(pretty(example));
  }

  function selectModel(id: string) {
    setModelId(id); seedParameters(id, EXAMPLES[id] ?? {});
    const model = models.find((item) => item.id === id); if (model?.determinism === "deterministic") setSeed("");
    else if (model?.determinism === "seeded_stochastic" && !seed) setSeed("42");
  }

  function newExperiment() {
    setSelectedExperimentId(null); setName("Untitled Quant Experiment"); setDescription(""); setDatasetIds("");
    setInvestigationId(""); setOrganizationId(""); setTimeoutMs("30000"); setSeed("42");
    const first = workspaceModels[0]; setModelId(first?.id ?? ""); seedParameters(first?.id ?? "", first ? EXAMPLES[first.id] ?? {} : {});
    setDataFabricFieldIds([]);
  }

  function selectExperiment(experiment: Experiment) {
    setSelectedExperimentId(experiment.id); setName(experiment.name); setDescription(experiment.description); setWorkspace(experiment.workspace);
    setModelId(experiment.modelId); seedParameters(experiment.modelId, experiment.parameters); setDatasetIds(experiment.datasetSnapshotIds.join(", "));
    setSeed(experiment.seed === null ? "" : String(experiment.seed)); setTimeoutMs(String(experiment.timeoutMs));
    setInvestigationId(experiment.investigationId ? String(experiment.investigationId) : ""); setOrganizationId(experiment.organizationId ? String(experiment.organizationId) : "");
    setDataFabricFieldIds(loadDataFabricFields(`lios.quantlab.fields.${experiment.id}`));
  }

  function addDataFabricField() {
    const field = buildQuantSeries(dataFabricFieldId);
    if (!field || dataFabricFieldIds.includes(field.fieldId)) return;
    const next = [...dataFabricFieldIds, field.fieldId];
    setDataFabricFieldIds(next);
    if (selectedExperimentId) window.localStorage.setItem(`lios.quantlab.fields.${selectedExperimentId}`, JSON.stringify(next));
  }

  function removeDataFabricField(fieldId: string) {
    const next = dataFabricFieldIds.filter((id) => id !== fieldId);
    setDataFabricFieldIds(next);
    if (selectedExperimentId) window.localStorage.setItem(`lios.quantlab.fields.${selectedExperimentId}`, JSON.stringify(next));
  }

  function payload() {
    const schema = QUANT_LAB_MODEL_SCHEMAS[modelId];
    return {
      name, description, workspace, modelId, parameters: schema ? parameters : JSON.parse(rawParameters),
      datasetSnapshotIds: datasetIds.split(",").map((value) => value.trim()).filter(Boolean),
      seed: seed ? Number(seed) : null, timeoutMs: Number(timeoutMs),
      investigationId: investigationId ? Number(investigationId) : null, organizationId: organizationId ? Number(organizationId) : null,
    };
  }

  async function saveExperiment() {
    setBusy(true); setError(null);
    try {
      const response = await apiRequest(selectedExperimentId ? "PATCH" : "POST", selectedExperimentId ? `/api/quant-lab/experiments/${selectedExperimentId}` : "/api/quant-lab/experiments", payload());
      const experiment = await response.json() as Experiment;
      setSelectedExperimentId(experiment.id);
      window.localStorage.setItem(`lios.quantlab.fields.${experiment.id}`, JSON.stringify(dataFabricFieldIds));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save experiment."); } finally { setBusy(false); }
  }

  async function runExperiment(id = selectedExperimentId) {
    if (!id) return; setBusy(true); setError(null);
    try { const response = await apiRequest("POST", `/api/quant-lab/experiments/${id}/runs`, {}); const run = await response.json() as Run; setSelectedRunId(run.id); setWorkspace("results"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to queue run."); } finally { setBusy(false); }
  }

  async function action(method: string, path: string, body: unknown = {}) { setBusy(true); setError(null); try { await apiRequest(method, path, body); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); } finally { setBusy(false); } }
  async function compare() { if (compareIds.length !== 2) return; setBusy(true); try { const response = await apiRequest("GET", `/api/quant-lab/compare?left=${compareIds[0]}&right=${compareIds[1]}`); setComparison(await response.json()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Comparison failed."); } finally { setBusy(false); } }

  return (
    <div className="h-full min-h-0 flex flex-col bg-background text-foreground overflow-hidden">
      <header className="shrink-0 border-b border-border px-3 py-2 flex flex-wrap items-center gap-3">
        <FlaskConical className="w-4 h-4 text-amber-300" />
        <div><div className="font-terminal text-[10px] tracking-wider">QUANT LAB & COMPUTE RUNTIME</div><div className="font-mono text-[7px] text-muted-foreground">EXPERIMENTS / ASYNC JOBS / REPRODUCIBLE RECEIPTS</div></div>
        <div className="ml-auto flex items-center gap-3 font-mono text-[7px]">
          <span>{runtime?.executableModels ?? 0} ENGINES</span><span className="text-sky-300">{runtime?.active ?? 0} ACTIVE</span><span>{runtime?.queued ?? 0} QUEUED</span><span>v{runtime?.version ?? "-"}</span>
          <button title="Refresh" onClick={() => load()} className="h-7 w-7 grid place-items-center border border-border hover:text-amber-300"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </header>

      <nav className="shrink-0 border-b border-border flex overflow-x-auto">
        {WORKSPACES.map((item) => <button key={item.id} onClick={() => setWorkspace(item.id)} className={`h-9 shrink-0 px-3 border-r border-border font-terminal text-[7px] ${workspace === item.id ? "bg-amber-400/7 text-amber-300 border-b border-b-amber-400" : "text-muted-foreground hover:text-foreground"}`}>{item.label}</button>)}
      </nav>
      {error && <div className="shrink-0 border-b border-red-400/25 bg-red-400/5 px-3 py-2 font-mono text-[7px] text-red-300">{error}</div>}

      {workspace === "dataset" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-[minmax(130px,.7fr)_minmax(150px,1fr)_110px_minmax(180px,1fr)_80px] border-b border-border bg-black px-3 py-2 font-terminal text-[7px] text-muted-foreground"><span>ENTITY</span><span>CLASS</span><span>PROVIDER</span><span>CONTENT HASH</span><span /></div>
          {snapshots.map((snapshot) => <div key={snapshot.id} className="grid grid-cols-[minmax(130px,.7fr)_minmax(150px,1fr)_110px_minmax(180px,1fr)_80px] items-center border-b border-border/60 px-3 py-2 font-mono text-[7px]"><span>{snapshot.entityKey}</span><span>{snapshot.dataClass.replaceAll("_", " ").toUpperCase()}</span><span>{snapshot.provider.toUpperCase()}</span><span className="truncate text-muted-foreground">{snapshot.contentHash}</span><button title="Attach dataset" onClick={() => setDatasetIds((value) => [...value.split(",").map((v) => v.trim()).filter(Boolean), snapshot.id].filter((v, i, a) => a.indexOf(v) === i).join(", "))} className="h-7 border border-border hover:text-amber-300"><Link className="mx-auto w-3.5 h-3.5" /></button></div>)}
        </div>
      ) : workspace === "registry" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {models.map((model) => <button key={model.id} disabled={!model.executable} onClick={() => { setWorkspace(model.workspace); selectModel(model.id); }} className="w-full grid grid-cols-[minmax(220px,1.5fr)_130px_120px_120px] gap-2 border-b border-border/60 px-3 py-2 text-left enabled:hover:bg-white/[0.025] disabled:opacity-60"><span><b className="block font-terminal text-[8px]">{model.label}</b><span className="font-mono text-[7px] text-muted-foreground">{model.id} / v{model.version}</span></span><span className="font-mono text-[7px]">{model.workspace.toUpperCase()}</span><span className={`font-mono text-[7px] ${model.executable ? "text-sky-300" : "text-muted-foreground"}`}>{model.executable ? "EXECUTABLE" : "CATALOGUED"}</span><span className="font-mono text-[7px] text-muted-foreground">{model.validationLevel.replaceAll("_", " ").toUpperCase()}</span></button>)}
        </div>
      ) : workspace === "results" ? (
        <div className="min-h-0 flex-1 grid lg:grid-cols-[minmax(430px,1.15fr)_minmax(320px,.85fr)] overflow-hidden">
          <div className="min-h-0 overflow-auto border-r border-border">
            <div className="sticky top-0 grid grid-cols-[28px_55px_minmax(160px,1fr)_100px_75px_100px] gap-2 border-b border-border bg-black px-3 py-2 font-terminal text-[7px] text-muted-foreground"><span>A/B</span><span>RUN</span><span>MODEL</span><span>STATUS</span><span>TIME</span><span>QUEUED</span></div>
            {runs.map((run) => <button key={run.id} onClick={() => setSelectedRunId(run.id)} className={`w-full grid grid-cols-[28px_55px_minmax(160px,1fr)_100px_75px_100px] gap-2 items-center border-b border-border/60 px-3 py-2 text-left ${selectedRunId === run.id ? "bg-amber-400/5" : "hover:bg-white/[0.025]"}`}><input aria-label={`Compare run ${run.sequence}`} type="checkbox" checked={compareIds.includes(run.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setCompareIds((ids) => event.target.checked ? [...ids, run.id].slice(-2) : ids.filter((id) => id !== run.id))} /><span className="font-terminal text-[8px]">#{run.sequence}</span><span className="truncate font-mono text-[7px]">{run.modelId}</span><span className={`w-fit border px-1.5 py-0.5 font-terminal text-[7px] ${tone(run.status)}`}>{run.status.toUpperCase()} {run.status === "running" ? `${run.progressPct}%` : ""}</span><span className="font-mono text-[7px]">{run.durationMs === null ? "-" : `${run.durationMs}ms`}</span><span className="font-mono text-[7px] text-muted-foreground">{date(run.queuedAt).slice(5, 16)}</span></button>)}
          </div>
          <div className="min-h-0 flex flex-col overflow-hidden">
            <div className="shrink-0 border-b border-border p-2 flex gap-2">
              <button disabled={compareIds.length !== 2 || busy} onClick={compare} className="h-8 px-3 border border-border font-terminal text-[7px] disabled:opacity-40 hover:border-amber-400/50"><GitCompareArrows className="inline w-3.5 h-3.5 mr-2" />COMPARE A/B</button>
              {selectedRun && (selectedRun.status === "queued" || selectedRun.status === "running") && <button onClick={() => action("POST", `/api/quant-lab/runs/${selectedRun.id}/cancel`)} className="h-8 px-3 border border-red-400/30 text-red-300 font-terminal text-[7px]"><Square className="inline w-3 h-3 mr-2" />CANCEL</button>}
              {selectedRun && !["queued", "running"].includes(selectedRun.status) && <button onClick={() => action("POST", `/api/quant-lab/runs/${selectedRun.id}/rerun`, { bypassCache: true })} className="h-8 px-3 border border-border font-terminal text-[7px]"><RefreshCw className="inline w-3.5 h-3.5 mr-2" />RERUN</button>}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {comparison ? <><div className="mb-2 font-terminal text-[8px] text-amber-300">RUN COMPARISON / {comparison.comparison.changedPaths} OF {comparison.comparison.comparedPaths} PATHS CHANGED</div><pre className="font-mono text-[7px] whitespace-pre-wrap text-muted-foreground">{pretty(comparison.comparison)}</pre></> : selectedRun ? <><div className="grid grid-cols-2 gap-px bg-border border border-border mb-3">{[["STATUS", selectedRun.status], ["INPUT", selectedRun.inputHash.slice(0, 16)], ["OUTPUT", selectedRun.outputHash?.slice(0, 16) ?? "-"], ["CACHE", selectedRun.cachedFromRunId ? "HIT" : "MISS"], ["SEED", selectedRun.seed ?? "-"], ["DURATION", selectedRun.durationMs === null ? "-" : `${selectedRun.durationMs}ms`]].map(([label, value]) => <div key={String(label)} className="bg-background p-2"><div className="font-terminal text-[6px] text-muted-foreground">{label}</div><div className="font-mono text-[8px]">{String(value).toUpperCase()}</div></div>)}</div>{selectedRun.error && <div className="mb-2 text-red-300 font-mono text-[7px]">{selectedRun.error}</div>}<QuantResultReceipt value={selectedRun.output ?? selectedRun.diagnostics} /></> : <div className="h-full grid place-items-center font-terminal text-[8px] text-muted-foreground">SELECT A RUN</div>}
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 grid lg:grid-cols-[260px_minmax(430px,1fr)_300px] overflow-hidden">
          <div className="min-h-0 overflow-auto border-r border-border">
            <div className="sticky top-0 border-b border-border bg-black px-3 py-2 font-terminal text-[7px] text-muted-foreground">{workspace.toUpperCase()} EXPERIMENTS / {workspaceExperiments.length}</div>
            {workspaceExperiments.filter((item) => item.workspace === workspace).map((experiment) => <button key={experiment.id} onClick={() => selectExperiment(experiment)} className={`w-full border-b border-border/60 px-3 py-3 text-left ${selectedExperimentId === experiment.id ? "bg-amber-400/5" : "hover:bg-white/[0.025]"}`}><span className="block truncate font-terminal text-[8px]">{experiment.name}</span><span className="block truncate font-mono text-[7px] text-muted-foreground">{experiment.modelId}</span><span className="mt-1 block font-mono text-[6px] text-muted-foreground">v{experiment.modelVersion} / {date(experiment.updatedAt)}</span></button>)}
          </div>
          <div className="min-h-0 overflow-auto border-r border-border p-3">
            <div className="flex gap-2 mb-2"><button title="New experiment" onClick={newExperiment} className="h-8 w-8 shrink-0 border border-border hover:text-amber-300"><Plus className="mx-auto w-3.5 h-3.5" /></button><input aria-label="Experiment name" value={name} onChange={(event) => setName(event.target.value)} className="h-8 min-w-0 flex-1 border border-border bg-black px-2 font-terminal text-[8px] outline-none focus:border-amber-400/50" /><select aria-label="Quant model" value={modelId} onChange={(event) => selectModel(event.target.value)} className="h-8 min-w-0 flex-1 border border-border bg-black px-2 font-terminal text-[7px] outline-none"><option value="">SELECT MODEL</option>{workspaceModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></div>
            {selectedModel ? <div className="mb-2 grid grid-cols-2 gap-px border border-border bg-border md:grid-cols-4"><div className="bg-background p-2"><div className="font-terminal text-[6px] text-muted-foreground">CATEGORY</div><div className="font-mono text-[7px]">{selectedModel.category.replaceAll("_", " ").toUpperCase()}</div></div><div className="bg-background p-2"><div className="font-terminal text-[6px] text-muted-foreground">VALIDATION</div><div className="font-mono text-[7px] text-amber-200">{selectedModel.validationLevel.replaceAll("_", " ").toUpperCase()}</div></div><div className="bg-background p-2"><div className="font-terminal text-[6px] text-muted-foreground">DETERMINISM</div><div className="font-mono text-[7px]">{selectedModel.determinism.replaceAll("_", " ").toUpperCase()}</div></div><div className="bg-background p-2"><div className="font-terminal text-[6px] text-muted-foreground">VERSION</div><div className="font-mono text-[7px]">v{selectedModel.version}</div></div>{selectedModel.limitations[0] ? <div className="col-span-2 bg-background p-2 md:col-span-4"><div className="font-terminal text-[6px] text-muted-foreground">MODEL LIMITATION</div><div className="mt-1 font-mono text-[7px] leading-relaxed text-muted-foreground">{selectedModel.limitations[0]}</div></div> : null}</div> : null}
            <textarea aria-label="Description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="EXPERIMENT DESCRIPTION" className="h-16 w-full resize-none border border-border bg-black p-2 font-mono text-[7px] outline-none focus:border-amber-400/50" />
            <div className="mt-2 font-terminal text-[7px] text-muted-foreground">PARAMETERS{QUANT_LAB_MODEL_SCHEMAS[modelId] ? "" : " JSON"}</div>
            {QUANT_LAB_MODEL_SCHEMAS[modelId] ? (
              <StructuredJsonEditor schema={QUANT_LAB_MODEL_SCHEMAS[modelId]} value={parameters} onChange={setParameters} className="mt-1" />
            ) : (
              <textarea aria-label="Parameters JSON" value={rawParameters} onChange={(event) => setRawParameters(event.target.value)} className="mt-1 h-52 w-full resize-y border border-border bg-black p-2 font-mono text-[7px] leading-relaxed outline-none focus:border-amber-400/50" />
            )}
            <div className="mt-2 font-terminal text-[7px] text-muted-foreground">DATASET SNAPSHOT IDS</div><input aria-label="Dataset snapshot IDs" value={datasetIds} onChange={(event) => setDatasetIds(event.target.value)} placeholder="UUID, UUID" className="mt-1 h-8 w-full border border-border bg-black px-2 font-mono text-[7px] outline-none" />
            <div className="mt-3 border border-cyan-400/20 bg-cyan-400/[0.025] p-2.5">
              <div className="font-terminal text-[7px] text-cyan-200">DATA FABRIC NUMERIC INPUTS</div>
              <div className="mt-1 font-mono text-[6.5px] leading-relaxed text-muted-foreground">Select canonical numeric fields for this experiment. Values are only computed after an attributed snapshot is attached; unavailable observations are never synthesized.</div>
              <div className="mt-2 flex flex-wrap gap-2"><select aria-label="Data Fabric numeric field" value={dataFabricFieldId} onChange={(event) => setDataFabricFieldId(event.target.value)} className="h-7 min-w-0 flex-1 border border-border bg-black px-2 font-terminal text-[7px] outline-none">{QUANT_NUMERIC_FIELDS.map((field) => <option key={field.id} value={field.id}>{field.label.toUpperCase()} · {field.id}</option>)}</select><button type="button" onClick={addDataFabricField} className="h-7 border border-cyan-400/35 px-2 font-terminal text-[7px] text-cyan-300 hover:bg-cyan-400/10"><Plus className="mr-1 inline h-3 w-3" />ADD FIELD</button></div>
              {dataFabricFieldIds.length ? <div className="mt-2 flex flex-wrap gap-1.5">{dataFabricFieldIds.map((fieldId) => <span key={fieldId} className="flex items-center gap-1 rounded-full border border-cyan-400/25 px-2 py-1 font-mono text-[6.5px] text-cyan-200">{QUANT_NUMERIC_FIELDS.find((field) => field.id === fieldId)?.label ?? fieldId}<button type="button" onClick={() => removeDataFabricField(fieldId)} aria-label={`Remove Data Fabric field ${fieldId}`}><XCircle className="h-2.5 w-2.5" /></button></span>)}</div> : <div className="mt-2 font-mono text-[6.5px] text-muted-foreground">No dynamic fields selected.</div>}
            </div>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2"><label className="font-terminal text-[6px] text-muted-foreground">SEED<input aria-label="Seed" value={seed} onChange={(event) => setSeed(event.target.value)} className="mt-1 h-8 w-full border border-border bg-black px-2 font-mono text-[8px] text-foreground" /></label><label className="font-terminal text-[6px] text-muted-foreground">TIMEOUT MS<input aria-label="Timeout milliseconds" value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} className="mt-1 h-8 w-full border border-border bg-black px-2 font-mono text-[8px] text-foreground" /></label><label className="font-terminal text-[6px] text-muted-foreground">INVESTIGATION<input aria-label="Investigation ID" value={investigationId} onChange={(event) => setInvestigationId(event.target.value)} className="mt-1 h-8 w-full border border-border bg-black px-2 font-mono text-[8px] text-foreground" /></label><label className="font-terminal text-[6px] text-muted-foreground">ORGANIZATION<input aria-label="Organization ID" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="mt-1 h-8 w-full border border-border bg-black px-2 font-mono text-[8px] text-foreground" /></label></div>
            <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || !modelId} onClick={saveExperiment} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[7px] disabled:opacity-40"><Save className="inline w-3.5 h-3.5 mr-2" />{selectedExperimentId ? "SAVE VERSION" : "SAVE EXPERIMENT"}</button><button disabled={busy || !selectedExperimentId} onClick={() => runExperiment()} className="h-8 px-3 border border-emerald-400/35 text-emerald-300 font-terminal text-[7px] disabled:opacity-40">{busy ? <Loader2 className="inline w-3.5 h-3.5 mr-2 animate-spin" /> : <Play className="inline w-3.5 h-3.5 mr-2" />}QUEUE RUN</button></div>
          </div>
          <div className="min-h-0 overflow-auto">
            <div className="border-b border-border px-3 py-2 font-terminal text-[7px] text-muted-foreground">EXPERIMENT CONTROL</div>
              {selectedExperiment ? <><div className="p-3 border-b border-border"><div className="font-terminal text-[9px]">{selectedExperiment.name}</div><div className="mt-1 font-mono text-[7px] text-muted-foreground">{selectedExperiment.id}</div><div className="mt-2 flex gap-2"><button title="Clone experiment" onClick={() => action("POST", `/api/quant-lab/experiments/${selectedExperiment.id}/clone`)} className="h-8 w-8 border border-border hover:text-amber-300"><Copy className="mx-auto w-3.5 h-3.5" /></button><button title={selectedExperiment.status === "archived" ? "Restore experiment" : "Archive experiment"} onClick={() => action("PATCH", `/api/quant-lab/experiments/${selectedExperiment.id}`, { status: selectedExperiment.status === "archived" ? "active" : "archived" })} className="h-8 w-8 border border-border hover:text-amber-300"><Archive className="mx-auto w-3.5 h-3.5" /></button><button disabled={selectedExperiment.status === "archived"} title="Run experiment" onClick={() => runExperiment(selectedExperiment.id)} className="h-8 w-8 border border-border hover:text-emerald-300 disabled:opacity-40"><Play className="mx-auto w-3.5 h-3.5" /></button></div></div><div className="p-3"><div className="font-terminal text-[7px] text-muted-foreground">RECENT RUNS</div>{runs.filter((run) => run.experimentId === selectedExperiment.id).slice(0, 12).map((run) => <button key={run.id} onClick={() => { setSelectedRunId(run.id); setWorkspace("results"); }} className="mt-2 w-full flex items-center gap-2 border-b border-border/50 pb-2 text-left">{run.status === "succeeded" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" /> : run.status === "running" || run.status === "queued" ? <Clock className="w-3.5 h-3.5 text-sky-300" /> : <XCircle className="w-3.5 h-3.5 text-red-300" />}<span className="font-terminal text-[7px]">RUN #{run.sequence}</span><span className="ml-auto font-mono text-[6px] text-muted-foreground">{run.status.toUpperCase()}</span></button>)}</div></> : <div className="h-full grid place-items-center font-terminal text-[8px] text-muted-foreground">SELECT OR CREATE EXPERIMENT</div>}
          </div>
        </div>
      )}
    </div>
  );
}
