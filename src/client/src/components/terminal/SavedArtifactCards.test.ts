import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedArtifactCardList, describeSavedArtifactCard } from "./SavedArtifactCards";

const id = "artifact:22222222-2222-4222-8222-222222222222";

test("saved Artifact card uses the persisted snapshot and prefers the live access-checked record", () => {
  const snapshot = describeSavedArtifactCard({ id, version: 1, title: "AAPL DCF sensitivity", kind: "valuation" }, undefined);
  assert.deepEqual(snapshot, { id, title: "AAPL DCF sensitivity", kindLabel: "Valuation", version: 1, ariaLabel: "Open saved Artifact AAPL DCF sensitivity, Valuation, version 1", unavailable: false });
  const live = describeSavedArtifactCard({ id, version: 1, title: "AAPL DCF sensitivity", kind: "valuation" }, { title: "AAPL DCF (revised)", kind: "valuation", headVersion: 3 });
  assert.equal(live.title, "AAPL DCF (revised)");
  assert.equal(live.version, 3);
  const legacy = describeSavedArtifactCard({ id, version: 2, title: null, kind: null }, undefined);
  assert.equal(legacy.title, "Saved Artifact");
  assert.equal(legacy.kindLabel, null);
});

test("saved Artifact card is a labelled keyboard-operable button that opens the canonical id", () => {
  const html = renderToStaticMarkup(createElement(SavedArtifactCardList, {
    cards: [describeSavedArtifactCard({ id, version: 1, title: "AAPL DCF sensitivity", kind: "valuation" }, undefined)],
    activeId: null,
    onOpen: () => undefined,
  }));
  assert.match(html, /<button type="button"/);
  assert.match(html, /aria-label="Open saved Artifact AAPL DCF sensitivity, Valuation, version 1"/);
  assert.match(html, /role="group" aria-label="Saved Artifacts"/);
  assert.doesNotMatch(html, /artifact:2222|JSON|sourceRefs/, "no internal ids or raw data in the card text");
  assert.equal(renderToStaticMarkup(createElement(SavedArtifactCardList, { cards: [], activeId: null, onOpen: () => undefined })), "");
});

test("once the Project Artifact list has loaded, a card whose Artifact is missing is disabled and marked Unavailable", () => {
  const ref = { id, version: 1, title: "AAPL DCF sensitivity", kind: "valuation" };
  assert.equal(describeSavedArtifactCard(ref, undefined, false).unavailable, false, "while the list is loading the card stays openable");
  assert.equal(describeSavedArtifactCard(ref, { title: "x", kind: "valuation", headVersion: 1 }, true).unavailable, false);
  const missing = describeSavedArtifactCard(ref, undefined, true);
  assert.equal(missing.unavailable, true);
  const html = renderToStaticMarkup(createElement(SavedArtifactCardList, { cards: [missing], activeId: null, onOpen: () => undefined }));
  assert.match(html, /<button type="button"[^>]*disabled=""/);
  assert.match(html, />Unavailable</);
  assert.doesNotMatch(html, />Open</);
  assert.match(html, /aria-label="Saved Artifact AAPL DCF sensitivity, Valuation, version 1 is unavailable"/);
});
