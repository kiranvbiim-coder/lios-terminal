import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-device-pairing-"));
process.env.HOME = path.join(base, "user");
process.env.LIOS_DATA_ROOT = path.join(base, "home");
delete process.env.DATABASE_URL;
fs.mkdirSync(process.env.HOME, { recursive: true });

// Load the storage modules only after the temporary HOME/DataRoot is set: static imports capture the real install.
const { closeDb, getDb, initDb } = await import("./db");
const { DevicePairingService } = await import("./devicePairingService");
const { findPairedDevice, insertPairedDevice, listActivePairedDevices, revokePairedDevice } = await import("./deviceStore");
const { users } = await import("@shared/schema");
const {
  buildDeviceProofPayload,
  deviceIdFromPublicKey,
  normalizeDeviceCapabilityAdvertisement,
  toBase64Url,
} = await import("@shared/devicePairing");
const { eq } = await import("drizzle-orm");
import type { GatewayConnectParams } from "@shared/gatewayProtocol";

let ownerId = 0;
let otherId = 0;
test.before(async () => {
  await initDb();
  const rows = await getDb().insert(users).values([
    { email: "owner@example.test", passwordHash: "x", role: "client_admin", name: "Owner", active: true },
    { email: "other@example.test", passwordHash: "x", role: "client_user", name: "Other", active: true },
  ]).returning();
  ownerId = rows[0]!.id;
  otherId = rows[1]!.id;
});
test.after(async () => {
  await closeDb();
  fs.rmSync(base, { recursive: true, force: true });
});

async function newDevice() {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const id = await deviceIdFromPublicKey(publicKey);
  async function connectParams(
    nonce: string,
    options: {
      pairingToken?: string;
      deviceName?: string;
      signedAt?: number;
      scopes?: Array<"read" | "write">;
      clientId?: string;
      capabilities?: string[];
      commands?: string[];
    } = {},
  ): Promise<GatewayConnectParams> {
    const signedAt = options.signedAt ?? Date.now();
    const client = { id: options.clientId ?? "phone", version: "1", platform: "ios", mode: "ui" as const };
    const surface = normalizeDeviceCapabilityAdvertisement({
      capabilities: options.capabilities,
      commands: options.commands,
    });
    const payload = buildDeviceProofPayload({
      deviceId: id,
      clientId: client.id,
      clientMode: client.mode,
      scopes: options.scopes ?? [],
      signedAt,
      nonce,
      pairingToken: options.pairingToken ?? "",
      ...surface,
    });
    const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(payload))));
    return {
      minProtocol: 1,
      maxProtocol: 1,
      client,
      ...(options.scopes ? { scopes: options.scopes } : {}),
      device: { id, publicKey, signature, signedAt, ...surface },
      ...(options.pairingToken ? { pairing: { token: options.pairingToken, deviceName: options.deviceName ?? "Kiran's phone" } } : {}),
    };
  }
  return { id, publicKey, connectParams };
}

async function pairDevice(
  service: InstanceType<typeof DevicePairingService>,
  userId: number,
  surface: { capabilities?: string[]; commands?: string[] } = {},
) {
  const device = await newDevice();
  const { pairingToken } = service.createPairingToken({ id: userId, organizationId: null });
  const decision = await service.authenticate({
    params: await device.connectParams("nonce-1", { pairingToken, ...surface }),
    nonce: "nonce-1",
    remoteAddress: "10.0.0.5",
  });
  assert.equal(decision.kind, "pending");
  if (decision.kind !== "pending") throw new Error("unreachable");
  const pending = service.listPending(userId);
  assert.equal(pending.length, 1);
  await service.approve(userId, pending[0]!.pairingId);
  assert.equal(await decision.resolution, "approved");
  return device;
}

test("pairing needs the owner's token and the owner's approval, then the device authenticates by signing a fresh nonce", async () => {
  const changed: number[] = [];
  const service = new DevicePairingService({ onChange: (userId) => changed.push(userId) });
  const device = await pairDevice(service, ownerId);
  assert.ok(changed.includes(ownerId));

  const stored = await findPairedDevice(device.id);
  assert.equal(stored?.publicKey, device.publicKey);
  assert.equal(stored?.ownerUserId, ownerId);
  assert.deepEqual(stored?.scopes, ["read", "write"]);

  const accepted = await service.authenticate({ params: await device.connectParams("nonce-2"), nonce: "nonce-2", remoteAddress: "10.0.0.5" });
  assert.equal(accepted.kind, "accept");
  if (accepted.kind === "accept") {
    assert.equal(accepted.identity.userId, ownerId);
    assert.equal(accepted.identity.deviceId, device.id);
    assert.deepEqual(accepted.identity.grantedScopes, ["read", "write"], "a paired device can never hold admin");
  }
});

test("pairing approval persists exactly the normalized signed capability declaration", async () => {
  const service = new DevicePairingService();
  const device = await pairDevice(service, ownerId, {
    capabilities: ["screen", "camera", "camera"],
    commands: ["screen.capture", "camera.snap"],
  });
  const stored = await findPairedDevice(device.id);
  assert.deepEqual(stored?.capabilities, ["camera", "screen"]);
  assert.deepEqual(stored?.commands, ["camera.snap", "screen.capture"]);
  assert.ok(stored?.advertisedAt instanceof Date);
  assert.deepEqual(stored?.scopes, ["read", "write"], "descriptive capabilities do not widen authorization");
});

test("paired reconnect replaces descriptive capability metadata without changing scopes", async () => {
  const changed: number[] = [];
  let now = Date.now();
  const service = new DevicePairingService({ now: () => now, onChange: (userId) => changed.push(userId) });
  const device = await pairDevice(service, ownerId, {
    capabilities: ["camera"],
    commands: ["camera.snap"],
  });
  changed.length = 0;
  now += 5_000;

  const accepted = await service.authenticate({
    params: await device.connectParams("nonce-update", {
      signedAt: now,
      capabilities: ["screen"],
      commands: ["screen.capture"],
    }),
    nonce: "nonce-update",
    remoteAddress: "10.0.0.5",
  });
  assert.equal(accepted.kind, "accept");
  const stored = await findPairedDevice(device.id);
  assert.deepEqual(stored?.capabilities, ["screen"]);
  assert.deepEqual(stored?.commands, ["screen.capture"]);
  assert.deepEqual(stored?.scopes, ["read", "write"]);
  assert.equal(stored?.advertisedAt?.getTime(), now);
  assert.deepEqual(changed, [ownerId], "surface changes invalidate the owner's existing devices view");
});

test("capability or command tampering after signing is rejected", async () => {
  const service = new DevicePairingService();
  const device = await pairDevice(service, ownerId, {
    capabilities: ["camera"],
    commands: ["camera.snap"],
  });
  const params = await device.connectParams("nonce-tamper", {
    capabilities: ["camera"],
    commands: ["camera.snap"],
  });
  const tamperedCaps = {
    ...params,
    device: { ...params.device!, capabilities: ["camera", "screen"] },
  };
  const capsDecision = await service.authenticate({
    params: tamperedCaps,
    nonce: "nonce-tamper",
    remoteAddress: "10.0.0.55",
  });
  assert.equal(capsDecision.kind === "reject" ? capsDecision.error.code : null, "UNAUTHORIZED");

  const tamperedCommands = {
    ...params,
    device: { ...params.device!, commands: ["camera.snap", "system.run"] },
  };
  const commandDecision = await service.authenticate({
    params: tamperedCommands,
    nonce: "nonce-tamper",
    remoteAddress: "10.0.0.56",
  });
  assert.equal(commandDecision.kind === "reject" ? commandDecision.error.code : null, "UNAUTHORIZED");
});

test("a proof is bound to the nonce, the client, the time and the key; replays and forgeries are rejected", async () => {
  const service = new DevicePairingService();
  const device = await pairDevice(service, ownerId);
  const reject = async (params: GatewayConnectParams, nonce: string) => {
    const decision = await service.authenticate({ params, nonce, remoteAddress: "10.0.0.6" });
    assert.equal(decision.kind, "reject");
    return decision.kind === "reject" ? decision.error.code : null;
  };
  // replayed signature under a different nonce
  assert.equal(await reject(await device.connectParams("old-nonce"), "new-nonce"), "UNAUTHORIZED");
  // signature made for another client id
  const forgedClient = await device.connectParams("n", { clientId: "phone" });
  assert.equal(await reject({ ...forgedClient, client: { ...forgedClient.client, id: "attacker-app" } }, "n"), "UNAUTHORIZED");
  // stale signing time (replay or clock far off)
  assert.equal(await reject(await device.connectParams("n", { signedAt: Date.now() - 10 * 60_000 }), "n"), "UNAUTHORIZED");
  // someone else's key claiming this device's id
  const thief = await newDevice();
  const stolen = await thief.connectParams("n");
  assert.equal(await reject({ ...stolen, device: { ...stolen.device!, id: device.id } }, "n"), "UNAUTHORIZED");
  // an unknown (never paired) key with a perfectly valid proof
  assert.equal(await reject(await thief.connectParams("n"), "n"), "UNAUTHORIZED");
  // no proof at all
  const { device: _omit, ...bare } = await device.connectParams("n");
  assert.equal(await reject(bare, "n"), "UNAUTHORIZED");
});

test("tokens are single use, expire after five minutes, and only the issuing owner can approve", async () => {
  let now = 1_000_000;
  const service = new DevicePairingService({ now: () => now });
  const first = await newDevice();
  const { pairingToken } = service.createPairingToken({ id: ownerId, organizationId: null });
  const request = await service.authenticate({ params: await first.connectParams("n", { pairingToken, signedAt: now }), nonce: "n", remoteAddress: "10.0.0.7" });
  assert.equal(request.kind, "pending");

  const second = await newDevice();
  const reuse = await service.authenticate({ params: await second.connectParams("n2", { pairingToken, signedAt: now }), nonce: "n2", remoteAddress: "10.0.0.7" });
  assert.equal(reuse.kind, "reject", "a used token cannot pair a second device");

  const [pending] = service.listPending(ownerId);
  assert.deepEqual(service.listPending(otherId), []);
  await assert.rejects(service.approve(otherId, pending!.pairingId), /no longer available/);
  assert.throws(() => service.deny(otherId, pending!.pairingId), /no longer available/);
  service.deny(ownerId, pending!.pairingId);
  if (request.kind === "pending") assert.equal(await request.resolution, "denied");
  assert.equal(await findPairedDevice(first.id), null, "a denied device is never stored");

  const expiring = service.createPairingToken({ id: ownerId, organizationId: null });
  now += 5 * 60_000 + 1;
  const late = await newDevice();
  const expired = await service.authenticate({ params: await late.connectParams("n3", { pairingToken: expiring.pairingToken, signedAt: now }), nonce: "n3", remoteAddress: "10.0.0.7" });
  assert.equal(expired.kind, "reject");
});

test("revocation stops the device from authenticating, and a revoked key cannot be paired again", async () => {
  const service = new DevicePairingService();
  const device = await pairDevice(service, ownerId);
  assert.equal(await revokePairedDevice(otherId, device.id), false, "another user cannot revoke it");
  assert.equal(await revokePairedDevice(ownerId, device.id), true);
  assert.equal(await revokePairedDevice(ownerId, device.id), false);
  const after = await service.authenticate({ params: await device.connectParams("n"), nonce: "n", remoteAddress: "10.0.0.8" });
  assert.equal(after.kind, "reject");
  if (after.kind === "reject") assert.equal(after.error.code, "FORBIDDEN");
  assert.ok(!(await listActivePairedDevices(ownerId)).some((row) => row.id === device.id));

  const { pairingToken } = service.createPairingToken({ id: ownerId, organizationId: null });
  const again = await service.authenticate({ params: await device.connectParams("n2", { pairingToken }), nonce: "n2", remoteAddress: "10.0.0.8" });
  assert.equal(again.kind, "reject", "the revoked key stays known and cannot re-pair silently");
});

test("a locked owner account stops its devices, and repeated failures from one address are rate limited", async () => {
  const service = new DevicePairingService();
  const device = await pairDevice(service, otherId);
  await getDb().update(users).set({ lockedUntil: new Date(Date.now() + 3_600_000) }).where(eq(users.id, otherId));
  const locked = await service.authenticate({ params: await device.connectParams("n"), nonce: "n", remoteAddress: "10.0.0.9" });
  assert.equal(locked.kind, "reject");
  await getDb().update(users).set({ lockedUntil: null }).where(eq(users.id, otherId));

  const limited = new DevicePairingService();
  const stranger = await newDevice();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const decision = await limited.authenticate({ params: await stranger.connectParams("n"), nonce: "n", remoteAddress: "192.0.2.1" });
    assert.equal(decision.kind === "reject" ? decision.error.code : null, "UNAUTHORIZED");
  }
  const blocked = await limited.authenticate({ params: await stranger.connectParams("n"), nonce: "n", remoteAddress: "192.0.2.1" });
  assert.equal(blocked.kind === "reject" ? blocked.error.code : null, "RATE_LIMITED");
  const otherAddress = await limited.authenticate({ params: await stranger.connectParams("n"), nonce: "n", remoteAddress: "192.0.2.2" });
  assert.equal(otherAddress.kind === "reject" ? otherAddress.error.code : null, "UNAUTHORIZED", "limits are per address");
});

test("concurrent uses of one pairing code produce exactly one pending request", async () => {
  const service = new DevicePairingService();
  const a = await newDevice();
  const b = await newDevice();
  const { pairingToken } = service.createPairingToken({ id: ownerId, organizationId: null });
  const params = await Promise.all([a.connectParams("a", { pairingToken }), b.connectParams("b", { pairingToken })]);
  const decisions = await Promise.all(params.map((value, index) => service.authenticate({
    params: value, nonce: index === 0 ? "a" : "b", remoteAddress: "192.0.2.10",
  })));
  assert.deepEqual(decisions.map((decision) => decision.kind).sort(), ["pending", "reject"]);
  const [pending] = service.listPending(ownerId);
  assert.equal(service.listPending(ownerId).length, 1);
  service.deny(ownerId, pending!.pairingId);
});

test("pending approval expires with the original code and cannot be approved after expiry", async () => {
  let now = Date.now();
  const service = new DevicePairingService({ now: () => now });
  const device = await newDevice();
  const code = service.createPairingToken({ id: ownerId, organizationId: null });
  now += 4 * 60_000;
  const decision = await service.authenticate({
    params: await device.connectParams("n", { pairingToken: code.pairingToken, signedAt: now }),
    nonce: "n", remoteAddress: "192.0.2.11",
  });
  assert.equal(decision.kind, "pending");
  if (decision.kind !== "pending") throw new Error("Expected pending pairing");
  assert.equal(decision.pending.expiresAt, code.expiresAt);
  now += 60_001;
  await assert.rejects(service.approve(ownerId, decision.pending.pairingId), /no longer available/);
  assert.equal(await decision.resolution, "expired");
  assert.equal(await findPairedDevice(device.id), null);
});

test("failed approval persistence resolves the waiting device as denied", async () => {
  const service = new DevicePairingService();
  const device = await newDevice();
  const code = service.createPairingToken({ id: ownerId, organizationId: null });
  const decision = await service.authenticate({
    params: await device.connectParams("n", { pairingToken: code.pairingToken }),
    nonce: "n", remoteAddress: "192.0.2.12",
  });
  if (decision.kind !== "pending") throw new Error("Expected pending pairing");
  // A conflicting record appears while the owner is deciding; the unique key insertion must fail safely.
  await insertPairedDevice({ id: device.id, ownerUserId: ownerId, organizationId: null, name: "Existing", platform: "test", publicKey: device.publicKey });
  await assert.rejects(service.approve(ownerId, decision.pending.pairingId));
  assert.equal(await decision.resolution, "denied");
  assert.deepEqual(service.listPending(ownerId), []);
});

test("disabled accounts and password-change requirements block paired devices", async () => {
  const service = new DevicePairingService();
  const device = await pairDevice(service, otherId);
  for (const restriction of [{ active: false }, { mustChangePassword: true }]) {
    await getDb().update(users).set(restriction).where(eq(users.id, otherId));
    const decision = await service.authenticate({
      params: await device.connectParams("n"), nonce: "n", remoteAddress: "192.0.2.13",
    });
    assert.equal(decision.kind === "reject" ? decision.error.code : null, "FORBIDDEN");
    await getDb().update(users).set({ active: true, mustChangePassword: false }).where(eq(users.id, otherId));
  }
});

test("authentication failure tracking is bounded and frees capacity after expiry", async () => {
  let now = Date.now();
  const service = new DevicePairingService({ now: () => now });
  const unknown = await newDevice();
  const params = await unknown.connectParams("n", { signedAt: now });
  for (let address = 0; address < 1024; address += 1) {
    const result = await service.authenticate({ params, nonce: "n", remoteAddress: `peer-${address}` });
    assert.equal(result.kind === "reject" ? result.error.code : null, "UNAUTHORIZED");
  }
  const full = await service.authenticate({ params, nonce: "n", remoteAddress: "next-peer" });
  assert.equal(full.kind === "reject" ? full.error.code : null, "RATE_LIMITED");
  now += 60_001;
  const recovered = await service.authenticate({ params: await unknown.connectParams("n", { signedAt: now }), nonce: "n", remoteAddress: "next-peer" });
  assert.equal(recovered.kind === "reject" ? recovered.error.code : null, "UNAUTHORIZED");
});
