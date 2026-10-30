import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-master-ai-gate-"));
const previousDataDir = process.env.LIMURIA_DATA_DIR;
process.env.LIMURIA_DATA_DIR = dataDir;

// db.ts freezes its data root on import; defer these imports until the isolated test root is selected.
const [{ initDb, closeDb, getDb }, schema, { registerWaveCRoutes }, { requireMasterAiOn }, { planConversationWorkflow }] = await Promise.all([
  import("./db"),
  import("@shared/schema"),
  import("./waveCRoutes"),
  import("./masterAiGate"),
  import("./conversationRuntime"),
]);
const { updateEnvironmentSetup } = await import("./environmentSetupService");
const { updateEnvironmentSetupSchema } = await import("@shared/schema");
const { beginAIChatVerification, publishAIChatVerification, resetConnectorVerificationsForTests } = await import("./connectorVerification");
const { upsertPersonaPreferences, getPersonaPreferences, setMasterAiPreference } = await import("./personaPreferenceService");

test("Master AI state persists per account, defaults OFF, and does not gate deterministic plans", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousDataDir;
  });

  const db = getDb();
  const [userA, userB] = await db.insert(schema.users).values([
    { email: "master-ai-a@example.test", passwordHash: "test-hash", role: "internal_admin", name: "Master AI A" },
    { email: "master-ai-b@example.test", passwordHash: "test-hash", role: "internal_admin", name: "Master AI B" },
  ]).returning();
  const [finance] = await db.select().from(schema.domains).where(eq(schema.domains.slug, "finance")).limit(1);
  if (!finance) await db.insert(schema.domains).values({ slug: "finance", name: "Finance", active: true });

  const registered = new Map<string, unknown[]>();
  const app = {
    get(route: string, ...handlers: unknown[]) { registered.set(`GET ${route}`, handlers); return this; },
    post(route: string, ...handlers: unknown[]) { registered.set(`POST ${route}`, handlers); return this; },
    put(route: string, ...handlers: unknown[]) { registered.set(`PUT ${route}`, handlers); return this; },
  };
  registerWaveCRoutes(app as never);
  const getState = registered.get("GET /api/wave-c/ai/state")?.at(-1) as ((req: unknown, res: unknown) => Promise<void>) | undefined;
  const putState = registered.get("PUT /api/wave-c/ai/state")?.at(-1) as ((req: unknown, res: unknown) => Promise<void>) | undefined;
  assert.ok(getState);
  assert.ok(putState);

  const callRoute = async (handler: (req: unknown, res: unknown) => Promise<void>, user: typeof userA, body?: unknown) => {
    const result: { statusCode: number; body?: unknown } = { statusCode: 200 };
    const res = {
      status(code: number) { result.statusCode = code; return this; },
      json(value: unknown) { result.body = value; return this; },
    };
    await handler({ user, body }, res);
    return result;
  };

  const defaultState = await callRoute(getState, userA);
  assert.equal(defaultState.statusCode, 200);
  assert.equal((defaultState.body as { state: string }).state, "off");

  assert.equal((await callRoute(putState, userA, { state: "on", mode: "ai_assist" })).statusCode, 409, "Master AI cannot be enabled without a saved, verified provider/model");
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "master-ai-evidence-fixture-not-a-real-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  await updateEnvironmentSetup(userA.id, null, updateEnvironmentSetupSchema.parse({ aiProviderId: "openai", aiModelId: "gpt-4o-mini" }), userA);
  const attempt = beginAIChatVerification({ provider: "openai", userId: userA.id, organizationId: null });
  assert.equal(publishAIChatVerification(attempt, "gpt-4o-mini", crypto.createHash("sha256").update(process.env.OPENAI_API_KEY).digest("hex")), true);
  const enabledState = await callRoute(putState, userA, { state: "on", mode: "ai_assist" });
  assert.equal(enabledState.statusCode, 200);
  assert.equal((enabledState.body as { state: string }).state, "on");
  assert.deepEqual(await callRoute(getState, userA), {
    statusCode: 200,
    body: { state: "on", mode: "ai_assist", updatedAt: (enabledState.body as { updatedAt: string }).updatedAt },
  });
  assert.equal(((await callRoute(getState, userB)).body as { state: string }).state, "off", "another account remains independently OFF");

  assert.equal((await requireMasterAiOn({ id: userA.id, email: userA.email, role: "internal_admin", organizationId: null })).ok, true);
  const deniedForB = await requireMasterAiOn({ id: userB.id, email: userB.email, role: "internal_admin", organizationId: null });
  assert.equal(deniedForB.ok, false);
  if (!deniedForB.ok) {
    assert.equal(deniedForB.status, 403);
    assert.equal(deniedForB.code, "ai_not_connected", "Chat refusal carries the code the client maps to Reconnect AI");
  }

  const personaUserA = { id: userA.id, email: userA.email, role: "internal_admin" as const, organizationId: null };
  const personaUserB = { id: userB.id, email: userB.email, role: "internal_admin" as const, organizationId: null };
  await upsertPersonaPreferences(personaUserB, { preferences: { waveCMasterAi: { state: "on", mode: "manual" }, compact: true } });
  assert.equal((await requireMasterAiOn(personaUserB)).ok, false, "generic preferences cannot enable AI");
  const stale = (await getPersonaPreferences(personaUserA)).preferences.preferences;
  assert.equal((await callRoute(putState, userA, { state: "off", mode: "manual" })).statusCode, 200);
  await upsertPersonaPreferences(personaUserA, { preferences: { ...stale, compact: true } });
  assert.equal(((await callRoute(getState, userA)).body as { state: string }).state, "off", "stale persona saves must preserve the current OFF state");
  await setMasterAiPreference(personaUserA, stale.waveCMasterAi as Parameters<typeof setMasterAiPreference>[1]);
  assert.equal((await requireMasterAiOn(personaUserA)).ok, false, "an older enable commit arriving after OFF cannot authorize a request even while its old proof still exists");
  assert.equal((await callRoute(putState, userA, { state: "on", mode: "ai_assist" })).statusCode, 200);
  await setMasterAiPreference(personaUserA, stale.waveCMasterAi as Parameters<typeof setMasterAiPreference>[1]);
  assert.equal((await requireMasterAiOn(personaUserA)).ok, true, "an obsolete enable commit must not overwrite a newer successful enable");
  const { requireMasterAiDispatchOn } = await import("./masterAiGate");
  const otherAttempt = beginAIChatVerification({ provider: "openai", userId: userA.id, organizationId: null });
  assert.equal(publishAIChatVerification(otherAttempt, "gpt-4o", crypto.createHash("sha256").update(process.env.OPENAI_API_KEY!).digest("hex")), true);
  await assert.rejects(requireMasterAiDispatchOn(userA.id, null, "openai", "gpt-4o"), "a surviving proof for another model is not the enabled model");
  resetConnectorVerificationsForTests();
  const afterReset = await requireMasterAiOn(personaUserA);
  assert.equal(afterReset.ok, false, "restart/reset cannot reuse persisted ON without current proof");
  if (!afterReset.ok) assert.equal(afterReset.code, "ai_not_connected", "a stale connection asks the user to reconnect");
  assert.equal(((await callRoute(getState, userA)).body as { state: string }).state, "off", "displayed state must match current authorization");

  const aiPlan = planConversationWorkflow({ requestId: "12b1dbe1-aafc-4f00-9caa-a822457eeec5", message: "Explain the current market outlook." });
  const deterministicPlan = planConversationWorkflow({ requestId: "d21660ef-a18a-442f-993e-c12aa52aaf00", message: "technical analysis AAPL with RSI and MACD", context: { symbol: "AAPL" } });
  assert.equal(aiPlan.intent.requiresAI, true);
  assert.equal(deterministicPlan.intent.requiresAI, false, "Master AI OFF must not block deterministic finance plans");
});
