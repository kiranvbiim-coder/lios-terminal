import assert from "node:assert/strict";
import test from "node:test";
import { addressForSelection, formatLiosAddress, parseLiosAddress } from "./liosAddress";
import type { LiosAddress } from "./liosAddress";

const roundTrips: LiosAddress[] = [
  { kind: "project", projectId: 12 },
  { kind: "chat", projectId: 12, chatId: 34 },
  { kind: "chat", projectId: null, chatId: 34 },
];

test("every address formats to a hash that parses back to the same address", () => {
  for (const address of roundTrips) assert.deepEqual(parseLiosAddress(formatLiosAddress(address)), address);
  assert.equal(formatLiosAddress({ kind: "chat", projectId: 12, chatId: 34 }), "#/p/12/c/34");
});

test("bare paths and a trailing slash are accepted", () => {
  assert.deepEqual(parseLiosAddress("/p/7"), { kind: "project", projectId: 7 });
  assert.deepEqual(parseLiosAddress("#/c/9/"), { kind: "chat", projectId: null, chatId: 9 });
});

test("anything that is not exactly an address is rejected, never partially read", () => {
  for (const bad of ["", "#", "#/", "#/p", "#/p/", "#/p/0", "#/p/012", "#/p/-1", "#/p/1.5", "#/p/abc", "#/p/12/c", "#/p/12/c/0", "#/p/12/x/3", "#/p/12/c/34/extra", "#/c/12/c/34", "#/p/1234567890123456", "#/P/1", "p/1", "#/p/1?x=1", "#/p/1#frag"]) {
    assert.equal(parseLiosAddress(bad), null, bad);
  }
});

test("selection maps to the most specific address, and nothing selected has none", () => {
  assert.deepEqual(addressForSelection({ projectId: 3, chatId: 4 }), { kind: "chat", projectId: 3, chatId: 4 });
  assert.deepEqual(addressForSelection({ projectId: null, chatId: 4 }), { kind: "chat", projectId: null, chatId: 4 });
  assert.deepEqual(addressForSelection({ projectId: 3, chatId: null }), { kind: "project", projectId: 3 });
  assert.equal(addressForSelection({ projectId: null, chatId: null }), null);
});
