import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { WebSocketServer } from "ws";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-d6-p9-pinned-device-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;

// All storage/runtime imports follow the isolated Home data-root binding.
const { initDb, closeDb, getDb } = await import("./db");
const { users, pairedDevices } = await import("@shared/schema");
const { gatewayHub } = await import("./gatewayRuntime");
const { DevicePairingService } = await import("./devicePairingService");
const { registerDeviceContinuityGateway } = await import("./gatewayDeviceContinuity");
const { loadOrCreateDeviceTlsIdentity } = await import("./deviceTls");
const { createPinnedDeviceSocket } = await import("./pinnedDeviceSocket");
const { GatewayClient } = await import("../client/src/lib/gateway/gatewayClient");
const { createDeviceIdentity } = await import("../client/src/lib/gateway/deviceIdentity");
const { createProject } = await import("./projectStore");
const { createP9Workflow } = await import("./p9AutomationStore");
const { executeP9Workflow } = await import("./p9AutomationService");

async function until(condition: () => boolean, name: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("D6 pinned device acceptance: " + name + " timed out");
}

test("D6 signed owner-approved TLS-pinned device receives P9 notifications, reconnects, and stops on revocation", { timeout: 100_000 }, async t => {
  await initDb();
  const tls = await loadOrCreateDeviceTlsIdentity(path.join(root, "tls"));
  registerDeviceContinuityGateway(gatewayHub, { homeId: () => tls.homeId });
  const pairing = new DevicePairingService();
  const server = createServer({ cert: tls.certificatePem, key: tls.privateKeyPem });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, ws => {
    gatewayHub.attachUnauthenticated(ws, pairing, request.socket.remoteAddress);
  }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = "wss://127.0.0.1:" + address.port + "/gateway/device";
  const clientInfo = { id: "d6-acceptance", version: "1", platform: "node", mode: "test" as const };
  const socketImpl = createPinnedDeviceSocket(tls.fingerprint);
  const clients: InstanceType<typeof GatewayClient>[] = [];
  t.after(async () => {
    clients.forEach(client => client.stop());
    await gatewayHub.shutdown("D6 pinned device test finished");
    sockets.clients.forEach(socket => socket.terminate());
    await new Promise<void>(resolve => server.close(() => resolve()));
    sockets.close();
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const [owner, stranger] = await getDb().insert(users).values([0, 1].map(i => ({
    name: "D6 signed owner " + i,
    email: crypto.randomUUID() + "@example.test",
    passwordHash: "test-only",
    role: "internal_analyst" as const,
    organizationId: null,
  }))).returning();
  const ownerCtx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ownerCtx, { name: "D6 signed notification continuity" });

  async function enroll(userId: number): Promise<Awaited<ReturnType<typeof createDeviceIdentity>>["identity"]> {
    const created = await createDeviceIdentity();
    const token = pairing.createPairingToken({ id: userId, organizationId: null });
    const enrollee = new GatewayClient({
      url, WebSocketImpl: socketImpl, scopes: ["read", "write"], clientInfo,
      device: {
        identity: created.identity,
        pairing: { token: token.pairingToken, deviceName: "D6 owner-approved device" },
        capabilities: ["notifications.read", "untrusted-tool.advertisement"],
        commands: ["untrusted.command.advertisement"],
      },
    });
    clients.push(enrollee);
    let pairingId: string | null = null;
    let resolved: string | null = null;
    enrollee.onPairing(pending => { pairingId = pending.pairingId; });
    enrollee.onPairingResolved(outcome => { resolved = outcome; });
    enrollee.start();
    await until(() => pairingId !== null, "signed owner pairing request");
    assert.equal(pairing.listPending(userId).length, 1);
    await pairing.approve(userId, pairingId!);
    await until(() => resolved !== null, "owner pairing resolution over WSS");
    assert.equal(resolved, "approved");
    const [stored] = await getDb().select().from(pairedDevices)
      .where(eq(pairedDevices.id, created.identity.id));
    assert.ok(stored);
    assert.equal(stored.ownerUserId, userId);
    assert.equal(stored.publicKey, created.identity.publicKey);
    assert.deepEqual(stored.scopes, ["read", "write"]);
    assert.equal(stored.capabilities.includes("untrusted-tool.advertisement"), true);
    assert.deepEqual(stored.commands, ["untrusted.command.advertisement"]);
    // Advertised capabilities/commands are not methods or execution grants.
    assert.equal(gatewayHub.readyConnections().some(c => c.identity.deviceId === created.identity.id), false);
    return created.identity;
  }

  const ownerIdentity = await enroll(owner.id);
  const foreignIdentity = await enroll(stranger.id);

  function connect(identity: typeof ownerIdentity) {
    const client = new GatewayClient({
      url, WebSocketImpl: socketImpl, scopes: ["read", "write"], clientInfo,
      device: { identity, capabilities: ["notifications.read"], commands: [] },
      reconnect: { initialMs: 100, maxMs: 200, multiplier: 2, jitter: 0 },
    });
    clients.push(client);
    const hints: string[] = [];
    const stop = client.onEvent("data.invalidate", payload => {
      if (payload.topics.includes("notifications")) hints.push("notifications");
    });
    client.start();
    return { client, hints, stop };
  }

  const mine = connect(ownerIdentity);
  const foreign = connect(foreignIdentity);
  await until(() => mine.client.state === "ready" && foreign.client.state === "ready",
    "signed proof and TLS pin authentication");
  assert.equal(mine.client.hello?.auth.deviceId, ownerIdentity.id);
  assert.equal(foreign.client.hello?.auth.deviceId, foreignIdentity.id);
  assert.equal((await mine.client.request("gateway.ping", {})).bootId, gatewayHub.bootId);

  const workflow = await createP9Workflow(ownerCtx, project.id, {
    name: "D6 signed device safe automation failure", template: "custom", enabled: true,
    trigger: { type: "manual" },
    action: { kind: "conversation_rerun", chatId: 2_000_000_000, request: { message: "LiOS doctor" } },
    notificationPolicy: {
      enabled: true, channels: ["in_app"], notifyOn: ["failure"],
      minimumRelevanceScore: 0, cooldownMinutes: 0, suppressUnchanged: false,
    },
  });
  const first = await executeP9Workflow({ workflow, triggerType: "manual" });
  assert.equal(first.run?.status, "failed");
  assert.equal(first.notification?.status, "delivered");
  await until(() => mine.hints.length === 1, "new committed P9 notification over pinned TLS");
  assert.deepEqual(foreign.hints, [], "foreign signed device cannot observe this owner's notification");
  const mineList = await mine.client.request("notifications.list", { projectId: project.id });
  assert.equal(mineList.notifications.some(row => row.id === first.notification!.id), true);
  await assert.rejects(foreign.client.request("notifications.list", { projectId: project.id }));
  const intent = {
    homeId: tls.homeId, userId: owner.id, deviceId: ownerIdentity.id,
    projectId: project.id, notificationId: first.notification!.id,
  };
  const ack = await mine.client.request("notifications.read.replay", intent);
  const replay = await mine.client.request("notifications.read.replay", intent);
  assert.equal(ack.notification.readAt, replay.notification.readAt,
    "replaying the same Home/device read intent is idempotent");

  // Restart the client application connection. An offline notification must
  // be recovered from the Home's actual store rather than an event replay.
  mine.stop();
  mine.client.stop();
  const offline = await executeP9Workflow({ workflow, triggerType: "manual" });
  assert.equal(offline.notification?.status, "delivered");
  const resumed = connect(ownerIdentity);
  await until(() => resumed.client.state === "ready", "reauthentication with fresh signed nonce and correct TLS pin");
  assert.equal(resumed.client.hello?.auth.deviceId, ownerIdentity.id);
  const refreshed = await resumed.client.request("notifications.list", { projectId: project.id });
  assert.equal(refreshed.notifications.some(row => row.id === offline.notification!.id), true,
    "missed notification is reconciled from the server after reconnect");
  assert.equal(resumed.hints.length, 0, "an offline event is not fabricated or blindly replayed");

  await getDb().update(pairedDevices).set({ revokedAt: new Date() })
    .where(eq(pairedDevices.id, ownerIdentity.id));
  const revoked = await executeP9Workflow({ workflow, triggerType: "manual" });
  assert.equal(revoked.notification?.status, "delivered");
  await until(() => resumed.client.state !== "ready", "revoked paired device socket closure");
  assert.deepEqual(resumed.hints, [], "no event released to a revoked signed device");
  assert.deepEqual(foreign.hints, []);
  await assert.rejects(
    resumed.client.requestRaw("notifications.list", { projectId: project.id }),
    "revoked/closed device cannot fetch private automation notification content",
  );
  resumed.stop();
  foreign.stop();
});
