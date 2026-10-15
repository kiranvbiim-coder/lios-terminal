import assert from "node:assert/strict";
import { inspect } from "node:util";
import test from "node:test";
import { restoreSession, signOutSession } from "./sessionLifecycle";

const identity = { email: "analyst@example.test", role: "client", name: "Analyst", mustChangePassword: false, offline: true };
const respond = (status: number, body: unknown = identity): typeof fetch => async () => new Response(JSON.stringify(body), { status });

test("session restoration preserves server identity and offline metadata", async () => {
  assert.deepEqual(await restoreSession("/me", { fetcher: respond(200) }), identity);
});

test("only an explicit 401 is a signed-out state", async () => {
  assert.equal(await restoreSession("/me", { fetcher: respond(401) }), null);
  for (const status of [403, 429, 500, 503]) {
    await assert.rejects(restoreSession("/me", { fetcher: respond(status) }), /restore your session/);
  }
});

test("invalid successful responses do not enter an authenticated workspace", async () => {
  for (const body of [null, {}, { ...identity, role: null }, { ...identity, mustChangePassword: "false" }]) {
    await assert.rejects(restoreSession("/me", { fetcher: respond(200, body) }), /incomplete session/);
  }
  await assert.rejects(restoreSession("/me", { fetcher: async () => new Response("<html>proxy failure</html>") }));
});

test("unreachable service is an error, not an expired session", async () => {
  await assert.rejects(restoreSession("/me", { fetcher: async () => { throw new TypeError("Failed to fetch"); } }), /Failed to fetch/);
});

test("a stalled session request times out even when the transport ignores abort", async () => {
  let requestSignal: AbortSignal | undefined;
  const fetcher: typeof fetch = async (_, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise(() => {});
  };
  await assert.rejects(restoreSession("/me", { fetcher, timeoutMs: 10 }), /too long/);
  assert.equal(requestSignal?.aborted, true);
});

test("deadline covers a stalled response body as well as headers", async () => {
  const fetcher: typeof fetch = async () => new Response(new ReadableStream());
  await assert.rejects(restoreSession("/me", { fetcher, timeoutMs: 10 }), /too long/);
});

function assertSafeCancellation(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "Session request cancelled.");
  assert.equal(Object.hasOwn(error, "cause"), false);
  for (const value of [String(error), inspect(error), JSON.stringify(error), error.stack ?? ""]) {
    assert.equal(value.includes("PRIVATE_REFRESH_TOKEN"), false);
  }
  return true;
}

test("cancelled restoration rejects promptly without exposing a caller-provided private reason", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Promise(() => {}); };
  const pending = restoreSession("/me", { fetcher, signal: controller.signal });
  controller.abort(new Error("PRIVATE_REFRESH_TOKEN"));
  await assert.rejects(pending, assertSafeCancellation);
  await assert.rejects(restoreSession("/me", { fetcher, signal: controller.signal }), assertSafeCancellation);
  assert.equal(calls, 1, "pre-aborted restoration cannot dispatch the network request");
});

test("sign-out accepts acknowledgement or an already expired session", async () => {
  for (const status of [200, 204, 401]) {
    let method: string | undefined;
    await signOutSession("/logout", { fetcher: async (_, init) => {
      method = init?.method;
      return new Response(null, { status });
    } });
    assert.equal(method, "POST");
  }
});

test("rejected, unreachable and stalled sign-out never report success", async () => {
  for (const status of [403, 429, 500, 503]) {
    await assert.rejects(signOutSession("/logout", { fetcher: respond(status) }), /confirm sign-out/);
  }
  await assert.rejects(signOutSession("/logout", { fetcher: async () => { throw new Error("offline"); } }), /offline/);
  await assert.rejects(signOutSession("/logout", { fetcher: async () => new Promise(() => {}), timeoutMs: 10 }), /too long/);
});

test("SI-07.19 sign-out cancellation also sanitizes private AbortSignal reasons", async () => {
  const controller = new AbortController();
  let dispatched = 0;
  const fetcher: typeof fetch = async () => {
    dispatched += 1;
    return new Promise(() => {});
  };
  const pending = signOutSession("/logout", { fetcher, signal: controller.signal });
  controller.abort({ refreshToken: "PRIVATE_REFRESH_TOKEN", secret: "PRIVATE_REFRESH_TOKEN" });
  await assert.rejects(pending, assertSafeCancellation);
  await assert.rejects(signOutSession("/logout", { fetcher, signal: controller.signal }), assertSafeCancellation);
  assert.equal(dispatched, 1, "pre-aborted sign-out cannot dispatch another POST");
});

test("SI-07.19 deadline error stays actionable and never propagates the underlying abort reason", async () => {
  let recorded: AbortSignal | undefined;
  const fetcher: typeof fetch = async (_url, init) => {
    recorded = init?.signal ?? undefined;
    return new Promise(() => {});
  };
  await assert.rejects(
    restoreSession("/me", { fetcher, timeoutMs: 10 }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "LiOS took too long to respond. Please retry.");
      assert.doesNotMatch(inspect(error), /PRIVATE_REFRESH_TOKEN/);
      return true;
    },
  );
  assert.equal(recorded?.aborted, true);
});

test("SI-07.19 a pre-cancelled request creates neither a fetch nor a dangling deadline timer", async (t) => {
  const scheduled = t.mock.method(globalThis, "setTimeout");
  const controller = new AbortController();
  controller.abort("PRIVATE_REFRESH_TOKEN");
  let calls = 0;
  await assert.rejects(restoreSession("/me", {
    signal: controller.signal,
    fetcher: async () => { calls++; return new Response("{}"); },
  }), assertSafeCancellation);
  assert.equal(calls, 0);
  assert.equal(scheduled.mock.callCount(), 0);
});

test("SI-07.19 transient service failures remain errors, never interpreted as explicit sign-out", async () => {
  const neverLoggedOut = await restoreSession("/me", { fetcher: respond(401) });
  assert.equal(neverLoggedOut, null);
  for (const status of [429, 502, 503]) {
    await assert.rejects(restoreSession("/me", { fetcher: respond(status) }), /restore your session/);
    await assert.rejects(signOutSession("/logout", { fetcher: respond(status) }), /confirm sign-out/);
  }
});
