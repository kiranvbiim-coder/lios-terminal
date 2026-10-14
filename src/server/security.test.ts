import test from "node:test";
import assert from "node:assert/strict";
import { INTERNAL_ROLES, CLIENT_ROLES } from "@shared/schema";

test("internal and client role sets are disjoint", () => {
  const client = new Set<string>(CLIENT_ROLES);
  for (const role of INTERNAL_ROLES) assert.equal(client.has(role), false, `overlapping role: ${role}`);
});

test("no client role satisfies the internal role set", () => {
  const internal = new Set<string>(INTERNAL_ROLES);
  for (const role of CLIENT_ROLES) assert.equal(internal.has(role), false, `overlapping role: ${role}`);
});
