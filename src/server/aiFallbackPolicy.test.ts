import assert from "node:assert/strict";
import test from "node:test";
import { executeConversationRuntime } from "./conversationRuntime";
import type { AICompletionResult, AIRoutedCompletionRequest } from "./byoaiTransport";

const household = {
  schemaVersion: "1" as const,
  asOf: "2026-09-26",
  accounts: [{ id: "bank", kind: "bank" as const, balance: 200000, currency: "INR" }],
  transactions: [{ id: "salary", at: "2026-09-05", amount: 100000, category: "salary", accountId: "bank" }],
  debts: [],
  goals: [],
  retirement: null,
};

function answer(provider: "openai" | "gemini", fallback?: AICompletionResult["fallback"], text = "General explanation."): AICompletionResult {
  return {
    provider, model: "test-model", text,
    attribution: { provider, model: "test-model", promptHash: "0".repeat(64), outputHash: "1".repeat(64), generatedAt: new Date().toISOString() } as never,
    ...(fallback ? { fallback } : {}),
  };
}

async function run(message: string, context: Record<string, unknown> | undefined, ai: (request: AIRoutedCompletionRequest) => Promise<AICompletionResult>, executionMode = "deterministic_first", tolerateFailure = false) {
  const events: any[] = [];
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: 1, role: "client_user" },
    scope: "project", chatId: 7, projectId: 7, projectName: "Fallback policy", history: [],
    request: { requestId: crypto.randomUUID(), message, executionMode, sourceScope: "auto", ...(context ? { context } : {}) },
    emit: (event: unknown) => { events.push(event); },
    aiCompletion: ai,
  } as never).catch((error) => {
    // Planner tests only inspect the plan; the routed tool itself needs a database this test does not start.
    if (!tolerateFailure) throw error;
    return null as never;
  });
  return { result, events };
}

test("a general question may fall back to another connected provider, and the answer says which one replied", async () => {
  const seen: AIRoutedCompletionRequest[] = [];
  const { events } = await run("Explain why operating leverage matters", undefined, async (request) => {
    seen.push(request);
    return answer("gemini", { attempts: [{ provider: "openai", code: "rate_limited", status: 429 }] });
  });
  assert.equal(seen[0].fallback, "configured");
  const notice = events.find((event) => event.type === "status" && /answered instead/.test(event.message));
  assert.ok(notice, "a visible fallback status is emitted");
  assert.match(notice.message, /openai \(rate limited\) could not answer; gemini · test-model answered instead\./);
});

test("requests carrying personal-finance data are never eligible for fallback", async () => {
  const seen: AIRoutedCompletionRequest[] = [];
  await run("Plan my retirement savings", { personalFinance: household }, async (request) => {
    seen.push(request);
    return answer("openai");
  }, "ai_assisted");
  // The deterministic personal-finance result is synthesized by AI; that call must be single-provider.
  assert.ok(seen.length > 0, "the AI synthesis step must have been attempted");
  for (const request of seen) assert.equal(request.fallback, "none");
});

test("selected Project Artifact context is private and cannot fall back as public chat", async () => {
  const seen: AIRoutedCompletionRequest[] = [];
  await run("Explain the selected work", { activeObjectRefs: [`artifact:${crypto.randomUUID()}`] }, async request => {
    seen.push(request);
    return answer("openai");
  }, "ai_assisted");
  assert.ok(seen.length > 0);
  for (const request of seen) {
    assert.equal(request.fallback, "none");
    assert.equal(request.dataClassification, "organization");
  }
});

test("when a private request cannot be answered, the user is told why it was not re-sent", async () => {
  const { AIProviderError } = await import("./byoaiRouter");
  let message = "";
  await run("Plan my retirement savings", { personalFinance: household }, async () => {
    throw new AIProviderError("rate_limited", "OpenAI reports no available quota for this API key.", { provider: "openai", status: 429 });
  }, "ai_assisted").then(({ events }) => {
    message = events.filter((event) => event.type === "error" || event.type === "status").map((event) => event.message).join(" | ");
  }).catch((error: Error) => { message = error.message; });
  assert.match(message, /AI synthesis unavailable \(.*no available quota.*includes personal-finance data, so it was not sent to another provider.*\); returning the authoritative deterministic LiOS result\./);
});

test("claim checker: AI prose with an invented figure is withheld and the deterministic result stands", async () => {
  const withheld = await run("Plan my retirement savings", { personalFinance: household }, async () => answer("openai", undefined, "You will retire with exactly $98,765,432 in savings."), "ai_assisted");
  assert.doesNotMatch(withheld.result.text, /AI synthesis/);
  assert.doesNotMatch(withheld.result.text, /98,765,432/);
  assert.equal(withheld.result.label, "deterministic");
  assert.ok(withheld.events.some((event) => event.type === "status" && /AI explanation withheld: it cited \$98,765,432/.test(event.message)));

  const clean = await run("Plan my retirement savings", { personalFinance: household }, async () => answer("openai", undefined, "Your plan depends on steady saving and cautious spending."), "ai_assisted");
  assert.match(clean.result.text, /### AI synthesis/);
});

test("AI planner: a named-company request the router missed is routed to a catalog tool, and never for concept questions", async () => {
  const seen: string[] = [];
  const { events } = await run("Any thoughts on how Nvidia is positioned?", undefined, async (request) => {
    seen.push(request.messages.at(-1)?.content ?? "");
    return answer("openai", undefined, '{"capability":"company.research","entity":"Nvidia"}');
  }, "deterministic_first", true);
  const plan = events.find((event) => event.type === "plan");
  assert.ok(plan.plan.capabilities.some((item: { id: string }) => item.id === "company.research"));
  assert.ok(events.some((event) => event.type === "status" && /Interpreted as: .*Nvidia/.test(event.message)));

  const concept: string[] = [];
  await run("Explain why operating leverage matters", undefined, async (request) => {
    concept.push(request.system ?? "");
    return answer("openai");
  }, "deterministic_first", true);
  assert.ok(concept.every((system) => !/route a finance request/.test(system)), "concept questions never invoke the planner");

  const bad = await run("Any thoughts on how Nvidia is positioned?", undefined, async () => answer("openai", undefined, '{"capability":"company.research","entity":"Microsoft"}'), "deterministic_first", true);
  assert.ok(bad.events.find((event) => event.type === "plan").plan.capabilities.every((item: { id: string }) => item.id === "ai.answer"), "an entity the user never wrote is rejected");
});
