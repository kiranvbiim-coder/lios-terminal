import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import express from "express";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-native-grant-route-"));
process.env.LIMURIA_DATA_DIR = root;
const [{ initDb, closeDb, getDb }, { users }, { createProjectChat }, { createArtifact }, { registerArtifactRoutes }, { LOCAL_TRUST_HANDOFF }, { verifyNativeDraftGrant, MAX_LIFETIME_MS }] = await Promise.all([
  import("./db"), import("@shared/schema"), import("./projectChatStore"), import("./artifactStore"), import("./artifactRoutes"), import("./localDesktopTrust"), import("../nativeDraftGrant.cjs"),
]);

test("native draft capabilities require authenticated immutable P4 custody and cannot move account, revision, hash or launch", async t => {
  await initDb();
  const tokenStore = globalThis as Record<symbol, unknown>;
  const previousToken = tokenStore[LOCAL_TRUST_HANDOFF];
  const token = crypto.randomBytes(32).toString("hex");
  tokenStore[LOCAL_TRUST_HANDOFF] = token;
  const [owner, stranger] = await getDb().insert(users).values([
    { email: "grant-owner@example.invalid", name: "Owner", role: "internal_analyst", passwordHash: "test-only" },
    { email: "grant-stranger@example.invalid", name: "Stranger", role: "internal_analyst", passwordHash: "test-only" },
  ]).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const chat = await createProjectChat(ctx, { scope: "quick" });
  const saved = await createArtifact(ctx, { projectId: null, owningChatId: chat.id, title: "Owned report", content: { kind: "report", blocks: [{ id: "p", type: "paragraph", text: "Owned content" }], sections: [] } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = Number(req.header("x-test-owner"));
    const user = userId === owner.id ? owner : userId === stranger.id ? stranger : null;
    Object.assign(req, { user, sessionID: `synthetic-session-${userId}`, isAuthenticated: () => user !== null });
    next();
  });
  registerArtifactRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = Promise.withResolvers<void>();
    server.close(error => error ? closed.reject(error) : closed.resolve());
    await closed.promise;
    if (previousToken === undefined) delete tokenStore[LOCAL_TRUST_HANDOFF]; else tokenStore[LOCAL_TRUST_HANDOFF] = previousToken;
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/artifacts/${encodeURIComponent(saved.artifact.id)}/native-draft-grant`;
  const body = { baseVersion: 1, contentHash: saved.version.contentHash };
  const post = (userId?: number, payload: unknown = body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(userId ? { "x-test-owner": String(userId) } : {}) }, body: JSON.stringify(payload) });
  assert.equal((await post()).status, 401);
  assert.notEqual((await post(stranger.id)).status, 200);
  assert.equal((await post(owner.id, { ...body, contentHash: "b".repeat(64) })).status, 409);
  assert.notEqual((await post(owner.id, { ...body, owner: stranger.email })).status, 200);
  const response = await post(owner.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const grant = await response.json() as { grant: string; expiresAt: number };
  const scope = { owner: owner.email, artifactId: saved.artifact.id, ...body };
  const verified = verifyNativeDraftGrant(token, grant.grant, scope);
  assert.deepEqual({ ...verified, sessionBinding: undefined }, { ...scope, sessionBinding: undefined });
  assert.match(verified.sessionBinding!, /^[a-f0-9]{64}$/);
  for (const altered of [{ ...scope, owner: stranger.email }, { ...scope, baseVersion: 2 }, { ...scope, contentHash: "c".repeat(64) }]) assert.throws(() => verifyNativeDraftGrant(token, grant.grant, altered));
  assert.throws(() => verifyNativeDraftGrant(crypto.randomBytes(32).toString("hex"), grant.grant, scope));
  assert.throws(() => verifyNativeDraftGrant(token, grant.grant, scope, grant.expiresAt));
  assert.throws(() => verifyNativeDraftGrant(token, grant.grant + "forged", scope));
  assert.ok(grant.expiresAt <= Date.now() + MAX_LIFETIME_MS);
  delete tokenStore[LOCAL_TRUST_HANDOFF];
  assert.equal((await post(owner.id)).status, 404);
});
