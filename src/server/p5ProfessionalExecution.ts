import crypto from "crypto";
import type { ConversationArtifactDraft, ConversationCapabilityId } from "@shared/conversationRuntime";
import { artifactExportFormatsForKind, type ArtifactContent, type ArtifactKind } from "@shared/artifactContracts";
import {
  p5ProfessionalExportProfileSchema,
  p5ReconciliationSchema,
  type P5AdvancedModelPath,
  type P5ProfessionalFamily,
  type P5Reconciliation,
} from "@shared/p5ProfessionalContracts";
import type { AdvancedQuantExecution } from "./advancedQuantExecution";
import type { Quote } from "./marketData";
import type { CapabilityResolution } from "./capabilityBroker";
import type { LseFinancialReport } from "./lseData";
import { defaultArtifactReportTemplate, generateReportPack, getReportTemplate, type ReportTemplateId } from "./reportEngine";
import { projectReportSections, reportSectionsFromArtifact } from "./reportSectionProjection";

export interface TechnicalSnapshot {
  rsi14: number | null;
  macdHistogram: number | null;
  macdCrossover: "bullish" | "bearish" | "none" | null;
  support20: number | null;
  resistance20: number | null;
}

function p5ExportProfile(kind: ArtifactKind) {
  return p5ProfessionalExportProfileSchema.parse({
    authority: "p4_artifact_export_plan",
    artifactKind: kind,
    formats: [...artifactExportFormatsForKind(kind)],
  });
}

function p5AdvancedReconciliation(run: AdvancedQuantExecution): P5Reconciliation {
  return p5ReconciliationSchema.parse({
    calculatorOfRecord: `${run.receipt.modelId}@${run.receipt.modelVersion}`,
    deterministic: true,
    inputHash: run.receipt.inputSnapshotHash,
    outputHash: run.receipt.outputSnapshotHash,
    validationLevel: run.receipt.validationLevel,
    sourceArtifactRef: null,
    analyticalRecalculation: true,
  });
}

export const P5_PROFESSIONAL_CAPABILITY_IDS = new Set<ConversationCapabilityId>([
  "company.research",
  "company.fundamentals",
  "company.valuation",
  "financial_modeling.three_statement",
  "portfolio.risk",
  "fixed_income.analytics",
  "derivatives.analytics",
  "macro_fx.analytics",
  "research.report",
  "personal_finance.snapshot",
]);

export function isP5ProfessionalCapabilityId(id: ConversationCapabilityId): boolean {
  return P5_PROFESSIONAL_CAPABILITY_IDS.has(id);
}

export function p5FamilyForCapabilityId(id: ConversationCapabilityId): P5ProfessionalFamily | null {
  switch (id) {
    case "company.research": return "company_research";
    case "company.fundamentals": return "company_fundamentals";
    case "company.valuation":
    case "financial_modeling.three_statement":
      return "valuation";
    case "portfolio.risk": return "portfolio_risk";
    case "fixed_income.analytics": return "fixed_income";
    case "derivatives.analytics": return "derivatives";
    case "macro_fx.analytics": return "macro_fx";
    case "research.report": return "research_reporting";
    case "personal_finance.snapshot": return "personal_finance";
    default: return null;
  }
}

export function p5ArtifactTypeForModelPath(path: P5AdvancedModelPath): "valuation" | "portfolio" | "report" {
  if (path.startsWith("valuation/") || path === "financial-modeling/three-statement") return "valuation";
  if (path.startsWith("portfolio/") || path.startsWith("risk/")) return "portfolio";
  return "report";
}

function sourceRefsFromAdvancedRun(run: AdvancedQuantExecution): string[] {
  return [...new Set([
    `model:${run.receipt.modelId}@${run.receipt.modelVersion}`,
    ...run.receipt.sourceBindings.map((binding) => binding.sourceReference),
  ])];
}

function modelLabel(path: P5AdvancedModelPath): string {
  return path.split("/").at(-1)?.replaceAll("-", " ").replace(/\b\w/g, (char) => char.toUpperCase()) ?? path;
}

export function buildP5AdvancedArtifact(input: {
  projectId: number | null;
  scope?: "quick" | "project" | "temporary";
  symbol?: string | null;
  modelPath: P5AdvancedModelPath;
  parameters: Record<string, unknown>;
  run: AdvancedQuantExecution;
  runtimeReceiptId: string;
}): ConversationArtifactDraft {
  const artifactKind = p5ArtifactTypeForModelPath(input.modelPath);
  const titlePrefix = input.symbol ? `${input.symbol} · ` : "";
  const sourceRefs = sourceRefsFromAdvancedRun(input.run);
  const modelId = input.run.receipt.modelId;
  const reconciliation = p5AdvancedReconciliation(input.run);

  if (artifactKind === "valuation") {
    return {
      schemaVersion: "1",
      artifactId: crypto.randomUUID(),
      artifactType: "valuation",
      title: `${titlePrefix}${modelLabel(input.modelPath)}`,
      projectId: input.projectId,
      sourceRefs,
      executionReceiptIds: [input.runtimeReceiptId],
      data: {
        kind: "valuation",
        symbol: input.symbol ?? null,
        modelId,
        assumptions: input.parameters,
        outputs: input.run.result && typeof input.run.result === "object" ? input.run.result as Record<string, unknown> : { result: input.run.result },
        summary: {
          modelPath: input.modelPath,
          modelVersion: input.run.receipt.modelVersion,
          validationLevel: input.run.receipt.validationLevel,
          inputSnapshotHash: input.run.receipt.inputSnapshotHash,
          outputSnapshotHash: input.run.receipt.outputSnapshotHash,
          dataClassification: input.run.receipt.dataClassification,
          professionalReconciliation: reconciliation,
          professionalExport: p5ExportProfile("valuation"),
        },
      },
      persistence: input.scope === "quick" ? "chat_candidate" : input.projectId ? "project_candidate" : "ephemeral",
    };
  }

  if (artifactKind === "portfolio") {
    return {
      schemaVersion: "1",
      artifactId: crypto.randomUUID(),
      artifactType: "portfolio",
      title: `${titlePrefix}${modelLabel(input.modelPath)}`,
      projectId: input.projectId,
      sourceRefs,
      executionReceiptIds: [input.runtimeReceiptId],
      data: {
        kind: "portfolio",
        portfolioRef: null,
        holdings: [],
        summary: {
          modelPath: input.modelPath,
          parameters: input.parameters,
          result: input.run.result,
          modelId,
          modelVersion: input.run.receipt.modelVersion,
          validationLevel: input.run.receipt.validationLevel,
          dataClassification: input.run.receipt.dataClassification,
          inputSnapshotHash: input.run.receipt.inputSnapshotHash,
          outputSnapshotHash: input.run.receipt.outputSnapshotHash,
          professionalReconciliation: reconciliation,
          professionalExport: p5ExportProfile("portfolio"),
        },
        risk: input.modelPath.startsWith("risk/") ? {
          modelPath: input.modelPath,
          parameters: input.parameters,
          result: input.run.result,
        } : {},
      },
      persistence: input.scope === "quick" ? "chat_candidate" : input.projectId ? "project_candidate" : "ephemeral",
    };
  }

  const report = generateReportPack({
    templateId: input.modelPath.startsWith("macro/") ? "macro_scenario"
      : input.modelPath.startsWith("fixed-income/") || input.modelPath.startsWith("derivatives/") ? "risk_report"
      : "investment_memo",
    title: `${titlePrefix}${modelLabel(input.modelPath)}`,
    symbol: input.symbol ?? undefined,
    engineId: modelId,
    engineVersion: input.run.receipt.modelVersion,
    sectionData: {
      summary: {
        modelPath: input.modelPath,
        validationLevel: input.run.receipt.validationLevel,
        dataClassification: input.run.receipt.dataClassification,
        professionalReconciliation: reconciliation,
        professionalExport: p5ExportProfile("report"),
      },
      key_metrics: input.run.result,
      table: input.modelPath.startsWith("macro/") ? input.run.result : undefined,
      assumptions: input.parameters,
      limitations: input.run.receipt.warnings,
      sources: sourceRefs,
    },
  });
  return {
    schemaVersion: "1",
    artifactId: crypto.randomUUID(),
    artifactType: "report",
    title: report.title,
    projectId: input.projectId,
    sourceRefs,
    executionReceiptIds: [input.runtimeReceiptId],
    data: {
      kind: "report",
      templateId: report.templateId,
      ...projectReportSections(report, {
        blockIdPrefix: "section",
        attrs: { sourceRefs, executionReceiptIds: [input.runtimeReceiptId] },
        firstBlockAttrs: {
          professionalReconciliation: reconciliation,
          professionalExport: p5ExportProfile("report"),
        },
      }),
      editorPreference: "builtin",
    },
    persistence: input.scope === "quick" ? "chat_candidate" : input.projectId ? "project_candidate" : "ephemeral",
  };
}

export interface P5ProfessionalResultTextInput {
  label: string;
  modelPath: string;
  symbol?: string | null;
  result: unknown;
  validationLevel: string;
  dataClassification: string;
  sourceCount?: number;
  warnings?: readonly string[];
  retentionScope: "project" | "quick" | "temporary";
}

const SOURCE_BOUND_CLASSIFICATIONS = new Set(["live", "delayed", "historical", "cached", "fallback"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function displayNumber(value: number, maximumFractionDigits: number, minimumFractionDigits = 0): string {
  return value.toLocaleString("en-US", { minimumFractionDigits, maximumFractionDigits });
}

function displayPercent(value: number | null): string {
  return value === null ? "—" : `${displayNumber(value, 2)}%`;
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function inputsLine(classification: string, sourceCount = 0): string {
  if (classification === "manual") return "Inputs were supplied by you.";
  if (SOURCE_BOUND_CLASSIFICATIONS.has(classification)) return sourceCount > 0 ? "Inputs have recorded source bindings; inspect their provenance in the model." : "No source binding is recorded; do not treat these inputs as source-verified.";
  if (classification === "synthetic") return "Inputs are synthetic (illustrative, not market data).";
  if (classification === "model_derived") return "Inputs were derived from an earlier model result.";
  return "Input origin is recorded with the result.";
}

function validationLine(level: string): string {
  switch (level) {
    case "known_answer": return "This calculation method has known-answer checks; this scenario is not an independently verified forecast.";
    case "regression_tested": return "The calculation is covered by regression tests, not independent reference answers.";
    case "implementation_reviewed": return "The calculation was reviewed but has not been checked against independent reference answers.";
    case "benchmark_required": return "The calculation has not yet been benchmarked; treat it as unverified.";
    case "research_only": return "The calculation is for research use only.";
    default: return "The calculation has not been validated.";
  }
}

function dcfScenarioCell(value: unknown) {
  const scenario = asRecord(value);
  const perShare = scenario ? finiteNumber(scenario.valuePerShare) : null;
  if (!scenario || perShare === null) return null;
  const growth = finiteNumber(scenario.terminalGrowthPct);
  const multiple = finiteNumber(scenario.exitMultiple);
  return {
    perShare,
    wacc: finiteNumber(scenario.waccPct),
    terminal: growth !== null ? displayPercent(growth) : multiple !== null ? `${displayNumber(multiple, 2)}x exit multiple` : "—",
  };
}

function dcfSensitivityBody(input: P5ProfessionalResultTextInput): string | null {
  const scenarios = asRecord(asRecord(input.result)?.scenarios);
  const bear = dcfScenarioCell(scenarios?.bear);
  const base = dcfScenarioCell(scenarios?.base);
  const bull = dcfScenarioCell(scenarios?.bull);
  if (!bear || !base || !bull) return null;
  const subject = input.symbol ? `${input.symbol}'s` : "The";
  const row = (name: string, cell: NonNullable<typeof base>) =>
    `| ${name} | ${displayNumber(cell.perShare, 2, 2)} | ${displayPercent(cell.wacc)} | ${cell.terminal} |`;
  return [
    `${subject} base-case value is **${displayNumber(base.perShare, 2, 2)} per share**, with a bear–bull range of ${displayNumber(bear.perShare, 2, 2)} to ${displayNumber(bull.perShare, 2, 2)}.`,
    "",
    "| Case | Value per share | WACC | Terminal assumption |",
    "| --- | ---: | ---: | ---: |",
    row("Bear", bear),
    row("Base", base),
    row("Bull", bull),
  ].join("\n");
}

function genericBody(input: P5ProfessionalResultTextInput): string {
  const record = asRecord(input.result);
  const rows: string[] = [];
  if (record) {
    for (const [key, value] of Object.entries(record)) {
      if (rows.length >= 8) break;
      if (/hash|id$/i.test(key)) continue;
      const number = finiteNumber(value);
      if (number !== null) rows.push(`| ${humanizeKey(key)} | ${displayNumber(number, 4)} |`);
      else if (typeof value === "string" && value.length <= 80 && !/^[a-f0-9]{32,}$/i.test(value)) rows.push(`| ${humanizeKey(key)} | ${value.replace(/\|/g, "/")} |`);
    }
  }
  const subject = input.symbol ? `${input.label} for ${input.symbol}` : input.label;
  return rows.length
    ? [`${subject} is complete. Key figures:`, "", "| Measure | Value |", "| --- | ---: |", ...rows].join("\n")
    : `${subject} is complete. The full results are in the saved model.`;
}

export function buildP5ProfessionalResultText(input: P5ProfessionalResultTextInput): string {
  const body = input.modelPath === "valuation/dcf-sensitivity" ? dcfSensitivityBody(input) ?? genericBody(input) : genericBody(input);
  const warnings = (input.warnings ?? []).filter((warning) => warning.trim().length > 0);
  const pointer = input.retentionScope === "temporary"
    ? "Temporary Chat does not save this result as a canonical model."
    : `The interactive model is retained with this ${input.retentionScope === "project" ? "Project conversation" : "Chat"}. Open the saved Artifact; model details and checks are under Show work.`;
  return [
    `### ${input.label}`,
    body,
    `${inputsLine(input.dataClassification, input.sourceCount)} ${validationLine(input.validationLevel)}`,
    ...(warnings.length ? [warnings.map((warning) => `Note: ${warning}`).join("\n")] : []),
    pointer,
  ].join("\n\n");
}

function latestReports(resolution: CapabilityResolution<LseFinancialReport[]> | null): LseFinancialReport[] {
  if (!resolution?.authoritative?.value?.length) return [];
  return [...resolution.authoritative.value]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
}

function safeReportData(report: LseFinancialReport): Record<string, unknown> {
  try {
    const value = JSON.parse(report.data);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function statementEvidence(
  resolution: CapabilityResolution<LseFinancialReport[]> | null,
  reportType: string,
): Array<{ id: string; title: string; snippet: string; sourceRef: string; url: null; sourceType: "provider"; observedAt: string | null }> {
  if (!resolution) return [];
  return resolution.observations.map((observation) => ({
    id: `evidence-${reportType}-${observation.providerId}`,
    title: `${reportType} statements · ${observation.providerLabel}`,
    snippet: `${observation.value.length} ${reportType} report(s) observed; conflict comparison is preserved in Show Work.`,
    sourceRef: `provider:${observation.providerId}`,
    url: null,
    sourceType: "provider" as const,
    observedAt: resolution.resolvedAt,
  }));
}

export function buildP5CompanyResearchArtifact(input: {
  projectId: number | null;
  scope?: "quick" | "project" | "temporary";
  symbol: string;
  quote: Quote;
  technical: TechnicalSnapshot | null;
  income: CapabilityResolution<LseFinancialReport[]> | null;
  balance: CapabilityResolution<LseFinancialReport[]> | null;
  cashflow: CapabilityResolution<LseFinancialReport[]> | null;
  sourceRefs: string[];
  receiptIds: string[];
  reconciliation?: P5Reconciliation | null;
}): ConversationArtifactDraft {
  const incomeRows = latestReports(input.income);
  const balanceRows = latestReports(input.balance);
  const cashflowRows = latestReports(input.cashflow);
  const latestIncome = incomeRows[0] ? safeReportData(incomeRows[0]) : {};
  const latestBalance = balanceRows[0] ? safeReportData(balanceRows[0]) : {};
  const latestCashflow = cashflowRows[0] ? safeReportData(cashflowRows[0]) : {};
  const conflicts = [input.income, input.balance, input.cashflow]
    .flatMap((resolution) => resolution?.conflicts ?? []);

  const claims = [
    {
      id: "claim-market-price",
      text: `${input.symbol} observed market price is ${input.quote.price} ${input.quote.currency}.`,
      sourceRefs: input.sourceRefs.filter((ref) => /quote|market|provider/i.test(ref)).slice(0, 20),
    },
    ...(typeof latestIncome.revenue === "number" ? [{
      id: "claim-revenue",
      text: `Latest observed annual revenue is ${latestIncome.revenue}.`,
      sourceRefs: input.income?.authoritative ? [`provider:${input.income.authoritative.providerId}`] : [],
    }] : []),
    ...(typeof latestIncome.netIncome === "number" ? [{
      id: "claim-net-income",
      text: `Latest observed annual net income is ${latestIncome.netIncome}.`,
      sourceRefs: input.income?.authoritative ? [`provider:${input.income.authoritative.providerId}`] : [],
    }] : []),
  ];

  const blocks = [
    {
      id: "heading",
      type: "heading" as const,
      text: `${input.symbol} Professional Research`,
      attrs: {
        professionalReconciliation: input.reconciliation ?? null,
        professionalExport: p5ExportProfile("research"),
      },
    },
    {
      id: "market",
      type: "paragraph" as const,
      text: `Market: ${input.quote.price} ${input.quote.currency}; change ${input.quote.changePercent ?? "N/A"}%. Provider: ${input.quote.quoteSource}.`,
      attrs: {},
    },
    ...(input.technical ? [{
      id: "technical",
      type: "paragraph" as const,
      text: `Technicals: RSI14 ${input.technical.rsi14 ?? "N/A"}; MACD crossover ${input.technical.macdCrossover ?? "N/A"}.`,
      attrs: {},
    }] : []),
    {
      id: "income",
      type: "code" as const,
      text: JSON.stringify({ latest: latestIncome, history: incomeRows.map((row) => ({ fiscalYear: row.fiscal_year, date: row.date, data: safeReportData(row) })) }, null, 2),
      attrs: { section: "income_statement" },
    },
    {
      id: "balance",
      type: "code" as const,
      text: JSON.stringify({ latest: latestBalance, history: balanceRows.map((row) => ({ fiscalYear: row.fiscal_year, date: row.date, data: safeReportData(row) })) }, null, 2),
      attrs: { section: "balance_sheet" },
    },
    {
      id: "cashflow",
      type: "code" as const,
      text: JSON.stringify({ latest: latestCashflow, history: cashflowRows.map((row) => ({ fiscalYear: row.fiscal_year, date: row.date, data: safeReportData(row) })) }, null, 2),
      attrs: { section: "cash_flow" },
    },
  ];

  return {
    schemaVersion: "1",
    artifactId: crypto.randomUUID(),
    artifactType: "research",
    title: `${input.symbol} Professional Research`,
    projectId: input.projectId,
    sourceRefs: [...new Set(input.sourceRefs)],
    executionReceiptIds: input.receiptIds,
    data: {
      kind: "research",
      question: `Research ${input.symbol}`,
      plan: {
        status: "completed",
        steps: [
          { id: "identity", objective: "Resolve canonical security identity", status: "done", sourceKinds: ["provider"] },
          { id: "market", objective: "Retrieve governed market observations", status: "done", sourceKinds: ["provider"] },
          { id: "fundamentals", objective: "Resolve multi-provider financial statements and conflicts", status: incomeRows.length + balanceRows.length + cashflowRows.length ? "done" : "blocked", sourceKinds: ["provider"] },
          { id: "analysis", objective: "Calculate deterministic market analytics", status: input.technical ? "done" : "blocked", sourceKinds: ["provider"] },
        ],
      },
      blocks,
      claims,
      evidence: [
        ...statementEvidence(input.income, "income"),
        ...statementEvidence(input.balance, "balance"),
        ...statementEvidence(input.cashflow, "cashflow"),
      ],
      sourcePolicy: {
        mode: "connected_sources",
        allowedSourceRefs: [...new Set(input.sourceRefs)],
        providerAllow: [],
        providerDeny: [],
      },
      contradictions: conflicts.slice(0, 500).map((conflict, index) => ({
        id: `conflict-${index + 1}`,
        summary: `${conflict.key} · ${conflict.field} differs across ${conflict.values.map((item) => item.providerId).join(", ")}.`,
        claimRefs: [],
        evidenceRefs: conflict.values.map((item) => `provider:${item.providerId}`),
        status: "open",
      })),
      executionTrail: input.receiptIds.map((receiptId) => ({
        at: new Date().toISOString(),
        action: "P5 professional research workflow step",
        sourceRefs: [...new Set(input.sourceRefs)].slice(0, 100),
        receiptId,
      })),
      editorPreference: "builtin",
    },
    persistence: input.scope === "quick" ? "chat_candidate" : input.projectId ? "project_candidate" : "ephemeral",
  };
}

export function buildP5ResearchReportArtifact(input: {
  projectId: number | null;
  scope?: "quick" | "project" | "temporary";
  symbol: string;
  quote: Quote;
  technical: TechnicalSnapshot | null;
  sourceRefs: string[];
  receiptIds: string[];
  templateId?: ReportTemplateId;
  statementSummary: Record<string, unknown>;
  limitations: string[];
  reconciliation?: P5Reconciliation | null;
}): ConversationArtifactDraft {
  const report = generateReportPack({
    templateId: input.templateId ?? "investment_memo",
    title: `${input.symbol} Investment Research`,
    symbol: input.symbol,
    engineId: "lios.p5.company-research",
    engineVersion: "1.0.0",
    sectionData: {
      summary: {
        symbol: input.symbol,
        marketPrice: input.quote.price,
        currency: input.quote.currency,
        changePercent: input.quote.changePercent,
        technical: input.technical,
      },
      key_metrics: input.statementSummary,
      table: input.statementSummary,
      assumptions: [],
      limitations: input.limitations,
      sources: input.sourceRefs,
    },
  });
  return {
    schemaVersion: "1",
    artifactId: crypto.randomUUID(),
    artifactType: "report",
    title: report.title,
    projectId: input.projectId,
    sourceRefs: input.sourceRefs,
    executionReceiptIds: input.receiptIds,
    data: {
      kind: "report",
      templateId: report.templateId,
      ...projectReportSections(report, {
        attrs: { sourceRefs: input.sourceRefs, executionReceiptIds: input.receiptIds },
        firstBlockAttrs: {
          professionalReconciliation: input.reconciliation ?? null,
          professionalExport: p5ExportProfile("report"),
        },
      }),
      editorPreference: "builtin",
    },
    persistence: input.scope === "quick" ? "chat_candidate" : input.projectId ? "project_candidate" : "ephemeral",
  };
}


export function buildP5FundamentalsArtifact(input: {
  projectId: number | null;
  scope?: "quick" | "project" | "temporary";
  symbol: string;
  income: CapabilityResolution<LseFinancialReport[]> | null;
  balance: CapabilityResolution<LseFinancialReport[]> | null;
  cashflow: CapabilityResolution<LseFinancialReport[]> | null;
  sourceRefs: string[];
  receiptIds: string[];
  reconciliation?: P5Reconciliation | null;
}): ConversationArtifactDraft {
  const incomeRows = latestReports(input.income);
  const balanceRows = latestReports(input.balance);
  const cashflowRows = latestReports(input.cashflow);
  const conflicts = [input.income, input.balance, input.cashflow]
    .flatMap((resolution) => resolution?.conflicts ?? []);
  const blocks = [
    {
      id: "heading",
      type: "heading" as const,
      text: `${input.symbol} Fundamentals`,
      attrs: {
        professionalReconciliation: input.reconciliation ?? null,
        professionalExport: p5ExportProfile("research"),
      },
    },
    {
      id: "income",
      type: "code" as const,
      text: JSON.stringify(incomeRows.map((row) => ({ fiscalYear: row.fiscal_year, date: row.date, currency: row.reported_currency, data: safeReportData(row) })), null, 2),
      attrs: { section: "income_statement" },
    },
    {
      id: "balance",
      type: "code" as const,
      text: JSON.stringify(balanceRows.map((row) => ({ fiscalYear: row.fiscal_year, date: row.date, currency: row.reported_currency, data: safeReportData(row) })), null, 2),
      attrs: { section: "balance_sheet" },
    },
    {
      id: "cashflow",
      type: "code" as const,
      text: JSON.stringify(cashflowRows.map((row) => ({ fiscalYear: row.fiscal_year, date: row.date, currency: row.reported_currency, data: safeReportData(row) })), null, 2),
      attrs: { section: "cash_flow" },
    },
  ];
  return {
    schemaVersion: "1",
    artifactId: crypto.randomUUID(),
    artifactType: "research",
    title: `${input.symbol} Fundamentals`,
    projectId: input.projectId,
    sourceRefs: [...new Set(input.sourceRefs)],
    executionReceiptIds: input.receiptIds,
    data: {
      kind: "research",
      question: `Review ${input.symbol} company fundamentals and financial statements`,
      plan: {
        status: "completed",
        steps: [
          { id: "identity", objective: "Resolve canonical security identity", status: "done", sourceKinds: ["provider"] },
          {
            id: "statements",
            objective: "Resolve multi-provider income, balance-sheet and cash-flow statements",
            status: incomeRows.length + balanceRows.length + cashflowRows.length ? "done" : "blocked",
            sourceKinds: ["provider"],
          },
        ],
      },
      blocks,
      claims: [],
      evidence: [
        ...statementEvidence(input.income, "income"),
        ...statementEvidence(input.balance, "balance"),
        ...statementEvidence(input.cashflow, "cashflow"),
      ],
      sourcePolicy: {
        mode: "connected_sources",
        allowedSourceRefs: [...new Set(input.sourceRefs)],
        providerAllow: [],
        providerDeny: [],
      },
      contradictions: conflicts.slice(0, 500).map((conflict, index) => ({
        id: `conflict-${index + 1}`,
        summary: `${conflict.key} · ${conflict.field} differs across ${conflict.values.map((item) => item.providerId).join(", ")}.`,
        claimRefs: [],
        evidenceRefs: conflict.values.map((item) => `provider:${item.providerId}`),
        status: "open",
      })),
      executionTrail: input.receiptIds.map((receiptId) => ({
        at: new Date().toISOString(),
        action: "P5 company fundamentals workflow step",
        sourceRefs: [...new Set(input.sourceRefs)].slice(0, 100),
        receiptId,
      })),
      editorPreference: "builtin",
    },
    persistence: input.scope === "quick" ? "chat_candidate" : input.projectId ? "project_candidate" : "ephemeral",
  };
}


export function buildP5ReportFromArtifact(input: {
  projectId: number | null;
  scope?: "quick" | "project" | "temporary";
  sourceArtifactId: string;
  sourceTitle: string;
  sourceContent: ArtifactContent;
  sourceRefs: string[];
  receiptId: string;
  reconciliation?: P5Reconciliation | null;
  templateId?: ReportTemplateId;
}): ConversationArtifactDraft {
  const templateId = input.templateId ?? defaultArtifactReportTemplate(input.sourceContent.kind);
  const template = getReportTemplate(templateId);
  if (!template) throw new Error(`Unknown report template: ${templateId}`);
  const report = generateReportPack({
    templateId,
    title: input.sourceTitle + " · " + template.name,
    engineId: "lios.p5.report-assembler",
    engineVersion: "1.0.0",
    sectionData: {
      ...reportSectionsFromArtifact(input.sourceContent),
      summary: {
        sourceArtifactId: input.sourceArtifactId,
        sourceKind: input.sourceContent.kind,
        statement: "This report is assembled from the selected canonical LiOS Artifact. It does not recalculate or reinterpret deterministic outputs.",
      },
      ...(input.sourceContent.kind === "chart" ? {
        chart_placeholder: { artifactRef: input.sourceArtifactId, chartType: input.sourceContent.chartType },
      } : {}),
      limitations: ["Report assembly preserves the selected Artifact state; analytical changes require a governed Artifact/model rerun."],
      sources: input.sourceRefs,
    },
  });
  return {
    schemaVersion: "1",
    artifactId: crypto.randomUUID(),
    artifactType: "report",
    title: report.title,
    projectId: input.projectId,
    sourceRefs: [...new Set([input.sourceArtifactId, ...input.sourceRefs])],
    executionReceiptIds: [input.receiptId],
    data: {
      kind: "report",
      templateId: report.templateId,
      ...projectReportSections(report, {
        attrs: {
          sourceArtifactId: input.sourceArtifactId,
          templateId,
          sourceRefs: [...new Set([input.sourceArtifactId, ...input.sourceRefs])],
          executionReceiptIds: [input.receiptId],
        },
        firstBlockAttrs: {
          professionalReconciliation: input.reconciliation ?? null,
          professionalExport: p5ExportProfile("report"),
        },
      }),
      editorPreference: "builtin",
    },
    persistence: input.scope === "quick" ? "chat_candidate" : input.projectId ? "project_candidate" : "ephemeral",
  };
}
