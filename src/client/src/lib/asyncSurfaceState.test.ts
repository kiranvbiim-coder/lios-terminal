import test from "node:test";
import assert from "node:assert/strict";
import { asyncSurfaceStatus, resolveAsyncSurfaceState } from "./asyncSurfaceState";

const read = (error: unknown, isPending = false, hasData = false) =>
  resolveAsyncSurfaceState({ hasData, isPending, isError: Boolean(error), error });

test("WS-10 existing saved revision stays visible while refetching and on background failure", () => {
  assert.equal(read(new Error("503: backend unavailable"), false, true), "ready");
  assert.equal(read(null, true, true), "ready");
});
test("WS-10 initial loading cannot masquerade as an empty saved object", () => {
  assert.equal(read(null, true, false), "loading");
});
test("WS-10 HTTP 401 and 403 are distinct session vs role failures", () => {
  assert.equal(read(new Error("401: Unauthorized")), "signed_out");
  assert.equal(read(new Error("403: Forbidden")), "denied");
});
test("WS-10 404 and 410 are explicit missing / no longer available, not fabricated empty content", () => {
  assert.equal(read(new Error("404: Artifact request failed.")), "missing");
  assert.equal(read(new Error("410: Resource gone")), "missing");
});
test("WS-10 network, transport, service and other read failures remain retryable", () => {
  assert.equal(read(new Error("503: Gateway unavailable")), "failed");
  assert.equal(read(new Error("NetworkError")), "failed");
  assert.equal(read(new Error("500: Internal error")), "failed");
});
test("WS-10 no successful data and no pending or error means missing, not ready", () => {
  assert.equal(read(null), "missing");
});
test("WS-10 status extraction uses typed errors and exact leading codes", () => {
  assert.equal(asyncSurfaceStatus({ status: 403 }), 403);
  assert.equal(asyncSurfaceStatus({ status: 404 }), 404);
  assert.equal(asyncSurfaceStatus(new Error("403: Denied")), 403);
  assert.equal(asyncSurfaceStatus(new Error("code 403 in private detail")), null);
  assert.equal(asyncSurfaceStatus(new Error("4037: not a real HTTP code")), null);
  assert.equal(asyncSurfaceStatus("403: raw untrusted input"), null);
});
test("WS-10 status extraction ignores invalid, oversized, or malformed values", () => {
  assert.equal(asyncSurfaceStatus({ status: 0 }), null);
  assert.equal(asyncSurfaceStatus({ status: 800 }), null);
  assert.equal(asyncSurfaceStatus({ status: "401" }), null);
  assert.equal(asyncSurfaceStatus({ status: 403.5 }), null);
});
test("WS-10 failed-read state is not mistaken for a permission denial", () => {
  assert.equal(read(new Error("An unrelated text mentions 403 somewhere")), "failed");
  assert.equal(read(new Error("Missing permission? please try again")), "failed");
});
