import crypto from "node:crypto";
import type { TestContext } from "node:test";
import type { PersonaPreferenceUser } from "../personaPreferenceService";

/** Synthetic proof for tests with an injected completion adapter; never performs provider inference. */
export async function authorizeInjectedAiForTest(user: PersonaPreferenceUser, test: Pick<TestContext, "after">): Promise<void> {
  const [{ updateEnvironmentSetup }, { updateEnvironmentSetupSchema }, { beginAIChatVerification, publishAIChatVerification }, { setMasterAiPreference }] = await Promise.all([
    import("../environmentSetupService"), import("@shared/schema"), import("../connectorVerification"), import("../personaPreferenceService"),
  ]);
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "synthetic-injected-completion-test-only";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://api.openai.com") {
      throw new Error("Real provider inference is blocked in this execution-contract fixture; inject a completion adapter.");
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  test.after(() => {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });
  await updateEnvironmentSetup(user.id, user.organizationId, updateEnvironmentSetupSchema.parse({ aiProviderId: "openai", aiModelId: "gpt-4o-mini" }), user);
  const attempt = beginAIChatVerification({ userId: user.id, organizationId: user.organizationId, provider: "openai" });
  if (!publishAIChatVerification(attempt, "gpt-4o-mini", crypto.createHash("sha256").update(process.env.OPENAI_API_KEY).digest("hex"))) {
    throw new Error("Could not establish isolated injected-completion test authorization.");
  }
  const { masterAiAuthorizationGeneration, masterAiAuthorizationRevision } = await import("../masterAiGate");
  await setMasterAiPreference(user, { state: "on", mode: "ai_assist", updatedAt: new Date().toISOString(), authorization: { generation: masterAiAuthorizationGeneration, revision: masterAiAuthorizationRevision(user.id), verificationAttemptId: attempt.attemptId } });
}
