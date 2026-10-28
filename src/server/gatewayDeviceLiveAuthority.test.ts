import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { GATEWAY_PROTOCOL_VERSION, gatewayFrameSchema, type GatewayFrame } from "@shared/gatewayProtocol";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-d5-live-device-authority-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { pairedDevices } = await import("@shared/schemaDevices");
const { gatewayHub, publishQuoteUpdate } = await import("./gatewayRuntime");

test("D5 production Gateway revocation, account restrictions and device scopes are live for any RPC", { timeout: 70_000 }, async (t) => {
  await initDb();
  const [user] = await getDb().insert(users).values({
    name: "D5 paired test", email: crypto.randomUUID() + "@example.test",
    passwordHash: "test-only", role: "client_user", organizationId: null,
  }).returning();
  const deviceId = crypto.randomBytes(16).toString("hex");
  await getDb().insert(pairedDevices).values({
    id: deviceId, ownerUserId: user.id, organizationId: null,
    name: "D5 Current", platform: "test", publicKey: crypto.randomBytes(32).toString("hex"),
    scopes: ["read", "write"], capabilities: ["untrusted.tool"], commands: ["arbitrary.invoke"],
  });
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", ws => gatewayHub.attach(ws, {
    userId: user.id, email: user.email, role: user.role, organizationId: null,
    grantedScopes: ["read", "write"], deviceId,
  }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await gatewayHub.shutdown("D5 test complete");
    sockets.clients.forEach(ws => ws.terminate());
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const address = server.address() as AddressInfo;
  const client = new WebSocket("ws://127.0.0.1:" + address.port);
  await once(client, "open");
  const frames: GatewayFrame[] = [];
  const listeners: Array<() => void> = [];
  client.on("message", raw => {
    frames.push(gatewayFrameSchema.parse(JSON.parse(raw.toString())));
    listeners.splice(0).forEach(fn => fn());
  });
  async function call(id: string, method: string, params?: unknown): Promise<Extract<GatewayFrame, { type: "res" }>> {
    client.send(JSON.stringify({ type: "req", id, method, params }));
    for (;;) {
      const index = frames.findIndex(frame => frame.type === "res" && frame.id === id);
      if (index >= 0) return frames.splice(index, 1)[0] as Extract<GatewayFrame, { type: "res" }>;
      await new Promise<void>(resolve => listeners.push(resolve));
    }
  }
  const hello = await call("connect", "connect", {
    minProtocol: 1, maxProtocol: GATEWAY_PROTOCOL_VERSION,
    client: { id: "d5-live-test", version: "1", platform: "node", mode: "test" },
  });
  assert.equal(hello.ok, true);
  assert.equal((await call("ping1", "gateway.ping", {})).ok, true);
  assert.equal((await call("subscribe1", "quotes.subscribe", { symbols: ["TEST"] })).ok, true);

  await getDb().update(pairedDevices).set({ revokedAt: new Date() }).where(eq(pairedDevices.id, deviceId));
  const revoked = await call("ping2", "gateway.ping", {});
  assert.equal(revoked.ok, false);
  assert.equal(revoked.error?.code, "FORBIDDEN");
  const revokedQuotes = await call("subscribe2", "quotes.subscribe", { symbols: ["REVOCATION"] });
  assert.equal(revokedQuotes.ok, false);
  assert.equal(revokedQuotes.error?.code, "FORBIDDEN");
  const active = gatewayHub.readyConnections()[0]!;
  await assert.rejects(gatewayHub.invokeForConnection("gateway.ping", {}, active), /authorization is unavailable or revoked/);
  await getDb().update(pairedDevices).set({ revokedAt: null, scopes: [] }).where(eq(pairedDevices.id, deviceId));
  assert.equal((await call("ping3", "gateway.ping", {})).error?.code, "FORBIDDEN",
    "a previously granted read scope cannot override current stored device scopes");

  await getDb().update(pairedDevices).set({ scopes: ["read", "write"] }).where(eq(pairedDevices.id, deviceId));
  await getDb().update(users).set({ active: false }).where(eq(users.id, user.id));
  assert.equal((await call("ping4", "gateway.ping", {})).error?.code, "FORBIDDEN",
    "disabling the owner invalidates the long-lived paired connection");
  await getDb().update(users).set({ active: true, role: "internal_analyst" }).where(eq(users.id, user.id));
  assert.equal((await call("ping5", "gateway.ping", {})).error?.code, "FORBIDDEN",
    "role changes require reconnecting under the new authority");
  const closed = once(client, "close");
  // The socket has a previous subscription and remains connected after
  // refusal. Outbound broadcasts must still revalidate current device
  // authority, deliver no quote, and drop the stale connection.
  active.emit("conversation.event", {
    requestId: "22222222-2222-4222-8222-222222222222", runSeq: 1,
    event: { type: "text", requestId: "22222222-2222-4222-8222-222222222222", at: new Date().toISOString(), text: "private text after role change", label: "manual" },
  });
  publishQuoteUpdate([{ symbol: "TEST", price: 3, change: 0, changePercent: 0 }]);
  const [closeCode] = await closed;
  assert.equal(closeCode, 4001);
  assert.equal(frames.some(frame => frame.type === "event" && frame.event === "quotes.update"), false,
    "an old paired quote subscription cannot leak data after role/device revocation");
  assert.equal(frames.some(frame => frame.type === "event" && frame.event === "conversation.event"), false,
    "direct conversation subscriptions must use the same fresh authority fence as broadcasts");
  client.terminate();
});
