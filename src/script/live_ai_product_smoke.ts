import crypto from "node:crypto";
import assert from "node:assert/strict";
import { normalizeProviderId } from "../server/byoaiRouter";
import {
  verifyAIProviderConnection,
  type AIProviderVerificationResult,
} from "../server/aiProviderVerification";
import {
  buildConversationContext,
  executeConversationRuntime,
  type ConversationRuntimeInput,
} from "../server/conversationRuntime";
import type {
  ConversationRequest,
  ConversationRuntimeEvent,
} from "../shared/conversationRuntime";

function argument(name: string): string | null {
  const prefix = "--" + name + "=";
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

type SmokeScope = "temporary" | "quick" | "project";

interface ScopeCase {
  scope: SmokeScope;
  chatId: number | null;
  projectId: number | null;
  projectName: string | null;
  projectInstructions: string | null;
  allowProjectInstructions: boolean;
}

const ALL_SCOPE_CASES: readonly ScopeCase[] = [
  {
    scope: "temporary",
    chatId: null,
    projectId: null,
    projectName: null,
    projectInstructions: null,
    allowProjectInstructions: false,
  },
  {
    scope: "quick",
    chatId: 9_100_001,
    projectId: null,
    projectName: null,
    projectInstructions: null,
    allowProjectInstructions: false,
  },
  {
    scope: "project",
    chatId: 9_100_002,
    projectId: 9_100_001,
    projectName: "Live AI Product Acceptance",
    projectInstructions: "Keep deterministic LiOS calculations separate from AI synthesis and do not invent financial facts.",
    allowProjectInstructions: true,
  },
];

function selectedScopeCases(): readonly ScopeCase[] {
  const requested = (argument("scope") || "all").toLowerCase();
  if (requested === "all") return ALL_SCOPE_CASES;
  if (requested === "temporary" || requested === "quick" || requested === "project") {
    return ALL_SCOPE_CASES.filter((item) => item.scope === requested);
  }
  throw new Error("--scope must be all, temporary, quick, or project.");
}

function requestFor(scopeCase: ScopeCase, provider: string): ConversationRequest {
  return {
    requestId: crypto.randomUUID(),
    continuationOf: null,
    message: "In one sentence, explain why LiOS keeps deterministic financial calculations separate from AI synthesis.",
    executionMode: "ai_assisted",
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured",
      providerAllow: [provider],
      providerDeny: [],
      allowProjectInstructions: scopeCase.allowProjectInstructions,
      allowResourceReferences: false,
      allowSelection: false,
      allowToolCalling: false,
      dataClassification: "public",
    },
    attachments: [],
    context: { view: "live-ai-smoke-" + scopeCase.scope },
  };
}

async function verifyConversationScope(
  scopeCase: ScopeCase,
  verification: AIProviderVerificationResult,
): Promise<{ scope: SmokeScope; receiptId: string }> {
  const events: ConversationRuntimeEvent[] = [];
  const request = requestFor(scopeCase, verification.provider);
  const input: ConversationRuntimeInput = {
    tenant: {
      userId: 1,
      organizationId: null,
      role: "internal_admin",
    },
    scope: scopeCase.scope,
    chatId: scopeCase.chatId,
    projectId: scopeCase.projectId,
    projectName: scopeCase.projectName,
    projectInstructions: scopeCase.projectInstructions,
    resources: [],
    history: [],
    preferredProvider: verification.provider,
    preferredModel: verification.model,
    request,
    emit: (event) => {
      events.push(event);
    },
  };

  const context = buildConversationContext({
    tenant: input.tenant,
    scope: input.scope,
    chatId: input.chatId,
    projectId: input.projectId,
    projectName: input.projectName,
    projectInstructions: input.projectInstructions,
    resources: input.resources,
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
    request,
  });

  assert.equal(context.conversation.scope, scopeCase.scope);
  assert.equal(context.project.projectId, scopeCase.projectId);
  assert.equal(
    context.project.instructionIncluded,
    scopeCase.scope === "project" && scopeCase.allowProjectInstructions,
    scopeCase.scope + " context did not preserve the expected Project-instruction boundary.",
  );

  const result = await executeConversationRuntime(input);
  assert.equal(result.cancelled, false, scopeCase.scope + " Conversation Runtime unexpectedly cancelled.");
  assert.equal(result.awaitingApproval, false, scopeCase.scope + " Conversation Runtime unexpectedly requested approval.");
  assert.equal(result.label, "ai_derived", scopeCase.scope + " Conversation Runtime did not return an AI-derived result.");
  assert.ok(result.text.trim().length > 0, scopeCase.scope + " Conversation Runtime returned no text.");
  assert.ok(result.receiptIds.length > 0, scopeCase.scope + " Conversation Runtime did not create an execution receipt.");

  const receiptEvent = events.find((event) => event.type === "receipt");
  assert.ok(receiptEvent && receiptEvent.type === "receipt", scopeCase.scope + " Conversation Runtime emitted no receipt event.");
  assert.equal(receiptEvent.receipt.aiDerived, true);
  assert.equal(receiptEvent.receipt.deterministic, false);
  assert.ok(
    receiptEvent.receipt.sourceRefs.includes("ai-provider:" + verification.provider),
    scopeCase.scope + " receipt does not attribute the selected AI provider.",
  );

  const resultEvent = events.find((event) => event.type === "tool_result");
  assert.ok(resultEvent && resultEvent.type === "tool_result", scopeCase.scope + " Conversation Runtime emitted no provider result event.");
  assert.equal(
    resultEvent.summary,
    `${verification.provider} · ${verification.model}`,
    "Conversation Runtime did not use the provider and model proven by the connectivity probe.",
  );

  return { scope: scopeCase.scope, receiptId: result.receiptIds[0]! };
}

async function main(): Promise<void> {
  const requestedProvider = argument("provider") || process.env.LIOS_AI_PROVIDER?.trim() || "";
  const provider = normalizeProviderId(requestedProvider);
  if (!provider) {
    throw new Error(
      "Choose a provider with --provider=<id> or LIOS_AI_PROVIDER. "
      + "Examples: openai, anthropic, gemini, mistral, groq, openrouter, xai.",
    );
  }

  const model = argument("model") || process.env.LIOS_AI_MODEL?.trim() || null;
  const scopes = selectedScopeCases();
  const totalSteps = 1 + scopes.length;

  process.stdout.write("LiOS live AI service acceptance\n");
  process.stdout.write("Provider: " + provider + (model ? " · model: " + model : "") + "\n");
  process.stdout.write("Scopes: " + scopes.map((item) => item.scope).join(", ") + "\n");
  process.stdout.write("1/" + totalSteps + " Live provider verification...\n");

  const verification = await verifyAIProviderConnection({ provider, model });
  assert.equal(verification.provider, provider);
  process.stdout.write(
    "PASS provider verification · " + verification.model + " · " + verification.latencyMs + " ms\n",
  );

  const receipts: Array<{ scope: SmokeScope; receiptId: string }> = [];
  for (const [index, scopeCase] of scopes.entries()) {
    process.stdout.write((index + 2) + "/" + totalSteps + " " + scopeCase.scope + " Conversation Runtime...\n");
    const accepted = await verifyConversationScope(scopeCase, verification);
    receipts.push(accepted);
    process.stdout.write("PASS " + accepted.scope + " · receipt " + accepted.receiptId + "\n");
  }

  assert.equal(receipts.length, scopes.length);
  assert.deepEqual(receipts.map((item) => item.scope), scopes.map((item) => item.scope));

  process.stdout.write(JSON.stringify({
    provider: verification.provider,
    model: verification.model,
    verifiedAt: verification.verifiedAt,
    scopes: receipts.map((item) => item.scope),
    receiptCount: receipts.length,
    projectInstructionsTransmittedOnlyInProjectScope: true,
    credentialMaterialLogged: false,
  }) + "\n");
  process.stdout.write("LIVE_AI_SERVICE_SMOKE: PASS\n");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown live AI smoke failure.";
  process.stderr.write("LIVE_AI_SERVICE_SMOKE: FAIL · " + message + "\n");
  process.exitCode = 1;
});
