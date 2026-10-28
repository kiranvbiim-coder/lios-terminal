import { useMemo, useState } from "react";
import { Calculator, GitBranch, GitCompareArrows, Merge, ShieldCheck } from "lucide-react";
import type { ArtifactContent } from "@shared/artifactContracts";
import type { P8FormulaValidation, P8ScenarioComparison, P8ScenarioKind } from "@shared/p8ScenarioContracts";
import {
  branchP8Scenario,
  compareP8Scenarios,
  proposeP8AssumptionMerge,
  publishP8Formula,
  validateP8Formula,
} from "@/lib/useP8Scenario";
import { useInvalidateArtifacts, useProjectArtifacts, type ProjectArtifactRecord } from "@/lib/useArtifacts";
import { SavedScenarioComparison } from "./SavedScenarioComparison";

function inferKind(artifact: ProjectArtifactRecord, baseId: string): P8ScenarioKind {
  if (artifact.id === baseId) return "base";
  const text = artifact.title.toLowerCase();
  if (/\bbull\b/.test(text)) return "bull";
  if (/\bbear\b/.test(text)) return "bear";
  return "custom";
}


export function ScenarioFormulaReview(props: {
  projectId: number;
  artifactId: string;
  artifactKind: ArtifactContent["kind"];
  headVersion: number;
  forkedFromArtifactId: string | null;
}) {
  const { projectId, artifactId, artifactKind, headVersion, forkedFromArtifactId } = props;
  const artifacts = useProjectArtifacts(projectId);
  const invalidate = useInvalidateArtifacts();
  const baseId = forkedFromArtifactId ?? artifactId;
  const family = useMemo(() => (artifacts.data ?? []).filter((item) =>
    item.kind === artifactKind && (item.id === baseId || item.forkedFromArtifactId === baseId)
  ), [artifacts.data, artifactKind, baseId]);
  const baseArtifact = family.find((item) => item.id === baseId) ?? null;
  const [comparison, setComparison] = useState<P8ScenarioComparison | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [mergeKeys, setMergeKeys] = useState("");
  const [formula, setFormula] = useState("");
  const [targetKey, setTargetKey] = useState("custom_metric");
  const [validation, setValidation] = useState<P8FormulaValidation | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const modelKind = ["valuation", "backtest", "strategy", "screen"].includes(artifactKind);
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setMessage("");
    try { await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : "P8 action failed."); }
  };

  const branch = (scenarioKind: "bull" | "bear" | "custom") => run(async () => {
    if (!baseArtifact) throw new Error("Scenario family base is unavailable.");
    const created = await branchP8Scenario(baseArtifact.id, { scenarioKind, version: baseArtifact.headVersion });
    invalidate(projectId, baseArtifact.id);
    invalidate(projectId, created.artifact.id);
    setMessage(scenarioKind.toUpperCase() + " branch created from the family base without changing its parent.");
  });

  const compare = () => run(async () => {
    const base = family.find((item) => item.id === baseId);
    const branches = family.filter((item) => item.id !== baseId);
    if (!base || !branches.length) throw new Error("Create at least one scenario branch before comparison.");
    const result = await compareP8Scenarios(projectId, {
      base: { artifactId: base.id, scenarioKind: "base", label: base.title },
      branches: branches.map((item) => ({ artifactId: item.id, scenarioKind: inferKind(item, baseId), label: item.title })),
    });
    setComparison(result);
    if (!sourceId && branches[0]) setSourceId(branches[0].id);
  });

  const proposeMerge = () => run(async () => {
    const keys = [...new Set(mergeKeys.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean))];
    if (!sourceId || !keys.length) throw new Error("Choose a source branch and at least one assumption key.");
    await proposeP8AssumptionMerge({
      sourceArtifactId: sourceId,
      targetArtifactId: artifactId,
      targetVersion: headVersion,
      keys,
      summary: "P8 selective assumption copy for review",
    });
    invalidate(projectId, artifactId);
    setMessage("Assumption copy is a review proposal. Accept or reject it below; nothing was silently applied.");
  });

  const validateFormula = () => run(async () => {
    const result = await validateP8Formula({
      expression: formula,
      targetSurface: "metric",
      targetKey,
      targetArtifactId: artifactId,
      sampleValues: {},
    });
    setValidation(result);
    setMessage(result.status === "valid" ? "Formula is deterministic and valid. Publishing still requires explicit approval." : "Formula is invalid.");
  });

  const publishFormula = () => run(async () => {
    if (!validation || validation.status !== "valid") throw new Error("Validate the current formula first.");
    const result = await publishP8Formula(projectId, {
      expression: formula,
      targetSurface: "metric",
      targetKey,
      targetArtifactId: artifactId,
      sampleValues: {},
      validationFingerprint: validation.fingerprint,
      approved: true,
    });
    invalidate(projectId, result.artifact.id);
    setMessage("Validated formula published as a versioned Strategy Artifact and linked to this Artifact.");
  });

  return <details className="mt-4 rounded-lg border border-fuchsia-300/15 bg-fuchsia-300/[0.015]">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-terminal text-[6px] text-fuchsia-200">
      <GitBranch className="h-3 w-3" /> P8 SCENARIO / MODEL CHANGE REVIEW
      <span className="ml-auto text-muted-foreground">BRANCH · COMPARE · MERGE · FORMULA</span>
    </summary>
    <div className="space-y-3 border-t border-border/40 p-3">
      {modelKind && <div className="flex flex-wrap gap-2">
        <button onClick={() => void branch("bull")} className="rounded border border-emerald-300/20 px-2 py-1 font-ui text-[7px] text-emerald-200">Create Bull branch</button>
        <button onClick={() => void branch("bear")} className="rounded border border-red-300/20 px-2 py-1 font-ui text-[7px] text-red-200">Create Bear branch</button>
        <button onClick={() => void branch("custom")} className="rounded border border-border/50 px-2 py-1 font-ui text-[7px]">Create Custom branch</button>
        <button onClick={() => void compare()} className="flex items-center gap-1 rounded border border-fuchsia-300/20 px-2 py-1 font-ui text-[7px] text-fuchsia-200"><GitCompareArrows className="h-3 w-3" />Compare family</button>
      </div>}

      {comparison && <SavedScenarioComparison comparison={comparison}/>}

      {modelKind && family.length > 1 && <div className="grid gap-2 rounded border border-border/45 p-2 md:grid-cols-[180px_1fr_auto]">
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="rounded border border-border/50 bg-[#090909] px-2 py-1.5 font-ui text-[7px]">
          <option value="">Source branch</option>{family.filter((item) => item.id !== artifactId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <input value={mergeKeys} onChange={(event) => setMergeKeys(event.target.value)} placeholder="Assumption keys, e.g. wacc, terminal.growth" className="rounded border border-border/50 bg-black/20 px-2 py-1.5 font-terminal text-[7px] outline-none"/>
        <button onClick={() => void proposeMerge()} className="flex items-center gap-1 rounded border border-cyan-300/20 px-2 py-1 font-ui text-[7px] text-cyan-200"><Merge className="h-3 w-3"/>Propose copy</button>
      </div>}

      <div className="rounded border border-border/45 p-2">
        <div className="mb-2 flex items-center gap-2 font-terminal text-[6px] text-muted-foreground"><Calculator className="h-3 w-3"/>VALIDATED FORMULA STUDIO · NO EVAL / GENERATED CODE EXECUTION</div>
        <div className="grid gap-2 md:grid-cols-[160px_1fr_auto_auto]">
          <input value={targetKey} onChange={(event) => setTargetKey(event.target.value)} placeholder="metric key" className="rounded border border-border/50 bg-black/20 px-2 py-1.5 font-terminal text-[7px] outline-none"/>
          <input value={formula} onChange={(event) => { setFormula(event.target.value); setValidation(null); }} placeholder="revenue * margin - debt" className="rounded border border-border/50 bg-black/20 px-2 py-1.5 font-terminal text-[7px] outline-none"/>
          <button onClick={() => void validateFormula()} disabled={!formula.trim() || !targetKey.trim()} className="rounded border border-amber-300/20 px-2 py-1 font-ui text-[7px] text-amber-200 disabled:opacity-30">Validate</button>
          <button onClick={() => void publishFormula()} disabled={validation?.status !== "valid"} className="flex items-center gap-1 rounded border border-emerald-300/20 px-2 py-1 font-ui text-[7px] text-emerald-200 disabled:opacity-30"><ShieldCheck className="h-3 w-3"/>Approve & publish</button>
        </div>
        {validation && <div className="mt-2 font-terminal text-[6px] text-muted-foreground">{validation.status.toUpperCase()} · DEPENDENCIES {validation.dependencies.join(", ") || "NONE"} · FINGERPRINT {validation.fingerprint.slice(0, 12)}…</div>}
      </div>

      {message && <div className="rounded border border-emerald-300/15 px-2 py-1.5 font-ui text-[7px] text-emerald-200">{message}</div>}
      {error && <div className="rounded border border-red-300/20 px-2 py-1.5 font-ui text-[7px] text-red-200">{error}</div>}
    </div>
  </details>;
}
