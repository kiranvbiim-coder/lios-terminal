import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { homeAttentionReadPresentation } from "./homeAttentionReadPresentation";
import { projectSavedWorkReadPresentation } from "./projectSavedWorkReadPresentation";
import { LIOS_FIRST_USE_CONTRACT } from "./firstUseJourney";

const source = (name: string) => readFileSync(new URL("../components/" + name, import.meta.url), "utf8");

test("Home unverified Pulse is not current attention and cannot authorize review writes", () => {
  const none = homeAttentionReadPresentation({ hasData: false, failed: true, pending: false, fetching: false, matchingCount: 0 });
  assert.equal(none.countText, null);
  assert.equal(none.emptyText, null);
  assert.equal(none.mayReview, false);
  const stale = homeAttentionReadPresentation({ hasData: true, failed: true, pending: false, fetching: false, matchingCount: 3 });
  assert.equal(stale.heading, "Previously recorded Home intelligence");
  assert.equal(stale.countText, "3 matching previously recorded items");
  assert.equal(stale.mayReview, false);
  const loading = homeAttentionReadPresentation({ hasData: true, failed: false, pending: false, fetching: true, matchingCount: 2 });
  assert.equal(loading.mayReview, false);
  const current = homeAttentionReadPresentation({ hasData: true, failed: false, pending: false, fetching: false, matchingCount: 0 });
  assert.equal(current.mayReview, true);
  assert.equal(current.emptyText, "No material intelligence currently needs attention.");
});

test("Project saved-work recovery disables stale-resource context changes", () => {
  const stale = projectSavedWorkReadPresentation({ chatsFailed: false, resourcesFailed: true, sessionsFailed: false, pending: false, fetching: false });
  assert.equal(stale.resourcesWritable, false);
  assert.equal(stale.retryAvailable, true);
  assert.match(stale.countQualifier, /Previously loaded or incomplete/);
  const fetching = projectSavedWorkReadPresentation({ chatsFailed: false, resourcesFailed: false, sessionsFailed: false, pending: false, fetching: true });
  assert.equal(fetching.resourcesWritable, false);
  assert.equal(fetching.retryAvailable, false);
  const fresh = projectSavedWorkReadPresentation({ chatsFailed: false, resourcesFailed: false, sessionsFailed: false, pending: false, fetching: false });
  assert.equal(fresh.resourcesWritable, true);
  const home = source("terminal/ProjectHome.tsx");
  assert.ok(home.includes("findProjectHomeItems(project.id, projectChats, projectResources, projectSessions, workQuery)"));
  assert.ok(home.includes("draft.projectId !== project.id || !savedWorkRead.resourcesWritable"));
  assert.ok(home.includes("Retry saved-work read"));
  assert.ok(home.includes("Resource records could not be verified"));
});

test("saved-work search supports read-only Retry and rejects late navigation UI outcomes", () => {
  const search = source("terminal/WorkSearchDialog.tsx");
  assert.ok(search.includes("encodeURIComponent(normalized)"));
  assert.ok(search.includes("workSearchResponseSchema.parse(await response.json())"));
  assert.ok(search.includes("controller.abort()"));
  assert.ok(search.includes("setRetrySequence(value => value + 1)"));
  assert.ok(search.includes("Retry saved-work search (read-only)"));
  assert.ok(search.includes("const epoch = navigationEpoch.current"));
  assert.ok(search.includes("currentOpen.current && navigationEpoch.current === epoch"));
  assert.ok(search.includes("navigationEpoch.current++"));
  assert.ok(!search.includes("setError(searchError instanceof Error ? searchError.message"));
  assert.ok(search.includes("shouldCloseSearchAfterNavigation(opened)"));
});

test("consulting requests remain explicitly user-submitted and never fake empty list on failure", () => {
  const advisory = source("panels/AdvisoryPanel.tsx");
  assert.ok(advisory.includes("const submitInFlight = useRef(false)"));
  assert.ok(advisory.includes("submitInFlight.current = true"));
  assert.ok(advisory.includes("submitInFlight.current = false"));
  assert.ok(advisory.includes('await apiRequest("POST", "/api/client/consulting/requests"'));
  assert.ok(advisory.includes("setRequestsLoadError(true)"));
  assert.ok(!advisory.includes("catch(() => setRequests([]))"));
  assert.ok(advisory.includes("Retry request list (read-only)"));
  assert.ok(advisory.includes("Submitting this form explicitly sends the details above"));
  assert.ok(advisory.includes("No engagement is started or automatically billed"));
  assert.ok(advisory.includes("setSubmitError("));
});

test("ask-first onboarding remains optional and keyboard accessible", () => {
  assert.equal(LIOS_FIRST_USE_CONTRACT.primaryAction, "ask");
  assert.equal(LIOS_FIRST_USE_CONTRACT.connectionsRequiredToEnter, false);
  const shell = source("terminal/ProjectExperienceShell.tsx");
  assert.ok(shell.includes('data-first-use-primary="ask"'));
  assert.ok(shell.includes('data-first-use-connect="optional"'));
  assert.ok(shell.includes("More options (optional)"));
  assert.ok(shell.includes("LIOS_FIRST_USE_CONTRACT.shellHint"));
  assert.ok(shell.includes("onClick={openSafeConnections}"));
  assert.ok(shell.includes("onClick={() => composerRef.current?.focus()}"));
});

test("Phase 3 reuses real Wave D Pulse, Project and Advisory authority", () => {
  const home = source("terminal/HomeAttentionPanel.tsx");
  const project = source("terminal/ProjectHome.tsx");
  const advisory = source("panels/AdvisoryPanel.tsx");
  assert.ok(home.includes('apiRequest("GET", "/api/wave-d/pulse")'));
  assert.ok(home.includes("homeAttentionReadPresentation({"));
  assert.ok(home.includes("const disableWrite = mutation.isPending || !readState.mayReview"));
  assert.ok(project.includes("useProjectChats(project.id)"));
  assert.ok(project.includes("useProjectResources(project.id)"));
  assert.ok(project.includes("useProjectSessions(project.id)"));
  assert.ok(advisory.includes("/api/client/consulting/requests"));
  assert.doesNotMatch(home + project, /autoSubmitConsulting|sponsoredImpression/);
});
