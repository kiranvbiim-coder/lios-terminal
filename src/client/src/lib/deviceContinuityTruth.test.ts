import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { GatewayState } from "./gateway/gatewayClient";
import type { DeviceNetworkStatus } from "@shared/deviceNetwork";
import {
  advertisedDeviceCapabilities,
  describeDeviceContinuity,
  deviceNetworkChangeReview,
  rememberedHomeChangeReview,
  pairedDeviceRevocationReview,
} from "./deviceContinuityTruth";

const network: DeviceNetworkStatus = {
  enabled: false, discoverable: false, discovering: false,
  name: "Private Home", port: null, urls: [], fingerprint: null, homeId: null,
};

test("offline and disconnected states do not invent Home, paired-device reachability or execution", () => {
  const ready = describeDeviceContinuity("ready", true);
  assert.equal(ready.state, "online");
  assert.match(ready.consequence, /Individual paired devices.*verification/);
  const offline = describeDeviceContinuity("ready", false);
  assert.equal(offline.state, "offline");
  assert.match(offline.consequence, /Do not resubmit approvals/);
  for (const state of ["connecting", "reconnecting"] as GatewayState[]) {
    const waiting = describeDeviceContinuity(state, true);
    assert.equal(waiting.state, "reconnecting");
    assert.match(waiting.consequence, /unknown outcomes/);
    assert.match(waiting.consequence, /Never auto-retry/);
  }
  for (const state of ["idle", "pairing", "stopped", "failed"] as GatewayState[]) {
    assert.equal(describeDeviceContinuity(state, true).state, "unknown");
  }
  assert.equal(describeDeviceContinuity("idle", null).state, "unknown");
});

test("paired and pending device capabilities are advertisements, never runtime authorization or verified health", () => {
  const shown = advertisedDeviceCapabilities({
    capabilities: ["filesystem.read", "node.finance"],
    commands: ["diagnose", "finance.compute"],
  });
  assert.match(shown.label, /Advertised capabilities:/);
  assert.match(shown.label, /declared commands:/);
  assert.match(shown.caveat, /not a permission grant/);
  assert.match(shown.caveat, /live runtime health/);
  const empty = advertisedDeviceCapabilities({ capabilities: [], commands: [] });
  assert.match(empty.label, /none declared/);
  assert.ok(!shown.caveat.includes("Ready to run"));
});

test("device network exposure, local Home preference and revocation have distinct effects", () => {
  const enabling = deviceNetworkChangeReview(network, true);
  assert.match(enabling, /device-only TLS listener/);
  assert.match(enabling, /trusted LAN/);
  assert.match(enabling, /not the web\/REST API/);
  const disabling = deviceNetworkChangeReview({ ...network, enabled: true }, false);
  assert.match(disabling, /does not revoke paired device records/);
  assert.match(disabling, /cannot be assumed cancelled/);

  const switchMessage = rememberedHomeChangeReview({ homeId: "private-home", name: "Research Home" });
  assert.match(switchMessage, /locally selected Home/);
  assert.match(switchMessage, /does not establish a TLS connection/);
  assert.match(switchMessage, /not.*retry a pending action/);

  const revocation = pairedDeviceRevocationReview({ id: "a".repeat(32), name: "Laptop" });
  assert.match(revocation, /Revoke "Laptop"/);
  assert.match(revocation, /offline device may not receive a push notice/);
  assert.match(revocation, /future access is refused on server verification/);
  assert.match(revocation, /Already completed remote actions cannot be undone/);
});

test("existing device Settings screen is explicit about scope and uses original owner-restricted endpoints", () => {
  const source = readFileSync(new URL("../components/settings/DevicesSettings.tsx", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../../../server/deviceRoutes.ts", import.meta.url), "utf8");
  const outbox = readFileSync(new URL("./p9NotificationReadOutbox.ts", import.meta.url), "utf8");
  for (const attribute of [
    "device-home-continuity-status", "device-read-outbox-count",
    "device-network-review", "device-home-switch-review", "device-pairing-review",
  ]) assert.ok(source.includes(`data-testid="${attribute}"`), attribute);

  assert.match(source, /useGatewayState\(\)/);
  assert.match(source, /describeDeviceContinuity\(gatewayState, browserOnline\)/);
  assert.match(source, /pendingNotificationReadCount\(\)/);
  assert.match(source, /Advertised capabilities|advertisedDeviceCapabilities\(device\)/);
  assert.match(source, /advertisedDeviceCapabilities\(request\)/);
  assert.match(source, /requestNetworkReview\(!networkEnabled,/);
  assert.match(source, /requestNetworkReview\(true, !networkDiscoverable\)/);
  assert.match(source, /setHomeReview\(home.homeId\)/);
  assert.match(source, /Confirm local Home selection/);
  assert.match(source, /Confirm pairing approval/);
  assert.match(source, /pairedDeviceRevocationReview\(device\)/);
  assert.match(source, /Revoking…/);
  assert.match(source, /Paired device revoked by the Home/);

  assert.match(routes, /app.delete\("\/api\/devices\/:deviceId", requireAuth/);
  assert.match(routes, /gatewayHub.disconnectDevice\(id.data\)/);
  assert.match(routes, /app.put\("\/api\/devices\/network", requireHomeOwner/);
  assert.match(routes, /app.post\("\/api\/devices\/pairing\/:pairingId\/approve", requireHomeOwner/);
  assert.match(outbox, /Only|only offline-replayable P9 operation/);
  assert.match(outbox, /setNotificationReadOutboxOwner/);
  assert.match(outbox, /replayNotificationReads/);
  assert.match(outbox, /\/api\/auth\/me/);
  assert.doesNotMatch(source, /replayNotificationReads\(/);
  assert.doesNotMatch(source, /conversation\.start|node\.finance\.run/);
});
