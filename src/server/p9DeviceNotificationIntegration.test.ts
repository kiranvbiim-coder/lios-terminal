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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-d6-p9-device-notification-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { pairedDevices } = await import("@shared/schemaDevices");
const { gatewayHub } = await import("./gatewayRuntime");
const { registerDeviceContinuityGateway } = await import("./gatewayDeviceContinuity");
const { createProject } = await import("./projectStore");
const { createP9Workflow, createP9Notification } = await import("./p9AutomationStore");
const { executeP9Workflow } = await import("./p9AutomationService");

type Client = {
  socket: WebSocket;
  events: Array<Extract<GatewayFrame, { type: "event" }>>;
  closed: Promise<[number, Buffer]>;
  call: (method: string, params: unknown) => Promise<Extract<GatewayFrame, { type: "res" }>>;
  awaitNotificationHint: (count: number) => Promise<void>;
};

test("D6 actual P9 failure receipt -> committed notification -> owner paired Gateway -> revoked device silence", { timeout: 80_000 }, async t => {
  await initDb();
  const homeId = crypto.randomUUID();
  registerDeviceContinuityGateway(gatewayHub, { homeId: () => homeId });
  const [owner, other] = await getDb().insert(users).values(
    [0, 1].map(i => ({
      name: "D6 owner " + i,
      email: crypto.randomUUID() + "@example.test",
      passwordHash: "test-only",
      role: "internal_analyst" as const,
      organizationId: null,
    })),
  ).returning();
  const ownerCtx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ownerCtx, { name: "D6 P9 device continuity" });
  const identities = new Map<string, { userId: number; email: string; role: typeof owner.role; organizationId: number | null; grantedScopes: Array<"read" | "write">; deviceId: string }>();
  const deviceIds = { owner: crypto.randomBytes(16).toString("hex"), other: crypto.randomBytes(16).toString("hex") };
  for (const record of [
    { user: owner, id: deviceIds.owner },
    { user: other, id: deviceIds.other },
  ]) {
    await getDb().insert(pairedDevices).values({
      id: record.id, ownerUserId: record.user.id, organizationId: null,
      name: "D6 paired", platform: "test", publicKey: crypto.randomBytes(32).toString("hex"),
      scopes: ["read", "write"], capabilities: ["plugin.fake.execute"], commands: ["shell.fake"],
    });
  }
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  sockets.on("connection", (socket, request) => {
    const key = new URL(request.url ?? "/", "http://local.test").searchParams.get("client") ?? "";
    const identity = identities.get(key);
    if (!identity) { socket.close(1008, "Unknown local test identity"); return; }
    gatewayHub.attach(socket, identity);
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await gatewayHub.shutdown("D6 test complete");
    sockets.clients.forEach(socket => socket.terminate());
    await new Promise<void>(resolve => http.close(() => resolve()));
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let nextId = 0;
  async function connect(user: typeof owner, deviceId: string): Promise<Client> {
    const key = crypto.randomUUID();
    identities.set(key, {
      userId: user.id, email: user.email, role: user.role,
      organizationId: user.organizationId, grantedScopes: ["read", "write"], deviceId,
    });
    const address = http.address() as AddressInfo;
    const socket = new WebSocket("ws://127.0.0.1:" + address.port + "/?client=" + key);
    const frames: GatewayFrame[] = [];
    const waiters: Array<() => void> = [];
    const events: Array<Extract<GatewayFrame, { type: "event" }>> = [];
    socket.on("message", data => {
      const frame = gatewayFrameSchema.parse(JSON.parse(data.toString()));
      frames.push(frame);
      if (frame.type === "event") events.push(frame);
      waiters.splice(0).forEach(resolve => resolve());
    });
    const closed = once(socket, "close") as Promise<[number, Buffer]>;
    await once(socket, "open");
    const next = async (predicate: (frame: GatewayFrame) => boolean) => {
      for (;;) {
        const i = frames.findIndex(predicate);
        if (i >= 0) return frames.splice(i, 1)[0]!;
        await new Promise<void>(resolve => waiters.push(resolve));
      }
    };
    const call = async (method: string, params: unknown) => {
      const id = "d6-" + (++nextId);
      socket.send(JSON.stringify({ type: "req", id, method, params }));
      return next(frame => frame.type === "res" && frame.id === id) as Promise<Extract<GatewayFrame, { type: "res" }>>;
    };
    const hello = await call("connect", {
      minProtocol: 1, maxProtocol: GATEWAY_PROTOCOL_VERSION,
      client: { id: "d6-paired", version: "1", platform: "node", mode: "test" },
    });
    assert.equal(hello.ok, true);
    return {
      socket, events, closed, call,
      async awaitNotificationHint(count) {
        for (let i = 0; i < 150; i++) {
          if (events.filter(e => e.event === "data.invalidate" &&
            (e.payload as { topics?: string[] }).topics?.includes("notifications")).length >= count) return;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error("Committed automation notification was not announced to paired device");
      },
    };
  }

  const mine = await connect(owner, deviceIds.owner);
  const foreign = await connect(other, deviceIds.other);
  const action = { kind: "conversation_rerun" as const, chatId: 2_000_000_000, request: {
    message: "LiOS doctor", sourceScope: "my_data" as const, executionMode: "deterministic_first" as const,
  } };
  const workflow = await createP9Workflow(ownerCtx, project.id, {
    name: "D6 safely failing diagnostic", template: "custom", enabled: true,
    trigger: { type: "manual" }, action,
    notificationPolicy: {
      enabled: true, channels: ["in_app"], notifyOn: ["failure"],
      minimumRelevanceScore: 0, cooldownMinutes: 0, suppressUnchanged: false,
    },
  });
  const first = await executeP9Workflow({ workflow, triggerType: "manual" });
  assert.equal(first.run?.status, "failed", "missing owned Chat refuses the scheduled command before model or tools");
  assert.equal(first.notification?.status, "delivered");
  assert.ok(first.notification?.id);
  await mine.awaitNotificationHint(1);
  assert.equal(foreign.events.some(e => e.event === "data.invalidate" &&
    (e.payload as { topics?: string[] }).topics?.includes("notifications")), false,
    "no unrelated owner can receive the notifications signal");
  const notificationHints = () => mine.events.filter(e => e.event === "data.invalidate" &&
    (e.payload as { topics?: string[] }).topics?.includes("notifications"));
  assert.equal(notificationHints().length, 1);
  assert.deepEqual(notificationHints()[0]?.payload, { topics: ["notifications"] },
    "outbound hints contain no run failure text, source data or credentials");

  const listed = await mine.call("notifications.list", { projectId: project.id });
  assert.equal(listed.ok, true);
  const visible = (listed.payload as { notifications: Array<{ id: string; status: string }> }).notifications;
  assert.ok(visible.some(item => item.id === first.notification!.id && item.status === "delivered"));
  assert.equal((await foreign.call("notifications.list", { projectId: project.id })).ok, false,
    "current Project ownership still governs actual notification records");
  const intent = { homeId, userId: owner.id, deviceId: deviceIds.owner, projectId: project.id,
    notificationId: first.notification.id };
  const ack = await mine.call("notifications.read.replay", intent);
  assert.equal(ack.ok, true);
  const repeat = await mine.call("notifications.read.replay", intent);
  assert.equal(repeat.ok, true);
  const readAt = (reply: typeof ack) => (reply.payload as { notification: { readAt: string } }).notification.readAt;
  assert.equal(readAt(ack), readAt(repeat), "a retry preserves the first durable read acknowledgement");

  // The same durable run receipt must not broadcast another hint when the
  // notification creation path is retried after an interrupted response.
  const duplicate = await createP9Notification(ownerCtx, workflow, first.run!.id,
    { result: null, error: first.error });
  assert.equal(duplicate?.id, first.notification.id);
  assert.equal(notificationHints().length, 1, "idempotent retry does not re-emit an event");

  await getDb().update(pairedDevices).set({ revokedAt: new Date() })
    .where(eq(pairedDevices.id, deviceIds.owner));
  const second = await executeP9Workflow({ workflow, triggerType: "manual" });
  assert.equal(second.run?.status, "failed");
  assert.equal(second.notification?.status, "delivered");
  const [code] = await mine.closed;
  assert.equal(code, 4001, "retracted device authority disconnects the previously subscribed socket");
  assert.equal(notificationHints().length, 1, "no notification-change signal leaves Home for a revoked device");
  assert.equal(foreign.events.some(e => e.event === "data.invalidate" &&
    (e.payload as { topics?: string[] }).topics?.includes("notifications")), false);
  mine.socket.terminate();
  foreign.socket.terminate();
});
