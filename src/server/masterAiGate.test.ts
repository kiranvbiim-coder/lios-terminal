import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-master-ai-gate-"));
const previousDataDir = process.env.LIMURIA_DATA_DIR;
process.env.LIMURIA_DATA_DIR = dataDir;

const [{ initDb, closeDb, getDb }, schema, { registerWaveCRoutes }, { requireMasterAiOn }, { planConversationWorkflow }] = await Promise.all([
  import("./db"),
  import("@shared/schema"),
  import("./waveCRoutes"),
  import("./masterAiGate"),
  import("./conversationRuntime"),
]);

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

  const enabledState = await callRoute(putState, userA, { state: "on", mode: "ai_assist" });
  assert.equal(enabledState.statusCode, 200);
  assert.equal((enabledState.body as { state: string }).state, "on");
  assert.deepEqual(await callRoute(getState, userA), {
    statusCode: 200,
    body: { state: "on", mode: "ai_assist", updatedAt: (enabledState.body as { updatedAt: string }).updatedAt },
  });
  assert.equal(((await callRoute(getState, userB)).body as { state: string }).state, "off", "another account remains independently OFF");

  assert.deepEqual(await requireMasterAiOn({ id: userA.id, email: userA.email, role: "internal_admin", organizationId: null }), { ok: true });
  const deniedForB = await requireMasterAiOn({ id: userB.id, email: userB.email, role: "internal_admin", organizationId: null });
  assert.equal(deniedForB.ok, false);
  if (!deniedForB.ok) assert.equal(deniedForB.status, 403);

  const aiPlan = planConversationWorkflow({ requestId: "12b1dbe1-aafc-4f00-9caa-a822457eeec5", message: "Explain the current market outlook." });
  const deterministicPlan = planConversationWorkflow({ requestId: "d21660ef-a18a-442f-993e-c12aa52aaf00", message: "technical analysis AAPL with RSI and MACD", context: { symbol: "AAPL" } });
  assert.equal(aiPlan.intent.requiresAI, true);
  assert.equal(deterministicPlan.intent.requiresAI, false, "Master AI OFF must not block deterministic finance plans");
});
