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
import type { GatewayFrame } from "@shared/gatewayProtocol";

// Outbound events are fenced by the current account, so the subscriber is a real active
// account in an isolated database (db.ts captures its root at module evaluation).
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-gateway-quotes-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { gatewayHub, publishQuoteUpdate } = await import("./gatewayRuntime");

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), "condition not met in time");
}

async function open(url: string) {
  const socket = new WebSocket(url);
  const frames: GatewayFrame[] = [];
  socket.on("message", (data) => frames.push(gatewayFrameSchema.parse(JSON.parse(data.toString()))));
  await once(socket, "open");
  const call = async (id: string, method: string, params?: unknown) => {
    socket.send(JSON.stringify({ type: "req", id, method, params }));
    for (let i = 0; i < 100; i += 1) {
      const found = frames.find((f) => f.type === "res" && f.id === id);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no response to ${method}`);
  };
  await call("c", "connect", { minProtocol: 1, maxProtocol: GATEWAY_PROTOCOL_VERSION, client: { id: "t", version: "1", platform: "node", mode: "test" } });
  return { socket, frames, call };
}

describe("Gateway quote subscriptions", () => {
  it("delivers each connection only the symbols it subscribed to, case-insensitively, and stops after unsubscribe", async () => {
    await initDb();
    const [account] = await getDb().insert(users).values({ name: "Quote subscriber", email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", role: "client_user", organizationId: null }).returning();
    const http = createServer();
    const wss = new WebSocketServer({ server: http });
    wss.on("connection", (socket) => gatewayHub.attach(socket, { userId: account!.id, email: account!.email, role: "client_user", organizationId: null, grantedScopes: ["read", "write"] }));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const a = await open(url);
    const b = await open(url);
    const none = await open(url);
    await a.call("1", "quotes.subscribe", { symbols: ["aapl", "msft"] });
    await b.call("1", "quotes.subscribe", { symbols: ["TSLA"] });

    publishQuoteUpdate([
      { symbol: "AAPL", price: 1, change: 0, changePercent: 0 },
      { symbol: "TSLA", price: 2, change: 0, changePercent: 0 },
      { symbol: "NVDA", price: 3, change: 0, changePercent: 0 },
    ]);
    const symbolsOf = (frames: GatewayFrame[]) => frames.flatMap((f) => (f.type === "event" && f.event === "quotes.update" ? (f.payload as { quotes: Array<{ symbol: string }> }).quotes.map((q) => q.symbol) : []));
    await waitFor(() => symbolsOf(a.frames).length === 1 && symbolsOf(b.frames).length === 1);
    assert.deepEqual(symbolsOf(a.frames), ["AAPL"]);
    assert.deepEqual(symbolsOf(b.frames), ["TSLA"]);
    assert.deepEqual(symbolsOf(none.frames), []);

    await a.call("2", "quotes.unsubscribe", { symbols: ["AAPL"] });
    publishQuoteUpdate([{ symbol: "AAPL", price: 4, change: 0, changePercent: 0 }]);
    // A barrier event proves the earlier publish has been processed: a second subscribed symbol arrives after it.
    publishQuoteUpdate([{ symbol: "TSLA", price: 5, change: 0, changePercent: 0 }]);
    await waitFor(() => symbolsOf(b.frames).length === 2);
    assert.deepEqual(symbolsOf(a.frames), ["AAPL"]);

    for (const c of [a, b, none]) c.socket.terminate();
    await gatewayHub.shutdown("test over");
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
