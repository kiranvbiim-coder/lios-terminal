import assert from "node:assert/strict";
import test from "node:test";
import type { AuthSessionState } from "@shared/identityContracts";
import {
  checkP9ManualRunAttempt,
  clearP9ManualRunAttempts,
  discardP9ManualRunAttempt,
  listP9ManualRunAttempts,
  prepareP9ManualRunAttempt,
  setP9ManualRunAttemptOwner,
  subscribeP9ManualRunAttempts,
} from "./p9ManualRunAttemptLedger";

const WORKFLOW = "workflow:550e8400-e29b-41d4-a716-446655440000";
const UUID = "550e8400-e29b-41d4-a716-446655440001";
const OTHER = "550e8400-e29b-41d4-a716-446655440002";
const KEY = "lios.p9-manual-run-receipt-bookmarks.v1.11.22";
const OTHER_KEY = "lios.p9-manual-run-receipt-bookmarks.v1.12.22";

function session(userId = 11, state: AuthSessionState["state"] = "authenticated_online"): AuthSessionState {
  return {
    version: 1, state,
    principal: {
      version: 1, kind: "human", userId, organizationId: 22, email: `user${userId}@example.test`,
      name: "Example", role: "client_user", audience: "client",
    },
    restoredAt: "2026-10-15T09:00:00.000Z",
    reason: state === "authenticated_online" ? null : "offline",
  };
}

function identity(userId = 11): Response {
  return new Response(JSON.stringify({ authState: session(userId) }), { status: 200 });
}
function receipt(status: "completed" | "in_progress" = "completed") {
  return new Response(JSON.stringify({
    receiptStatus: status, run: {
      id: "workflow-run:550e8400-e29b-41d4-a716-446655440099",
      workflowId: WORKFLOW, projectId: 7,
    },
  }), { status: 200 });
}

async function browser<T>(fn: (ctx: {
  data: Map<string, string>;
  denyWrite(): void;
  disconnect(): void;
}) => Promise<T>): Promise<T> {
  const names = ["window", "localStorage", "navigator"] as const;
  const old = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const data = new Map<string, string>();
  const callbacks = new Map<string, Set<() => void>>();
  let connected = true;
  let deny = false;
  const win = {
    addEventListener(event: string, cb: () => void) {
      if (!callbacks.has(event)) callbacks.set(event, new Set());
      callbacks.get(event)!.add(cb);
    },
    removeEventListener(event: string, cb: () => void) { callbacks.get(event)?.delete(cb); },
    dispatchEvent(event: Event) {
      for (const cb of callbacks.get(event.type) ?? []) cb();
      return true;
    },
  };
  const storage = {
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) {
      if (deny) throw new Error("quota denied");
      data.set(key, value);
    },
    removeItem(key: string) {
      if (deny) throw new Error("removal denied");
      data.delete(key);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => ({ onLine: connected }) });
  setP9ManualRunAttemptOwner(session());
  try {
    return await fn({ data, denyWrite: () => { deny = true; }, disconnect: () => { connected = false; } });
  } finally {
    setP9ManualRunAttemptOwner(null);
    for (const [name, descriptor] of old) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("SI-06.22 request key survives account session restore and reconciles with GET only", async () => {
  await browser(async ({ data }) => {
    assert.equal(prepareP9ManualRunAttempt(7, WORKFLOW, UUID), true);
    assert.equal(prepareP9ManualRunAttempt(7, WORKFLOW, UUID), true);
    assert.equal(listP9ManualRunAttempts(7).length, 1);
    assert.doesNotMatch(data.get(KEY) ?? "", /prompt|secret|credential|token|action/i);

    // Simulate JS module owner disarming/rearming after a browser restart:
    // persistent data remains, and there is no implicit POST.
    setP9ManualRunAttemptOwner(null);
    setP9ManualRunAttemptOwner(session());
    assert.deepEqual(listP9ManualRunAttempts().map(row => row.requestKey), [UUID]);
    const urls: string[] = [];
    const found = await checkP9ManualRunAttempt(7, WORKFLOW, UUID, async (url, init) => {
      urls.push(url);
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.method, undefined, "both recovery requests must be read-only");
      return url === "/api/auth/me" ? identity() : receipt();
    });
    assert.equal(found.state, "completed");
    assert.deepEqual(urls, [
      "/api/auth/me",
      `/api/projects/7/automation/workflows/${encodeURIComponent(WORKFLOW)}/manual-requests/${UUID}`,
    ]);
    assert.equal(listP9ManualRunAttempts(7).length, 0);
  });
});

test("SI-06.22 other account and offline/revoked user cannot inspect or reconcile a saved attempt", async () => {
  await browser(async ({ data, disconnect }) => {
    assert.equal(prepareP9ManualRunAttempt(7, WORKFLOW, UUID), true);
    setP9ManualRunAttemptOwner(session(12));
    assert.equal(listP9ManualRunAttempts().length, 0);
    assert.equal(await checkP9ManualRunAttempt(7, WORKFLOW, UUID, async () => {
      throw new Error("must not fetch other owner's attempt");
    }).then(x => x.state), "blocked");
    assert.equal(prepareP9ManualRunAttempt(7, WORKFLOW, OTHER), true);
    assert.equal(data.has(KEY), true);
    assert.equal(data.has(OTHER_KEY), true);
    clearP9ManualRunAttempts();
    assert.equal(data.has(KEY), true, "another account's history must not be destroyed");
    setP9ManualRunAttemptOwner(session());
    disconnect();
    assert.equal((await checkP9ManualRunAttempt(7, WORKFLOW, UUID)).state, "blocked");
    setP9ManualRunAttemptOwner({ ...session(), state: "revoked", reason: "revoked" });
    assert.equal(listP9ManualRunAttempts().length, 0);
    assert.equal(prepareP9ManualRunAttempt(7, WORKFLOW, OTHER), false);
  });
});

test("SI-06.22 404, authorization denial and uncertain transport retain the original key without POST retry", async () => {
  await browser(async () => {
    assert.equal(prepareP9ManualRunAttempt(7, WORKFLOW, UUID), true);
    const notYet = await checkP9ManualRunAttempt(7, WORKFLOW, UUID, async url =>
      url === "/api/auth/me" ? identity() : new Response("missing", { status: 404 }));
    assert.equal(notYet.state, "unconfirmed");
    const forbidden = await checkP9ManualRunAttempt(7, WORKFLOW, UUID, async url =>
      url === "/api/auth/me" ? identity() : new Response("denied", { status: 403 }));
    assert.equal(forbidden.state, "blocked");
    const mismatch = await checkP9ManualRunAttempt(7, WORKFLOW, UUID, async () => identity(12));
    assert.equal(mismatch.state, "blocked");
    const timedOut = await checkP9ManualRunAttempt(7, WORKFLOW, UUID, async url => {
      if (url === "/api/auth/me") return identity();
      throw new TypeError("connection reset");
    });
    assert.equal(timedOut.state, "unconfirmed");
    assert.equal(listP9ManualRunAttempts().length, 1);
    assert.equal(listP9ManualRunAttempts()[0].requestKey, UUID);
  });
});

test("SI-06.22 running server receipt remains available for later read-only status polling", async () => {
  await browser(async () => {
    prepareP9ManualRunAttempt(7, WORKFLOW, UUID);
    const live = await checkP9ManualRunAttempt(7, WORKFLOW, UUID, async url =>
      url === "/api/auth/me" ? identity() : receipt("in_progress"));
    assert.equal(live.state, "in_progress");
    assert.equal(listP9ManualRunAttempts().length, 1);
    const completed = await checkP9ManualRunAttempt(7, WORKFLOW, UUID, async url =>
      url === "/api/auth/me" ? identity() : receipt("completed"));
    assert.equal(completed.state, "completed");
    assert.equal(listP9ManualRunAttempts().length, 0);
  });
});

test("SI-06.22 owner switching during async verification prevents cross-account receipt processing", async () => {
  await browser(async () => {
    prepareP9ManualRunAttempt(7, WORKFLOW, UUID);
    let release!: (response: Response) => void;
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    let requests = 0;
    const pending = checkP9ManualRunAttempt(7, WORKFLOW, UUID, async () => {
      requests += 1;
      return delayed;
    });
    assert.equal((await checkP9ManualRunAttempt(7, WORKFLOW, UUID)).state, "blocked",
      "concurrent verification cannot be duplicated");
    setP9ManualRunAttemptOwner(session(12));
    release(identity());
    assert.equal((await pending).state, "blocked");
    assert.equal(requests, 1);
    setP9ManualRunAttemptOwner(session());
    assert.equal(listP9ManualRunAttempts().length, 1);
  });
});

test("SI-06.22 unavailable storage never permits a new untraceable execution", async () => {
  await browser(async ({ data, denyWrite }) => {
    const signals: number[] = [];
    const unsubscribe = subscribeP9ManualRunAttempts(() => signals.push(listP9ManualRunAttempts().length));
    try {
      assert.equal(prepareP9ManualRunAttempt(7, WORKFLOW, UUID), true);
      assert.deepEqual(signals, [1]);
      denyWrite();
      assert.equal(prepareP9ManualRunAttempt(7, WORKFLOW, OTHER), false);
      assert.equal(discardP9ManualRunAttempt(7, WORKFLOW, UUID), false);
      assert.equal(data.has(KEY), true);
      assert.deepEqual(signals, [1], "denied mutation cannot announce an invented success");
    } finally {
      unsubscribe();
    }
  });
});

test("SI-06.22 malformed or expired cached keys are ignored and can never authorize a POST", async () => {
  await browser(async ({ data }) => {
    data.set(KEY, JSON.stringify([
      { projectId: 7, workflowId: WORKFLOW, requestKey: UUID, preparedAt: Date.now() - 100 * 24 * 60 * 60 * 1000 },
      { projectId: 7, workflowId: WORKFLOW, requestKey: "POST /api/admin", preparedAt: Date.now() },
      { projectId: 7, workflowId: "../injected", requestKey: OTHER, preparedAt: Date.now() },
      { projectId: -5, workflowId: WORKFLOW, requestKey: OTHER, preparedAt: Date.now() },
      null,
    ]));
    assert.deepEqual(listP9ManualRunAttempts(), []);
    assert.equal(prepareP9ManualRunAttempt(7, WORKFLOW, "unsafe/path"), false);
    data.set(KEY, "{corrupted");
    assert.deepEqual(listP9ManualRunAttempts(), []);
  });
});
