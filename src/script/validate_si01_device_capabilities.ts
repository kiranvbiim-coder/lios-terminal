import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-si01-device-capabilities-v2-"));
process.env.HOME = path.join(base, "user");
process.env.LIOS_DATA_ROOT = path.join(base, "home");
delete process.env.DATABASE_URL;
fs.mkdirSync(process.env.HOME, { recursive: true });

const { closeDb, getDb, initDb } = await import("../server/db");
const { DevicePairingService } = await import("../server/devicePairingService");
const { findPairedDevice, toDeviceRecord } = await import("../server/deviceStore");
const {
  buildDeviceProofPayload,
  deviceIdFromPublicKey,
  normalizeDeviceCapabilityAdvertisement,
  toBase64Url,
} = await import("../shared/devicePairing");
const { gatewayConnectParamsSchema } = await import("../shared/gatewayProtocol");
const { users } = await import("../shared/schema");

async function run(): Promise<void> {
  try {
    await initDb();
    const [owner] = await getDb().insert(users).values({
      email: "si01-device-owner@example.test",
      passwordHash: "x",
      role: "client_admin",
      name: "SI-01 device owner",
      active: true,
    }).returning();
    assert.ok(owner);

    const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
    const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey)));
    const deviceId = await deviceIdFromPublicKey(publicKey);

    async function params(
      nonce: string,
      surfaceInput: { capabilities?: string[]; commands?: string[] },
      pairingToken?: string,
    ) {
      const signedAt = Date.now();
      const surface = normalizeDeviceCapabilityAdvertisement(surfaceInput);
      const client = { id: "si01-node", version: "1", platform: "macos", mode: "service" as const };
      const payload = buildDeviceProofPayload({
        deviceId,
        clientId: client.id,
        clientMode: client.mode,
        scopes: ["read", "write"],
        signedAt,
        nonce,
        pairingToken: pairingToken ?? "",
        ...surface,
      });
      const signature = toBase64Url(new Uint8Array(
        await crypto.subtle.sign("Ed25519", keyPair.privateKey, new TextEncoder().encode(payload)),
      ));
      return gatewayConnectParamsSchema.parse({
        minProtocol: 1,
        maxProtocol: 1,
        client,
        scopes: ["read", "write"],
        device: { id: deviceId, publicKey, signature, signedAt, ...surface },
        ...(pairingToken ? { pairing: { token: pairingToken, deviceName: "Owner Mac node" } } : {}),
      });
    }

    const changes: number[] = [];
    const service = new DevicePairingService({ onChange: (userId) => changes.push(userId) });
    const pairing = service.createPairingToken({ id: owner.id, organizationId: null });
    const first = await service.authenticate({
      params: await params("pair-nonce", {
        capabilities: ["screen", "camera", "camera"],
        commands: ["screen.capture", "camera.snap"],
      }, pairing.pairingToken),
      nonce: "pair-nonce",
      remoteAddress: "127.0.0.1",
    });
    assert.equal(first.kind, "pending");
    if (first.kind !== "pending") throw new Error("expected pending pairing");

    const pending = service.listPending(owner.id);
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0]?.capabilities, ["camera", "screen"]);
    assert.deepEqual(pending[0]?.commands, ["camera.snap", "screen.capture"]);
    await service.approve(owner.id, pending[0]!.pairingId);
    assert.equal(await first.resolution, "approved");

    let stored = await findPairedDevice(deviceId);
    assert.ok(stored);
    assert.deepEqual(stored.capabilities, ["camera", "screen"]);
    assert.deepEqual(stored.commands, ["camera.snap", "screen.capture"]);
    assert.deepEqual(stored.scopes, ["read", "write"]);
    const firstAdvertisedAt = stored.advertisedAt?.getTime() ?? 0;
    assert.ok(firstAdvertisedAt > 0);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const reconnect = await service.authenticate({
      params: await params("reconnect-nonce", {
        capabilities: ["files", "screen"],
        commands: ["files.read", "screen.capture"],
      }),
      nonce: "reconnect-nonce",
      remoteAddress: "127.0.0.1",
    });
    assert.equal(reconnect.kind, "accept");

    stored = await findPairedDevice(deviceId);
    assert.ok(stored);
    assert.deepEqual(stored.capabilities, ["files", "screen"]);
    assert.deepEqual(stored.commands, ["files.read", "screen.capture"]);
    assert.deepEqual(stored.scopes, ["read", "write"], "advertisement never grants authorization");
    assert.ok((stored.advertisedAt?.getTime() ?? 0) >= firstAdvertisedAt);

    const ownerRecord = toDeviceRecord(stored);
    assert.deepEqual(ownerRecord.capabilities, ["files", "screen"]);
    assert.deepEqual(ownerRecord.commands, ["files.read", "screen.capture"]);
    assert.ok(ownerRecord.advertisedAt);
    assert.ok(changes.filter((id) => id === owner.id).length >= 3, "pair request, approval and surface change are observable");

    console.log("SI-01.09 V2 signed device capability advertisement: PASS");
  } finally {
    await closeDb().catch(() => undefined);
    fs.rmSync(base, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
