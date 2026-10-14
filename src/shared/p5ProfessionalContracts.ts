import { z } from "zod";
import { advancedQuantInputProvenanceSchema } from "./quantModelRegistry";
import { artifactKindSchema, artifactExportFormatSchema } from "./artifactContracts";

export const p5ProfessionalFamilySchema = z.enum([
  "company_research",
  "company_fundamentals",
  "valuation",
  "portfolio_risk",
  "fixed_income",
  "derivatives",
  "macro_fx",
  "research_reporting",
  "personal_finance",
]);
export type P5ProfessionalFamily = z.infer<typeof p5ProfessionalFamilySchema>;

export const p5AdvancedModelPathSchema = z.enum([
  "valuation/probabilistic-dcf",
  "valuation/dcf-sensitivity",
  "valuation/reverse-dcf",
  "valuation/residual-income",
  "valuation/eva",
  "valuation/sotp",
  "valuation/merger-accretion",
  "valuation/real-option",
  "valuation/expectation-surface",
  "valuation/project-finance",
  "valuation/saas-cohort",
  "valuation/insurance-embedded-value",
  "portfolio/hrp",
  "portfolio/risk-budget",
  "portfolio/factor-risk",
  "portfolio/tracking-error",
  "portfolio/tax-aware-rebalance",
  "portfolio/stress-aware",
  "portfolio/regime-blend",
  "portfolio/black-litterman",
  "portfolio/bayesian-mean-shrinkage",
  "portfolio/ledoit-wolf-covariance",
  "risk/tail-report",
  "risk/liquidity-var",
  "risk/reverse-stress",
  "risk/correlation-breakdown",
  "fixed-income/bootstrap-par-curve",
  "fixed-income/spread-analytics",
  "fixed-income/key-rate-risk",
  "fixed-income/immunize-duration",
  "fixed-income/callable-oas",
  "fixed-income/floating-rate-note",
  "fixed-income/inflation-linked-bond",
  "fixed-income/credit-spread-curve",
  "derivatives/black-scholes-greeks",
  "derivatives/implied-volatility",
  "derivatives/surface-arbitrage",
  "derivatives/exotic-monte-carlo",
  "derivatives/interest-rate-swap",
  "derivatives/black-swaption",
  "derivatives/local-volatility",
  "derivatives/portfolio-greeks",
  "derivatives/futures-basis",
  "derivatives/strategy-payoff",
  "macro/yield-curve-signals",
  "macro/financial-conditions-index",
  "macro/recession-probability",
  "macro/inflation-decomposition",
  "macro/company-transmission",
  "macro/fiscal-multiplier",
  "research/evidence-graph",
  "research/filing-diff",
  "research/consensus-divergence",
  "research/catalyst-monitor",
  "financial-modeling/three-statement",
]);
export type P5AdvancedModelPath = z.infer<typeof p5AdvancedModelPathSchema>;

export const p5ReconciliationSchema = z.object({
  calculatorOfRecord: z.string().trim().min(1).max(300),
  deterministic: z.literal(true),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  outputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  validationLevel: z.string().trim().max(120).nullable().default(null),
  sourceArtifactRef: z.string().trim().max(500).nullable().default(null),
  analyticalRecalculation: z.boolean().default(true),
}).strict();
export type P5Reconciliation = z.infer<typeof p5ReconciliationSchema>;

export const p5ProfessionalExportProfileSchema = z.object({
  authority: z.literal("p4_artifact_export_plan"),
  artifactKind: artifactKindSchema,
  formats: z.array(artifactExportFormatSchema).min(1).max(10),
}).strict();
export type P5ProfessionalExportProfile = z.infer<typeof p5ProfessionalExportProfileSchema>;

export const p5ProfessionalRunSchema = z.object({
  schemaVersion: z.literal("1"),
  family: p5ProfessionalFamilySchema,
  modelPath: p5AdvancedModelPathSchema,
  parameters: z.record(z.unknown()),
  inputProvenance: advancedQuantInputProvenanceSchema.optional(),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
}).strict();
export type P5ProfessionalRun = z.infer<typeof p5ProfessionalRunSchema>;

export const p5CompanyResearchRequestSchema = z.object({
  schemaVersion: z.literal("1"),
  symbol: z.string().trim().min(1).max(120),
  includeTechnicals: z.boolean().default(true),
  includeStatements: z.boolean().default(true),
  includeReport: z.boolean().default(true),
  statementPeriod: z.enum(["FY", "Q"]).default("FY"),
}).strict();
export type P5CompanyResearchRequest = z.infer<typeof p5CompanyResearchRequestSchema>;

export const p5WorkflowDescriptorSchema = z.object({
  family: p5ProfessionalFamilySchema,
  label: z.string().trim().min(1).max(240),
  artifactType: z.enum(["research", "valuation", "portfolio", "report", "decision", "data"]),
  deterministicAuthority: z.boolean(),
  supportsConversation: z.boolean(),
  supportsArtifactInput: z.boolean(),
  supportsExplicitJsonInput: z.boolean(),
  supportsRerun: z.boolean(),
  supportsExport: z.boolean(),
  defaultWorkspaceCommand: z.string().trim().min(1).max(120),
}).strict();
export type P5WorkflowDescriptor = z.infer<typeof p5WorkflowDescriptorSchema>;

export const P5_WORKFLOW_DESCRIPTORS: readonly P5WorkflowDescriptor[] = [
  { family: "company_research", label: "Company Research", artifactType: "research", deterministicAuthority: true, supportsConversation: true, supportsArtifactInput: false, supportsExplicitJsonInput: false, supportsRerun: true, supportsExport: true, defaultWorkspaceCommand: "/research" },
  { family: "company_fundamentals", label: "Company Fundamentals", artifactType: "data", deterministicAuthority: true, supportsConversation: true, supportsArtifactInput: false, supportsExplicitJsonInput: false, supportsRerun: true, supportsExport: true, defaultWorkspaceCommand: "/fundamentals" },
  { family: "valuation", label: "Valuation & Modeling", artifactType: "valuation", deterministicAuthority: true, supportsConversation: true, supportsArtifactInput: true, supportsExplicitJsonInput: true, supportsRerun: true, supportsExport: true, defaultWorkspaceCommand: "/valuation" },
  { family: "portfolio_risk", label: "Portfolio & Risk", artifactType: "portfolio", deterministicAuthority: true, supportsConversation: true, supportsArtifactInput: true, supportsExplicitJsonInput: true, supportsRerun: true, supportsExport: true, defaultWorkspaceCommand: "/portfolio" },
  { family: "fixed_income", label: "Fixed Income", artifactType: "report", deterministicAuthority: true, supportsConversation: true, supportsArtifactInput: true, supportsExplicitJsonInput: true, supportsRerun: true, supportsExport: true, defaultWorkspaceCommand: "/fixedincome" },
  { family: "derivatives", label: "Derivatives", artifactType: "report", deterministicAuthority: true, supportsConversation: true, supportsArtifactInput: true, supportsExplicitJsonInput: true, supportsRerun: true, supportsExport: true, defaultWorkspaceCommand: "/options" },
  { family: "macro_fx", label: "Macro & FX", artifactType: "report", deterministicAuthority: true, supportsConversation: true, supportsArtifactInput: true, supportsExplicitJsonInput: true, supportsRerun: true, supportsExport: true, defaultWorkspaceCommand: "/macro" },
  { family: "research_reporting", label: "Research & Reporting", artifactType: "report", deterministicAuthority: true, supportsConversation: true, supportsArtifactInput: true, supportsExplicitJsonInput: true, supportsRerun: true, supportsExport: true, defaultWorkspaceCommand: "/research" },
  { family: "personal_finance", label: "Personal Finance", artifactType: "decision", deterministicAuthority: true, supportsConversation: true, supportsArtifactInput: false, supportsExplicitJsonInput: false, supportsRerun: true, supportsExport: true, defaultWorkspaceCommand: "/personal-finance" },
] as const;

export function p5WorkflowDescriptor(family: P5ProfessionalFamily): P5WorkflowDescriptor {
  const found = P5_WORKFLOW_DESCRIPTORS.find((item) => item.family === family);
  if (!found) throw new Error(`Unknown P5 professional workflow family: ${family}`);
  return found;
}
