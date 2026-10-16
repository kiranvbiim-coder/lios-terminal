import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { GATEWAY_PROTOCOL_VERSION, gatewayFrameSchema, type GatewayFrame, type GatewayScope } from "@shared/gatewayProtocol";
import type { DeviceReviewBinding } from "@shared/deviceOutbox";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-device-continuity-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
// Database modules capture the storage root on import: load them only after isolating this Home.
const { initDb, closeDb, getDb } = await import("./db");
const schema = await import("@shared/schema");
const { pairedDevices } = await import("@shared/schemaDevices");
const { decisionSnapshotHash } = await import("./decisionEngine");
const { GatewayHub } = await import("./gatewayHub");
const { registerDeviceContinuityGateway } = await import("./gatewayDeviceContinuity");
const { createProject } = await import("./projectStore");
const { createArtifact } = await import("./artifactStore");
const { users, decisionCases, decisionReceiptVersions, decisionApprovals } = schema;

type Role = "internal_compliance" | "internal_analyst";
const homeId = crypto.randomUUID();

function identityRow(role: Role) {
  return { name: role, email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", role, organizationId: null };
}

async function makeDecision(ownerUserId: number, overrides: { materiality?: "routine" | "material" | "critical" } = {}) {
  const db = getDb();
  const [decision] = await db.insert(decisionCases).values({
    title: "Rebalance review", question: `Should the book change? ${crypto.randomUUID()}`, decisionType: "investment",
    materiality: overrides.materiality ?? "routine", status: "review", organizationId: null, ownerUserId,
  }).returning();
  const payload = {
    decisionId: decision.id, version: 1, question: decision.question, recommendation: "Review the downside case.",
    interpretation: "Evidence is mixed.", evidence: [], sources: [], assumptions: [{ label: "a" }], calculations: [], models: [],
    scenarios: [], alternatives: [], counterarguments: [], contradictions: [], confidence: {}, monitoringTriggers: [],
    provenance: [], requiredEvidenceCount: 1, completeness: { complete: true, missing: [] }, createdByUserId: ownerUserId,
  };
  const [receipt] = await db.insert(decisionReceiptVersions).values({ ...payload, snapshotHash: decisionSnapshotHash(payload) }).returning();
  return { decision, receipt };
}

type Pending = (frame: GatewayFrame) => boolean;
async function openClient(url: string) {
  const socket = new WebSocket(url);
  const frames: GatewayFrame[] = [];
  const waiters: Array<() => void> = [];
  socket.on("message", (data) => { frames.push(gatewayFrameSchema.parse(JSON.parse(data.toString()))); waiters.splice(0).forEach((wake) => wake()); });
  await once(socket, "open");
  const next = async (predicate: Pending): Promise<GatewayFrame> => {
    for (;;) {
      const index = frames.findIndex(predicate);
      if (index >= 0) return frames.splice(index, 1)[0]!;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  socket.send(JSON.stringify({ type: "req", id: "connect", method: "connect", params: { minProtocol: 1, maxProtocol: GATEWAY_PROTOCOL_VERSION, client: { id: "t", version: "1", platform: "node", mode: "test" } } }));
  const hello = await next((frame) => frame.type === "res" && frame.id === "connect");
  let counter = 0;
  return {
    hello, close: () => socket.terminate(),
    async call(method: string, params: unknown) {
      const id = `r${++counter}`;
      socket.send(JSON.stringify({ type: "req", id, method, params }));
      const frame = await next((candidate) => candidate.type === "res" && candidate.id === id);
      assert.equal(frame.type, "res");
      if (frame.type !== "res") throw new Error("unreachable");
      return frame.ok ? { ok: true as const, payload: frame.payload as Record<string, unknown> } : { ok: false as const, code: frame.error?.code ?? "", message: frame.error?.message ?? "" };
    },
  };
}

test("paired-device continuity and exact-request Decision review use current Home authority", { timeout: 120_000 }, async (t) => {
  await initDb();
  const hub = new GatewayHub({ version: "device-continuity-test" });
  registerDeviceContinuityGateway(hub, { homeId: () => homeId });
  const identities = new Map<string, { userId: number; email: string; role: Role; organizationId: null; grantedScopes: GatewayScope[]; deviceId?: string }>();
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (socket, request) => {
    const key = new URL(request.url ?? "/", "http://home.test").searchParams.get("k") ?? "";
    const identity = identities.get(key);
    if (!identity) return socket.close(1008, "unknown test identity");
    hub.attach(socket, identity);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const base = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  t.after(async () => {
    await hub.shutdown("test over");
    wss.clients.forEach((client) => client.terminate());
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const db = getDb();
  const [reviewer, analyst, stranger] = await db.insert(users).values([identityRow("internal_compliance"), identityRow("internal_analyst"), identityRow("internal_analyst")]).returning();
  const deviceIds = { reviewer: crypto.randomBytes(16).toString("hex"), reviewerRead: crypto.randomBytes(16).toString("hex"), analyst: crypto.randomBytes(16).toString("hex"), stranger: crypto.randomBytes(16).toString("hex") };
  const device = (id: string, ownerUserId: number, scopes: GatewayScope[]) => ({ id, ownerUserId, organizationId: null, name: id.slice(0, 6), platform: "test", publicKey: crypto.randomBytes(32).toString("hex"), scopes, capabilities: [], commands: [] });
  await db.insert(pairedDevices).values([
    device(deviceIds.reviewer, reviewer.id, ["read", "write"]), device(deviceIds.reviewerRead, reviewer.id, ["read"]),
    device(deviceIds.analyst, analyst.id, ["read", "write"]), device(deviceIds.stranger, stranger.id, ["read", "write"]),
  ]);
  async function connect(who: "reviewer" | "reviewerRead" | "analyst" | "stranger") {
    const user = who === "reviewer" || who === "reviewerRead" ? reviewer : who === "analyst" ? analyst : stranger;
    const key = crypto.randomUUID();
    identities.set(key, { userId: user.id, email: user.email, role: user.role as Role, organizationId: null, grantedScopes: who === "reviewerRead" ? ["read"] : ["read", "write"], deviceId: deviceIds[who] });
    return openClient(`${base}?k=${key}`);
  }
  const submission = (binding: DeviceReviewBinding, overrides: Record<string, unknown> = {}) => ({
    requestId: crypto.randomUUID(), binding, outcome: "rejected", finalDecision: "Do not rebalance now.", rationale: "The downside case dominates.", ...overrides,
  });
  async function readBinding(client: Awaited<ReturnType<typeof connect>>, decisionId: number) {
    const read = await client.call("decision.review.read", { decisionId });
    assert.ok(read.ok, JSON.stringify(read));
    return read.payload as { binding: DeviceReviewBinding; canReview: boolean; approval: unknown };
  }

  await t.test("canonical Project, Chat and Artifact state is readable by its owner and refused to another account", async () => {
    const ownerCtx = { userId: reviewer.id, organizationId: null, role: reviewer.role };
    const project = await createProject(ownerCtx, { name: "Device continuity" });
    const artifact = await createArtifact(ownerCtx, { projectId: project.id, title: "Owned table", content: { kind: "table", columns: [{ key: "x", label: "X" }], rows: [{ x: 1 }] } });
    const owner = await connect("reviewer");
    const projects = await owner.call("projects.list", {});
    assert.ok(projects.ok && (projects.payload.projects as Array<{ id: number }>).some((item) => item.id === project.id));
    const chat = await owner.call("chats.create", { projectId: project.id, title: "From my phone" });
    assert.ok(chat.ok, JSON.stringify(chat));
    const continuity = await owner.call("device.continuity.read", { projectId: project.id });
    assert.ok(continuity.ok, JSON.stringify(continuity));
    assert.equal(continuity.payload.homeId, homeId);
    assert.equal((continuity.payload.artifacts as Array<{ id: string }>).some((item) => item.id === artifact.artifact.id), true);
    const revision = await owner.call("artifacts.read", { artifactId: artifact.artifact.id });
    assert.ok(revision.ok, `native clients pass the canonical Artifact id verbatim: ${JSON.stringify(revision)}`);
    const foreign = await connect("stranger");
    const refused = await foreign.call("device.continuity.read", { projectId: project.id });
    assert.equal(refused.ok, false);
    const foreignArtifact = await foreign.call("artifacts.read", { artifactId: artifact.artifact.id });
    assert.equal(foreignArtifact.ok, false);
    owner.close(); foreign.close();
  });

  await t.test("an exact review is applied once, replays idempotently and refuses a changed payload under the same request", async () => {
    const { decision, receipt } = await makeDecision(reviewer.id);
    const client = await connect("reviewer");
    const { binding, canReview } = await readBinding(client, decision.id);
    assert.equal(canReview, true);
    assert.equal(binding.homeId, homeId); assert.equal(binding.deviceId, deviceIds.reviewer); assert.equal(binding.snapshotHash, receipt.snapshotHash);
    const draft = submission(binding);
    const first = await client.call("decision.review.submit", draft);
    assert.ok(first.ok, JSON.stringify(first));
    assert.equal(first.payload.idempotent, false);
    const replay = await client.call("decision.review.submit", draft);
    assert.ok(replay.ok, JSON.stringify(replay));
    assert.equal(replay.payload.idempotent, true);
    assert.equal(replay.payload.approvalId, first.payload.approvalId);
    const changed = await client.call("decision.review.submit", { ...draft, rationale: "A different rationale." });
    assert.equal(changed.ok, false, "the same request id cannot carry different content");
    const rows = await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, decision.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.reviewRequestId, draft.requestId);
    const [stored] = await db.select().from(decisionCases).where(eq(decisionCases.id, decision.id));
    assert.equal(stored!.status, "rejected");
    client.close();
  });

  await t.test("a stale draft cannot finalize over a decision head that changed after it was authored", async () => {
    const { decision } = await makeDecision(reviewer.id);
    const client = await connect("reviewer");
    const { binding } = await readBinding(client, decision.id);
    await db.update(decisionCases).set({ status: "approved", finalDecision: "Someone else decided.", decisionRationale: "Concurrent review." }).where(eq(decisionCases.id, decision.id));
    const refused = await client.call("decision.review.submit", submission(binding));
    assert.equal(refused.ok, false);
    assert.equal((await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, decision.id))).length, 0);
    client.close();
  });

  await t.test("a tampered receipt is refused at read and at release", async () => {
    const { decision, receipt } = await makeDecision(reviewer.id);
    const client = await connect("reviewer");
    const { binding } = await readBinding(client, decision.id);
    await db.update(decisionReceiptVersions).set({ recommendation: "Quietly changed after the draft." }).where(eq(decisionReceiptVersions.id, receipt.id));
    assert.equal((await client.call("decision.review.read", { decisionId: decision.id })).ok, false);
    assert.equal((await client.call("decision.review.submit", submission(binding))).ok, false);
    assert.equal((await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, decision.id))).length, 0);
    client.close();
  });

  await t.test("an approval still needs the institutional assurance gate; the device path cannot bypass it", async () => {
    const { decision } = await makeDecision(reviewer.id, { materiality: "critical" });
    const client = await connect("reviewer");
    const { binding } = await readBinding(client, decision.id);
    const refused = await client.call("decision.review.submit", submission(binding, { outcome: "approved", finalDecision: "Proceed." }));
    assert.equal(refused.ok, false);
    assert.equal((await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, decision.id))).length, 0);
    client.close();
  });

  await t.test("a draft authored on one device cannot be released by another device or account", async () => {
    const { decision } = await makeDecision(reviewer.id);
    const origin = await connect("reviewer");
    const { binding } = await readBinding(origin, decision.id);
    const thief = await connect("analyst");
    assert.equal((await thief.call("decision.review.submit", submission(binding))).ok, false);
    const mismatched = await origin.call("decision.review.submit", submission({ ...binding, homeId: crypto.randomUUID() }));
    assert.equal(mismatched.ok, false, "a different Home identity is refused");
    const expired = await origin.call("decision.review.submit", submission({ ...binding, issuedAt: new Date(Date.now() - 49 * 3600_000).toISOString(), expiresAt: new Date(Date.now() - 25 * 3600_000).toISOString() }));
    assert.equal(expired.ok, false, "a binding past its 24 hour life is refused");
    assert.equal((await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, decision.id))).length, 0);
    origin.close(); thief.close();
  });

  await t.test("a read-only device can read a review but is refused the release, and an analyst cannot review at all", async () => {
    const { decision } = await makeDecision(reviewer.id);
    const readOnly = await connect("reviewerRead");
    const { binding, canReview } = await readBinding(readOnly, decision.id);
    assert.equal(canReview, false, "no write scope means no review capability is advertised");
    assert.equal((await readOnly.call("decision.review.submit", submission(binding))).ok, false);
    const analystClient = await connect("analyst");
    const analystRead = await analystClient.call("decision.review.read", { decisionId: decision.id });
    assert.equal(analystRead.ok, false, "an analyst does not own this compliance decision");
    readOnly.close(); analystClient.close();
  });

  await t.test("revoking the paired device or changing the account's role stops every method before the next call", async () => {
    const { decision } = await makeDecision(reviewer.id);
    const client = await connect("reviewer");
    const { binding } = await readBinding(client, decision.id);
    await db.update(users).set({ role: "internal_analyst" }).where(eq(users.id, reviewer.id));
    const drifted = await client.call("decision.review.submit", submission(binding));
    assert.equal(drifted.ok, false);
    assert.match(drifted.ok ? "" : drifted.message, /identity changed|reconnect/i);
    await db.update(users).set({ role: "internal_compliance" }).where(eq(users.id, reviewer.id));
    assert.equal((await client.call("projects.list", {})).ok, true, "restoring the role restores access to the same live connection");
    await db.update(pairedDevices).set({ revokedAt: new Date() }).where(eq(pairedDevices.id, deviceIds.reviewer));
    const revoked = await client.call("decision.review.read", { decisionId: decision.id });
    assert.equal(revoked.ok, false);
    assert.match(revoked.ok ? "" : revoked.message, /revoked|scopes/i);
    assert.equal((await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, decision.id))).length, 0);
    client.close();
  });
});