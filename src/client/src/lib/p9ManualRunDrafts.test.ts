import test from "node:test";
import assert from "node:assert/strict";
import type { AuthSessionState } from "@shared/identityContracts";
import {
  clearP9ManualRunDrafts,
  discardP9ManualRunDraft,
  listP9ManualRunDrafts,
  prepareP9ManualRunConfirmation,
  saveP9ManualRunDraft,
  setP9ManualRunDraftOwner,
  subscribeP9ManualRunDrafts,
} from "./p9ManualRunDrafts";

const WORKFLOW = "workflow:550e8400-e29b-41d4-a716-446655440000";
const SECOND = "workflow:550e8400-e29b-41d4-a716-446655440001";
const REVISION = "2026-10-15T12:00:00.000Z";
const PREFIX = "lios.p9-manual-run-draft.v1.";

function session(userId = 11, state: AuthSessionState["state"] = "authenticated_online"): AuthSessionState {
  return {
    version: 1, state,
    principal: {
      version: 1, kind: "human", userId, organizationId: 22,
      email: `user${userId}@example.test`, name: "Example", role: "client_user", audience: "client",
    },
    restoredAt: REVISION, reason: state === "authenticated_online" ? null : "offline",
  };
}
const key = (userId = 11) => `${PREFIX}${userId}.22`;
const okIdentity = (userId = 11) => new Response(
  JSON.stringify({ authState: session(userId) }), { status: 200 },
);
const workflows = (id = WORKFLOW, updatedAt = REVISION) => new Response(JSON.stringify([
  { id, projectId: 7, updatedAt, name: "Governed workflow", enabled: true },
]), { status: 200 });

async function withBrowser<T>(
  fn: (ctx: {
    data: Map<string, string>;
    offline(): void;
    denyWrites(): void;
    posted: string[];
  }) => Promise<T>,
): Promise<T> {
  const names = ["window", "localStorage", "navigator"] as const;
  const prior = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const data = new Map<string, string>();
  const posted: string[] = [];
  let connected = true;
  let deny = false;
  const listeners = new Map<string, Set<() => void>>();
  const win = {
    addEventListener(name: string, listener: () => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener(name: string, listener: () => void) { listeners.get(name)?.delete(listener); },
    dispatchEvent(event: Event) { for (const cb of listeners.get(event.type) ?? []) cb(); return true; },
  };
  const storage = {
    getItem(name: string) { return data.get(name) ?? null; },
    setItem(name: string, value: string) {
      if (deny) throw new Error("Storage quota denied");
      data.set(name, value);
    },
    removeItem(name: string) {
      if (deny) throw new Error("Storage removal denied");
      data.delete(name);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => ({ onLine: connected }) });
  setP9ManualRunDraftOwner(session());
  try {
    return await fn({
      data, posted, offline: () => { connected = false; },
      denyWrites: () => { deny = true; },
    });
  } finally {
    setP9ManualRunDraftOwner(null);
    for (const [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("SI-06.22 offline manual draft is inert, identifier-only and requires explicit fresh confirmation", async () => {
  await withBrowser(async ({ data, posted }) => {
    setP9ManualRunDraftOwner(session(11, "authenticated_offline"));
    assert.equal(saveP9ManualRunDraft(7, WORKFLOW, REVISION), true);
    assert.equal(saveP9ManualRunDraft(7, WORKFLOW, REVISION), true);
    assert.equal(listP9ManualRunDrafts(7).length, 1);
    assert.doesNotMatch(data.get(key()) ?? "", /conversation|providerSecret|prompt|authorization/i);

    let calls = 0;
    assert.equal(await prepareP9ManualRunConfirmation(7, WORKFLOW, async () => {
      calls += 1; throw new Error("offline must never fetch");
    }), false);
    assert.equal(calls, 0);
    assert.equal(listP9ManualRunDrafts(7).length, 1);

    setP9ManualRunDraftOwner(session());
    const allowed = await prepareP9ManualRunConfirmation(7, WORKFLOW, async (url, options) => {
      posted.push(url);
      assert.equal(options?.credentials, "same-origin");
      assert.equal(options?.cache, "no-store");
      return url === "/api/auth/me" ? okIdentity() : workflows();
    });
    assert.equal(allowed, true);
    assert.deepEqual(posted, ["/api/auth/me", "/api/projects/7/automation/workflows"],
      "preflight never dispatches execution; a separate human-confirmed UI handler must do so");
    assert.equal(listP9ManualRunDrafts(7).length, 0);
    assert.equal(await prepareP9ManualRunConfirmation(7, WORKFLOW, async () => {
      throw new Error("consumed draft must not be retried");
    }), false);
  });
});

test("SI-06.22 a different account cannot inspect or confirm another owner's manual drafts", async () => {
  await withBrowser(async ({ data }) => {
    assert.equal(saveP9ManualRunDraft(7, WORKFLOW, REVISION), true);
    setP9ManualRunDraftOwner(session(12));
    assert.equal(listP9ManualRunDrafts(7).length, 0);
    assert.equal(await prepareP9ManualRunConfirmation(7, WORKFLOW, async () => {
      throw new Error("must not contact provider");
    }), false);
    assert.equal(saveP9ManualRunDraft(7, SECOND, REVISION), true);
    assert.equal(data.has(key(11)), true);
    assert.equal(data.has(key(12)), true);
    clearP9ManualRunDrafts();
    assert.equal(data.has(key(12)), false);
    assert.equal(data.has(key(11)), true);
    setP9ManualRunDraftOwner(session());
    assert.equal(listP9ManualRunDrafts(7)[0]?.workflowId, WORKFLOW);
    setP9ManualRunDraftOwner({ ...session(), state: "revoked", reason: "revoked" });
    assert.deepEqual(listP9ManualRunDrafts(), []);
    assert.equal(saveP9ManualRunDraft(7, WORKFLOW, REVISION), false);
  });
});

test("SI-06.22 server identity mismatch, permission failure and changed workflow revision block confirmation", async () => {
  await withBrowser(async () => {
    saveP9ManualRunDraft(7, WORKFLOW, REVISION);
    const mismatch = await prepareP9ManualRunConfirmation(7, WORKFLOW, async () => okIdentity(12));
    assert.equal(mismatch, false);
    assert.equal(listP9ManualRunDrafts(7).length, 1);
    const forbidden = await prepareP9ManualRunConfirmation(7, WORKFLOW, async (url) =>
      url === "/api/auth/me" ? okIdentity() : new Response("Forbidden", { status: 403 }));
    assert.equal(forbidden, false);
    const changed = await prepareP9ManualRunConfirmation(7, WORKFLOW, async (url) =>
      url === "/api/auth/me" ? okIdentity() : workflows(WORKFLOW, "2026-10-15T12:01:00.000Z"));
    assert.equal(changed, false, "offline approval must not survive changed action/revision");
    const deleted = await prepareP9ManualRunConfirmation(7, WORKFLOW, async (url) =>
      url === "/api/auth/me" ? okIdentity() : workflows(SECOND));
    assert.equal(deleted, false);
    assert.equal(listP9ManualRunDrafts(7).length, 1);
  });
});

test("SI-06.22 pending preflight aborts on identity change, logout or revoked authentication", async () => {
  await withBrowser(async () => {
    saveP9ManualRunDraft(7, WORKFLOW, REVISION);
    let resolve!: (value: Response) => void;
    const pendingResponse = new Promise<Response>((res) => { resolve = res; });
    const check = prepareP9ManualRunConfirmation(7, WORKFLOW, async () => pendingResponse);
    setP9ManualRunDraftOwner(session(12));
    resolve(okIdentity());
    assert.equal(await check, false);
    assert.deepEqual(listP9ManualRunDrafts(7), []);
    setP9ManualRunDraftOwner(session());
    assert.equal(listP9ManualRunDrafts(7).length, 1);
    setP9ManualRunDraftOwner(null);
    assert.equal(await prepareP9ManualRunConfirmation(7, WORKFLOW, async () => {
      throw new Error("never fetch while signed out");
    }), false);
  });
});

test("SI-06.22 duplicate confirmations cannot prepare two submissions of one draft", async () => {
  await withBrowser(async () => {
    saveP9ManualRunDraft(7, WORKFLOW, REVISION);
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    let calls = 0;
    const fetcher = async (url: string) => {
      calls += 1;
      return url === "/api/auth/me" ? pending : workflows();
    };
    const first = prepareP9ManualRunConfirmation(7, WORKFLOW, fetcher);
    const second = prepareP9ManualRunConfirmation(7, WORKFLOW, fetcher);
    assert.equal(await second, false, "a second click cannot duplicate a manual request");
    release(okIdentity());
    assert.equal(await first, true);
    assert.equal(calls, 2);
    assert.equal(listP9ManualRunDrafts(7).length, 0);
  });
});

test("SI-06.22 malformed/expired drafts and failed device writes cannot claim execution readiness", async () => {
  await withBrowser(async ({ data, denyWrites, offline }) => {
    data.set(key(), JSON.stringify([
      { projectId: 7, workflowId: WORKFLOW, expectedUpdatedAt: REVISION, queuedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 },
      { projectId: 7, workflowId: "POST /admin", expectedUpdatedAt: REVISION, queuedAt: Date.now() },
      null,
    ]));
    assert.deepEqual(listP9ManualRunDrafts(7), []);
    assert.equal(saveP9ManualRunDraft(0, WORKFLOW, REVISION), false);
    assert.equal(saveP9ManualRunDraft(7, "workflow:../../danger", REVISION), false);
    assert.equal(saveP9ManualRunDraft(7, WORKFLOW, "not-a-date"), false);
    assert.equal(saveP9ManualRunDraft(7, WORKFLOW, REVISION), true);
    const events: number[] = [];
    const detach = subscribeP9ManualRunDrafts(() => events.push(listP9ManualRunDrafts().length));
    try {
      offline();
      assert.equal(await prepareP9ManualRunConfirmation(7, WORKFLOW, async () => {
        throw new Error("offline must not attempt server preflight");
      }), false);
      denyWrites();
      assert.equal(saveP9ManualRunDraft(7, SECOND, REVISION), false);
      assert.equal(discardP9ManualRunDraft(7, WORKFLOW), false);
      assert.equal(listP9ManualRunDrafts(7).length, 1);
      assert.deepEqual(events, [], "storage failure never emits a fake success event");
    } finally {
      detach();
    }
  });
});
