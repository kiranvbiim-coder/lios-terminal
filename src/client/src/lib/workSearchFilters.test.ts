import test from "node:test";
import assert from "node:assert/strict";
import type { WorkSearchResult } from "@shared/workSearch";
import {
  WORK_SEARCH_FILTERS,
  clampWorkSearchSelection,
  countWorkSearchKind,
  filterWorkSearchResults,
  workSearchEmptyMessage,
} from "./workSearchFilters";


const match = (kind: WorkSearchResult["kind"], id: string): WorkSearchResult => ({
  kind, id, title: `${kind} ${id}`, snippet: null,
  projectId: null, chatId: null, artifactId: null, resourceId: null,
  updatedAt: "2026-10-22T00:00:00Z",
});
const results: WorkSearchResult[] = [
  match("chat", "same-id"), match("project", "same-id"),
  match("file", "f2"), match("artifact", "a1"), match("chat", "c3"),
];

test("type filters preserve original server order and only return authorized search results", () => {
  assert.deepEqual(WORK_SEARCH_FILTERS.map((x) => x.value), ["all", "chat", "project", "artifact", "file"]);
  assert.deepEqual(filterWorkSearchResults(results, "all"), results);
  assert.deepEqual(filterWorkSearchResults(results, "chat"), [results[0], results[4]]);
  assert.deepEqual(filterWorkSearchResults(results, "project"), [results[1]]);
  assert.deepEqual(filterWorkSearchResults(results, "artifact"), [results[3]]);
  assert.deepEqual(filterWorkSearchResults(results, "file"), [results[2]]);
  assert.notEqual(filterWorkSearchResults(results, "all"), results, "never mutate input reference");
});

test("counts reflect only returned matches and do not claim server completeness", () => {
  assert.deepEqual(WORK_SEARCH_FILTERS.map((f) => countWorkSearchKind(results, f.value)), [5,2,1,1,1]);
  assert.equal(countWorkSearchKind([], "chat"), 0);
  assert.match(workSearchEmptyMessage("test", "file", 3), /among the returned matches/);
  assert.match(workSearchEmptyMessage("test", "all", 0), /No matching work/);
  assert.match(workSearchEmptyMessage("a", "project", 0), /at least 2 characters/);
});

test("keyboard selection is clamped when filtering changes the available matches", () => {
  assert.equal(clampWorkSearchSelection(8, 2), 1);
  assert.equal(clampWorkSearchSelection(0, 0), 0);
  assert.equal(clampWorkSearchSelection(-5, 4), 0);
  assert.equal(clampWorkSearchSelection(1, 4), 1);
});
