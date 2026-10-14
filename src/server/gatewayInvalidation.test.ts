import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { GATEWAY_PROTOCOL_VERSION, gatewayFrameSchema } from "@shared/gatewayProtocol";
import type { GatewayFrame, GatewayScope } from "@shared/gatewayProtocol";
import { gatewayHub, notifyDataChanged } from "./gatewayRuntime";

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), "condition not met in time");
}

describe("Gateway data.invalidate audiences", () => {
  it("reaches only the named user, or only Home-owner (admin-scope) connections", async () => {
    const http = createServer();
    const wss = new WebSocketServer({ server: http });
    const identities: Array<{ userId: number; grantedScopes: GatewayScope[] }> = [
      { userId: 1, grantedScopes: ["read", "write", "admin"] },
      { userId: 2, grantedScopes: ["read", "write"] },
      { userId: 3, grantedScopes: ["read", "write"] },
    ];
    let next = 0;
    wss.on("connection", (socket) => gatewayHub.attach(socket, { ...identities[next++]!, email: "t@example.test", role: "client_user", organizationId: null }));
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

    notifyDataChanged("alerts", { userId: 2 });
    notifyDataChanged("backup", { homeOwner: true });
    notifyDataChanged("license", { homeOwner: true });
    // The barrier: a topic sent to user 3 last proves earlier publishes were processed in order.
    notifyDataChanged("quantlab", { userId: 3 });
    await waitFor(() => clients[2]!.topics.length === 1 && clients[1]!.topics.length === 1 && clients[0]!.topics.length === 2);
    assert.deepEqual(clients[0]!.topics, ["backup", "license"]);
    assert.deepEqual(clients[1]!.topics, ["alerts"]);
    assert.deepEqual(clients[2]!.topics, ["quantlab"]);

    clients.forEach((client) => client.socket.terminate());
    await gatewayHub.shutdown("test over");
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
});
