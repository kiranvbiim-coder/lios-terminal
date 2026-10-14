import test from "node:test";
import assert from "node:assert/strict";

import { parseActionInboxResponse } from "./useProactivePulse";

test("parseActionInboxResponse counts items and marks ready", () => {
  const result = parseActionInboxResponse({ items: [{ id: "1" }, { id: "2" }, { id: "3" }] });
  assert.deepEqual(result, { count: 3, status: "ready" });
});

test("parseActionInboxResponse treats an empty inbox as ready with zero count", () => {
  const result = parseActionInboxResponse({ items: [] });
  assert.deepEqual(result, { count: 0, status: "ready" });
});

test("parseActionInboxResponse marks null response unavailable, not zero-ready", () => {
  const result = parseActionInboxResponse(null);
  assert.deepEqual(result, { count: 0, status: "unavailable" });
});

test("parseActionInboxResponse marks a malformed payload unavailable", () => {
  assert.deepEqual(parseActionInboxResponse("not an object"), { count: 0, status: "unavailable" });
  assert.deepEqual(parseActionInboxResponse(42), { count: 0, status: "unavailable" });
  assert.deepEqual(parseActionInboxResponse([1, 2, 3]), { count: 0, status: "unavailable" });
});

test("parseActionInboxResponse treats a missing items field as an empty, ready inbox", () => {
  const result = parseActionInboxResponse({ asOf: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(result, { count: 0, status: "ready" });
});
