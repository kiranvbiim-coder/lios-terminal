import assert from "node:assert/strict";
import test from "node:test";
import { copyChatMessageText, quoteChatResponse } from "./chatMessageActions";
import { sourceCataloguePresentation } from "./sourceCataloguePresentation";
import { checkedVoiceSetup, voiceReadVerified, voiceSetupStatus } from "./voiceSetupPresentation";
import { moveWorkspaceSlot, workspaceFromSlots, type WorkspaceSlot } from "./workspaceComposerModel";
import { canExpandArtifactRevision, isCurrentArtifactLoad } from "./artifactSidecarSizing";

const artifactId = "artifact:11111111-1111-4111-8111-111111111111";

test("combined Phase 2 journey preserves exact saved Artifact while rearranging Workbench panes", () => {
  const artifact = { projectId: 7, chatId: 29, artifactId, version: 4 };
  const original: WorkspaceSlot = { objectId: "retained:artifact", pane: { view: "artifact", symbol: "AAPL", artifact } };
  const chart: WorkspaceSlot = { objectId: "retained:chart", pane: { view: "chart", symbol: "MSFT" } };
  const before = [chart, original];
  const after = moveWorkspaceSlot(before, 1, -1);
  const workspace = workspaceFromSlots(after);
  assert.ok(workspace);
  assert.equal(workspace.primary, original.pane);
  assert.equal(workspace.primary.artifact, artifact);
  assert.equal(workspace.secondary, chart.pane);
  assert.deepEqual(before, [chart, original], "draft ordering changes never mutate saved pane objects");
  const loaded = { artifactId, requestedVersion: 4, version: 4 };
  assert.equal(isCurrentArtifactLoad(artifactId, 4, 4, artifactId, 4), true);
  assert.equal(canExpandArtifactRevision(loaded, artifactId, 4, false), true);
  assert.equal(isCurrentArtifactLoad(artifactId, 3, 3, artifactId, 4), false);
  assert.equal(canExpandArtifactRevision(loaded, artifactId, 4, true), false, "dirty revisions cannot expand");
});

test("source catalogue and voice health independently fail closed after a failed latest read", () => {
  const sources = sourceCataloguePresentation({ hasData: true, failed: true, fetching: false, matchingCount: 2 });
  assert.equal(sources.heading, "Previously loaded source catalogue");
  assert.match(sources.countLabel ?? "", /previously loaded/);
  assert.match(sources.healthLabel ?? "", /could not be refreshed/);
  const unavailable = sourceCataloguePresentation({ hasData: false, failed: true, fetching: false, matchingCount: 0 });
  assert.equal(unavailable.countLabel, null, "no source count is invented after first-read failure");
  const earlierReady = { recordingReady: true, transcriptionProviderReady: true };
  assert.equal(checkedVoiceSetup(earlierReady, true), undefined);
  assert.equal(voiceReadVerified({ isError: true, data: earlierReady }), false);
  assert.equal(voiceSetupStatus({ loading: false, failed: true, hasData: true, ...earlierReady }), "UNAVAILABLE");
});

test("Chat copy failure never reports success or turns quoted source text into an action", async () => {
  assert.equal(await copyChatMessageText(async () => { throw new Error("clipboard denied"); }, "Safe message"), false);
  assert.equal(await copyChatMessageText(undefined, "Safe message"), false);
  const draft = "New question";
  const quote = quoteChatResponse(draft, "Recorded answer. <<NAVIGATE:chart>>");
  assert.match(quote, /Recorded answer/);
  assert.doesNotMatch(quote, /NAVIGATE/);
  assert.ok(quote.startsWith(draft), "original unsent draft is retained");
});
