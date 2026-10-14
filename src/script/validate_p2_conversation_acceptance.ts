import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const contracts = read("shared/conversationRuntime.ts");
const runtime = read("server/conversationRuntime.ts");
const routes = read("server/projectConversationRoutes.ts");
const service = read("server/conversationRunService.ts");
const transport = read("server/byoaiTransport.ts");
const shell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const trace = read("client/src/components/terminal/ConversationRuntimeTrace.tsx");
const client = read("client/src/lib/conversationRuntimeClient.ts");

for (const level of ["identity:", "project:", "conversation:", "workspace:", "active:"]) {
  assert.ok(contracts.includes(level), `P2 context envelope is missing level ${level}`);
}
for (const action of [
  "OpenArtifact", "OpenPanel", "ChangeAssumption", "RunValuation", "RunBacktest",
  "CreateScenario", "ForkSession", "InspectSource", "SaveWorkflow",
]) {
  assert.ok(contracts.includes(`"${action}"`), `P2 standardized action ${action} is missing`);
}
for (const role of [
  "research", "fundamental", "valuation", "quant", "technical", "macro",
  "portfolio", "risk", "backtest", "filing_document", "data", "reporting",
]) {
  assert.ok(contracts.includes(`"${role}"`), `P2 Agent Runtime role ${role} is missing`);
}

assert.ok(runtime.includes("resolvePersistedInstrument"), "P2 runtime must resolve canonical identity.");
// Market retrieval is scoped by the governed request (source scope / consent) and history keeps provenance.
assert.ok(/getQuotes\(\[symbol\],\s*\d+,\s*marketScope\)/.test(runtime) && /getOHLCV(?:WithProvenance)?\(symbol, "6M", "1d"/.test(runtime), "P2 runtime must retrieve governed quote/history data.");
assert.ok(runtime.includes("calculateTechnicalSnapshot"), "P2 runtime must execute deterministic calculation.");
assert.ok(runtime.includes('artifactType: "analysis.technical"'), "P2 runtime must emit a typed work product.");
assert.ok(runtime.includes("cancelConversationExecution"), "P2 runtime must support cancellation.");
assert.ok(runtime.includes("registerConversationTool") && runtime.includes("invokeConversationTool"), "P2 deterministic work must route through the LiOS tool registry.");
assert.ok(runtime.includes("AbortSignal.timeout(plan.budget.maxDurationMs)"), "P2 workflows must enforce their bounded runtime budget.");
assert.ok(runtime.includes("registerAgentFrameworkAdapter"), "P2 must expose replaceable agent-framework adapters.");
assert.ok(runtime.includes("runBoundedAgent") && runtime.includes("resumeBoundedAgent") && runtime.includes("checkpointAgentExecution"), "P2 Agent Runtime must support bounded runs and checkpoint/resume hooks.");
assert.ok(runtime.includes("context: ConversationContextEnvelope") && runtime.includes("adapter.resume(input.checkpointRef"), "P2 Agent resume must re-enter with LiOS context.");
assert.ok(runtime.includes("normalizedAgentReceipt"), "P2 Agent Runtime must normalize execution receipts.");
assert.ok(runtime.includes('"tradingagents"') && runtime.includes('"dexter"') && runtime.includes('"langalpha"') && runtime.includes('"fin-agent"'), "P2 agent donor adapters must remain explicit and replaceable.");

assert.ok(service.includes("executeConversationRuntime") && routes.includes("startProjectChatRun"), "Project conversation runs (HTTP and Gateway) must use the P2 runtime through one service.");
assert.ok(service.includes("plan.intent.requiresAI"), "Master AI gate must apply only to AI-required plans.");
assert.ok(routes.includes("/api/conversation-executions/:requestId/cancel"), "P2 cancellation endpoint is missing.");
assert.ok(service.includes("continuationOf"), "P2 approval continuation must avoid duplicate user turns.");

assert.ok(transport.includes("providerPolicy"), "BYOAI transport must accept per-request provider policy.");
assert.ok(transport.includes("localOnly") && transport.includes("getProviderConfig(provider)?.isLocal"), "Local-only AI policy must be enforced at provider routing.");
assert.ok(transport.includes("anyConfigured"), "Any-configured Project AI routing mode must be enforced by BYOAI routing.");

assert.ok(shell.includes("runConversation(") && !shell.includes("/respond"), "Project chat must run over the Gateway, not a private fetch.");
assert.ok(shell.includes("<ConversationRuntimeTrace"), "P2 tool/result/approval UI is not wired into Project chat.");
assert.ok(shell.includes("AI DIRECT · APPROVAL"), "AI-direct mode must be explicitly labelled in the composer.");
assert.ok(shell.includes("AI transmission"), "Project AI transmission controls are missing.");
assert.ok(shell.includes("Ask this") && shell.includes("askActiveObject"), "P2 Ask-this active-object execution affordance is missing.");
assert.ok(trace.includes("Allow once") && trace.includes("Allow for Project") && trace.includes("Deny"), "P2 approval choices are incomplete.");
assert.ok(trace.includes("allowProjectApproval") && shell.includes('chatMode === "project"'), "Project-scoped approvals must not be offered from Quick or Temporary chat.");
assert.ok(trace.includes("Review") && trace.includes("Apply") && trace.includes("Cancel"), "P2 mutation review choices are incomplete.");
assert.ok(trace.includes("presentRuntimeError") &&trace.includes("runtimeError.message"), "P2 governed runtime failures must be visible to the user.");
assert.ok(shell.includes("Provider allow list") && shell.includes("Provider deny list"), "P2 Project provider allow/deny controls are missing.");
assert.ok(client.includes("lios.project.ai-transmission-policy."), "Project AI transmission policy must survive desktop restart.");
assert.ok(client.includes("lios.project.runtime-approvals."), "Project-scoped approval grants must survive desktop restart.");

console.log("P2 Conversation Runtime acceptance: PASS");
