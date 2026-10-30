import assert from "node:assert/strict";
import test from "node:test";
import { homeAttentionReadPresentation } from "./homeAttentionReadPresentation";
import { projectSavedWorkReadPresentation } from "./projectSavedWorkReadPresentation";
import { LIOS_FIRST_USE_CONTRACT } from "./firstUseJourney";


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
});


test("ask-first onboarding remains optional and keyboard accessible", () => {
  assert.equal(LIOS_FIRST_USE_CONTRACT.primaryAction, "ask");
  assert.equal(LIOS_FIRST_USE_CONTRACT.connectionsRequiredToEnter, false);
});

