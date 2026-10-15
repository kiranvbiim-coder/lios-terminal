import assert from "node:assert/strict";
import test from "node:test";
import type { AuthSessionState } from "@shared/identityContracts";
import {
  setNotificationReadOutboxOwner,
  queueNotificationRead,
  pendingNotificationReadCount,
  replayNotificationReads,
  clearNotificationReadOutbox,
} from "./p9NotificationReadOutbox";

const NOTIFICATION = "550e8400-e29b-41d4-a716-446655440099";
const SECOND = "550e8400-e29b-41d4-a716-446655440098";
const PREFIX = "lios.p9-notification-read-outbox.v1.";
const key = (user: number) => `${PREFIX}${user}.17`;
function session(userId = 11, state: AuthSessionState["state"] = "authenticated_online"): AuthSessionState {
  return {
    version: 1, state,
    principal: {
      version: 1, kind: "human", userId, organizationId: 17, email: `user${userId}@example.test`,
      name: "Example User", role: "client_user", audience: "client",
    },
    restoredAt: "2026-10-15T09:00:00.000Z", reason: state === "authenticated_online" ? null : "unavailable",
  };
}

async function inBrowser<T>(
  fn: (state: { items: Map<string, string>; denyWrites: () => void; offline: () => void }) => Promise<T>,
): Promise<T> {
  const names = ["window", "localStorage", "navigator"] as const;
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const items = new Map<string, string>();
  let denied = false;
  let connected = true;
  const storage = {
    getItem(k: string) { return items.get(k) ?? null; },
    setItem(k: string, value: string) {
      if (denied) throw new Error("quota exhausted");
      items.set(k, value);
    },
    removeItem(k: string) {
      if (denied) throw new Error("storage mutation denied");
      items.delete(k);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => ({ onLine: connected }) });
  setNotificationReadOutboxOwner(session());
  try {
    return await fn({ items, denyWrites: () => { denied = true; }, offline: () => { connected = false; } });
  } finally {
    setNotificationReadOutboxOwner(null);
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("SI-06.22 queued read receipts contain identifiers only, dedupe and replay via fresh owner check", async () => {
  await inBrowser(async ({ items }) => {
    assert.equal(queueNotificationRead(7, NOTIFICATION), true);
    assert.equal(queueNotificationRead(7, NOTIFICATION), true);
    assert.equal(queueNotificationRead(7, SECOND), true);
    assert.equal(pendingNotificationReadCount(), 2);
    assert.doesNotMatch(items.get(key(11)) ?? "", /secret|notification.body|workflow.definition/);

    const urls: string[] = [];
    const result = await replayNotificationReads(async (url, init) => {
      urls.push(url);
      if (url === "/api/auth/me") {
        assert.equal(init?.cache, "no-store");
        return new Response(JSON.stringify({ authState: session() }), { status: 200 });
      }
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "same-origin");
      return new Response("{}", { status: 200 });
    });
    assert.deepEqual(result, { confirmed: 2, remaining: 0, blocked: false });
    assert.deepEqual(urls, [
      "/api/auth/me",
      `/api/projects/7/automation/notifications/${NOTIFICATION}/read`,
      `/api/projects/7/automation/notifications/${SECOND}/read`,
    ]);
    assert.equal(pendingNotificationReadCount(), 0);
    assert.equal(items.has(key(11)), false);
  });
});

test("SI-06.22 never replays for a changed owner or offline/unauthenticated session", async () => {
  await inBrowser(async ({ items, offline }) => {
    assert.equal(queueNotificationRead(5, NOTIFICATION), true);
    setNotificationReadOutboxOwner(session(12));
    assert.equal(pendingNotificationReadCount(), 0);
    assert.equal(queueNotificationRead(5, SECOND), true);
    assert.equal(items.has(key(11)), true);
    let requests = 0;
    const mismatched = await replayNotificationReads(async () => {
      requests += 1;
      return new Response(JSON.stringify({ authState: session(11) }), { status: 200 });
    });
    assert.equal(mismatched.blocked, true);
    assert.equal(requests, 1, "only identity confirmation is permitted");
    assert.equal(pendingNotificationReadCount(), 1);
    offline();
    const offlineResult = await replayNotificationReads(async () => {
      throw new Error("offline must not attempt a request");
    });
    assert.equal(offlineResult.blocked, true);
    setNotificationReadOutboxOwner({ ...session(), state: "revoked", reason: "revoked" });
    assert.equal(pendingNotificationReadCount(), 0);
    assert.equal(queueNotificationRead(5, NOTIFICATION), false);
  });
});

test("SI-06.22 server authorization failure leaves receipt queued and stops further POSTs", async () => {
  await inBrowser(async () => {
    queueNotificationRead(8, NOTIFICATION);
    queueNotificationRead(8, SECOND);
    const urls: string[] = [];
    const blocked = await replayNotificationReads(async (url) => {
      urls.push(url);
      return url === "/api/auth/me"
        ? new Response(JSON.stringify({ authState: session() }), { status: 200 })
        : new Response("forbidden", { status: 403 });
    });
    assert.deepEqual(blocked, { confirmed: 0, remaining: 2, blocked: true });
    assert.equal(urls.length, 2);
  });
});

test("SI-06.22 corrupted, expired or malformed local intents are ignored", async () => {
  await inBrowser(async ({ items }) => {
    const stale = Date.now() - 8 * 24 * 60 * 60 * 1000;
    items.set(key(11), JSON.stringify([
      { projectId: 3, notificationId: NOTIFICATION, queuedAt: stale },
      { projectId: 0, notificationId: NOTIFICATION, queuedAt: Date.now() },
      { projectId: 3, notificationId: "not-a-uuid", queuedAt: Date.now() },
      null,
    ]));
    assert.equal(pendingNotificationReadCount(), 0);
    assert.equal(queueNotificationRead(3, "unsafe/path"), false);
    assert.equal(queueNotificationRead(-1, NOTIFICATION), false);
    items.set(key(11), "{bad-json");
    assert.equal(pendingNotificationReadCount(), 0);
    assert.equal(queueNotificationRead(3, NOTIFICATION), true);
    assert.equal(pendingNotificationReadCount(), 1);
  });
});

test("SI-06.22 storage denial refuses to claim a queued receipt or a completed clear", async () => {
  await inBrowser(async ({ items, denyWrites }) => {
    assert.equal(queueNotificationRead(4, NOTIFICATION), true);
    denyWrites();
    assert.equal(queueNotificationRead(4, SECOND), false);
    clearNotificationReadOutbox();
    assert.equal(items.has(key(11)), true, "blocked removal must not fabricate a successful clear");
    assert.equal(pendingNotificationReadCount(), 1);
  });
});

test("SI-06.22 simultaneous replay calls share one verified attempt", async () => {
  await inBrowser(async () => {
    queueNotificationRead(3, NOTIFICATION);
    let calls = 0;
    let release!: (response: Response) => void;
    const verify = new Promise<Response>((resolve) => { release = resolve; });
    const fetcher = async (url: string) => {
      calls += 1;
      return url === "/api/auth/me"
        ? verify
        : new Response("{}", { status: 200 });
    };
    const first = replayNotificationReads(fetcher);
    const second = replayNotificationReads(fetcher);
    release(new Response(JSON.stringify({ authState: session() }), { status: 200 }));
    const [one, two] = await Promise.all([first, second]);
    assert.deepEqual(one, two);
    assert.equal(calls, 2, "one session recheck and one POST, not two replays");
  });
});
