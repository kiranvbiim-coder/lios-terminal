import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const studio=readFileSync(new URL("../components/terminal/ProjectBriefingStudio.tsx",import.meta.url),"utf8");
const native=readFileSync(new URL("./nativeArtifactPptx.ts",import.meta.url),"utf8");
const composer=readFileSync(new URL("./phase4Briefing.ts",import.meta.url),"utf8");
test("one P4 owner and opt-in current Project visual read; save revalidates the exact pinned version",()=>{
  assert.match(studio,/useProjectArtifacts\(projectId\)/);
  assert.match(studio,/readP4Visual\(projectId, artifactId\)/);
  assert.match(studio,/credentials: "same-origin", cache: "no-store"/);
  assert.match(studio,/verifyCurrentPinnedVisual\(visual,/);
  assert.match(studio,/assertSavedBriefingArtifact\(result,/);
  assert.match(studio,/createArtifact\(expectedProject,/);
  assert.doesNotMatch(studio,/localStorage|sessionStorage|setInterval|onClick=.*runTool/);
});
test("native P4 Office exporter consumes same captured chart and table object schema",()=>{
  assert.match(composer,/type: "chart_ref"/);
  assert.match(composer,/attrs: \{ \.\.\.metadata, chart: visual\.content \}/);
  assert.match(composer,/type: "table"/);
  assert.match(native,/block\.type === "chart_ref"/);
  assert.match(native,/readRecordedDocumentTable\(attrs\)/);
  assert.match(native,/addNativeChart/);
  assert.match(native,/addNativeTable/);
  assert.match(native,/officeDocumentBindings/);
});
