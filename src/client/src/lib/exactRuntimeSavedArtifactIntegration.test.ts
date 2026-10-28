import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("C06 reuses existing authenticated P4 sidecar and exact-version loading", () => {
  const shell = source("../components/terminal/ProjectExperienceShell.tsx");
  const trace = source("../components/terminal/ConversationRuntimeTrace.tsx");
  const sidecar = source("../components/terminal/ConversationArtifactSidecar.tsx");

  for (const required of [
    'exactRuntimeSavedArtifact(candidate, {',
    'isCurrentSavedArtifactHandoff(saved, original,',
    'sandboxSelectionRef.current, runtimeHandoffRequestIdRef.current',
    'keepingArtifactRef.current',
    'savedArtifactReopenInFlightRef.current',
    'artifactDraftDirtyRef.current && !(await requestLifecycle(',
    'setConversationArtifactRef(saved.artifactId)',
    'setArtifactViewVersion(saved.version)',
    '<ConversationArtifactSidecar',
    'onDisplayedVersionChange={(version, artifactId, loadedRequest) =>',
    'isCurrentArtifactLoad(artifactId, loadedRequest, version, conversationArtifactRef, artifactViewVersion)',
  ]) assert.ok(shell.includes(required), "Missing canonical P4 handoff: " + required);
  for (const required of [
    'onOpenSavedArtifact?: (artifactId: string',
    'data-testid="c06-open-exact-saved-version"',
    'onOpenSavedArtifact(artifact.persistedArtifact!.id',
  ]) assert.ok(trace.includes(required), "Missing exact recorded Chat action: " + required);
  assert.match(sidecar, /ArtifactPane/);
  assert.doesNotMatch(shell, /setConversationArtifactRef\(saved.artifactId\);\s*setArtifactViewVersion\(null\)/);
});

test("C06 handoff does not create duplicate P4 authorizations, writes or open stale result automatically", () => {
  const shell = source("../components/terminal/ProjectExperienceShell.tsx");
  const helper = source("./exactRuntimeSavedArtifact.ts");
  assert.match(shell, /onOpenSavedArtifact=\{chatMode === "temporary" \? undefined : async/);
  assert.match(shell, /if \(artifactDraftDirtyRef\.current && !\(await requestLifecycle/);
  assert.match(helper, /event\.requestId !== owner\.requestId/);
  assert.match(helper, /original\.chatId === current\.chatId/);
  assert.doesNotMatch(helper, /fetch\(|apiRequest\(|createArtifactVersion\(|keepConversationDraft\(|approveRuntime|runP9WorkflowNow/);
});
