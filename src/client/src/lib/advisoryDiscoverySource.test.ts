import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const invite = read("../components/terminal/QuietAdvisoryInvite.tsx");
const home = read("../components/terminal/ProjectHome.tsx");
const projectShell = read("../components/terminal/ProjectExperienceShell.tsx");
const terminal = read("../pages/Terminal.tsx");
const advisory = read("../components/panels/AdvisoryPanel.tsx");
const routes = read("../../../server/clientRoutes.ts");

test("Phase 4 uses one quiet Project-home invitation, not injected chat ads or new marketing routes", () => {
  assert.match(invite, /data-testid="quiet-advisory-invite"/);
  assert.match(invite, /Also available · Optional professional service/);
  assert.match(invite, /No.*Project is shared/);
  assert.match(invite, /onDismiss/);
  assert.match(invite, /onClick=\{onExplore\}/);
  assert.match(home, /showQuietAdvisoryInvite && !editingName && !renameBusy && !pendingContext && !contextBusy/);
  assert.match(home, /<QuietAdvisoryInvite onExplore=\{onExploreAdvisory\} onDismiss=\{onDismissAdvisory\}/);
  assert.doesNotMatch(invite, /setInterval|fetch\(|apiRequest|localStorage|analytics|navigator\.sendBeacon|location\.href/);
});

test("Phase 4 audience and permission guard existing Advisory route and respect unsaved work", () => {
  assert.match(projectShell, /mayShowQuietAdvisoryInvite\(\{/);
  assert.match(projectShell, /audience, surface: "project-home", dismissedInSession: advisoryDismissed/);
  assert.match(projectShell, /setAdvisoryDismissed\(true\)/);
  assert.match(projectShell, /setAdvisoryDismissed\(false\); \}, \[account\.email\]/);
  assert.match(projectShell, /artifactDraftDirtyRef\.current/);
  assert.match(projectShell, /onExploreAdvisory\(\)/);
  assert.match(terminal, /onExploreAdvisory=\{\(\) => \{/);
  assert.match(terminal, /!canOpenView\("advisory"\) \|\| workbenchDirtyRef\.current/);
  assert.match(terminal, /handleOpenAction\("advisory", "tab"\)/);
  assert.match(terminal, /focusMode=\{focusMode\}/);
  assert.match(terminal, /presentationMode=\{presentationMode\}/);
});

test("Phase 4 service discovery offers actual editable templates and explains scoping", () => {
  assert.match(advisory, /Explore common advisory briefs/);
  assert.match(advisory, /Object\.entries\(PACK_TEMPLATES\)\.map/);
  assert.match(advisory, /ADVISORY_SERVICE_EXPLANATIONS/);
  assert.match(advisory, /ADVISORY_SERVICE_STEPS/);
  assert.match(advisory, /startAdvisoryBrief\(key\)/);
  assert.match(advisory, /setTitle\(pack\.title\)/);
  assert.match(advisory, /setDescription\(pack\.description\)/);
  assert.match(advisory, /setShowNewModal\(true\)/);
  assert.match(advisory, /No Project, file, source, conversation or analysis is attached automatically/);
  assert.match(routes, /app\.post\("\/api\/client\/consulting\/requests", requireFullClient/);
  assert.match(routes, /res\.json\(request\)/);
  assert.equal((advisory.match(/apiRequest\("POST", "\/api\/client\/consulting\/requests"/g) || []).length, 1);
});

test("Phase 4 actual request submission is explicit, accessible and confirmed by server identity", () => {
  assert.match(advisory, /<Dialog open=\{showNewModal\} onOpenChange=\{next => \{ if \(!next && !submitting\) setShowNewModal\(false\); \}\}>/);
  assert.match(advisory, /onEscapeKeyDown=\{event => \{ if \(submitting\) event\.preventDefault\(\); \}\}/);
  assert.match(advisory, /onInteractOutside=\{event => \{ if \(submitting\) event\.preventDefault\(\); \}\}/);
  assert.match(advisory, /<DialogTitle/);
  assert.match(advisory, /<DialogDescription/);
  assert.match(advisory, /<form onSubmit=\{handleCreateRequest\}/);
  assert.match(advisory, /const saved: unknown = await response\.json\(\)/);
  assert.match(advisory, /Number\.isSafeInteger\(saved\.id\)/);
  assert.match(advisory, /submitInFlight\.current = true/);
  assert.match(advisory, /submitInFlight\.current = false/);
  assert.match(advisory, /disabled=\{submitting\} onClick=\{\(\) => setShowNewModal\(false\)\}/);
  assert.match(advisory, /setSubmissionNotice\(/);
  assert.match(advisory, /role="alert"/);
  assert.match(advisory, /check existing requests before retrying to avoid duplicates/);
  assert.doesNotMatch(advisory, /onMouseDown=\{\(\) => setShowNewModal\(false\)\}/);
});
