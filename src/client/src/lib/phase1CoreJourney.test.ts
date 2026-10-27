import test from "node:test";
import assert from "node:assert/strict";
import { LIOS_FIRST_USE_CONTRACT, firstUseConnectionState, firstUseRecoveryDestination } from "./firstUseJourney";
import { resolveComposerPersistenceTarget, sourceScopeForChatMode } from "./p1Shell";
import { canRetryHomeConnection, conversationSendAvailability, unconfirmedRunRecoveryNotice } from "./conversationConnectionRecovery";
import { stageSafeRunRetry } from "./observedRunPolicy";
import { returnChangesChatIdentity, captureChatWorkbenchOrigin } from "./chatWorkbenchHandoff";
import { matchesSavedSearchChat, shouldCloseSearchAfterNavigation } from "./workSearchNavigationPolicy";
import { conversationArtifactViewKey, parseArtifactView } from "./conversationArtifactView";
import type { WorkSearchResult } from "@shared/workSearch";

test("Phase 1: clean authenticated first use needs no paid connection or mandatory Project", () => {
  assert.equal(LIOS_FIRST_USE_CONTRACT.identityIsOnlyEntryGate, true);
  assert.equal(LIOS_FIRST_USE_CONTRACT.connectionsRequiredToEnter, false);
  assert.equal(firstUseConnectionState(0), "unconfigured");
  assert.equal(resolveComposerPersistenceTarget({ chatMode: "quick", projectId: null, chatId: null }), "quick");
  assert.equal(sourceScopeForChatMode("quick", "auto"), "auto");
  // A ready Home only proves authenticated transport, not model/source entitlement.
  assert.equal(conversationSendAvailability(true, "ready").canSubmit, true);
  assert.match(LIOS_FIRST_USE_CONTRACT.shellHint, /Configure sources and AI when needed/);
});

test("Phase 1: missing connection preserves the original task and requires deliberate resubmission", () => {
  const question = "Research Apple and cite filings";
  assert.equal(firstUseRecoveryDestination("Connect AI"), "connections");
  assert.equal(firstUseRecoveryDestination("open connection center"), "connections");
  assert.equal(stageSafeRunRetry("", question), question);
  assert.equal(stageSafeRunRetry("My follow-up", question), "My follow-up");
  assert.equal(conversationSendAvailability(true, "failed").canSubmit, false);
  assert.equal(canRetryHomeConnection(true, "failed"), true);
  assert.equal(canRetryHomeConnection(false, "failed"), false);
  assert.equal(canRetryHomeConnection(true, "reconnecting"), false);
  assert.match(unconfirmedRunRecoveryNotice(), /Nothing was retried automatically/);
});

test("Phase 1: saved-work search is owner-scoped and a canceled switch keeps search open", () => {
  const result = { kind: "artifact", chatId: 24, projectId: null, artifactId: "3b30fed0-69e1-4a45-aa47-a34fa873276d" } as WorkSearchResult;
  const owner = { id: 24, projectId: null, scope: "quick" as const, status: "active", trashedAt: null };
  assert.equal(matchesSavedSearchChat(result, owner), true);
  assert.equal(matchesSavedSearchChat(result, { ...owner, id: 25 }), false);
  assert.equal(matchesSavedSearchChat(result, { ...owner, status: "archived" }), false);
  assert.equal(matchesSavedSearchChat(result, { ...owner, projectId: 7, scope: "project" }), false);
  assert.equal(shouldCloseSearchAfterNavigation(false), false);
  assert.equal(shouldCloseSearchAfterNavigation(true), true);
  assert.notEqual(conversationArtifactViewKey(101, null, 24), conversationArtifactViewKey(102, null, 24));
});

test("Phase 1: Workbench return cannot conflate unsaved Quick and Temporary chat identity", () => {
  const quick = captureChatWorkbenchOrigin("quick", null, null);
  const temporary = captureChatWorkbenchOrigin("temporary", null, null);
  assert.equal(returnChangesChatIdentity(quick, temporary), true);
  const saved = captureChatWorkbenchOrigin("quick", null, 24);
  assert.equal(returnChangesChatIdentity(quick, saved), true);
  assert.equal(returnChangesChatIdentity(saved, { ...saved }), false);
  const project = captureChatWorkbenchOrigin("project", 8, 24);
  assert.equal(returnChangesChatIdentity(saved, project), true);
});

test("Phase 1: exact persisted Artifact identity and revision are never silently fabricated", () => {
  const id = "3b30fed0-69e1-4a45-aa47-a34fa873276d";
  assert.deepEqual(parseArtifactView({ version: 1, artifactId: id, focus: false, revision: 4 }), {
    artifactId: id, focus: false, revision: 4,
  });
  assert.equal(parseArtifactView({ version: 1, artifactId: id, focus: false, revision: -1 }).revision, undefined);
  assert.equal(parseArtifactView({ version: 1, artifactId: "not-an-artifact", focus: false }).artifactId, null);
  assert.equal(conversationArtifactViewKey(101, null, null), null);
});
