import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { GATEWAY_PROTOCOL_VERSION, gatewayFrameSchema } from "@shared/gatewayProtocol";
import type { GatewayFrame, GatewayScope } from "@shared/gatewayProtocol";

// db.ts captures its data root at module evaluation. Outbound events are fenced by the
// current account, so the audiences below are real active accounts in an isolated database.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-gateway-invalidation-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { gatewayHub, notifyDataChanged } = await import("./gatewayRuntime");

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), "condition not met in time");
}

describe("Gateway data.invalidate audiences", () => {
  it("reaches only the named user, or only Home-owner (admin-scope) connections", async () => {
    await initDb();
    const accounts = await getDb().insert(users).values([1, 2, 3].map((n) => ({
      name: `Invalidation ${n}`, email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "test-only", role: "client_user" as const, organizationId: null,
    }))).returning();
    const http = createServer();
    const wss = new WebSocketServer({ server: http });
    const grants: GatewayScope[][] = [["read", "write", "admin"], ["read", "write"], ["read", "write"]];
    let next = 0;
    wss.on("connection", (socket) => {
      const index = next++;
      gatewayHub.attach(socket, { userId: accounts[index]!.id, grantedScopes: grants[index]!, email: accounts[index]!.email, role: "client_user", organizationId: null });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;

    const clients = [] as Array<{ socket: WebSocket; topics: string[] }>;
    for (let i = 0; i < 3; i += 1) {
      const socket = new WebSocket(url);
      const topics: string[] = [];
      let hello: GatewayFrame | null = null;
      socket.on("message", (data) => {
        const frame = gatewayFrameSchema.parse(JSON.parse(data.toString()));
        if (frame.type === "res") hello = frame;
        if (frame.type === "event" && frame.event === "data.invalidate") topics.push(...(frame.payload as { topics: string[] }).topics);
      });
      await once(socket, "open");
      socket.send(JSON.stringify({ type: "req", id: "c", method: "connect", params: { minProtocol: 1, maxProtocol: GATEWAY_PROTOCOL_VERSION, client: { id: "t", version: "1", platform: "node", mode: "test" } } }));
      await waitFor(() => hello !== null);
      clients.push({ socket, topics });
    }

    notifyDataChanged("alerts", { userId: accounts[1]!.id });
    notifyDataChanged("backup", { homeOwner: true });
    notifyDataChanged("license", { homeOwner: true });
    // The barrier: a topic sent to user 3 last proves earlier publishes were processed in order.
    notifyDataChanged("quantlab", { userId: accounts[2]!.id });
    await waitFor(() => clients[2]!.topics.length === 1 && clients[1]!.topics.length === 1 && clients[0]!.topics.length === 2);
    assert.deepEqual(clients[0]!.topics, ["backup", "license"]);
    assert.deepEqual(clients[1]!.topics, ["alerts"]);
    assert.deepEqual(clients[2]!.topics, ["quantlab"]);

    clients.forEach((client) => client.socket.terminate());
    await gatewayHub.shutdown("test over");
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
