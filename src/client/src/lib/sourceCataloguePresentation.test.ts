import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sourceCataloguePresentation } from "./sourceCataloguePresentation";

test("failed first read is unavailable, never 'zero registered sources'", () => {
  const state = sourceCataloguePresentation({ hasData: false, failed: true, fetching: false, matchingCount: 0 });
  assert.equal(state.countLabel, null);
  assert.equal(state.emptyLabel, null);
  assert.match(state.healthLabel ?? "", /No source availability was verified/);
});

test("a failed refresh with cached records explicitly identifies stale rather than current catalogue", () => {
  const state = sourceCataloguePresentation({ hasData: true, failed: true, fetching: false, matchingCount: 3 });
  assert.equal(state.heading, "Previously loaded source catalogue");
  assert.equal(state.countLabel, "3 matching previously loaded sources");
  assert.match(state.healthLabel ?? "", /last loaded/);
  assert.match(state.emptyLabel ?? "", /Current source availability could not be verified/);
});

test("successful catalogue read may count registered records, but not grant access", () => {
  const state = sourceCataloguePresentation({ hasData: true, failed: false, fetching: false, matchingCount: 1 });
  assert.equal(state.heading, "Registered source catalogue");
  assert.equal(state.countLabel, "1 matching registered source");
  assert.match(state.emptyLabel ?? "", /No matching sources/);
  assert.equal(state.healthLabel, null);
  const updating = sourceCataloguePresentation({ hasData: true, failed: false, fetching: true, matchingCount: 2 });
  assert.match(updating.healthLabel ?? "", /Checking for source catalogue updates/);
});

test("Chat source menu uses the same canonical read and never calls an execution or scope-grant API", () => {
  const source = readFileSync(new URL("../components/terminal/ChatSourcesControl.tsx", import.meta.url), "utf8");
  assert.match(source, /apiRequest\("GET", "\/api\/setup\/source-registry"\)/);
  assert.match(source, /sourceCataloguePresentation\(\{/);
  assert.match(source, /registry\.data \? "Showing previously loaded records, not current availability\."/);
  assert.match(source, /aria-busy=\{registry\.isFetching\}/);
  assert.match(source, /onClick=\{\(\) => void registry\.refetch\(\)\}/);
  assert.match(source, /min-h-11/);
  assert.match(source, /onScopeChange\(item\.id\)/);
  assert.match(source, /onOpenConnections\(\)/);
  assert.match(source, /Choosing a scope does not grant access or start retrieval/);
  assert.doesNotMatch(source, /apiRequest\("(?:POST|PUT|PATCH|DELETE)"/);
});
