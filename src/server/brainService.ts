import crypto from "crypto";
import type { UserRole } from "@shared/schema";

export const BRAIN_DECISION_TYPES = ["investment", "policy", "portfolio", "risk", "supply_chain", "consulting", "general_research"] as const;
export type BrainDecisionType = typeof BRAIN_DECISION_TYPES[number];
export type BrainAgentRole = "planner" | "research" | "financial_analyst" | "portfolio" | "risk" | "economist" | "policy" | "supply_chain" | "consulting" | "red_team" | "verification" | "decision_judge" | "human";

export interface BrainIntent {
  decisionType: BrainDecisionType;
  entities: string[];
  horizon: string | null;
  constraints: string[];
  requiredOutputs: string[];
}

export interface BrainTaskPlan {
  key: string;
  label: string;
  agentRole: BrainAgentRole;
  toolId: string | null;
  dependencies: string[];
  expectedEvidence: string[];
  completionCriteria: string;
  input: Record<string, unknown>;
}

export interface BrainToolDefinition {
  id: string;
  label: string;
  description: string;
  allowedAgents: BrainAgentRole[];
  allowedRoles: UserRole[];
  dataClass: "public_market" | "public_research" | "official_data" | "tenant_research" | "derived_analysis";
  tenantScoped: boolean;
  writeOperation: boolean;
  inputSchema: Record<string, string>;
  outputContract: string;
  safeFailure: string;
}

const INTERNAL_ROLES: UserRole[] = ["internal_admin", "internal_analyst", "internal_compliance"];
const AUTHOR_ROLES: UserRole[] = ["internal_admin", "internal_analyst"];

export const BRAIN_TOOL_REGISTRY: BrainToolDefinition[] = [
  { id: "research.search", label: "Unified research search", description: "Searches permitted filing, news, official, published, and tenant-private sources.", allowedAgents: ["research", "economist", "policy", "supply_chain"], allowedRoles: AUTHOR_ROLES, dataClass: "public_research", tenantScoped: true, writeOperation: false, inputSchema: { query: "string", entity: "string?", organizationId: "number?" }, outputContract: "Normalized evidence results with source status and provenance.", safeFailure: "Returns incomplete with provider-specific failures." },
  { id: "market.quote", label: "Market quote", description: "Retrieves a source-status-bearing market snapshot for an identified symbol.", allowedAgents: ["financial_analyst", "portfolio", "risk", "verification"], allowedRoles: INTERNAL_ROLES, dataClass: "public_market", tenantScoped: false, writeOperation: false, inputSchema: { symbol: "string" }, outputContract: "Quote fields plus provider, as-of time, and freshness.", safeFailure: "Returns incomplete when no symbol or quote is available." },
  { id: "consensus.analysis", label: "Consensus analysis", description: "Reads saved consensus, revisions, guidance, actual, and model comparisons.", allowedAgents: ["financial_analyst", "research", "verification", "red_team"], allowedRoles: INTERNAL_ROLES, dataClass: "derived_analysis", tenantScoped: true, writeOperation: false, inputSchema: { symbol: "string", organizationId: "number?" }, outputContract: "Deterministic series, comparisons, signals, and snapshot hashes.", safeFailure: "Returns incomplete with an explicit unavailable-coverage reason." },
  { id: "official.catalog", label: "Official data catalog", description: "Finds attributable FRED and World Bank dataset definitions without inventing observations.", allowedAgents: ["economist", "policy", "research", "verification"], allowedRoles: INTERNAL_ROLES, dataClass: "official_data", tenantScoped: false, writeOperation: false, inputSchema: { query: "string" }, outputContract: "Official dataset profiles and direct source URLs.", safeFailure: "Returns incomplete when no matching official dataset is found." },
  { id: "evidence.challenge", label: "Evidence challenge", description: "Deterministically identifies missing, unavailable, or unsupported parts of the task record.", allowedAgents: ["red_team", "verification"], allowedRoles: INTERNAL_ROLES, dataClass: "derived_analysis", tenantScoped: true, writeOperation: false, inputSchema: { runId: "number" }, outputContract: "Explicit gaps and challenged task references.", safeFailure: "Fails closed and blocks synthesis if the execution record cannot be inspected." },
  { id: "provenance.verify", label: "Provenance verification", description: "Checks that material outputs carry source or deterministic calculation references.", allowedAgents: ["verification"], allowedRoles: INTERNAL_ROLES, dataClass: "derived_analysis", tenantScoped: true, writeOperation: false, inputSchema: { runId: "number" }, outputContract: "Coverage result, missing references, and incomplete task list.", safeFailure: "Fails closed and blocks approval when provenance is missing." },
  { id: "synthesis.assemble", label: "Deterministic synthesis", description: "Assembles approved evidence and explicit gaps without generating unsupported figures.", allowedAgents: ["decision_judge"], allowedRoles: AUTHOR_ROLES, dataClass: "derived_analysis", tenantScoped: true, writeOperation: true, inputSchema: { runId: "number" }, outputContract: "Source-constrained final synthesis with replay identifiers.", safeFailure: "Returns incomplete rather than producing a recommendation without support." },
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function parseBrainIntent(question: string, primaryEntity?: string | null): BrainIntent {
  const lower = question.toLowerCase();
  const decisionType: BrainDecisionType = /policy|regulation|government|central bank|inflation|gdp|unemployment|fiscal|monetary/.test(lower) ? "policy"
    : /portfolio|allocation|holdings|rebalance/.test(lower) ? "portfolio"
    : /supply chain|supplier|freight|inventory|logistics/.test(lower) ? "supply_chain"
    : /consult|market entry|strategy|commercial/.test(lower) ? "consulting"
    : /stock|equity|invest|valuation|earnings|company|shares|buy|sell/.test(lower) || primaryEntity ? "investment"
    : /risk|stress|downside|var|exposure/.test(lower) ? "risk"
    : "general_research";
  const tickerCandidates = question.match(/\b[A-Z]{2,5}(?:\.[A-Z]{1,3}|-[A-Z])?\b/g) ?? [];
  const ignored = new Set(["GDP", "CPI", "FED", "SEC", "ETF", "DCF", "EPS", "THE", "AND", "FOR", "WITH"]);
  const entities = unique([primaryEntity?.trim().toUpperCase() ?? "", ...tickerCandidates.filter((item) => !ignored.has(item))]).slice(0, 10);
  const horizonMatch = question.match(/(?:next|over|within|for)\s+(\d+\s*(?:days?|weeks?|months?|quarters?|years?))/i)
    ?? question.match(/\b(short[- ]term|medium[- ]term|long[- ]term)\b/i);
  const constraints = unique(Array.from(question.matchAll(/\b(?:without|under|subject to|assuming|while)\s+([^,.;?]+)/gi), (match) => match[0].trim())).slice(0, 10);
  const outputsByType: Record<BrainDecisionType, string[]> = {
    investment: ["evidence map", "market snapshot", "consensus divergence", "risks and gaps", "approval-ready synthesis"],
    policy: ["official data map", "policy evidence", "affected entities", "risks and gaps", "approval-ready synthesis"],
    portfolio: ["portfolio evidence", "market context", "risk gaps", "approval-ready synthesis"],
    risk: ["risk evidence", "market context", "failure modes", "approval-ready synthesis"],
    supply_chain: ["supply-chain evidence", "affected entities", "failure modes", "approval-ready synthesis"],
    consulting: ["research evidence", "commercial implications", "risks and gaps", "approval-ready synthesis"],
    general_research: ["evidence map", "source gaps", "approval-ready synthesis"],
  };
  return { decisionType, entities, horizon: horizonMatch?.[1] ?? null, constraints, requiredOutputs: outputsByType[decisionType] };
}

export function buildBrainPlan(question: string, intent: BrainIntent, organizationId?: number | null): BrainTaskPlan[] {
  const entity = intent.entities[0] ?? null;
  const tasks: BrainTaskPlan[] = [{ key: "research", label: "Assemble research evidence", agentRole: intent.decisionType === "policy" ? "policy" : "research", toolId: "research.search", dependencies: [], expectedEvidence: ["normalized source result", "provider availability"], completionCriteria: "Search results and failures are source-attributed.", input: { query: question, entity, organizationId: organizationId ?? null } }];
  if (intent.decisionType === "policy") tasks.push({ key: "official_data", label: "Map official datasets", agentRole: "economist", toolId: "official.catalog", dependencies: [], expectedEvidence: ["official dataset profile", "direct source URL"], completionCriteria: "Relevant official datasets are identified without claiming observations.", input: { query: question } });
  if (["investment", "portfolio", "risk"].includes(intent.decisionType)) tasks.push({ key: "market", label: "Capture market context", agentRole: intent.decisionType === "risk" ? "risk" : intent.decisionType === "portfolio" ? "portfolio" : "financial_analyst", toolId: "market.quote", dependencies: [], expectedEvidence: ["provider", "as-of timestamp", "freshness"], completionCriteria: "A current or explicitly fallback quote is captured.", input: { symbol: entity } });
  if (intent.decisionType === "investment") tasks.push({ key: "consensus", label: "Inspect market expectations", agentRole: "financial_analyst", toolId: "consensus.analysis", dependencies: [], expectedEvidence: ["snapshot hash", "revision series", "benchmark comparison"], completionCriteria: "Coverage or unavailability is explicit and reproducible.", input: { symbol: entity, organizationId: organizationId ?? null } });
  const evidenceKeys = tasks.map((task) => task.key);
  tasks.push({ key: "challenge", label: "Challenge evidence coverage", agentRole: "red_team", toolId: "evidence.challenge", dependencies: evidenceKeys, expectedEvidence: ["explicit gaps", "failed or incomplete task references"], completionCriteria: "Missing support is visible before synthesis.", input: {} });
  tasks.push({ key: "verify", label: "Verify provenance and calculations", agentRole: "verification", toolId: "provenance.verify", dependencies: [...evidenceKeys, "challenge"], expectedEvidence: ["source references", "deterministic references"], completionCriteria: "Every material output has provenance or a deterministic reference.", input: {} });
  tasks.push({ key: "approval", label: "Human materiality approval", agentRole: "human", toolId: null, dependencies: ["verify"], expectedEvidence: ["reviewer decision", "approved task snapshot"], completionCriteria: "An authorized analyst explicitly approves or rejects the evidence set.", input: {} });
  tasks.push({ key: "synthesis", label: "Assemble final synthesis", agentRole: "decision_judge", toolId: "synthesis.assemble", dependencies: ["approval"], expectedEvidence: ["approved evidence references", "explicit unresolved gaps"], completionCriteria: "Final output contains no unsupported number and remains replayable.", input: {} });
  return tasks;
}

export function canInvokeBrainTool(toolId: string, agentRole: BrainAgentRole, userRole: UserRole): boolean {
  const tool = BRAIN_TOOL_REGISTRY.find((item) => item.id === toolId);
  return Boolean(tool?.allowedAgents.includes(agentRole) && tool.allowedRoles.includes(userRole));
}

export function findDownstreamTaskKeys(tasks: Array<{ taskKey: string; dependencies: string[] }>, taskKey: string): string[] {
  const keys = new Set([taskKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (!keys.has(task.taskKey) && task.dependencies.some((dependency) => keys.has(dependency))) {
        keys.add(task.taskKey);
        changed = true;
      }
    }
  }
  return Array.from(keys);
}

export function validateToolResult(result: { provenance?: unknown[]; deterministicRefs?: string[]; output?: unknown }): string[] {
  if (result.output == null) return ["missing_output"];
  if (!(result.provenance?.length || result.deterministicRefs?.length)) return ["missing_provenance_or_deterministic_reference"];
  return [];
}

const OFFICIAL_QUERY_CONCEPTS: Array<{ pattern: RegExp; queries: string[] }> = [
  { pattern: /inflation|consumer prices?|\bcpi\b/i, queries: ["inflation", "consumer price"] },
  { pattern: /unemploy|employment|labor|labour|jobs?/i, queries: ["unemployment", "employment"] },
  { pattern: /growth|gross domestic product|\bgdp\b|output/i, queries: ["gross domestic product"] },
  { pattern: /monetary|central bank|interest|rates?|tightening|easing/i, queries: ["interest rate", "federal funds"] },
  { pattern: /fiscal|government spending|budget|deficit|debt/i, queries: ["government", "debt"] },
  { pattern: /trade|tariffs?|imports?|exports?/i, queries: ["trade", "exports"] },
  { pattern: /population|demograph|birth|mortality/i, queries: ["population"] },
];

export function extractOfficialCatalogQueries(question: string): string[] {
  const queries = OFFICIAL_QUERY_CONCEPTS.flatMap((concept) => concept.pattern.test(question) ? concept.queries : []);
  return unique(queries).slice(0, 8);
}

export function shouldExecuteBrainTask(status: string): boolean {
  return status === "pending";
}

export function brainApprovalSnapshotHash(
  tasks: Array<{ id: number; status: string; output: unknown; deterministicRefs: string[] }>,
  approvalTaskId: number,
): string {
  return stableBrainHash(tasks.filter((task) => task.id !== approvalTaskId).map((task) => ({
    id: task.id,
    status: task.status,
    output: task.output,
    refs: task.deterministicRefs,
  })));
}

export function stableBrainHash(value: unknown): string {
  const stable = (item: unknown): string => {
    if (item instanceof Date) return JSON.stringify(item.toISOString());
    if (Array.isArray(item)) return `[${item.map(stable).join(",")}]`;
    if (item && typeof item === "object") return `{${Object.entries(item as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
    return JSON.stringify(item);
  };
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}
