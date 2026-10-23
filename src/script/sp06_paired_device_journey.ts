/**
 * Manual SP-06 target probe. Requires an operator-launched, disposable
 * installed LiOS Home, an owner session, and the Home's real pinned device
 * listener. Never uploads evidence or reads production secrets from disk.
 *
 * npm run acceptance:sp06-device-local
 *
 * Env: LIOS_SP06_DISPOSABLE_HOME=1, LIOS_SP06_HOME_ORIGIN,
 * LIOS_SP06_DEVICE_WSS_URL, LIOS_SP06_TLS_FINGERPRINT,
 * LIOS_SP06_PROJECT_ID, LIOS_SP06_APP_BINARY, LIOS_SP06_TARGET_COMMIT,
 * LIOS_SP06_OWNER_COOKIE, optional LIOS_SP06_EVIDENCE_PATH.
 *
 * This proves a local operator-linked installed target journey; it does NOT
 * certify native physical mobile hardware, binary-to-server process binding,
 * signing/notarization, SP-06 as a whole or P14.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { GatewayClient } from "../client/src/lib/gateway/gatewayClient";
import { createDeviceIdentity } from "../client/src/lib/gateway/deviceIdentity";
import { createPinnedDeviceSocket } from "../server/pinnedDeviceSocket";
import { assertSp06HomeIdentity, parseSp06Target } from "./sp06_paired_device_contract";

const target = parseSp06Target(process.env);
const binarySha256 = createHash("sha256").update(fs.readFileSync(target.appBinary)).digest("hex");
const label = "SP06 " + randomUUID();
const clientInfo = { id: "lios-sp06-target-probe", version: "1", platform: "node", mode: "test" as const };
const transport = createPinnedDeviceSocket(target.fingerprint);
const checks: string[] = [];
const clients: GatewayClient[] = [];
let deviceId = "";
let workflowId = "";
let homeId = "";
let ownerIdentity: Awaited<ReturnType<typeof createDeviceIdentity>>["identity"] | null = null;
const wait = async (condition: () => boolean, label: string, maxMs = 20_000) => {
  const until = Date.now() + maxMs;
  while (!condition()) {
    if (Date.now() > until) throw new Error("SP-06 check timed out: " + label);
    await new Promise(resolve => setTimeout(resolve, 80));
  }
};
async function api<T>(endpoint: string, method = "GET", body?: unknown, csrf?: string): Promise<{ status: number; value: T }> {
  const res = await fetch(target.origin + endpoint, {
    method,
    headers: {
      Cookie: target.cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await res.json() as T;
  return { status: res.status, value };
}
function makeClient(identity: NonNullable<typeof ownerIdentity>) {
  const c = new GatewayClient({
    url: target.wssUrl, WebSocketImpl: transport, clientInfo,
    scopes: ["read", "write"], device: { identity },
    reconnect: { initialMs: 300, maxMs: 600, multiplier: 2, jitter: 0 },
  });
  clients.push(c);
  return c;
}
async function run(csrf: string): Promise<{ notification: { id: string; status: string }; run: { status: string } }> {
  const r = await api<{ notification: { id: string; status: string }; run: { status: string } }>(
    "/api/projects/" + target.projectId + "/automation/workflows/" + encodeURIComponent(workflowId) + "/run",
    "POST", {}, csrf,
  );
  assert.equal(r.status, 409, "the deliberately missing Chat must refuse, not run AI or tools");
  assert.equal(r.value.run?.status, "failed");
  assert.equal(r.value.notification?.status, "delivered");
  return r.value;
}
async function main() {
  const current = await api<{ role: string; email: string }>("/api/auth/me");
  assert.equal(current.status, 200, "current owner session required");
  const listed = await api<{ canPair: boolean; network: { enabled: boolean; fingerprint: string; homeId: string; port: number } }>("/api/devices");
  assert.equal(listed.status, 200);
  assert.equal(listed.value.canPair, true, "the signed-in account must own this Home");
  homeId = assertSp06HomeIdentity(target, listed.value.network);
  checks.push("owner-home-session-and-pin");
  const token = await api<{ token: string }>("/api/security/csrf");
  assert.equal(token.status, 200);
  const csrf = token.value.token;
  try {
    const created = await createDeviceIdentity();
    ownerIdentity = created.identity;
    deviceId = created.identity.id;
    const invitation = await api<{ pairingToken: string }>(
      "/api/devices/pairing", "POST", {}, csrf,
    );
    assert.equal(invitation.status, 201);
    let pairingId = "";
    let decision = "";
    const newDevice = new GatewayClient({
      url: target.wssUrl, WebSocketImpl: transport, clientInfo,
      scopes: ["read", "write"], device: {
        identity: created.identity,
        pairing: { token: invitation.value.pairingToken, deviceName: "SP06 disposable probe" },
        capabilities: ["notifications.read", "arbitrary.command.advertisement"],
        commands: ["arbitrary.command.advertisement"],
      },
    });
    clients.push(newDevice);
    newDevice.onPairing(x => { pairingId = x.pairingId; });
    newDevice.onPairingResolved(x => { decision = x; });
    newDevice.start();
    await wait(() => !!pairingId, "signed TLS-pinned pairing request");
    const approval = await api<{ ok: boolean }>(
      "/api/devices/pairing/" + encodeURIComponent(pairingId) + "/approve", "POST", {}, csrf,
    );
    assert.equal(approval.status, 200);
    await wait(() => !!decision, "actual owner pairing approval");
    assert.equal(decision, "approved");
    checks.push("ed25519-owner-approved-pairing");

    const device = makeClient(created.identity);
    let hints = 0;
    device.onEvent("data.invalidate", event => { if (event.topics.includes("notifications")) hints++; });
    device.start();
    await wait(() => device.state === "ready", "signed device connection");
    assert.equal(device.hello?.auth.deviceId, deviceId);
    checks.push("fresh-signed-device-session");

    const createdWorkflow = await api<{ id: string }>(
      "/api/projects/" + target.projectId + "/automation/workflows", "POST", {
        name: label, template: "custom", enabled: true,
        trigger: { type: "manual" },
        action: { kind: "conversation_rerun", chatId: 2_000_000_000,
          request: { message: "SP06 disposable fail-closed device probe" } },
        notificationPolicy: { enabled: true, channels: ["in_app"], notifyOn: ["failure"],
          cooldownMinutes: 0, suppressUnchanged: false, minimumRelevanceScore: 0 },
      }, csrf,
    );
    assert.equal(createdWorkflow.status, 201);
    workflowId = createdWorkflow.value.id;
    const first = await run(csrf);
    await wait(() => hints === 1, "committed notification hint");
    const listed = await device.request("notifications.list", { projectId: target.projectId });
    assert.equal(listed.notifications.some(n => n.id === first.notification.id), true);
    checks.push("durable-p9-notification-and-content-free-event");

    const acknowledged = await device.request("notifications.read.replay", {
      homeId, userId: Number.NaN, deviceId, projectId: target.projectId, notificationId: first.notification.id,
    }).catch(() => null);
    // The HTTP owner session does not disclose its canonical numeric ID.
    // A forged device read-replay must fail rather than guessed identity.
    assert.equal(acknowledged, null);
    checks.push("no-guessed-device-acknowledgement");
    device.stop();
    const offline = await run(csrf);
    const reconnected = makeClient(created.identity);
    let recoveredHints = 0;
    reconnected.onEvent("data.invalidate", event => { if (event.topics.includes("notifications")) recoveredHints++; });
    reconnected.start();
    await wait(() => reconnected.state === "ready", "fresh WSS reconnect");
    assert.equal(reconnected.hello?.auth.deviceId, deviceId);
    const recovered = await reconnected.request("notifications.list", { projectId: target.projectId });
    assert.equal(recovered.notifications.some(n => n.id === offline.notification.id), true);
    assert.equal(recoveredHints, 0, "offline push must be reconciled, not replayed");
    checks.push("offline-notification-recovery");

    const revoked = await api<{ ok: boolean }>("/api/devices/" + deviceId, "DELETE", undefined, csrf);
    assert.equal(revoked.status, 200);
    await wait(() => reconnected.state !== "ready", "device revocation disconnect");
    const hintCount = recoveredHints;
    await run(csrf);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(recoveredHints, hintCount, "revoked device must not receive follow-up notifications");
    checks.push("live-device-revocation");
  } finally {
    for (const c of clients) c.stop();
    if (deviceId) await api("/api/devices/" + deviceId, "DELETE", undefined, csrf).catch(() => {});
    if (workflowId) await api("/api/projects/" + target.projectId + "/automation/workflows/" + encodeURIComponent(workflowId), "DELETE", undefined, csrf).catch(() => {});
  }
}
try {
  await main();
  const evidence = {
    schemaVersion: 1, qualification: "sp06-local-operator-target-probe", passed: true,
    sourceCommitClaim: target.appCommit,
    executablePath: target.appBinary,
    executableSha256: binarySha256,
    recordedAt: new Date().toISOString(),
    checks, connection: { homeId, tlsFingerprint: target.fingerprint, transport: "WSS-pinned" },
    limitations: ["operator-supplied executable/process link not cryptographically verified",
      "disposable operator-started local Home only", "no physical mobile client or packaged P14 signoff"],
  };
  fs.writeFileSync(target.evidencePath, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log("SP-06 local installed-target device probe passed; sanitized evidence written to " + target.evidencePath);
} catch (error) {
  console.error("SP-06 target probe FAILED: " + (error instanceof Error ? error.message.replaceAll(target.cookie, "[redacted]") : "unknown error"));
  process.exitCode = 1;
}
