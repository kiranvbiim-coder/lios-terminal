import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedArtifactCardList, describeSavedArtifactCard, savedArtifactMatchesScope } from "./SavedArtifactCards";

const id = "artifact:22222222-2222-4222-8222-222222222222";

test("saved Artifact cards remain pinned to the retained result when the current head advances", () => {
  const snapshot = describeSavedArtifactCard({ id, version: 1, title: "AAPL DCF sensitivity", kind: "valuation" }, undefined);
  assert.deepEqual(snapshot, { id, title: "AAPL DCF sensitivity", kindLabel: "Valuation", version: 1, preview: null, ariaLabel: "Open saved Artifact AAPL DCF sensitivity, Valuation, version 1", unavailable: false });
  const live = describeSavedArtifactCard({ id, version: 1, title: "AAPL DCF sensitivity", kind: "valuation" }, { title: "AAPL DCF (revised)", kind: "valuation", headVersion: 3 });
  assert.equal(live.title, snapshot.title);
  assert.equal(live.version, 1);
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

test("a card is unavailable only when the exact lookup says missing, never because the active list lacks it", () => {
  const ref = { id, version: 1, title: "AAPL DCF sensitivity", kind: "valuation" };
  assert.equal(describeSavedArtifactCard(ref, undefined).unavailable, false, "lookup pending: stays openable");
  assert.equal(describeSavedArtifactCard(ref, undefined, "found").unavailable, false);
  assert.equal(describeSavedArtifactCard(ref, { title: "x", kind: "valuation", headVersion: 1 }, "missing").unavailable, false, "a resolved Artifact is never unavailable");
  const missing = describeSavedArtifactCard(ref, undefined, "missing");
  assert.equal(missing.unavailable, true);
  const html = renderToStaticMarkup(createElement(SavedArtifactCardList, { cards: [missing], activeId: null, onOpen: () => undefined }));
  assert.match(html, /<button type="button"[^>]*disabled=""/);
  assert.match(html, />Unavailable</);
  assert.doesNotMatch(html, />Open</);
  assert.match(html, /aria-label="Saved Artifact AAPL DCF sensitivity, Valuation, version 1 is unavailable"/);
});

test("projectless saved cards resolve only in the owning Quick Chat while retaining their recorded revision", () => {
  const owned = { projectId: null, owningChatId: 42 };
  assert.equal(savedArtifactMatchesScope(owned, null, 42), true);
  assert.equal(savedArtifactMatchesScope(owned, null, 43), false);
  assert.equal(savedArtifactMatchesScope(owned, 17, 42), false);
  assert.equal(savedArtifactMatchesScope(owned, null, null), false, "Temporary scope cannot resolve saved cards");
  assert.equal(savedArtifactMatchesScope({ projectId: null }, null, 42), false);
  assert.equal(savedArtifactMatchesScope({ projectId: 17 }, 17, 43), true, "existing Project cards remain shared by Project scope");
  const card = describeSavedArtifactCard({ id, version: 2, title: "Quick Chat analysis", kind: "research" }, { title: "Updated analysis", kind: "research", headVersion: 5 }, "found");
  assert.equal(card.version, 2);
  assert.equal(card.title, "Quick Chat analysis");
  assert.equal(card.unavailable, false);
});

test("WS-34 saved Artifact card shows the authorized exact-revision preview without inventing a new result", () => {
  const ref = { id, version: 2, title: "Retained analysis", kind: "research" };
  const preview = "Research question · What changed in recorded evidence?";
  const card = describeSavedArtifactCard(ref, undefined, "found", preview);
  assert.equal(card.preview, preview);
  assert.equal(card.version, 2);
  assert.equal(card.title, "Retained analysis");
  const markup = renderToStaticMarkup(createElement(SavedArtifactCardList, {
    cards: [card], activeId: null, onOpen: () => undefined,
  }));
  assert.match(markup, /data-testid="artifact-task-preview"/);
  assert.match(markup, /What changed in recorded evidence/);
  assert.match(markup, />v2</);
  assert.match(markup, /<button type="button"/);
  assert.doesNotMatch(markup, /artifact:2222|<pre|\{&quot;/);
});

test("WS-34 metadata-only and failed/pending exact lookups cannot supply fake previews", () => {
  const ref = { id, version: 3, title: "Saved title only", kind: "chart" };
  const text = "A fictional chart with three return curves";
  const pending = describeSavedArtifactCard(ref, { title: "Live list only", kind: "chart", headVersion: 7 }, "pending", text);
  const missing = describeSavedArtifactCard(ref, undefined, "missing", text);
  assert.equal(pending.preview, null);
  assert.equal(missing.preview, null);
  assert.equal(pending.version, 3, "the current head cannot replace the retained version");
  assert.equal(pending.title, "Saved title only");
  assert.equal(missing.unavailable, true);
  const pendingHtml = renderToStaticMarkup(createElement(SavedArtifactCardList, {
    cards: [pending], activeId: null, onOpen: () => undefined,
  }));
  assert.doesNotMatch(pendingHtml, /fictional|artifact-task-preview/);
});

test("WS-34 every task preview has an explicit exact-version and scope check before rendering", () => {
  // Source-contract assertions complement, rather than replace, signed-in
  // tenant/Project HTTP negative tests.
  const source = readFileSync(new URL("./SavedArtifactCards.tsx", import.meta.url), "utf8");
  assert.match(source, /query\.data\.artifact\.id === ref\.id/);
  assert.match(source, /query\.data\.version\.artifactId === ref\.id/);
  assert.match(source, /query\.data\.version\.version === ref\.version/);
  assert.match(source, /savedArtifactMatchesScope\(query\.data\.artifact, projectId, chatId\)/);
  assert.match(source, /const preview = detail \? recordedArtifactPreview\(detail\.version\.content\) : null/);
  assert.match(source, /\?version=\$\{ref\.version\}/);
  assert.doesNotMatch(source, /recordedArtifactPreview\(ref|recordedArtifactPreview\(fromList/);
});
