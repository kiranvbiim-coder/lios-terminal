import { p7ResearchToolSchema, type P7ResearchTool } from "@shared/p7ResearchContracts";

export const P7_RESEARCH_DONOR_ADAPTATIONS = [
  {
    source: "tradingagents",
    capabilities: ["specialist_finance_roles", "structured_outputs", "checkpoint_resume", "point_in_time_guards"],
    authority: "LiOS Agent Runtime + Project/Artifact/Ledger + Data Fabric",
    bundled: false,
  },
  {
    source: "dexter",
    capabilities: ["research_planning", "tool_selection", "iterative_research"],
    authority: "LiOS permission/context runtime + Data Fabric",
    bundled: false,
  },
  {
    source: "langalpha",
    capabilities: ["research_workspace_patterns", "skills_tool_binding", "subagent_traceability"],
    authority: "LiOS Project/Session/Artifact + MCP/Plugin/Permission contracts",
    bundled: false,
  },
  {
    source: "fin-agent",
    capabilities: ["natural_language_finance_patterns", "backtest_workflow", "portfolio_research_patterns"],
    authority: "LiOS Agent Runtime + deterministic finance/backtest engines",
    bundled: false,
  },
  {
    source: "lse-terminal",
    capabilities: ["local_research_execution", "bounded_tool_output", "fail_loudly_network_tools"],
    authority: "LiOS P5 BrowserConnectorPolicy/McpClientPolicy",
    bundled: false,
  },
] as const;

export const P7_RESEARCH_TOOLS: P7ResearchTool[] = [
  { id: "lios.entity.resolve", label: "Resolve canonical P5 entity, security and listing identity", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.entity.private_research", label: "Research canonical private/no-ticker entities from permitted Project evidence", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.provider.access", label: "Inspect provider capability, entitlement, locality and AI-use posture without fetching data", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.compose_sources", label: "Compose AI-permitted broker, expert, internal, public and user research with source rights preserved", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.alternative_evidence", label: "Inspect permitted alternative and private-market evidence with entitlement preserved", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.search", label: "Search permitted Project intelligence", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.knowledge_state", label: "Classify matching Project evidence as known, qualified, or unknown", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.financial_events", label: "Inspect cited financial events and explicit relationship impacts", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.numeric_evidence", label: "Save exact-decimal values with source-field numerical lineage", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.disclosure_changes", label: "Compare permitted filing and IR disclosure changes with exact source lineage", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.cross_search", label: "Search explicitly approved Projects", permissionClass: "user_confirm", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.what_changed", label: "Compare Project intelligence snapshots", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.context_graph", label: "Inspect Project Context Graph", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.insight_lens", label: "Compile deterministic Project insights", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.project.timeline", label: "Inspect deterministic Project timeline intelligence", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.branch_create", label: "Fork an exact Research Artifact version into an alternate hypothesis branch", permissionClass: "user_confirm", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.branch_status", label: "Inspect deterministic Research Artifact branch divergence and comparison", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.branch_promote", label: "Propose explicit promotion of a current Research Artifact branch", permissionClass: "user_confirm", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.refresh", label: "Refresh cited Research Artifact evidence", permissionClass: "user_confirm", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.filing_diff", label: "Compare primary-source filing sections", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.thesis.living_review", label: "Review a durable investment thesis and exact changes since its prior version", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.estimate_evidence", label: "Inspect source-separated estimate, rating and price-target revision evidence", permissionClass: "safe_auto", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.thesis.refresh", label: "Refresh a Thesis Artifact from indexed evidence", permissionClass: "user_confirm", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.docling_index", label: "Parse and index a local document with Docling", permissionClass: "user_confirm", deterministic: true, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.browser", label: "Read approved public research pages through Project browser policy", permissionClass: "user_confirm", deterministic: false, requiresAI: false, projectScoped: true, externalSideEffects: false },
  { id: "lios.research.external_mcp", label: "Call an allow-listed external MCP research tool", permissionClass: "user_confirm", deterministic: false, requiresAI: false, projectScoped: true, externalSideEffects: false },
].map((tool) => p7ResearchToolSchema.parse(tool));

export function p7ResearchTool(toolId: string): P7ResearchTool | null {
  return P7_RESEARCH_TOOLS.find((tool) => tool.id === toolId) ?? null;
}

export function assertP7ResearchToolPermission(toolId: string, approved = false): P7ResearchTool {
  const tool = p7ResearchTool(toolId);
  if (!tool) throw new Error("Unknown P7 research tool.");
  if (tool.permissionClass === "denied") throw new Error("P7 research tool is disabled by policy.");
  if ((tool.permissionClass === "user_confirm" || tool.permissionClass === "admin_confirm") && !approved) {
    throw new Error("P7 research tool requires explicit approval.");
  }
  return tool;
}

export function p7AgentRuntimeContract() {
  return {
    owner: "LiOS",
    projectScoped: true,
    canonicalStateOwner: "LiOS Project/Artifact/Ledger",
    byoaiOptional: true,
    deterministicToolsDoNotRequireAI: true,
    browserBoundary: "P5 BrowserConnectorPolicy",
    mcpBoundary: "P5 McpClientPolicy",
    unrestrictedFilesystem: false,
    unrestrictedNetwork: false,
    directSecretExposure: false,
    donorAdaptations: P7_RESEARCH_DONOR_ADAPTATIONS,
    toolIds: P7_RESEARCH_TOOLS.map((tool) => tool.id),
  } as const;
}
