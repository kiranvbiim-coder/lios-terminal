import assert from "node:assert/strict";
import test from "node:test";
import {
  ARTIFACT_REVISION_POLICY,
  OBSERVATION_TRUTH_POLICY,
  PROACTIVITY_POLICY,
  WORKING_CONTEXT_POLICY,
  artifactRevisionPolicySchema,
  proactivityPolicySchema,
  workingContextPolicySchema,
  CONVERSATION_SCOPE_POLICIES,
  cloudTransmissionConsentSchema,
  conversationScopePolicySchema,
  citedAssertionSchema,
  memoryItemSchema,
  pendingSetupContinuationSchema,
} from "../../../shared/terminalConvergenceContracts";

test("TC-01 hidden Working Context and no required active-entity selector", () => {
  assert.equal(WORKING_CONTEXT_POLICY.userVisibleInspector, false);
  assert.equal(WORKING_CONTEXT_POLICY.activeEntitySelector, false);
  assert.throws(() => workingContextPolicySchema.parse({ ...WORKING_CONTEXT_POLICY, userVisibleInspector: true }));
});



test("TC-01 high proactivity stays inside permission, budget and governance limits", () => {
  assert.equal(PROACTIVITY_POLICY.level, "high");
  assert.equal(PROACTIVITY_POLICY.consequentialActionsSilent, false);
  assert.equal(PROACTIVITY_POLICY.brokerageExecution, false);
  assert.throws(() => proactivityPolicySchema.parse({ ...PROACTIVITY_POLICY, backgroundByoaiRequiresBudget: false }));
});

test("TC-01 living Artifacts append immutable revisions and keep the trust triad", () => {
  assert.equal(ARTIFACT_REVISION_POLICY.overwriteHistory, false);
  assert.throws(() => artifactRevisionPolicySchema.parse({ ...ARTIFACT_REVISION_POLICY, overwriteHistory: true }));
});

test("TC-01 no fabricated observations: data gaps are structured and the public preview is non-executable", () => {
  assert.equal(OBSERVATION_TRUTH_POLICY.inventedValues, false);
});

// Roadmap §0.0.12 reconciliation: interfaces TC-02 and later tasks implement against.
test("§0.0.12 scope: Quick and Project retrieve across permitted sources; Temporary never inherits or remembers", () => {
  assert.equal(CONVERSATION_SCOPE_POLICIES.quick.retrieval, "all_permitted_sources");
  assert.equal(CONVERSATION_SCOPE_POLICIES.project.retrieval, "all_permitted_sources");
  for (const policy of Object.values(CONVERSATION_SCOPE_POLICIES)) {
    assert.equal(policy.crossTenant, false);
    assert.equal(policy.mutateOtherProjects, false);
    assert.equal(policy.explicitExclusionsAuthoritative, true);
  }
  const temporary = CONVERSATION_SCOPE_POLICIES.temporary;
  for (const leak of [{ durableMemory: true }, { inheritsPrivateContext: true }, { retrieval: "all_permitted_sources" }]) {
    assert.equal(conversationScopePolicySchema.safeParse({ ...temporary, ...leak }).success, false, JSON.stringify(leak));
  }
});

const memory = {
  id: "m1", origin: "inferred", scope: "project", projectId: 7, sourceConversationScope: "project", kind: "assumption",
  content: "Prefers a 9% WACC for European industrials.", confidence: 0.6, revision: 1, createdAt: "2026-10-02T09:00:00Z", financialEvidence: false,
};

test("§0.0.12 memory: never from Temporary chats, never evidence, never a secret, Project-bound when Project-scoped", () => {
  assert.equal(memoryItemSchema.safeParse(memory).success, true);
  assert.equal(memoryItemSchema.safeParse({ ...memory, sourceConversationScope: "temporary" }).success, false);
  assert.equal(memoryItemSchema.safeParse({ ...memory, financialEvidence: true }).success, false);
  assert.equal(memoryItemSchema.safeParse({ ...memory, projectId: null }).success, false);
  assert.equal(memoryItemSchema.safeParse({ ...memory, scope: "user" }).success, false);
  for (const secret of ["key sk-abcdefghijklmnopqrstuv", "api_key=abc123", "AKIAABCDEFGHIJKLMNOP", "Authorization: Bearer abcdefghijklmnopqrstu"]) {
    assert.equal(memoryItemSchema.safeParse({ ...memory, content: secret }).success, false, secret);
  }
});

test("§0.0.12 consent: initial consent covers relevant excerpts without routine prompts and cannot be revoked before grant", () => {
  const consent = { consentId: "c1", grantedAt: "2026-10-02T09:00:00Z", scope: "relevant_excerpts", approvedProviders: ["anthropic"], sourceRestrictionsOverride: true, routinePrompting: false };
  assert.equal(cloudTransmissionConsentSchema.safeParse(consent).success, true);
  assert.equal(cloudTransmissionConsentSchema.safeParse({ ...consent, sourceRestrictionsOverride: false }).success, false);
  assert.equal(cloudTransmissionConsentSchema.safeParse({ ...consent, revokedAt: "2026-10-01T09:00:00Z" }).success, false);
});

test("§0.0.12 evidence: a supported assertion must cite evidence", () => {
  assert.equal(citedAssertionSchema.safeParse({ text: "Revenue grew 4.1%.", kind: "fact", evidenceIds: [], supportState: "supported" }).success, false);
  assert.equal(citedAssertionSchema.safeParse({ text: "Revenue grew 4.1%.", kind: "fact", evidenceIds: ["e1"], supportState: "supported" }).success, true);
  assert.equal(citedAssertionSchema.safeParse({ text: "Margins will recover.", kind: "ai_interpretation", evidenceIds: [], supportState: "not_checked" }).success, true);
});

test("§0.0.12 setup continuation: a pending request resumes exactly once and only when ready", () => {
  const pending = { requestId: "r1", conversationScope: "quick", chatId: 3, prompt: "Compare MSFT and GOOGL", requiredCapability: "ai.completion", capabilityState: "finish_setup", createdAt: "2026-10-02T09:00:00Z", resumeCount: 0 };
  assert.equal(pendingSetupContinuationSchema.safeParse(pending).success, true);
  assert.equal(pendingSetupContinuationSchema.safeParse({ ...pending, resumeCount: 1, resumedAt: "2026-10-02T09:01:00Z" }).success, false);
  assert.equal(pendingSetupContinuationSchema.safeParse({ ...pending, capabilityState: "ready", resumeCount: 1, resumedAt: "2026-10-02T09:01:00Z" }).success, true);
  assert.equal(pendingSetupContinuationSchema.safeParse({ ...pending, capabilityState: "ready", resumeCount: 2, resumedAt: "2026-10-02T09:01:00Z" }).success, false);
  assert.equal(pendingSetupContinuationSchema.safeParse({ ...pending, chatId: null }).success, false);
});
