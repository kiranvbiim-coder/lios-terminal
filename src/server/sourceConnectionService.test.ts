import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-gemini-connection-"));
const previousDataDir = process.env.LIMURIA_DATA_DIR;
process.env.LIMURIA_DATA_DIR = dataDir;

const [{ initDb, closeDb, getDb }, { users, sourceConnections }, { testSourceConnection, unprobedConnectionResult }, { recordConnectorVerification }, { setVaultCredential, invalidateVaultCache }] = await Promise.all([
  import("./db"),
  import("@shared/schema"),
  import("./sourceConnectionService"),
  import("./connectorVerification"),
  import("./credentialVault"),
]);

test("Gemini and FRED Verify use fresh saved-key probes rather than stale connector health", async (t) => {
  await initDb();
  const previousFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await closeDb();
    invalidateVaultCache();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousDataDir;
  });

  setVaultCredential("geminiApiKey", "test-gemini-key", "Gemini connection test fixture");
  const db = getDb();
  const [user] = await db.insert(users).values({
    email: "gemini-connection-test@example.test",
    passwordHash: "test-hash",
    role: "internal_admin",
    name: "Gemini Connection Test",
  }).returning();
  const [connection] = await db.insert(sourceConnections).values({
    userId: user.id,
    organizationId: null,
    connectorId: "gemini",
    name: "Google Gemini",
    sourceType: "keyed_api",
    config: {},
    credentialRef: "geminiApiKey",
    status: "configured",
  }).returning();

  recordConnectorVerification("gemini", false, "stale previous chat failure: HTTP 404");
  let requestedUrl = "";
  let requestedKey = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = inputUrl(input);
    requestedKey = new Headers(init?.headers).get("x-goog-api-key") ?? "";
    return new Response(JSON.stringify({ models: [{ name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
  }) as typeof fetch;

  const result = await testSourceConnection(user.id, connection.id, { id: user.id, email: user.email });
  assert.ok(result);
  assert.equal(result.status, "healthy");
  assert.match(result.detail, /accepted the credential probe/);
  assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100");
  assert.equal(requestedKey, "test-gemini-key");
  assert.equal(requestedUrl.includes("test-gemini-key"), false);

  const [saved] = await db.select().from(sourceConnections).where(eq(sourceConnections.id, connection.id));
  assert.equal(saved.status, "healthy");
  assert.match(saved.statusDetail ?? "", /accepted the credential probe/);
  assert.ok(saved.lastTestedAt);

  // A non-AI keyed connector must take the same fresh verification path.
  // Previously only Gemini had the explicit credential-probe branch.
  setVaultCredential("fredApiKey", "test-fred-key", "FRED connection test fixture");
  const [fredConnection] = await db.insert(sourceConnections).values({
    userId: user.id,
    organizationId: null,
    connectorId: "fred",
    name: "FRED",
    sourceType: "keyed_api",
    config: {},
    credentialRef: "fredApiKey",
    status: "configured",
  }).returning();
  recordConnectorVerification("fred", true, "stale passive success");
  let fredUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fredUrl = inputUrl(input);
    return new Response(JSON.stringify({ seriess: [{ id: "GDP" }] }), { status: 200 });
  }) as typeof fetch;

  const fredResult = await testSourceConnection(user.id, fredConnection.id, { id: user.id, email: user.email });
  assert.ok(fredResult);
  assert.equal(fredResult.status, "healthy");
  assert.match(fredResult.detail, /accepted the credential probe/);
  assert.match(fredUrl, /^https:\/\/api\.stlouisfed\.org\/fred\/series\?/);
  assert.equal(new URL(fredUrl).searchParams.get("api_key"), "test-fred-key");
  assert.equal(fredResult.detail.includes("test-fred-key"), false);

  // Fresh authorization rejection overrides an earlier passive success.
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: "Invalid API key" }), { status: 401 },
  )) as typeof fetch;
  const fredFailure = await testSourceConnection(user.id, fredConnection.id, { id: user.id, email: user.email });
  assert.ok(fredFailure);
  assert.equal(fredFailure.status, "invalid");
  assert.match(fredFailure.detail, /rejected the credential/);
  const [savedFred] = await db.select().from(sourceConnections).where(eq(sourceConnections.id, fredConnection.id));
  assert.equal(savedFred.status, "invalid");
  assert.equal(savedFred.lastHealthyAt !== null, true);
});

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}


test("a previous passive success cannot satisfy a new Verify click without a live probe", () => {
  const pastSuccess = unprobedConnectionResult("live_verified");
  assert.equal(pastSuccess.status, "configured");
  assert.match(pastSuccess.detail, /did not contact the provider/);
  assert.notEqual(pastSuccess.status, "healthy");
  assert.equal(unprobedConnectionResult("credential_configured").status, "configured");
  assert.equal(unprobedConnectionResult("catalog_only").status, "invalid");
  assert.equal(unprobedConnectionResult("disabled").status, "degraded");
  assert.equal(unprobedConnectionResult("rate_limited").status, "degraded");
  assert.equal(unprobedConnectionResult(null).status, "unreachable");
});
