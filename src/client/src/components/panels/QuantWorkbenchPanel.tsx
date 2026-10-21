import { useTerminalArtifactContext, useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useEffect, useState, type ReactNode } from "react";
import {
  QUANT_MODEL_FAMILIES,
  modelsForQuantFamily,
  type QuantModelFamilyKey,
  type QuantModelKey,
} from "@/lib/quantModelCatalog";
import { loadTerminalViewState, patchTerminalViewState } from "@/lib/terminalViewState";
import QuantWorkbenchLegacyPanel from "./QuantWorkbenchLegacyPanel";
import { InstitutionalWorkspaceShell, MethodologyCard, WorkstationOverview } from "./workstations/InstitutionalWorkspaceShell";
import { WORKSTATION_DEFINITIONS } from "./workstations/workstationDefinitions";

type Section = "overview" | "lab" | "methodology";

const SECTIONS = new Set<Section>(["overview", "lab", "methodology"]);
const FAMILY_KEYS = new Set<QuantModelFamilyKey>(QUANT_MODEL_FAMILIES.map((item) => item.key));

function initialState() {
  const state = loadTerminalViewState("quantworkbench");
  const section = typeof state.section === "string" && SECTIONS.has(state.section as Section)
    ? state.section as Section
    : "lab";
  const family = typeof state.family === "string" && FAMILY_KEYS.has(state.family as QuantModelFamilyKey)
    ? state.family as QuantModelFamilyKey
    : "factor-structure";
  return { section, family };
}

export default function QuantWorkbenchPanel() {
  const terminal = useTerminalArtifactContext();
  const initial = terminal ? { section: "lab" as Section, family: "factor-structure" as QuantModelFamilyKey } : initialState();
  // Operational workstations open on computation. Section + family focus are
  // persisted so analytical workspace snapshots retain where the analyst was
  // navigating even before the legacy 18-mode lab is internally decomposed.
  const [section, setSection] = useTerminalArtifactState<Section>("QuantWorkbenchPanel.section", initial.section);
  const [selectedFamily, setSelectedFamily] = useTerminalArtifactState<QuantModelFamilyKey>("QuantWorkbenchPanel.selectedFamily", initial.family);
  const [selectedModel, setSelectedModel] = useTerminalArtifactState<QuantModelKey>("QuantWorkbenchLegacyPanel.tab", "pca");
  const definition = WORKSTATION_DEFINITIONS.quant;
  const selectedFamilyDefinition = QUANT_MODEL_FAMILIES.find((item) => item.key === selectedFamily) ?? QUANT_MODEL_FAMILIES[0];
  const selectedFamilyModels = modelsForQuantFamily(selectedFamilyDefinition.key);
  useEffect(() => {
    if (!selectedFamilyModels.some(model => model.key === selectedModel) && selectedFamilyModels[0]) setSelectedModel(selectedFamilyModels[0].key);
  }, [selectedFamily]);

  useEffect(() => {
    if (!terminal) patchTerminalViewState("quantworkbench", undefined, { section, family: selectedFamily });
  }, [section, selectedFamily]);

  let body: ReactNode;
  if (section === "lab") {
    body = (
      <div className="flex h-full min-h-0 flex-col" data-quant-lab data-quant-family={selectedFamily}>
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border/60 bg-[#060606] px-2 py-1.5 scrollbar-thin">
          <span className="shrink-0 font-terminal text-[7px] font-bold tracking-widest text-muted-foreground">MODEL FAMILY</span>
          <select
            value={selectedFamily}
            onChange={(event) => setSelectedFamily(event.target.value as QuantModelFamilyKey)}
            className="min-w-0 max-w-[220px] border border-border bg-[#080808] px-2 py-1 font-terminal text-[8px] text-amber-300 outline-none"
            aria-label="Quant model family focus"
          >
            {QUANT_MODEL_FAMILIES.map((family) => <option key={family.key} value={family.key}>{family.label}</option>)}
          </select>
          <span className="hidden min-w-0 truncate font-terminal text-[7px] text-muted-foreground lg:inline">
            {selectedFamilyModels.map((model) => model.shortLabel).join(" · ")}
          </span>
          <button type="button" onClick={() => setSection("overview")} className="ml-auto shrink-0 border border-border px-2 py-1 font-terminal text-[7px] text-muted-foreground hover:border-amber-500/40 hover:text-amber-300">
            MODEL MAP
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <QuantWorkbenchLegacyPanel selectedModel={selectedModel} onModelChange={model => { setSelectedModel(model); const family = QUANT_MODEL_FAMILIES.find(item => item.modelKeys.includes(model)); if (family) setSelectedFamily(family.key); }}/>
        </div>
      </div>
    );
  } else if (section === "methodology") {
    body = (
      <div className="h-full overflow-y-auto scrollbar-thin p-4">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <MethodologyCard title="PCA" formula="Σvᵢ = λᵢvᵢ" detail="Principal components summarize covariance structure. High explained variance does not by itself identify an economic causal factor." />
            <MethodologyCard title="OLS / REGRESSION" formula="β̂ = (XᵀX)⁻¹Xᵀy" detail="Regression coefficients are conditional statistical estimates. Interpretation depends on specification, residual behavior, sample size, and identification assumptions." />
            <MethodologyCard title="ENGLE-GRANGER" detail="Cointegration testing asks whether a linear combination of non-stationary series is stationary. Passing a historical test does not guarantee a future trading relationship." />
            <MethodologyCard title="KALMAN FILTER" detail="Dynamic beta treats exposure as a latent state updated from observations. Process/measurement-noise assumptions determine how quickly the estimate adapts." />
            <MethodologyCard title="COPULA" detail="A copula separates marginal distributions from dependence structure. Tail-dependence estimates can be unstable in small samples and should not be read as certainty." />
            <MethodologyCard title="ARIMA / SARIMAX / GARCH" detail="Forecast and volatility models require stationarity/specification diagnostics. Model confidence is conditional on the historical process remaining relevant." />
            <MethodologyCard title="BOOTSTRAP / PERMUTATION" detail="Resampling methods quantify sampling uncertainty under specific exchangeability or resampling assumptions; they do not repair biased or non-representative data." />
            <MethodologyCard title="SABR / HESTON" detail="Volatility-surface models describe smile/skew dynamics under calibrated parameters. Calibration quality and arbitrage diagnostics matter as much as the fitted curve." />
          </div>
          <div className="border border-cyan-500/20 bg-cyan-500/[0.025] p-3 font-terminal text-[8px] leading-4 text-muted-foreground">
            <span className="font-bold tracking-widest text-cyan-300">QUANT TRUST RULE:</span> observed data, manually supplied datasets, model estimates, fitted parameters, and simulations are different evidence classes. The lab must keep those distinctions visible; statistical significance is not economic significance, and neither is causation by default.
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="h-full overflow-y-auto scrollbar-thin" data-quant-model-map>
        <WorkstationOverview
          definition={definition}
          onSection={(next) => setSection(next as Section)}
          headline="The Quant Workbench is a model library organized by research question, not one giant miscellaneous tab bar."
          description="The existing workbench already contains factor decomposition, relative-value tests, dynamic exposure models, tail dependence, forecasting/econometrics, fixed income, portfolio/risk, statistics, causal/panel methods, options volatility, and machine learning. The model map exposes that depth without duplicating any engine."
          trustItems={[
            "The canonical explorer catalog accounts for every one of the 18 legacy model modes exactly once.",
            "Observed market/economic series and manually supplied datasets remain distinct inputs.",
            "Statistical significance is not presented as causation or guaranteed trading edge.",
            "Model limitations and identification assumptions are first-class navigation, not hidden documentation.",
          ]}
        />
        <div className="mx-auto max-w-6xl px-4 pb-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {QUANT_MODEL_FAMILIES.map((item) => {
              const models = modelsForQuantFamily(item.key);
              const active = item.key === selectedFamily;
              return (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => { setSelectedFamily(item.key); setSection("lab"); }}
                  className={`border p-3 text-left transition-colors ${active ? "border-amber-500/45 bg-amber-500/[0.045]" : "border-border bg-[#080808] hover:border-amber-500/30 hover:bg-amber-500/[0.025]"}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="font-terminal text-[8px] font-bold tracking-widest text-amber-300">{item.label}</div>
                    <span className="ml-auto border border-border/70 px-1.5 py-0.5 font-terminal text-[6.5px] tabular-nums text-muted-foreground">{models.length} MODEL{models.length === 1 ? "" : "S"}</span>
                  </div>
                  <div className="mt-1 font-terminal text-[7px] leading-4 text-muted-foreground">{models.map((model) => model.shortLabel).join(" · ")}</div>
                  <div className="mt-2 border-t border-border/60 pt-2 font-terminal text-[7.5px] leading-4 text-foreground/80">{item.question}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {models.slice(0, 3).map((model) => (
                      <span key={model.key} className="border border-border/60 px-1.5 py-0.5 font-terminal text-[6.5px] text-cyan-300/80">/{model.commandAliases[0]}</span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return <InstitutionalWorkspaceShell definition={definition} activeSection={section} onSection={(next) => setSection(next as Section)} status={{ label: "REPRODUCIBLE VIEW STATE", tone: "ok" }}>{body}</InstitutionalWorkspaceShell>;
}
