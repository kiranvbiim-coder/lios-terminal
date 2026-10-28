import assert from "node:assert/strict";
import test from "node:test";
import { requestTelegramGetUpdates, TelegramPollRefusal, type TelegramPollRequest } from "./telegramNetworkBroker";

const poll: TelegramPollRequest = { offset: 17, allowedUpdates: ["message", "edited_message"] };
const publicAddress = async () => ({ address: "149.154.167.220", family: 4 as const });
const token = "123456:synthetic_test_only";
const refusal = (code: TelegramPollRefusal["code"]) => (error: unknown) => error instanceof TelegramPollRefusal && error.code === code;

test("malformed/destructive polling requests cannot resolve secrets or attempt networking", async () => {
  let accesses = 0;
  for (const candidate of [{ ...poll, offset: -1 }, { ...poll, timeoutSeconds: 41 }, { ...poll, allowedUpdates: ["message", "message"] }, { ...poll, url: "https://attacker.invalid" }]) {
    await assert.rejects(requestTelegramGetUpdates({ poll: candidate, assertAuthorized: () => { accesses++; }, resolveBotToken: () => { accesses++; return token; } }), refusal("invalid_request"));
  }
  assert.equal(accesses, 0);
});

test("revocation after DNS or secret lookup prevents physical dispatch", async () => {
  for (const boundary of ["dns", "secret"] as const) {
    let current = true, dispatched = 0;
    await assert.rejects(requestTelegramGetUpdates({ poll,
      assertAuthorized: () => { if (!current) throw new Error("account revoked"); },
      resolveBotToken: () => { if (boundary === "secret") current = false; return token; },
      dependencies: {
        resolveAddress: async () => { if (boundary === "dns") current = false; return publicAddress(); },
        requester: async () => { dispatched++; throw new Error("must not dispatch"); },
      },
    }), refusal("unauthorized"));
    assert.equal(dispatched, 0);
  }
});

test("revocation during HTTP withholds the response from canonical adoption", async () => {
  let current = true;
  await assert.rejects(requestTelegramGetUpdates({ poll,
    assertAuthorized: () => { if (!current) throw new Error("revoked"); }, resolveBotToken: () => token,
    dependencies: { resolveAddress: publicAddress, requester: async () => { current = false; return { status: 200, headers: {}, body: Buffer.from("PRIVATE-UPDATE") }; } },
  }), refusal("unauthorized"));
});

test("cancellation bounds a blocked secret lookup and a late result cannot dispatch", async () => {
  const controller = new AbortController(), entered = Promise.withResolvers<void>(), secret = Promise.withResolvers<string>();
  let dispatched = 0;
  const pending = requestTelegramGetUpdates({ poll, signal: controller.signal,
    assertAuthorized: () => {}, resolveBotToken: () => { entered.resolve(); return secret.promise; },
    dependencies: { resolveAddress: publicAddress, requester: async () => { dispatched++; throw new Error("not reached"); } },
  });
  const rejected = assert.rejects(pending, refusal("cancelled"));
  await entered.promise;
  controller.abort("SECRET-ABORT-REASON");
  await rejected;
  secret.resolve(token);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(dispatched, 0);
});

test("one absolute polling deadline aborts body work without extending the general P13 timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = Promise.withResolvers<void>();
  let aborted = false;
  const pending = requestTelegramGetUpdates({ poll, assertAuthorized: () => {}, resolveBotToken: () => token,
    dependencies: { resolveAddress: publicAddress, requester: async input => {
      input.signal!.addEventListener("abort", () => { aborted = true; }, { once: true });
      entered.resolve();
      return new Promise(() => {});
    } },
  });
  const rejected = assert.rejects(pending, refusal("timeout"));
  await entered.promise;
  t.mock.timers.tick(45_000);
  await rejected;
  assert.equal(aborted, true);
});

test("raw token-bearing transport failures and causes never escape Home polling", async () => {
  const privateDetail = `https://api.telegram.org/bot${token}/getUpdates private-provider-detail`;
  await assert.rejects(requestTelegramGetUpdates({ poll, assertAuthorized: () => {}, resolveBotToken: () => token,
    dependencies: { resolveAddress: publicAddress, requester: async () => { throw new Error(privateDetail); } },
  }), error => {
    assert.ok(error instanceof TelegramPollRefusal);
    assert.equal(error.code, "unavailable");
    assert.equal(error.stack?.includes(token), false);
    assert.equal(error.message.includes("private-provider-detail"), false);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("the body bound cannot be bypassed by an internal requester replacement", async () => {
  await assert.rejects(requestTelegramGetUpdates({ poll, assertAuthorized: () => {}, resolveBotToken: () => token,
    dependencies: { resolveAddress: publicAddress, requester: async () => ({ status: 200, headers: {}, body: Buffer.alloc(4 * 1024 * 1024 + 1) }) },
  }), refusal("response_too_large"));
});

test("the synchronous authority fence closes the final asynchronous-admission microtask window", async () => {
  let current = true, admissions = 0, dispatched = 0;
  await assert.rejects(requestTelegramGetUpdates({ poll, resolveBotToken: () => token,
    assertAuthorized: async () => {
      admissions++;
      if (admissions === 3) queueMicrotask(() => { current = false; });
      return () => { if (!current) throw new Error("authority revision changed after lookup"); };
    },
    dependencies: { resolveAddress: publicAddress, requester: async () => { dispatched++; return { status: 200, headers: {}, body: Buffer.from("{}") }; } },
  }), refusal("unauthorized"));
  assert.equal(dispatched, 0);
});
