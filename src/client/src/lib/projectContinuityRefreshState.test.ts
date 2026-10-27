import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  canBeginProjectRefresh,
  visibleProjectRefreshNotice,
} from "./projectContinuityRefreshState";

test("refresh notices only appear in the exact original Project", () => {
  const first = { projectId: 17, text: "2 retained changes are visible" };
  assert.equal(visibleProjectRefreshNotice(first, 17), first.text);
  assert.equal(visibleProjectRefreshNotice(first, 18), null);
  assert.equal(visibleProjectRefreshNotice(first, 0), null);
  assert.equal(visibleProjectRefreshNotice(null, 17), null);
});

test("an in-flight Project recompute is never repeated; distinct Projects can proceed independently", () => {
  const inFlight = new Set([17]);
  assert.equal(canBeginProjectRefresh(inFlight, 17), false);
  assert.equal(canBeginProjectRefresh(inFlight, 18), true);
  inFlight.add(18);
  assert.equal(canBeginProjectRefresh(inFlight, 18), false);
  inFlight.delete(17);
  assert.equal(canBeginProjectRefresh(inFlight, 17), true);
});

test("invalid or unsafe Project identities cannot initiate a refresh", () => {
  const inFlight = new Set<number>();
  assert.equal(canBeginProjectRefresh(inFlight, 0), false);
  assert.equal(canBeginProjectRefresh(inFlight, -1), false);
  assert.equal(canBeginProjectRefresh(inFlight, 1.5), false);
  assert.equal(canBeginProjectRefresh(inFlight, Number.POSITIVE_INFINITY), false);
  assert.equal(canBeginProjectRefresh(inFlight, Number.MAX_SAFE_INTEGER + 1), false);
});

test("mounted P6 refresh snapshots exact request scope and suppresses stale responses", () => {
  const source = readFileSync(new URL("../components/terminal/ProjectContinuityPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /const requestedProjectId = projectId;/);
  assert.match(source, /if \(!canBeginProjectRefresh\(inFlightProjectsRef\.current, requestedProjectId\)\) return;/);
  assert.match(source, /inFlightProjectsRef\.current\.add\(requestedProjectId\);/);
  assert.match(source, /await refreshP6ProjectContinuity\(requestedProjectId\)/);
  assert.match(source, /invalidate\(requestedProjectId\)/);
  assert.match(source, /if \(currentProjectRef\.current !== requestedProjectId\) return;/);
  assert.match(source, /if \(currentProjectRef\.current === requestedProjectId\)/);
  assert.match(source, /inFlightProjectsRef\.current\.delete\(requestedProjectId\)/);
  assert.match(source, /const message = visibleProjectRefreshNotice\(notice, projectId\);/);
  assert.match(source, /aria-busy=\{refreshing\}/);
  assert.doesNotMatch(source, /refreshP6ProjectContinuity\(projectId\)/);
});

test("missing Project decision counts are not misreported as zero", () => {
  const source = readFileSync(new URL("../components/terminal/ProjectContinuityPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /snapshot \? `\$\{snapshot\.counts\.unresolvedDecisions\} open` : "Unavailable"/);
  assert.doesNotMatch(source, /snapshot\?\.counts\.unresolvedDecisions \?\? 0/);
  assert.match(source, /setNotice\(focused \? null : \{/);
  assert.match(source, /projectId,/);
  assert.match(source, /Nothing was run or changed/);
});
