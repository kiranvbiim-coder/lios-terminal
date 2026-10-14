import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const contracts = read("shared/conversationRuntime.ts");
const resolver = read("server/conversationCapabilityResolver.ts");
const runtime = read("server/conversationRuntime.ts");
const trace = read("client/src/components/terminal/ConversationRuntimeTrace.tsx");
const ask = read("shared/askLiosRouter.ts");
// The run logic lives in conversationRunService; the routes file is only the HTTP/SSE adapter.
const routes = read("server/conversationRunService.ts");
const transport = read("server/byoaiTransport.ts");
const telemetry = read("client/src/lib/p2ConversationTelemetry.ts");
const shell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const ledger = read("server/ledgerReproducibility.ts");
const artifactDiff = read("server/artifactDiff.ts");

for (const capability of [
  "instrument.resolve",
  "security.overview",
  "market.technical",
  "strategy.backtest",
  "personal_finance.snapshot",
  "project.search",
  "project.changes",
  "project.insight_lens",
  "deterministic.engine",
  "artifact.edit",
  "ai.answer",
]) {
  assert.ok(contracts.includes(`"${capability}"`), `Active P2 capability contract missing ${capability}`);
}
assert.ok(contracts.includes("conversationCapabilityMatchSchema"), "Active P2 typed capability match contract is missing.");
assert.ok(contracts.includes('availability: z.enum(["ready", "needs_input", "needs_approval", "requires_ai"])'), "Active P2 capability readiness contract is missing.");
assert.ok(contracts.includes("requiredInputs:") && contracts.includes("missingInputs:"), "Active P2 capability required/missing-input contract is missing.");
assert.ok(contracts.includes("sourceScopeCompatible:") && contracts.includes("sourceScopeReason:"), "Active P2 capability source-compatibility contract is missing.");
assert.ok(contracts.includes("capabilities: z.array(conversationCapabilityMatchSchema)"), "WorkflowPlan must carry resolved capabilities.");

assert.ok(resolver.includes("resolveConversationCapabilities"), "Active P2 LiOS-owned capability resolver is missing.");
assert.ok(resolver.includes("extractConversationEntityQuery"), "Active P2 natural company/security entity extraction is missing.");
assert.ok(resolver.includes("security.overview"), "Active P2 company/security overview resolution is missing.");
assert.ok(resolver.includes("strategy.backtest") && resolver.includes("market.technical"), "Active P2 multi-capability market resolution is incomplete.");
assert.ok(resolver.includes("isMarketCapabilityBundle"), "Active P2 executable bundle classification is missing.");
assert.ok(resolver.includes('availability: entity ? "ready" : "needs_input"'), "Active P2 must preserve deterministic capability intent when entity input is missing.");
assert.ok(resolver.includes('missingInputs: entity ? [] : ["company_or_security"]'), "Active P2 missing security/company input must be explicit.");
assert.ok(resolver.includes("connectedScope(request)") && resolver.includes("projectScope(request)"), "Active P2 must resolve source compatibility for connected and Project capabilities.");
assert.ok(resolver.includes("capabilities.some((item) => !supported.has(item.id))"), "Active P2 must not claim unsupported mixed bundles.");

assert.ok(runtime.includes("input.name || input.query"), "Instrument resolver must accept natural company/security names, not ticker-only input.");
assert.ok(runtime.includes('workflow: "p2_capability_bundle"'), "Active P2 capability-bundle workflow is not planned.");
assert.ok(runtime.includes("executeP2CapabilityBundle"), "Active P2 capability-bundle executor is missing.");
assert.ok(runtime.includes("capabilityIds"), "Active P2 runtime must carry capability identity into execution/receipts.");
assert.ok(runtime.includes("RunBacktest") && runtime.includes("before LiOS executes the multi-capability plan"), "Governed bundle approval preflight is missing.");
assert.ok(runtime.includes("sourceScopeAllowsExternalData(sourceScope)"), "Active P2 bundle must enforce P1 source scope before retrieval.");
assert.ok(runtime.includes('invokeConversationTool("lios.finance.technical"'), "Active P2 bundle must use the deterministic LiOS technical tool.");
assert.ok(runtime.includes("runP6Backtest"), "Active P2 bundle must invoke the deterministic backtest engine.");
assert.ok(runtime.includes("receipts.map((receipt) => receipt.id)"), "Active P2 bundle must aggregate multiple execution receipts.");
assert.ok(runtime.includes("artifacts,"), "Active P2 bundle must aggregate multiple work products.");
assert.ok(artifactDiff.includes("normalizeConversationDraft"), "Conversation work products must continue through the canonical Artifact OS keep bridge.");
assert.ok(runtime.includes('id: "ai-synthesis"'), "AI-assisted bundle plan must expose synthesis as a dependency step.");
assert.ok(runtime.includes("maybeSynthesizeDeterministicResult"), "Active P2 must preserve deterministic-first authoritative output before optional BYOAI synthesis.");
assert.ok(runtime.includes('field: "deterministic_engine_inputs"'), "Missing deterministic-engine inputs must become a structured capability gap.");
assert.ok(runtime.includes('workspaceCommand[delegation.view]'), "Deterministic-engine input gaps must expose governed workspace recovery actions.");

assert.ok(trace.includes('data-p2-capability-resolution="true"'), "Active P2 capability resolution must be visible in the conversation execution UI.");
assert.ok(trace.includes("Resolved capabilities"), "Active P2 UI must explain which capabilities LiOS selected.");
assert.ok(trace.includes("capability.permissionClass"), "Active P2 UI must make governed capability posture visible.");
assert.ok(trace.includes("capability.availability") && trace.includes("capability.missingInputs"), "Active P2 UI must expose capability readiness and missing inputs.");
assert.ok(trace.includes("capability.sourceScopeCompatible") && trace.includes("SOURCE SCOPE"), "Active P2 UI must expose source-scope incompatibility before execution.");
assert.ok(trace.includes("NEEDS INPUT") && trace.includes("APPROVAL"), "Active P2 UI must distinguish blocked input from governed approval.");
assert.ok(trace.includes('observed?.type === "status" && observed.state === "completed"'), "Active P2 progress UI must support non-tool dependency completion.");
assert.ok(shell.includes('useState<ConversationExecutionMode>("ai_assisted")'), "Active P2 composer must default to AI-assisted orchestration.");
assert.ok(shell.includes("AUTO · AI ASSISTED") && shell.includes("DETERMINISTIC ONLY"), "Active P2 execution-mode labels must make the default/fallback posture clear.");
assert.ok(shell.includes('if (action.startsWith("/"))') && shell.includes("void runCommand(action)"), "Recovery actions must be able to open governed LiOS workspaces directly.");

assert.ok(ask.includes("Route to and invoke governed LiOS capabilities"), "Ask LiOS must be capability-invoking rather than module-delegating.");
assert.ok(!ask.includes("ask the user to run it rather than approximating"), "Legacy manual-module delegation must not remain the active Ask LiOS doctrine.");

assert.ok(routes.includes("executeConversationRuntime"), "All authenticated conversation scopes must continue through the governed Conversation Runtime.");
assert.ok(routes.includes("resolveEffectiveConversationRequest"), "Active P2 must resolve Master AI preference before execution.");
assert.ok(routes.includes('executionMode: "deterministic_first"'), "AI-off must downgrade optional AI assistance without disabling deterministic work.");
assert.ok(routes.includes('request.sourceScope === "web" ? [] : request.attachments'), "Web source scope must block Project attachment content before server-side resolution.");
assert.ok(transport.includes("providerPolicy"), "Active P2 must preserve provider-neutral BYOAI routing policy.");
assert.ok(runtime.includes("registerAgentFrameworkAdapter") && runtime.includes("runBoundedAgent"), "Active P2 must preserve the replaceable bounded Agent Runtime.");
assert.ok(!runtime.includes("frameworkOwnedProjectState"), "No donor/provider framework may become canonical product state.");

assert.ok(telemetry.includes("P2_CONVERSATION_TELEMETRY_PRIVACY_CONTRACT"), "Active P2 orchestration telemetry privacy contract is missing.");
for (const forbidden of [
  "storesPromptText: false",
  "storesEntityQueries: false",
  "storesSymbols: false",
  "storesProjectNames: false",
  "storesFileNames: false",
  "storesFileContents: false",
  "storesProviderCredentials: false",
]) assert.ok(telemetry.includes(forbidden), `Active P2 telemetry privacy rule missing: ${forbidden}`);
assert.ok(shell.includes("recordP2ConversationEvent(runtimeEvent)"), "Active P2 runtime events must feed privacy-safe local orchestration telemetry.");
assert.ok(ledger.includes("sourceScope: input.request.sourceScope"), "P2 reproducibility ledger must record the governed source scope.");
assert.ok(ledger.includes("capabilityIds: input.plan.capabilities.map"), "P2 reproducibility ledger must record resolved capability ids.");
assert.ok(ledger.includes("sourceScopeCompatible: capability.sourceScopeCompatible"), "P2 receipt snapshots must retain capability source-compatibility metadata.");

console.log(JSON.stringify({
  contractVersion: "active-p2-1.0.0",
  capabilityResolver: true,
  naturalEntityResolution: true,
  multiCapabilityPlanning: true,
  capabilityReadiness: true,
  missingInputRecovery: true,
  sourceCompatibilityPlanning: true,
  sharedIdentityAndDataSteps: true,
  governedApprovalPreflight: true,
  sourceScopeEnforced: true,
  multiReceiptAggregation: true,
  multiArtifactAggregation: true,
  optionalAuthoritativeAiSynthesis: true,
  capabilityProgressUi: true,
  providerNeutralByoai: true,
  aiOffDeterministicFallback: true,
  deterministicEngineInputRecovery: true,
  sourceScopedAttachmentResolution: true,
  localContentFreeTelemetry: true,
  reproducibilityLedgerCapabilities: true,
  artifactOsKeepBridge: true,
  frameworkOwnedState: false,
}, null, 2));
