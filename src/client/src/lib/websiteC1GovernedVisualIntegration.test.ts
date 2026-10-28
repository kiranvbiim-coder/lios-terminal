import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
test("C1 runtime selects only exact P4 saved-artifact chart/table, without model-authored data",()=>{
  const trace=source("../components/terminal/ConversationRuntimeTrace.tsx");
  const schema=source("../../../shared/governedVisualAnswer.ts");
  assert.match(trace,/const visualAnswerRequest = artifact\?\.type === "artifact" \? visualRequestFromRuntimeArtifact\(artifact\) : null/);
  assert.match(trace,/\{visualAnswerRequest && <GovernedVisualAnswer/);
  assert.match(trace,/request=\{visualAnswerRequest\}/);
  assert.match(schema,/governedVisualAnswerRequestSchema = z\.object/);
  assert.match(schema,/version\.version !== request\.data\.version/);
  assert.match(schema,/artifact\.projectId !== request\.data\.projectId/);
  assert.match(schema,/request\.data\.sourceRefs\.some\(ref => !canonicalRefs\.has\(ref\)\)/);
  assert.match(schema,/chartArtifactContentSchema\.safeParse/);
  assert.match(schema,/tableArtifactContentSchema\.safeParse/);
  assert.doesNotMatch(schema,/Math\.random|sourceUrl|URL\(|geocode|runConversation|promptTemplate|http[s]?:/);
});
test("C1 uses current authenticated P4 GET and original renderer, not client-trusted AI content or extra API",()=>{
  const view=source("../components/terminal/GovernedVisualAnswer.tsx");
  const hook=source("./useArtifacts.ts");
  assert.match(view,/useArtifact\(request\.artifactId, request\.version, true\)/);
  assert.match(hook,/export function useArtifact\(/);
  assert.match(hook,/\/api\/artifacts\/\$\{encodeURIComponent\(artifactId!\)\}/);
  assert.match(hook,/\?version=\$\{version\}/);
  assert.match(hook,/credentials: "same-origin"/);
  assert.match(hook,/cache: "no-store"/);
  assert.match(hook,/refetchOnMount: "always"/);
  assert.match(view,/resolveGovernedVisualAnswer\(request, remote\)/);
  assert.match(view,/<ArtifactChart content=\{decision\.content\} artifactSourceRefs=\{decision\.sourceRefs\} readOnly\s*\/>/);
  assert.match(view,/Not recorded/);
  assert.match(view,/Recorded source IDs/);
  assert.match(view,/current\.decision\?\.status === "ready"/);
  assert.doesNotMatch(view,/localStorage|sessionStorage|setTimeout\(|postMessage\(|eval\(|dangerouslySetInnerHTML|createArtifact\(|createP9Workflow\(/);
});
test("C1 P4 read authorization remains governed by existing server Artifact API",()=>{
  const hooks=source("./useArtifacts.ts");
  assert.match(hooks,/export function useArtifact\(/);
  assert.match(hooks,/\/api\/artifacts\/\$\{encodeURIComponent\(artifactId!\)\}/);
  assert.match(hooks,/if \(!res\.ok\) throw new Error/);
  const pkg=JSON.parse(source("../../../package.json"));
  assert.equal(pkg.dependencies.echarts,"6.1.0");
  assert.ok(pkg.dependencies.recharts);
});
