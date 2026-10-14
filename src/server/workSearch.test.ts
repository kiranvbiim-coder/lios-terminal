import assert from "node:assert/strict";
import test from "node:test";
import { workSearchSnippet } from "./workSearch";

test("work search snippets center the matching text without returning the full conversation", () => {
  const source = "Before context ".repeat(20) + "NVIDIA data center margins accelerated sharply during the quarter. " + "After context ".repeat(20);
  const snippet = workSearchSnippet(source, "NVIDIA", 120);
  assert.ok(snippet);
  assert.match(snippet!, /NVIDIA data center margins/i);
  assert.ok(snippet!.length <= 122);
  assert.ok(snippet!.startsWith("…"));
  assert.ok(snippet!.endsWith("…"));
});

test("work search snippets normalize whitespace and safely handle empty values", () => {
  assert.equal(workSearchSnippet("  Apple\n\tvaluation  ", "Apple"), "Apple valuation");
  assert.equal(workSearchSnippet(null, "Apple"), null);
});
