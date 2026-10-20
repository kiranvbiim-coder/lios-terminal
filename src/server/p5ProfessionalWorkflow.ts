import {
  p5AdvancedModelPathSchema,
  p5WorkflowDescriptor,
  type P5AdvancedModelPath,
  type P5ProfessionalFamily,
} from "@shared/p5ProfessionalContracts";
import type { ConversationCapabilityId, ConversationRequest } from "@shared/conversationRuntime";
import type { ArtifactContent, ArtifactRefreshSpec } from "@shared/artifactContracts";
import type { AdvancedQuantInputProvenance } from "@shared/quantModelRegistry";
import {
  buildP5GuidedInputs,
  flattenP5ParametersForForm,
  p5GuidedFieldLabel,
  p5RequiredInputKeys,
  type P5GuidedInputs,
} from "@shared/p5GuidedInputs";
import { resolveExplicitReportTemplate } from "./reportEngine";
import { extractP5PlainLanguageInputs, type P5PlainLanguageGap } from "./p5PlainLanguageInputs";

export interface P5ProfessionalIntent {
  family: P5ProfessionalFamily;
  capabilityId: ConversationCapabilityId;
  label: string;
  reason: string;
  modelPath: P5AdvancedModelPath | null;
  parameters: Record<string, unknown> | null;
  inputProvenance: unknown;
  activeArtifactRef: string | null;
  requiresEntity: boolean;
  workspaceCommand: string;
  /** Present when assumptions were typed in plain language but are incomplete or ambiguous. */
  inputGap: P5PlainLanguageGap | null;
}

function activeArtifactRef(request: ConversationRequest): string | null {
  return request.context?.activeObjectRefs?.find((value) => /^artifact:[0-9a-f-]{36}$/i.test(value)) ?? null;
}

export function extractP5JsonObject(message: string): Record<string, unknown> | null {
  const fenced = message.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() || (() => {
    const start = message.indexOf("{");
    const end = message.lastIndexOf("}");
    return start >= 0 && end > start ? message.slice(start, end + 1) : "";
  })();
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function explicitAdvancedRun(message: string): {
  modelPath: P5AdvancedModelPath | null;
  parameters: Record<string, unknown> | null;
  inputProvenance: unknown;
} {
  const parsed = extractP5JsonObject(message);
  if (!parsed) return { modelPath: null, parameters: null, inputProvenance: undefined };
  const wrappedPath = typeof parsed.modelPath === "string" ? p5AdvancedModelPathSchema.safeParse(parsed.modelPath) : null;
  const wrappedParameters = parsed.parameters && typeof parsed.parameters === "object" && !Array.isArray(parsed.parameters)
    ? parsed.parameters as Record<string, unknown>
    : null;
  if (wrappedPath?.success && wrappedParameters) {
    return {
      modelPath: wrappedPath.data,
      parameters: wrappedParameters,
      inputProvenance: parsed.inputProvenance,
    };
  }
  return { modelPath: null, parameters: parsed, inputProvenance: undefined };
}

export function inferP5AdvancedModelPath(message: string): P5AdvancedModelPath | null {
  const lower = message.toLowerCase();
  const rules: Array<[RegExp, P5AdvancedModelPath]> = [
    [/\breverse\s*dcf\b/, "valuation/reverse-dcf"],
    [/\b(?:dcf\s+sensitivity|sensitivity\s+dcf|wacc\s*(?:x|×|by)\s*terminal\s+growth|terminal\s+growth\s*(?:x|×|by)\s*wacc)\b/, "valuation/dcf-sensitivity"],
    [/\bresidual\s+income\b/, "valuation/residual-income"],
    [/\b(?:economic value added|eva)\b/, "valuation/eva"],
    [/\b(?:sum[- ]of[- ]the[- ]parts|sotp)\b/, "valuation/sotp"],
    [/\b(?:merger|accretion|dilution|break[- ]even synergy)\b/, "valuation/merger-accretion"],
    [/\breal option\b/, "valuation/real-option"],
    [/\bexpectation surface\b/, "valuation/expectation-surface"],
    [/\bproject finance\b/, "valuation/project-finance"],
    [/\bsaas\b.*\bcohort\b|\bcohort\b.*\bvaluation\b/, "valuation/saas-cohort"],
    [/\binsurance\b.*\bembedded value\b|\bembedded value\b/, "valuation/insurance-embedded-value"],
    [/\b(?:probabilistic|monte carlo)\b.*\bdcf\b|\bdcf\b/, "valuation/probabilistic-dcf"],

    [/\bblack[- ]litterman\b/, "portfolio/black-litterman"],
    [/\bhierarchical risk parity\b|\bhrp\b/, "portfolio/hrp"],
    [/\brisk budget\b/, "portfolio/risk-budget"],
    [/\bfactor risk\b.*\b(?:optim|allocation|portfolio)\b/, "portfolio/factor-risk"],
    [/\btracking error\b/, "portfolio/tracking-error"],
    [/\btax[- ]aware\b.*\brebalanc/, "portfolio/tax-aware-rebalance"],
    [/\bstress[- ]aware\b.*\bportfolio\b/, "portfolio/stress-aware"],
    [/\bregime\b.*\bportfolio\b|\bportfolio\b.*\bregime\b/, "portfolio/regime-blend"],
    [/\bbayesian mean\b|\bmean shrinkage\b/, "portfolio/bayesian-mean-shrinkage"],
    [/\bledoit[- ]wolf\b|\bshrinkage covariance\b/, "portfolio/ledoit-wolf-covariance"],
    [/\btail risk\b/, "risk/tail-report"],
    [/\bliquidity[- ]adjusted\s+var\b|\bliquidity\s+var\b/, "risk/liquidity-var"],
    [/\breverse stress\b/, "risk/reverse-stress"],
    [/\bcorrelation breakdown\b/, "risk/correlation-breakdown"],

    [/\bbootstrap\b.*\b(?:par|yield)\s+curve\b/, "fixed-income/bootstrap-par-curve"],
    [/\bz[- ]?spread\b|\bspread duration\b/, "fixed-income/spread-analytics"],
    [/\bkey[- ]rate\b|\bdv01\b/, "fixed-income/key-rate-risk"],
    [/\bimmuni[sz]e\b.*\bduration\b|\bduration immuni[sz]ation\b/, "fixed-income/immunize-duration"],
    [/\bcallable\b.*\boas\b|\boas\b.*\bcallable\b/, "fixed-income/callable-oas"],
    [/\bfloating[- ]rate note\b|\bfrn\b/, "fixed-income/floating-rate-note"],
    [/\binflation[- ]linked bond\b/, "fixed-income/inflation-linked-bond"],
    [/\bcredit spread curve\b/, "fixed-income/credit-spread-curve"],

    [/\bimplied vol(?:atility)?\b/, "derivatives/implied-volatility"],
    [/\bvol(?:atility)? surface\b.*\barbitrage\b/, "derivatives/surface-arbitrage"],
    [/\bexotic\b.*\bmonte carlo\b/, "derivatives/exotic-monte-carlo"],
    [/\binterest[- ]rate swap\b|\bir swap\b/, "derivatives/interest-rate-swap"],
    [/\bswaption\b/, "derivatives/black-swaption"],
    [/\blocal vol(?:atility)?\b|\bdupire\b/, "derivatives/local-volatility"],
    [/\bportfolio greeks\b/, "derivatives/portfolio-greeks"],
    [/\bfutures basis\b/, "derivatives/futures-basis"],
    [/\boption strategy\b.*\bpayoff\b|\bstrategy payoff\b/, "derivatives/strategy-payoff"],
    [/\bblack[- ]scholes\b|\boption greeks?\b|\bdelta\b.*\bgamma\b/, "derivatives/black-scholes-greeks"],

    [/\byield curve signals?\b/, "macro/yield-curve-signals"],
    [/\bfinancial conditions index\b|\bfci\b/, "macro/financial-conditions-index"],
    [/\brecession probability\b/, "macro/recession-probability"],
    [/\binflation decomposition\b/, "macro/inflation-decomposition"],
    [/\bmacro\b.*\bcompany transmission\b|\bcompany\b.*\bmacro transmission\b/, "macro/company-transmission"],
    [/\bfiscal multiplier\b/, "macro/fiscal-multiplier"],

    [/\bevidence graph\b/, "research/evidence-graph"],
    [/\bfiling diff(?:erence)?\b|\bcompare filings\b/, "research/filing-diff"],
    [/\bconsensus divergence\b|\bvariant perception\b/, "research/consensus-divergence"],
    [/\bcatalyst monitor\b/, "research/catalyst-monitor"],
    [/\bthree[- ]statement\b|\bintegrated financial model\b/, "financial-modeling/three-statement"],
  ];
  for (const [pattern, path] of rules) if (pattern.test(lower)) return path;
  return null;
}

function familyForModelPath(path: P5AdvancedModelPath): P5ProfessionalFamily {
  if (path.startsWith("valuation/") || path === "financial-modeling/three-statement") return "valuation";
  if (path.startsWith("portfolio/") || path.startsWith("risk/")) return "portfolio_risk";
  if (path.startsWith("fixed-income/")) return "fixed_income";
  if (path.startsWith("derivatives/")) return "derivatives";
  if (path.startsWith("macro/")) return "macro_fx";
  if (path.startsWith("research/")) return "research_reporting";
  return "research_reporting";
}

function capabilityIdForFamily(family: P5ProfessionalFamily, modelPath: P5AdvancedModelPath | null): ConversationCapabilityId {
  if (modelPath === "financial-modeling/three-statement") return "financial_modeling.three_statement";
  switch (family) {
    case "company_research": return "company.research";
    case "company_fundamentals": return "company.fundamentals";
    case "valuation": return "company.valuation";
    case "portfolio_risk": return "portfolio.risk";
    case "fixed_income": return "fixed_income.analytics";
    case "derivatives": return "derivatives.analytics";
    case "macro_fx": return "macro_fx.analytics";
    case "research_reporting": return "research.report";
    case "personal_finance": return "personal_finance.snapshot";
  }
}

function addIntent(
  intents: P5ProfessionalIntent[],
  family: P5ProfessionalFamily,
  reason: string,
  options: {
    modelPath?: P5AdvancedModelPath | null;
    parameters?: Record<string, unknown> | null;
    inputProvenance?: unknown;
    activeArtifactRef?: string | null;
    requiresEntity?: boolean;
    inputGap?: P5PlainLanguageGap | null;
  } = {},
) {
  const descriptor = p5WorkflowDescriptor(family);
  const modelPath = options.modelPath ?? null;
  const capabilityId = capabilityIdForFamily(family, modelPath);
  if (intents.some((item) => item.capabilityId === capabilityId && item.modelPath === modelPath)) return;
  intents.push({
    family,
    capabilityId,
    label: descriptor.label,
    reason,
    modelPath,
    parameters: options.parameters ?? null,
    inputProvenance: options.inputProvenance,
    activeArtifactRef: options.activeArtifactRef ?? null,
    requiresEntity: options.requiresEntity ?? false,
    workspaceCommand: descriptor.defaultWorkspaceCommand,
    inputGap: options.inputGap ?? null,
  });
}

export function resolveP5ProfessionalIntents(request: ConversationRequest): P5ProfessionalIntent[] {
  const message = request.message;
  const lower = message.toLowerCase();
  const intents: P5ProfessionalIntent[] = [];
  const artifactRef = activeArtifactRef(request);
  if (artifactRef) {
    const selection = resolveExplicitReportTemplate(message);
    if (selection.reportRequested) {
      addIntent(intents, "research_reporting", "The request assembles a report from the active canonical Artifact without new research or analytical recalculation.", {
        activeArtifactRef: artifactRef,
        parameters: { templateId: selection.templateId, templateSelectionError: selection.error },
      });
      return intents;
    }
  }
  const explicit = explicitAdvancedRun(message);
  const inferredPath = explicit.modelPath ?? inferP5AdvancedModelPath(message);
  const modelPath = inferredPath;
  // Plain-language assumptions are read only when the user did not supply the expert JSON object.
  const plain = !explicit.parameters && modelPath ? extractP5PlainLanguageInputs(message, modelPath) : null;
  const plainComplete = plain?.status === "complete" ? plain : null;
  const modelFamily = modelPath ? familyForModelPath(modelPath) : null;

  if (/\b(?:investment research|equity research|company research|research report|full research|investment memo|company tear ?sheet)\b/i.test(message)) {
    addIntent(intents, "company_research", "The request asks for an end-to-end company/investment research journey.", { requiresEntity: true });
  }
  if (/\b(?:fundamental analysis|company fundamentals|financial statements?|income statement|balance sheet|cash flow statement)\b/i.test(message)) {
    addIntent(intents, "company_fundamentals", "The request asks for company fundamentals or financial statements.", { requiresEntity: true });
  }

  if (modelFamily) {
    addIntent(intents, modelFamily, `The request maps to institutional model ${modelPath}.`, {
      modelPath,
      parameters: explicit.parameters ?? plainComplete?.parameters ?? null,
      inputProvenance: explicit.inputProvenance ?? plainComplete?.inputProvenance,
      activeArtifactRef: artifactRef,
      requiresEntity: modelFamily === "valuation",
      inputGap: plain?.status === "incomplete" ? plain.gap : null,
    });
  } else {
    if ((/^\s*value\b/i.test(message) || /\b(?:valuation|fair value|intrinsic value|dcf|residual income|economic value added|sum[- ]of[- ]parts|sotp)\b/i.test(message))
      && !/\bvalue at risk\b/i.test(message)) {
      addIntent(intents, "valuation", "The request asks for deterministic valuation/modeling.", { activeArtifactRef: artifactRef, requiresEntity: true });
    }
    if (/\b(?:portfolio risk|portfolio optim|risk contribution|value at risk|\bvar\b|stress test|risk budget|black[- ]litterman)\b/i.test(message)) {
      addIntent(intents, "portfolio_risk", "The request asks for deterministic portfolio/risk analytics.", { activeArtifactRef: artifactRef });
    }
    // "Explain how inflation affects rates" is a concept question for the AI, not a request to run an engine.
    const conceptQuestion = /^\s*(?:explain|why|what (?:is|are)|how (?:does|do|is|are))\b/i.test(message) && !/\d/.test(message) && !artifactRef;
    if (!conceptQuestion && /\b(?:fixed income|bond analytics|duration|convexity|yield to maturity|yield curve|credit spread|\boas\b)\b/i.test(message)) {
      addIntent(intents, "fixed_income", "The request asks for deterministic fixed-income analytics.", { activeArtifactRef: artifactRef });
    }
    if (!conceptQuestion && /\b(?:derivatives?|options?|greeks?|implied volatility|swaption|interest[- ]rate swap)\b/i.test(message)) {
      addIntent(intents, "derivatives", "The request asks for deterministic derivatives analytics.", { activeArtifactRef: artifactRef });
    }
    if (!conceptQuestion && /\b(?:macro(?:economic)?|recession|inflation|financial conditions|fiscal multiplier|macro transmission|fx analysis|foreign exchange)\b/i.test(message)) {
      addIntent(intents, "macro_fx", "The request asks for macro/FX analytics.", { activeArtifactRef: artifactRef });
    }
    if (/\b(?:investment memo|research report|risk report|portfolio review|earnings preview|company tear ?sheet)\b/i.test(message)) {
      addIntent(intents, "research_reporting", "The request asks for a professional research/reporting output.", { activeArtifactRef: artifactRef, requiresEntity: /company|investment|earnings|tear/i.test(lower) });
    }
  }

  // A plain "research/analyze <company>" remains a valid P5 flagship journey,
  // but generic non-company analysis must not be stolen from other capabilities.
  const personalFinanceIntent = /\b(?:personal finance|personal finances|net worth|retirement|retire|debt payoff|savings rate|financial goals?|my finances|my income|my expenses|my cash flow)\b/i.test(message);
  if (!personalFinanceIntent
    && !intents.some((item) => item.family === "company_research")
    && /\b(?:research|analy[sz]e|review|assess)\b/i.test(message)
    && /\b(?:company|stock|equity|shares?|ticker)\b/i.test(message)) {
    addIntent(intents, "company_research", "The request asks for company/security research.", { requiresEntity: true });
  }

  return intents;
}

export interface P5InputGapDescription {
  message: string;
  guidedInputs: P5GuidedInputs | undefined;
}

/**
 * Describes exactly which model inputs are missing or unclear for a professional capability,
 * and the guided-form definition (pre-filled with values already understood) that can collect them.
 * Nothing is defaulted: every field the form shows blank is a value the user has not stated.
 */
export function describeP5InputGap(input: {
  label: string;
  modelPath: string | null;
  entity: string | null;
  missingInputs: string[];
  modelParameters: Record<string, unknown> | null;
  inputGap: P5PlainLanguageGap | null;
  detail?: string;
}): P5InputGapDescription {
  const required = input.modelPath ? p5RequiredInputKeys(input.modelPath) : [];
  const entityMissing = !input.entity && input.missingInputs.includes("company_or_security");
  const known = input.inputGap
    ? input.inputGap
    : { missing: input.modelParameters ? [] : required, issues: [], provided: input.modelPath ? flattenP5ParametersForForm(input.modelPath, input.modelParameters) : {}, notes: [] };
  const guidedInputs = input.modelPath
    ? buildP5GuidedInputs({
      modelPath: input.modelPath,
      entity: entityMissing ? null : input.entity,
      missing: [...(entityMissing ? ["entity"] : []), ...known.missing],
      issues: known.issues,
      provided: known.provided,
    }) ?? undefined
    : undefined;
  if (input.detail) return { message: input.detail, guidedInputs };
  if (!guidedInputs || !input.modelPath) {
    const missing = input.missingInputs.length ? input.missingInputs : ["structured_model_inputs_or_active_artifact"];
    return { message: input.label + " requires explicit deterministic model inputs. Missing: " + missing.join(", ") + ". LiOS did not invent assumptions.", guidedInputs: undefined };
  }
  const modelPath = input.modelPath;
  const parts = [input.label + " requires explicit deterministic model inputs."];
  if (guidedInputs.missing.length) parts.push("Missing: " + guidedInputs.missing.map((key) => p5GuidedFieldLabel(modelPath, key)).join("; ") + ".");
  if (guidedInputs.issues.length) parts.push("Unclear: " + guidedInputs.issues.map((issue) => issue.message).join(" "));
  if (known.notes.length) parts.push(known.notes.join(" "));
  parts.push("LiOS did not invent assumptions.");
  return { message: parts.join(" ").slice(0, 1_900), guidedInputs };
}

export function p5AdvancedPathFromEngineRef(engineRef: string | null | undefined): P5AdvancedModelPath | null {
  if (!engineRef) return null;
  const direct = p5AdvancedModelPathSchema.safeParse(engineRef);
  if (direct.success) return direct.data;
  const prefix = "python.advanced.";
  if (!engineRef.startsWith(prefix)) return null;
  const remainder = engineRef.slice(prefix.length);
  const separator = remainder.indexOf(".");
  if (separator <= 0) return null;
  const path = `${remainder.slice(0, separator)}/${remainder.slice(separator + 1)}`;
  const parsed = p5AdvancedModelPathSchema.safeParse(path);
  return parsed.success ? parsed.data : null;
}

export function p5InputsFromArtifact(
  content: ArtifactContent,
  refreshSpec?: ArtifactRefreshSpec | null,
): { modelPath: P5AdvancedModelPath | null; parameters: Record<string, unknown> | null; inputProvenance?: AdvancedQuantInputProvenance } {
  const refreshPath = p5AdvancedPathFromEngineRef(refreshSpec?.engineRef);
  if (content.kind === "valuation") {
    const directPath = p5AdvancedPathFromEngineRef(content.modelId);
    const modelIdPath = p5AdvancedModelPathSchema.safeParse(content.modelId);
    const summaryPath = typeof content.summary.modelPath === "string"
      ? p5AdvancedModelPathSchema.safeParse(content.summary.modelPath)
      : null;
    const modelVersion = typeof content.summary.modelVersion === "string" ? content.summary.modelVersion : null;
    const outputSnapshotHash = typeof content.summary.outputSnapshotHash === "string" && /^[a-f0-9]{64}$/.test(content.summary.outputSnapshotHash)
      ? content.summary.outputSnapshotHash
      : null;
    return {
      modelPath: refreshPath
        ?? directPath
        ?? (modelIdPath.success ? modelIdPath.data : null)
        ?? (summaryPath?.success ? summaryPath.data : null),
      parameters: content.assumptions,
      ...(modelVersion && outputSnapshotHash ? {
        inputProvenance: {
          dataClassification: "model_derived",
          transformations: ["Reused versioned Artifact assumptions as the next governed model input."],
          derivedFrom: {
            modelId: content.modelId,
            modelVersion,
            outputSnapshotHash,
          },
        } satisfies AdvancedQuantInputProvenance,
      } : {}),
    };
  }
  if (content.kind === "portfolio") {
    const summaryPath = typeof content.summary.modelPath === "string"
      ? p5AdvancedModelPathSchema.safeParse(content.summary.modelPath)
      : null;
    const riskPath = typeof content.risk.modelPath === "string"
      ? p5AdvancedModelPathSchema.safeParse(content.risk.modelPath)
      : null;
    const parameters = content.summary.parameters && typeof content.summary.parameters === "object" && !Array.isArray(content.summary.parameters)
      ? content.summary.parameters as Record<string, unknown>
      : content.risk.parameters && typeof content.risk.parameters === "object" && !Array.isArray(content.risk.parameters)
        ? content.risk.parameters as Record<string, unknown>
        : null;
    const modelId = typeof content.summary.modelId === "string" ? content.summary.modelId : null;
    const modelVersion = typeof content.summary.modelVersion === "string" ? content.summary.modelVersion : null;
    const outputSnapshotHash = typeof content.summary.outputSnapshotHash === "string" && /^[a-f0-9]{64}$/.test(content.summary.outputSnapshotHash)
      ? content.summary.outputSnapshotHash
      : null;
    return {
      modelPath: refreshPath
        ?? (summaryPath?.success ? summaryPath.data : null)
        ?? (riskPath?.success ? riskPath.data : null),
      parameters,
      ...(modelId && modelVersion && outputSnapshotHash ? {
        inputProvenance: {
          dataClassification: "model_derived",
          transformations: ["Reused versioned Portfolio Artifact parameters as the next governed model input."],
          derivedFrom: { modelId, modelVersion, outputSnapshotHash },
        } satisfies AdvancedQuantInputProvenance,
      } : {}),
    };
  }
  if (content.kind === "screen") {
    const statePath = typeof content.state.modelPath === "string"
      ? p5AdvancedModelPathSchema.safeParse(content.state.modelPath)
      : null;
    const parameters = content.state.parameters && typeof content.state.parameters === "object" && !Array.isArray(content.state.parameters)
      ? content.state.parameters as Record<string, unknown>
      : null;
    return { modelPath: refreshPath ?? (statePath?.success ? statePath.data : null), parameters };
  }
  return { modelPath: refreshPath, parameters: null };
}
