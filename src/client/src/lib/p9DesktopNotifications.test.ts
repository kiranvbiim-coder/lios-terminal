import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserP9DesktopNotificationPort,
  deliverP9DesktopNotifications,
  sanitizeP9DesktopNotificationText,
  type P9DesktopNotificationPermission,
  type P9DesktopNotificationPort,
} from "./p9DesktopNotifications";

const NOW = new Date("2026-10-15T06:00:00.000Z");

function port(
  permission: P9DesktopNotificationPort["permission"] = "granted",
  requestedPermission: P9DesktopNotificationPermission = "granted",
) {
  const delivered = new Set<string>();
  const shown: Array<{ id: string; title: string; body: string }> = [];
  let permissionRequests = 0;
  const adapter: P9DesktopNotificationPort = {
    permission,
    requestPermission: async () => {
      permissionRequests += 1;
      return requestedPermission;
    },
    claimDelivery: (id) => {
      if (delivered.has(id)) return "duplicate";
      delivered.add(id);
      return "claimed";
    },
    show: (notification) => { shown.push(notification); },
  };
  return { adapter, delivered, shown, permissionRequests: () => permissionRequests };
}

const canonical = {
  id: "workflow-notification:1",
  status: "delivered" as const,
  reason: "change_detected" as const,
  title: "Secret acquisition target changed",
  body: "Confidential target EBITDA changed. api_key=super-secret-token-value",
  createdAt: "2026-10-15T05:59:00.000Z",
  readAt: null,
};

const options = { now: NOW, freshnessMs: 5 * 60_000 };

test("SI-06 desktop delivery projects only canonical delivered P9 notifications", async () => {
  const { adapter, shown } = port();
  const result = await deliverP9DesktopNotifications([
    canonical,
    { ...canonical, id: "workflow-notification:2", status: "suppressed" as const },
  ], adapter, options);
  assert.equal(result.delivered, 1);
  assert.equal(result.suppressed, 1);
  assert.deepEqual(shown.map((item) => item.id), ["workflow-notification:1"]);
});

test("a recent notification already acknowledged on Home never prompts or displays another desktop alert", async () => {
  const { adapter, shown, delivered, permissionRequests } = port("default");
  const result = await deliverP9DesktopNotifications([
    { ...canonical, readAt: NOW.toISOString() },
  ], adapter, options);
  assert.equal(result.delivered, 0);
  assert.deepEqual(shown, []);
  assert.equal(delivered.size, 0);
  assert.equal(permissionRequests(), 0);
});

test("SI-06 desktop popup never copies canonical workflow title/body onto the OS lock screen", async () => {
  const { adapter, shown } = port();
  await deliverP9DesktopNotifications([canonical], adapter, options);
  assert.deepEqual(shown, [{
    id: canonical.id,
    title: "LiOS · Material change detected",
    body: "Open LiOS to review this Project update.",
  }]);
  const serialized = JSON.stringify(shown);
  assert.doesNotMatch(serialized, /Secret acquisition target/i);
  assert.doesNotMatch(serialized, /Confidential target EBITDA/i);
  assert.doesNotMatch(serialized, /super-secret-token-value/i);
});

test("SI-06 desktop delivery baselines historical records instead of replaying them on first upgrade/start", async () => {
  const { adapter, shown, delivered } = port();
  const historical = {
    ...canonical,
    id: "workflow-notification:historical",
    createdAt: "2026-10-15T04:00:00.000Z",
  };
  const result = await deliverP9DesktopNotifications([historical, canonical], adapter, options);
  assert.equal(result.baselined, 1);
  assert.equal(result.delivered, 1);
  assert.deepEqual(shown.map((item) => item.id), [canonical.id]);
  assert.equal(delivered.has(historical.id), true);
});

test("SI-06 desktop delivery fails closed and baselines notifications with invalid timestamps", async () => {
  const { adapter, shown, delivered } = port();
  const invalid = { ...canonical, id: "workflow-notification:invalid-time", createdAt: "not-a-date" };
  const result = await deliverP9DesktopNotifications([invalid], adapter, options);
  assert.equal(result.baselined, 1);
  assert.equal(shown.length, 0);
  assert.equal(delivered.has(invalid.id), true);
});

test("SI-06 desktop delivery is durable-idempotent through the canonical notification id", async () => {
  const { adapter, shown } = port();
  await deliverP9DesktopNotifications([canonical], adapter, options);
  const second = await deliverP9DesktopNotifications([canonical], adapter, options);
  assert.equal(second.duplicate, 1);
  assert.equal(shown.length, 1);
});

test("SI-06 desktop delivery resolves Electron default permission before claiming or showing", async () => {
  const pending = port("default", "granted");
  const result = await deliverP9DesktopNotifications([canonical], pending.adapter, options);
  assert.equal(result.delivered, 1);
  assert.equal(pending.permissionRequests(), 1);
  assert.deepEqual(pending.shown.map((item) => item.id), [canonical.id]);
  assert.equal(pending.delivered.has(canonical.id), true);
});

test("SI-06 desktop delivery leaves canonical id unclaimed when permission request is denied", async () => {
  const pending = port("default", "denied");
  const result = await deliverP9DesktopNotifications([canonical], pending.adapter, options);
  assert.equal(result.unavailable, 1);
  assert.equal(pending.permissionRequests(), 1);
  assert.equal(pending.shown.length, 0);
  assert.equal(pending.delivered.size, 0);
});

test("SI-06 desktop delivery does not fail the workflow when OS notifications are explicitly denied", async () => {
  const denied = port("denied");
  const result = await deliverP9DesktopNotifications([canonical], denied.adapter, options);
  assert.deepEqual(result, {
    delivered: 0,
    duplicate: 0,
    baselined: 0,
    suppressed: 0,
    unavailable: 1,
    failed: 0,
  });
  assert.equal(denied.permissionRequests(), 0);
  assert.equal(denied.shown.length, 0);
  assert.equal(denied.delivered.size, 0);
});

test("SI-06 desktop notification text is byte-capped and credential-shaped content is redacted", () => {
  const raw = "Provider failed with api_key=super-secret-token-value and Authorization: Bearer abcdefghijklmnopqrstuvwxyz " + "x".repeat(500);
  const safe = sanitizeP9DesktopNotificationText(raw, 160);
  assert.ok(new TextEncoder().encode(safe).byteLength <= 160);
  assert.doesNotMatch(safe, /super-secret-token-value/);
  assert.doesNotMatch(safe, /abcdefghijklmnopqrstuvwxyz/);
  assert.match(safe, /\[REDACTED\]/);
});

test("SI-06 desktop notification byte cap does not split Tamil or other multi-byte characters", () => {
  const safe = sanitizeP9DesktopNotificationText("தமிழ் அறிவிப்பு ".repeat(20), 64);
  assert.ok(new TextEncoder().encode(safe).byteLength <= 64);
  assert.doesNotMatch(safe, /�/);
});

test("SI-06 desktop delivery reserves the canonical id before OS show so a failure cannot duplicate after restart", async () => {
  const { adapter, delivered } = port();
  adapter.show = () => { throw new Error("OS notification service unavailable"); };
  const first = await deliverP9DesktopNotifications([canonical], adapter, options);
  const second = await deliverP9DesktopNotifications([canonical], adapter, options);
  assert.equal(first.failed, 1);
  assert.equal(second.duplicate, 1);
  assert.deepEqual([...delivered], [canonical.id]);
});

test("SI-06 desktop delivery refuses to show when durable local dedupe state cannot be persisted", async () => {
  const { adapter, shown } = port();
  adapter.claimDelivery = () => "unavailable";
  const result = await deliverP9DesktopNotifications([canonical], adapter, options);
  assert.equal(result.unavailable, 1);
  assert.equal(shown.length, 0);
});

test("SI-06 browser delivery rechecks persisted ids when concurrent ports claim the same notification", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const storageValues = new Map<string, string>();
  const storage = {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { storageValues.set(key, value); },
  };
  class FakeNotification {
    static permission = "granted";
    static async requestPermission() { return "granted"; }
    constructor(_title: string, _options?: unknown) {}
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      limuriaDesktop: { isElectron: true },
      localStorage: storage,
      Notification: FakeNotification,
    },
  });

  try {
    const first = createBrowserP9DesktopNotificationPort();
    const concurrent = createBrowserP9DesktopNotificationPort();
    assert.equal(first.claimDelivery(canonical.id), "claimed");
    assert.equal(concurrent.claimDelivery(canonical.id), "duplicate");
  } finally {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: originalWindow });
  }
});
