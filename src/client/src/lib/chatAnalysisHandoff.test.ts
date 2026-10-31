import test from "node:test";
import assert from "node:assert/strict";
import { matchAnalysisWorkbenchView } from "@shared/askLiosRouter";
import { decideChatAnalysisPresentation } from "./chatAnalysisHandoff";

test("analysis routing excludes advanced settings and concept explanations", () => {
  assert.equal(matchAnalysisWorkbenchView({ message: "chart MSFT" })?.view, "chart");
  assert.equal(matchAnalysisWorkbenchView({ message: "what is a DCF?" }), null);
  assert.equal(matchAnalysisWorkbenchView({ message: "open administration", capabilities: [{ id: "admin", parameters: { view: "adminconsole" } }] }), null);
});

test("automatic analysis opening preserves narrow layouts and existing unsaved or generated work", () => {
  const base = { card: { view: "chart" as const, symbol: "MSFT", title: "Chart", kind: "chart" as const }, viewportWidth: 1440, artifactDraftDirty: false, turnProducedArtifactOrDirective: false, showing: null };
  assert.equal(decideChatAnalysisPresentation(base), "sidecar");
  assert.equal(decideChatAnalysisPresentation({ ...base, viewportWidth: 1099 }), "card");
  assert.equal(decideChatAnalysisPresentation({ ...base, artifactDraftDirty: true }), "card");
  assert.equal(decideChatAnalysisPresentation({ ...base, turnProducedArtifactOrDirective: true }), "card");
  assert.equal(decideChatAnalysisPresentation({ ...base, showing: { view: "chart", symbol: "MSFT" } }), "already-open");
});
