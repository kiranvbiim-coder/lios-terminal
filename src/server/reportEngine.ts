/**
 * Report Engine: generates structured report packs from LiOS engine
 * outputs. Produces JSON report structures that can be rendered as
 * PDF, XLSX, PPTX, or HTML by the existing export utilities.
 *
 * Each report template defines sections, data bindings, and layout.
 * The engine is format-agnostic — it produces a ReportPack that
 * downstream renderers (exportPdf.ts, exportXlsx.ts, etc.) consume.
 */
import crypto from "crypto";
import type { DataPassport, SourcePriority } from "@shared/dataTruth";

// ─── Report Pack Structure ────────────────────────────────────────────────

export type ReportSectionType =
  | "title"
  | "summary"
  | "table"
  | "chart_placeholder"
  | "key_metrics"
  | "assumptions"
  | "passport_appendix"
  | "limitations"
  | "sources"
  | "decision_receipt"
  | "text";

export interface ReportSection {
  type: ReportSectionType;
  title: string;
  content: unknown;
  order: number;
}

export interface ReportPack {
  id: string;
  templateId: string;
  title: string;
  subtitle?: string;
  generatedAt: string;
  sections: ReportSection[];
  metadata: {
    symbol?: string;
    engineId?: string;
    engineVersion?: string;
    passportIds: string[];
    receiptId?: string;
    outputHash: string;
  };
}

// ─── Report Templates ─────────────────────────────────────────────────────

export type ReportTemplateId =
  | "investment_memo"
  | "company_tearsheet"
  | "dcf_model_pack"
  | "portfolio_review"
  | "risk_report"
  | "macro_scenario"
  | "decision_receipt_report"
  | "earnings_preview";

export interface ReportTemplate {
  id: ReportTemplateId;
  name: string;
  description: string;
  sectionOrder: ReportSectionType[];
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: "investment_memo",
    name: "Investment Memo",
    description: "Full investment thesis with valuation, risks, and recommendation",
    sectionOrder: ["title", "summary", "key_metrics", "table", "chart_placeholder", "assumptions", "limitations", "sources", "passport_appendix"],
  },
  {
    id: "company_tearsheet",
    name: "Company Tear Sheet",
    description: "One-page company overview with key financials and market data",
    sectionOrder: ["title", "key_metrics", "table", "chart_placeholder", "sources"],
  },
  {
    id: "dcf_model_pack",
    name: "DCF Model Pack",
    description: "Complete DCF analysis with assumptions, forecast, sensitivity",
    sectionOrder: ["title", "summary", "assumptions", "table", "chart_placeholder", "key_metrics", "limitations", "passport_appendix", "sources"],
  },
  {
    id: "portfolio_review",
    name: "Portfolio Review",
    description: "Portfolio performance, attribution, and risk analysis",
    sectionOrder: ["title", "summary", "key_metrics", "table", "chart_placeholder", "limitations", "sources"],
  },
  {
    id: "risk_report",
    name: "Risk Report",
    description: "VaR, stress testing, and risk factor analysis",
    sectionOrder: ["title", "summary", "key_metrics", "table", "limitations", "sources"],
  },
  {
    id: "macro_scenario",
    name: "Macro Scenario Report",
    description: "Economic scenario analysis with cross-domain impacts",
    sectionOrder: ["title", "summary", "table", "chart_placeholder", "assumptions", "limitations", "sources"],
  },
  {
    id: "decision_receipt_report",
    name: "Decision Receipt Report",
    description: "Auditable record of a decision with full provenance chain",
    sectionOrder: ["title", "decision_receipt", "assumptions", "passport_appendix", "limitations", "sources"],
  },
  {
    id: "earnings_preview",
    name: "Earnings Preview",
    description: "Pre-earnings analysis with estimates, historical surprise, and expectations",
    sectionOrder: ["title", "summary", "key_metrics", "table", "chart_placeholder", "sources"],
  },
];

const REPORT_TEMPLATE_ALIASES: Record<ReportTemplateId, readonly string[]> = {
  investment_memo: ["investment memo", "investment memorandum"],
  company_tearsheet: ["company tear sheet", "company tearsheet", "company tear-sheet"],
  dcf_model_pack: ["dcf model pack", "dcf report"],
  portfolio_review: ["portfolio review", "portfolio report"],
  risk_report: ["risk report"],
  macro_scenario: ["macro scenario report", "macro scenario"],
  decision_receipt_report: ["decision receipt report"],
  earnings_preview: ["earnings preview"],
};

export function defaultArtifactReportTemplate(kind: string): ReportTemplateId {
  return kind === "portfolio" ? "portfolio_review"
    : kind === "valuation" ? "dcf_model_pack"
      : kind === "decision" ? "decision_receipt_report"
        : "investment_memo";
}

/** Resolve presentation intent only; never infer analytical inputs from a template. */
export function resolveExplicitReportTemplate(message: string): {
  reportRequested: boolean;
  templateId: ReportTemplateId | null;
  error: string | null;
} {
  const normalized = message.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  const matches = REPORT_TEMPLATES.filter((template) =>
    REPORT_TEMPLATE_ALIASES[template.id].some((alias) =>
      new RegExp(`\\b${alias.replace(/-/g, " ")}\\b`).test(normalized)));
  const requested = normalized.match(/\b(?:create|generate|assemble|build|prepare|write|render)\s+(?:(?:a|an|the)\s+)?(.+?)(?=\s+(?:from|using|based on|for)\b|[.!?\n]|$)/)?.[1]
    ?? normalized.match(/^(.+?\b(?:report|memo|memorandum|tear ?sheet|model pack|preview|template))(?=\s+(?:from|using|based on|for)\b|[.!?]|$)/)?.[1];
  const reportRequested = matches.length > 0 || /\b(?:report|memo|memorandum|tear ?sheet|model pack|earnings preview|template)\b/.test(requested ?? normalized);
  if (!reportRequested) return { reportRequested: false, templateId: null, error: null };
  if (matches.length > 1) {
    return { reportRequested: true, templateId: null, error: `Choose one report template; the request names ${matches.map((template) => template.name).join(" and ")}.` };
  }
  if (requested) {
    const candidates = requested.split(/\s+(?:and|or)\s+|,/).map((part) =>
      part.replace(/^(?:(?:create|generate|assemble|build|prepare|write|render)\s+)?(?:(?:a|an|the)\s+)?/, "").trim());
    const unknown = candidates.find((part) =>
      /\b(?:report|memo|memorandum|tear ?sheet|model pack|preview|template)\b/.test(part)
      && !["report", "professional report", "research report"].includes(part)
      && !REPORT_TEMPLATES.some((template) => REPORT_TEMPLATE_ALIASES[template.id].some((alias) => alias.replace(/-/g, " ") === part)));
    if (unknown) {
      return { reportRequested: true, templateId: null, error: `Unknown report template "${unknown}". Choose one of: ${REPORT_TEMPLATES.map((template) => template.name).join(", ")}.` };
    }
  }
  return { reportRequested: true, templateId: matches[0]?.id ?? null, error: null };
}

// ─── Report Generation ────────────────────────────────────────────────────

// Minimal shape the "decision_receipt" report section reads (`.id` only,
// for metadata.receiptId); the real receipt is server/decisionRoutes.ts's
// DB-backed DecisionReceiptVersion, deliberately not imported here since
// this file only ever renders whatever shape a caller passes through.
export interface ReportDecisionReceipt {
  id: string;
  [key: string]: unknown;
}

export interface ReportGenerationInputs {
  templateId: ReportTemplateId;
  title: string;
  subtitle?: string;
  symbol?: string;
  engineId?: string;
  engineVersion?: string;
  /** Section data: keyed by section type */
  sectionData: Partial<Record<ReportSectionType, unknown>>;
  passports?: DataPassport[];
  receipt?: ReportDecisionReceipt;
}

export function generateReportPack(inputs: ReportGenerationInputs): ReportPack {
  const template = REPORT_TEMPLATES.find((t) => t.id === inputs.templateId);
  if (!template) throw new Error(`Unknown report template: ${inputs.templateId}`);

  const sections: ReportSection[] = [];
  let order = 0;

  for (const sectionType of template.sectionOrder) {
    const content = inputs.sectionData[sectionType] ?? getDefaultContent(sectionType, inputs);
    sections.push({
      type: sectionType,
      title: getSectionTitle(sectionType),
      content,
      order: order++,
    });
  }

  const passportIds = inputs.passports?.map((p) => p.id) ?? [];

  /*
   * Report identity intentionally excludes the generated report id and
   * generatedAt timestamp: both are unique per render and are not report
   * content. It includes the rendered section content, stable report
   * metadata, receipt content, and passport/source references. Passport
   * retrieval/creation timestamps are excluded from the reference projection;
   * the passport snapshotHash is the immutable data-version anchor.
   */
  const identity = {
    templateId: inputs.templateId,
    title: inputs.title,
    subtitle: inputs.subtitle,
    symbol: inputs.symbol,
    engineId: inputs.engineId,
    engineVersion: inputs.engineVersion,
    sections: sections.map((section) => ({
      type: section.type,
      title: section.title,
      order: section.order,
      content: section.content,
    })),
    receipt: inputs.receipt,
    passports: inputs.passports?.map((passport) => ({
      id: passport.id,
      contractFamily: passport.contractFamily,
      entityKey: passport.entityKey,
      snapshotHash: passport.snapshotHash,
      engineOutputHash: passport.engineOutputHash,
      engineId: passport.engineId,
      engineVersion: passport.engineVersion,
      quality: passport.quality,
      entries: passport.entries.map((entry) => ({
        field: entry.field,
        source: entry.source,
        currency: entry.currency,
        unit: entry.unit,
        period: entry.period,
      })),
    })) ?? [],
  };

  const outputHash = crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(identity)))
    .digest("hex");

  return {
    id: `rpt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    templateId: inputs.templateId,
    title: inputs.title,
    subtitle: inputs.subtitle,
    generatedAt: new Date().toISOString(),
    sections,
    metadata: {
      symbol: inputs.symbol,
      engineId: inputs.engineId,
      engineVersion: inputs.engineVersion,
      passportIds,
      receiptId: inputs.receipt?.id,
      outputHash,
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function getSectionTitle(type: ReportSectionType): string {
  const titles: Record<ReportSectionType, string> = {
    title: "Report Title",
    summary: "Executive Summary",
    table: "Data Tables",
    chart_placeholder: "Charts & Visualizations",
    key_metrics: "Key Metrics",
    assumptions: "Assumptions",
    passport_appendix: "Data Passport Appendix",
    limitations: "Limitations & Caveats",
    sources: "Sources & References",
    decision_receipt: "Decision Receipt",
    text: "Analysis",
  };
  return titles[type];
}

// Include source/winner/pin metadata in professional exports. Every field a
// passport carries already
// records who supplied it (source.provider/connectorId) and, when a
// conflict was resolved, HOW (DataConflict.strategy/reason) -- including
// "manual_override", which is exactly what a conflict pin produces
// when it forces a specific provider to win (see dataTruth.ts's
// SourcePriority and resolveConflict). None of that reached a rendered
// export before this: passport_appendix only showed passport-level
// metadata (id/quality/snapshotHash), dropping the per-field entries
// entirely, and "sources" was an unconditional empty-array stub.
function buildSourcesAppendix(passports: DataPassport[] = []): Array<{ provider: string; connectorId: string; priority: SourcePriority; fields: string[] }> {
  const byKey = new Map<string, { provider: string; connectorId: string; priority: SourcePriority; fields: Set<string> }>();
  for (const passport of passports) {
    for (const entry of passport.entries) {
      const key = `${entry.source.connectorId}:${entry.source.provider}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.fields.add(entry.field);
        // A manual_override anywhere for this source is the strongest
        // signal a human explicitly chose it (a pin) -- that should
        // win the displayed priority even if the same source also
        // supplied other fields automatically.
        if (entry.source.priority === "manual_override") existing.priority = "manual_override";
      } else {
        byKey.set(key, { provider: entry.source.provider, connectorId: entry.source.connectorId, priority: entry.source.priority, fields: new Set([entry.field]) });
      }
    }
  }
  return Array.from(byKey.values())
    .map((s) => ({ provider: s.provider, connectorId: s.connectorId, priority: s.priority, fields: Array.from(s.fields).sort() }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

function getDefaultContent(type: ReportSectionType, inputs: ReportGenerationInputs): unknown {
  switch (type) {
    case "title": return { title: inputs.title, subtitle: inputs.subtitle, symbol: inputs.symbol };
    case "passport_appendix": return inputs.passports?.map((p) => ({
      id: p.id,
      contractFamily: p.contractFamily,
      entityKey: p.entityKey,
      quality: p.quality,
      snapshotHash: p.snapshotHash,
      // Per-field winner + (when applicable) conflict/pin provenance --
      // the part of a DataPassport a professional export appendix exists
      // to prove, previously dropped between the hash-identity object
      // (which always included it) and what actually got rendered.
      entries: p.entries.map((e) => ({
        field: e.field,
        source: e.source,
        retrievedAt: e.retrievedAt,
        freshnessDays: e.freshnessDays,
        conflict: e.conflict ? { strategy: e.conflict.strategy, resolvedFrom: e.conflict.resolvedFrom, reason: e.conflict.reason, alternativeCount: e.conflict.values.length } : null,
      })),
    })) ?? [];
    case "decision_receipt": return inputs.receipt ?? null;
    case "limitations": return [];
    case "sources": return buildSourcesAppendix(inputs.passports);
    default: return null;
  }
}

// ─── Report Template Listing ──────────────────────────────────────────────

export function listReportTemplates(): Array<{ id: string; name: string; description: string }> {
  return REPORT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description }));
}

export function getReportTemplate(id: string): ReportTemplate | undefined {
  return REPORT_TEMPLATES.find((t) => t.id === id);
}
