import assert from "node:assert/strict";
import test from "node:test";
import {
  deliverP9DesktopNotifications,
  sanitizeP9DesktopNotificationText,
  type P9DesktopNotificationPort,
} from "./p9DesktopNotifications";

function port(permission: P9DesktopNotificationPort["permission"] = "granted") {
  const delivered = new Set<string>();
  const shown: Array<{ id: string; title: string; body: string }> = [];
  const adapter: P9DesktopNotificationPort = {
    permission,
    claimDelivery: (id) => {
      if (delivered.has(id)) return "duplicate";
      delivered.add(id);
      return "claimed";
    },
    show: (notification) => { shown.push(notification); },
  };
  return { adapter, delivered, shown };
}

const canonical = {
  id: "workflow-notification:1",
  status: "delivered" as const,
  title: "Material change detected",
  body: "Three new source changes were found.",
};

test("SI-06 desktop delivery projects only canonical delivered P9 notifications", async () => {
  const { adapter, shown } = port();
  const result = await deliverP9DesktopNotifications([
    canonical,
    { ...canonical, id: "workflow-notification:2", status: "suppressed" as const },
  ], adapter);
  assert.equal(result.delivered, 1);
  assert.equal(result.suppressed, 1);
  assert.deepEqual(shown.map((item) => item.id), ["workflow-notification:1"]);
});

test("SI-06 desktop delivery is durable-idempotent through the canonical notification id", async () => {
  const { adapter, shown } = port();
  await deliverP9DesktopNotifications([canonical], adapter);
  const second = await deliverP9DesktopNotifications([canonical], adapter);
  assert.equal(second.duplicate, 1);
  assert.equal(shown.length, 1);
});

test("SI-06 desktop delivery does not fail the workflow when OS notifications are unavailable", async () => {
  const denied = port("denied");
  const result = await deliverP9DesktopNotifications([canonical], denied.adapter);
  assert.deepEqual(result, {
    delivered: 0,
    duplicate: 0,
    suppressed: 0,
    unavailable: 1,
    failed: 0,
  });
  assert.equal(denied.shown.length, 0);
  assert.equal(denied.delivered.size, 0);
});

test("SI-06 desktop notification text is capped and credential-shaped content is redacted", () => {
  const raw = "Provider failed with api_key=super-secret-token-value and Authorization: Bearer abcdefghijklmnopqrstuvwxyz " + "x".repeat(500);
  const safe = sanitizeP9DesktopNotificationText(raw, 240);
  assert.ok(safe.length <= 240);
  assert.doesNotMatch(safe, /super-secret-token-value/);
  assert.doesNotMatch(safe, /abcdefghijklmnopqrstuvwxyz/);
  assert.match(safe, /\[REDACTED\]/);
});

test("SI-06 desktop delivery reserves the canonical id before OS show so a failure cannot duplicate after restart", async () => {
  const { adapter, delivered } = port();
  adapter.show = () => { throw new Error("OS notification service unavailable"); };
  const first = await deliverP9DesktopNotifications([canonical], adapter);
  const second = await deliverP9DesktopNotifications([canonical], adapter);
  assert.equal(first.failed, 1);
  assert.equal(second.duplicate, 1);
  assert.deepEqual([...delivered], [canonical.id]);
});

test("SI-06 desktop delivery refuses to show when durable local dedupe state cannot be persisted", async () => {
  const { adapter, shown } = port();
  adapter.claimDelivery = () => "unavailable";
  const result = await deliverP9DesktopNotifications([canonical], adapter);
  assert.equal(result.unavailable, 1);
  assert.equal(shown.length, 0);
});
