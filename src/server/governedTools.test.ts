import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  GovernedToolApprovalRequiredError,
  GovernedToolDeniedError,
  GovernedToolRegistry,
  decidePermission,
} from "./governedTools";

type Result = { ok: true };
const OK: Result = { ok: true };
const objectSchema = z.record(z.string(), z.unknown());
const resultSchema = z.object({ ok: z.literal(true) });

function registry(permissionClass: "safe_auto" | "user_confirm" | "admin_confirm" | "denied", calls: string[] = []) {
  const tools = new GovernedToolRegistry<"act", Result>();
  tools.register({
    id: "lios.test.tool",
    label: "Test",
    kind: "act",
    permissionClass,
    access: "read",
    sideEffect: "none",
    replaySafe: true,
    inputSchema: objectSchema,
    outputSchema: resultSchema,
    cancel: null,
    invoke: async () => {
      calls.push("invoked");
      return OK;
    },
  });
  return tools;
}

const live = () => new AbortController().signal;

test("a safe_auto tool runs without any approval, and a cancelled signal stops it before and after the call", async () => {
  const calls: string[] = [];
  const tools = registry("safe_auto", calls);
  assert.deepEqual(await tools.invoke("lios.test.tool", {}, live()), OK);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => tools.invoke("lios.test.tool", {}, controller.signal), { name: "AbortError" });
  assert.deepEqual(calls, ["invoked"]);
});

test("an approval-required tool fails closed without an approval and never invokes", async () => {
  const calls: string[] = [];
  const tools = registry("user_confirm", calls);
  await assert.rejects(() => tools.invoke("lios.test.tool", {}, live(), { userId: 7, requestId: "run-1" }), GovernedToolApprovalRequiredError);
  assert.deepEqual(calls, []);
});

test("a denied tool cannot be authorized by client-shaped data", async () => {
  const tools = registry("denied");
  await assert.rejects(
    () => tools.invoke("lios.test.tool", {}, live(), { userId: 7, requestId: "run-1", authorization: { grant: { scope: "once" } } }),
    GovernedToolDeniedError,
  );
});

test("copied, JSON and model authorization-shaped data cannot bypass canonical owner review", async () => {
  const calls: string[] = [];
  const tools = registry("user_confirm", calls);
  const claim = { toolId: "lios.test.tool", userId: 7, grant: { scope: "project" }, expiresAtMs: Date.now() + 5_000 };
  for (const authorization of [claim, { ...claim }, JSON.parse(JSON.stringify(claim)), true, "approved"]) {
    await assert.rejects(
      () => tools.invoke("lios.test.tool", {}, live(), { userId: 7, requestId: "run-1", authorization }),
      GovernedToolApprovalRequiredError,
    );
  }
  assert.deepEqual(calls, []);
});

test("admin_confirm still denies non-administrator calls without canonical authority", async () => {
  await assert.rejects(
    () => registry("admin_confirm").invoke("lios.test.tool", {}, live(), { role: "internal_analyst" }),
    GovernedToolDeniedError,
  );
});

test("registration rejects unsafe external auto-tools and approval-gated tools without schemas", () => {
  const tools = new GovernedToolRegistry<"act", Result>();
  assert.throws(
    () => tools.register({ id: "lios.test.send", label: "Send", kind: "act", permissionClass: "safe_auto", access: "write", sideEffect: "external", replaySafe: false, inputSchema: objectSchema, outputSchema: resultSchema, cancel: null, invoke: async () => OK }),
    /external side effect/,
  );
  assert.throws(
    () => tools.register({ id: " ", label: "x", kind: "act", permissionClass: "safe_auto", access: "read", sideEffect: "none", replaySafe: true, inputSchema: objectSchema, outputSchema: resultSchema, cancel: null, invoke: async () => OK }),
    /id is required/,
  );
  assert.throws(
    () => tools.register({ id: "lios.test.send", label: "Send", kind: "act", permissionClass: "user_confirm", access: "write", sideEffect: "external", replaySafe: false, cancel: null, invoke: async () => OK } as never),
    /input and output schemas/,
  );
  tools.register({ id: "lios.test.send", label: "Send", kind: "act", permissionClass: "user_confirm", access: "write", sideEffect: "external", replaySafe: false, inputSchema: objectSchema, outputSchema: resultSchema, cancel: null, invoke: async () => OK });
  assert.equal(tools.list().length, 1);
});


test("registration requires explicit access, side-effect, replay and cancellation metadata", () => {
  const tools = new GovernedToolRegistry<"act", Result>();
  const base = {
    id: "lios.test.meta",
    label: "Meta",
    kind: "act" as const,
    permissionClass: "safe_auto" as const,
    access: "read" as const,
    sideEffect: "none" as const,
    replaySafe: true,
    inputSchema: objectSchema,
    outputSchema: resultSchema,
    cancel: null,
    invoke: async () => OK,
  };
  for (const field of ["access", "sideEffect", "replaySafe", "inputSchema", "outputSchema", "cancel"] as const) {
    const candidate = { ...base } as Record<string, unknown>;
    delete candidate[field];
    assert.throws(() => tools.register(candidate as never));
  }
});

test("agent calls require declared schemas, validate inputs and bound outputs without echoing invalid values", async () => {
  const calls: string[] = [];
  const tools = new GovernedToolRegistry<"act", Result>();
  tools.register({
    id: "lios.test.typed",
    label: "Typed",
    kind: "act",
    permissionClass: "safe_auto",
    access: "read",
    sideEffect: "none",
    replaySafe: true,
    inputSchema: z.object({ query: z.string().min(1).max(10) }).strict(),
    outputSchema: resultSchema,
    cancel: null,
    invoke: async () => { calls.push("invoked"); return OK; },
  });
  assert.equal(tools.listAgentTools().length, 1);
  await assert.rejects(
    () => tools.invoke("lios.test.typed", { query: "unbounded-secret-content" }, live(), { source: "agent" }),
    (error: Error) => error.name === "GovernedToolInputError" && !error.message.includes("unbounded-secret-content"),
  );
  assert.deepEqual(await tools.invoke("lios.test.typed", { query: "safe" }, live(), { source: "agent" }), OK);
  assert.deepEqual(calls, ["invoked"]);

  const missing = new GovernedToolRegistry<"act", Result>();
  assert.throws(
    () => missing.register({
      id: "lios.test.legacy",
      label: "Legacy",
      kind: "act",
      permissionClass: "safe_auto",
      access: "read",
      sideEffect: "none",
      replaySafe: true,
      cancel: null,
      invoke: async () => OK,
    } as never),
    /input and output schemas/,
  );
  assert.equal(missing.listAgentTools().length, 0);
});

test("agent tool result is validated and bounded before returning to a model", async () => {
  const tools = new GovernedToolRegistry<"act", { ok: true; value?: string }>();
  tools.register({
    id: "lios.test.result",
    label: "Result",
    kind: "act",
    permissionClass: "safe_auto",
    access: "read",
    sideEffect: "none",
    replaySafe: true,
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ ok: z.literal(true), value: z.string().optional() }).strict(),
    maxOutputBytes: 32,
    cancel: null,
    invoke: async () => ({ ok: true, value: "x".repeat(128) }),
  });
  await assert.rejects(
    () => tools.invoke("lios.test.result", {}, live(), { source: "agent" }),
    /result exceeded its registered output bound/,
  );
});


test("the permission decision keeps the long-standing wording and scopes for every class", () => {
  const decide = (permissionClass: Parameters<typeof decidePermission>[0]["permissionClass"], role: string, grant: Parameters<typeof decidePermission>[0]["grant"]) =>
    decidePermission({ actionId: "a", permissionClass, role, grant });

  assert.deepEqual(decide("denied", "internal_admin", { scope: "once" }), {
    actionId: "a", decision: "deny", policyClass: "denied", reason: "This action is denied by LiOS policy.", scope: "request", expiresAt: null,
  });
  assert.deepEqual(decide("safe_auto", "x", null), {
    actionId: "a", decision: "allow", policyClass: "safe_auto", reason: "Safe local action.", scope: "request", expiresAt: null,
  });
  assert.equal(decide("user_confirm", "x", null).reason, "Explicit user confirmation is required.");
  assert.equal(decide("user_confirm", "x", null).decision, "confirm");
  assert.equal(decide("user_confirm", "x", { scope: "once" }).reason, "Approved once by the user.");
  assert.equal(decide("user_confirm", "x", { scope: "once" }).scope, "request");
  assert.equal(decide("user_confirm", "x", { scope: "project" }).reason, "Approved for this Project by the user.");
  assert.equal(decide("user_confirm", "x", { scope: "project" }).scope, "project");
  assert.equal(decide("admin_confirm", "internal_user", { scope: "once" }).reason, "Administrator approval is required.");
  assert.equal(decide("admin_confirm", "client_admin", null).reason, "Administrator confirmation is required.");
  assert.equal(decide("admin_confirm", "client_admin", { scope: "once" }).decision, "allow");
});
