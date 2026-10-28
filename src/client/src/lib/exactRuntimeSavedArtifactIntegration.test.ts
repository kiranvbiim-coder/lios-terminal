import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("C06 exact Chat artifact reopen uses existing canonical P4 viewer and unsaved guard",()=>{
 const src=readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx",import.meta.url),"utf8");
 for(const key of [
  'exactRuntimeSavedArtifact(candidate, {',
  'saved.artifactId !== artifactId',
  'saved.version !== version',
  'saved.projectId !== projectId',
  'keepingArtifactRef.current',
  'artifactDraftDirtyRef.current && !(await requestLifecycle(',
  'setConversationArtifactRef(saved.artifactId)',
  'setArtifactViewVersion(saved.version)',
  '<ConversationArtifactSidecar',
  'onExpand={(version) =>',
  'onOpenWorkbench();',
 ])assert.ok(src.includes(key),"Missing P4 exact-version handoff: "+key);
 assert.doesNotMatch(src,/setConversationArtifactRef\(artifactId\);\s*setArtifactViewVersion\(null\)/);
});
