import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkSearchResult } from "@shared/workSearch";
import {
  WORK_SEARCH_FILTERS,
  clampWorkSearchSelection,
  countWorkSearchKind,
  filterWorkSearchResults,
  workSearchEmptyMessage,
} from "./workSearchFilters";

const base = path.dirname(fileURLToPath(import.meta.url));
const dialog = fs.readFileSync(path.join(base, "../components/terminal/WorkSearchDialog.tsx"), "utf8");

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

test("dialog provides accessible filter buttons and keyboard navigation for only visible results", () => {
  assert.match(dialog, /role="group" aria-label="Filter returned results by type"/);
  assert.match(dialog, /aria-pressed=\{filter === entry.value\}/);
  assert.match(dialog, /role="combobox"/);
  assert.match(dialog, /role="listbox" aria-label="Matching LiOS work"/);
  assert.match(dialog, /aria-activedescendant=/);
  assert.match(dialog, /aria-selected=\{selected === index\}/);
  assert.match(dialog, /visibleResults\[selected\]/);
  assert.match(dialog, /visibleResults.map\(\(result, index\)/);
  assert.match(dialog, /setFilter\(entry.value\)/);
  assert.match(dialog, /\$\{result.kind\}:\$\{result.id\}/, "different result kinds can share an ID");
});

test("search stays on the existing permissioned endpoint with cancellation and truthful failures", () => {
  assert.match(dialog, /fetch\(`\/api\/work-search\?q=\$\{encodeURIComponent\(normalized\)\}&limit=30`/);
  assert.match(dialog, /controller.abort\(\)/);
  assert.match(dialog, /controller.signal.aborted/);
  assert.match(dialog, /openingRef.current/);
  assert.match(dialog, /Keep the already-authorized results/);
  assert.doesNotMatch(dialog, /fetch\([^\n]*\/api\/projects/);
  assert.doesNotMatch(dialog, /localStorage|sessionStorage/, "no new searchable copy of user work");
});
