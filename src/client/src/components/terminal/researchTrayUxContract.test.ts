import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createResearchContextItem,
  pinResearchContext,
  removeResearchTrayItem,
  updateResearchTrayItem,
} from "../../lib/terminalResearchTray";

const source = readFileSync(new URL("./ResearchTray.tsx", import.meta.url), "utf8");

// Source-level assertions complement, not replace, rendered keyboard/AT tests.
test("Research Tray has readable controls, announced tabs, and visible focus", () => {
  assert.match(source, /<aside className="lios-research-tray/);
  assert.match(source, /aria-label="Research continuity"/);
  assert.match(source, /aria-label="Close Research Tray"/);
  assert.match(source, /<nav className=/);
  assert.match(source, /aria-pressed=\{tab === "pinned"\}/);
  assert.match(source, /aria-pressed=\{tab === "thread"\}/);
  assert.match(source, /role="group" aria-label="Filter research by group"/);
  assert.match(source, /aria-pressed=\{group === itemGroup\}/);
  assert.match(source, /focus-visible:outline/);
  assert.match(source, /min-h-10/);
  assert.match(source, /h-\[min\(620px,calc\(100dvh-145px\)\)\]/);
  assert.doesNotMatch(source, /text-\[(?:6|7|8|9)px\]/);
});

test("New note requires user submission, no blocking browser prompt", () => {
  assert.match(source, /<form id="research-new-note"/);
  assert.match(source, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); addNote\(\); \}\}/);
  assert.match(source, /<label htmlFor="research-note-content"/);
  assert.match(source, /disabled=\{!newNote\.trim\(\)\}/);
  assert.match(source, /setNewNote\(""\)/);
  assert.match(source, /createResearchContextItem\(\{/);
  assert.doesNotMatch(source, /window\.prompt/);
});

test("Annotations save explicitly or cancel without accidentally persisting a blur", () => {
  assert.match(source, /setNoteDraft\(item\.note\)/);
  assert.match(source, /setTagsDraft\(item\.tags\.join\(", "\)\)/);
  assert.match(source, /setGroupDraft\(item\.group\)/);
  assert.match(source, /updateResearchTrayItem\(items, item\.id/);
  assert.match(source, /Save annotation/);
  assert.match(source, /onClick=\{\(\) => setEditingId\(null\)\}/);
  assert.doesNotMatch(source, /onBlur=\{/);
});

test("Removing a pinned item and clearing history need explicit confirmation", () => {
  assert.match(source, /data-testid="research-remove-confirm"/);
  assert.match(source, /setRemoveId\(item\.id\)/);
  assert.match(source, /onClick=\{\(\) => remove\(item\)\}/);
  assert.match(source, /removeResearchTrayItem\(items, item\.id\)/);
  assert.match(source, /data-testid="research-clear-confirm"/);
  assert.match(source, /setConfirmClear\(true\)/);
  assert.match(source, /clearResearchThread\(\)/);
  assert.match(source, /Pinned notes and findings will remain/);
  assert.doesNotMatch(source, /window\.confirm/);
});

test("All original Workbench research actions and offline source operations stay wired", () => {
  for (const mode of ["current", "tab", "split-right"]) {
    assert.ok(source.includes('onOpen(item.view, "' + mode + '"'), "missing open mode: " + mode);
  }
  for (const required of [
    "pinResearchContext(items", "appendResearchThreadEvent", "subscribeResearchTray",
    "subscribeResearchThread", "loadResearchTray", "loadResearchThread",
    "groupResearchThreadByDay", "getResearchTrayGroups", "saveResearchTray(next)",
  ]) assert.ok(source.includes(required), "missing original research function: " + required);
  assert.match(source, /role="status"/);
});

test("Research note edits and explicit delete retain unrelated canonical findings", () => {
  const note = createResearchContextItem({ view: "valuation", symbol: "MSFT", kind: "note", note: "Original thesis" });
  const other = createResearchContextItem({ view: "chart", symbol: "AAPL", kind: "context" });
  const list = pinResearchContext([note, other], { view: "financialstatements", symbol: "MSFT" });
  const edited = updateResearchTrayItem(list, note.id, { note: "Revised thesis", group: "Catalysts", tags: ["risk", "catalyst", "risk"] });
  const result = edited.find((item) => item.id === note.id)!;
  assert.equal(result.note, "Revised thesis");
  assert.equal(result.group, "Catalysts");
  assert.deepEqual(result.tags, ["risk", "catalyst"]);
  const removed = removeResearchTrayItem(edited, note.id);
  assert.equal(removed.length, edited.length - 1);
  assert.equal(removed.some((item) => item.id === note.id), false);
  assert.equal(removed.some((item) => item.id === other.id), true);
});
