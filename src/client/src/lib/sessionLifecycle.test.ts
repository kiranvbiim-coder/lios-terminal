import assert from "node:assert/strict";
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

test("cancelled restoration rejects promptly and does not start an already cancelled request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Promise(() => {}); };
  const pending = restoreSession("/me", { fetcher, signal: controller.signal });
  controller.abort(new Error("View unmounted"));
  await assert.rejects(pending, /View unmounted/);
  await assert.rejects(restoreSession("/me", { fetcher, signal: controller.signal }), /View unmounted/);
  assert.equal(calls, 1);
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
