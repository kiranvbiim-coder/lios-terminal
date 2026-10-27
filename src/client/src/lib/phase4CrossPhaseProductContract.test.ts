import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("the cumulative product retains one P6/P9 owner boundary and no implicit P9 execution", () => {
  const project = read("../components/terminal/ProjectContinuityPanel.tsx");
  const automation = read("../components/terminal/ProjectAutomationPanel.tsx");
  assert.match(project, /focusProjectWorkflowRow/);
  assert.match(project, /refreshP6ProjectContinuity\(requestedProjectId\)/);
  assert.match(project, /continuity\.refetch\(\)/);
  assert.match(automation, /data-p9-workflow-id=\{workflow\.id\}/);
  assert.match(automation, /onClick=\{\(\) => void run\(workflow\.id, workflow\.updatedAt\)\}/);
  assert.match(automation, /requestWorkflowReview\(workflow, "delete"\)/);
});

test("Phase 2 Chat, source, voice, Workbench, Artifact remain one integrated product", () => {
  const chat = read("../components/terminal/ChatMessageActions.tsx");
  const sources = read("../components/terminal/ChatSourcesControl.tsx");
  const voice = read("../components/settings/LocalVoiceRuntimeSettings.tsx");
  const workbench = read("../components/terminal/WorkspaceComposer.tsx");
  const artifact = read("../components/terminal/ConversationArtifactSidecar.tsx");
  const shell = read("../components/terminal/ProjectExperienceShell.tsx");
  assert.match(chat, /if\(epoch\.current===generation\)inFlight\.current=false/);
  assert.match(sources, /sourceCataloguePresentation/);
  assert.match(voice, /voiceSetupStatus/);
  assert.match(workbench, /moveWorkspaceSlot/);
  assert.match(artifact, /isCurrentArtifactLoad/);
  assert.match(shell, /isCurrentArtifactLoad\(artifactId, loadedRequest, version, conversationArtifactRef, artifactViewVersion\)/);
});

test("Phase 3 maintains explicit voluntary advisory consent and real user-controlled first use", () => {
  const home = read("../components/terminal/HomeAttentionPanel.tsx");
  const work = read("../components/terminal/ProjectHome.tsx");
  const search = read("../components/terminal/WorkSearchDialog.tsx");
  const advisory = read("../components/panels/AdvisoryPanel.tsx");
  assert.match(home, /homeAttentionReadPresentation/);
  assert.match(work, /projectSavedWorkReadPresentation/);
  assert.match(search, /Retry saved-work search \(read-only\)/);
  assert.match(advisory, /await apiRequest\("POST", "\/api\/client\/consulting\/requests"/);
  assert.match(advisory, /const submitInFlight = useRef\(false\)/);
  assert.match(advisory, /No engagement is started or automatically billed/);
  assert.doesNotMatch(home + work + search, /autoSubmitConsulting|sponsoredImpression/);
});

test("the advisory request is a real accessible modal, not a click-through div", () => {
  const advisory = read("../components/panels/AdvisoryPanel.tsx");
  assert.match(advisory, /import \{ Dialog, DialogContent, DialogDescription, DialogTitle \} from "@\/components\/ui\/dialog"/);
  assert.match(advisory, /<Dialog open=\{showNewModal\}/);
  assert.match(advisory, /<DialogContent className="max-h-\[90vh\]/);
  assert.match(advisory, /<DialogTitle/);
  assert.match(advisory, /<DialogDescription/);
  assert.match(advisory, /onEscapeKeyDown=\{event => \{ if \(submitting\) event\.preventDefault\(\); \}\}/);
  assert.match(advisory, /onInteractOutside=\{event => \{ if \(submitting\) event\.preventDefault\(\); \}\}/);
  for (const id of ["lios-advisory-domain", "lios-advisory-title", "lios-advisory-description"]) {
    assert.ok(advisory.includes(id));
  }
  assert.doesNotMatch(advisory, /<div role="dialog" aria-modal="true"/);
});

test("Phase 4 CI keeps source evidence separate from signed/installed native release", () => {
  const workflow = read("../../../../.github/workflows/source-cross-platform.yml");
  const pkg = JSON.parse(read("../../../package.json"));
  assert.match(workflow, /github\.event\.repository\.private == false/);
  assert.match(workflow, /npm run phase4:source/);
  assert.match(workflow, /npm run phase4:assets/);
  assert.match(workflow, /npm run audit:oss/);
  assert.match(workflow, /npm run audit:licenses/);
  assert.match(workflow, /npm run release:preflight:ci/);
  assert.match(workflow, /npm run build/);
  assert.equal(pkg.scripts?.["test:phase4"], "node --test script/phase4_release_evidence.test.mjs script/phase4_source_asset_budget.test.mjs");
  assert.ok(!workflow.includes("npm run app:dist:mac") && !workflow.includes("npm run app:dist:win"));
  assert.ok(!workflow.includes("npm run acceptance:sp01-packaged"));
});
