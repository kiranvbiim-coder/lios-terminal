import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildV4OperationalReadiness, findV4OperationalItem, V4_OPERATIONAL_ITEMS } from "@shared/v4OperationalContracts";
import { registerOperationalReadinessRoutes } from "./operationalReadinessRoutes";

test("V4 operational readiness covers every final-wave board item", () => {
  const readiness = buildV4OperationalReadiness(new Date("2026-09-18T00:00:00.000Z"));
  assert.equal(readiness.contractVersion, "1.0.0");
  assert.equal(readiness.items.length, 55);
  assert.deepEqual(readiness.phases.map((phase) => phase.total), [11, 12, 8, 13, 11]);
  assert.equal(readiness.status, "partial");
  assert.ok(readiness.blockers.length > 0);
  assert.equal(readiness.generatedAt, "2026-09-18T00:00:00.000Z");
});

test("operational statuses remain explicit for external gates", () => {
  const keychain = findV4OperationalItem("LV4-25-03");
  const signing = findV4OperationalItem("LV4-29-03");
  assert.equal(keychain?.status, "partial");
  assert.equal(signing?.status, "partial");
  assert.ok(keychain?.blockers.length);
  assert.ok(signing?.nextAction.includes("Apple"));
});

test("operational inventory is immutable and has unique IDs", () => {
  const ids = V4_OPERATIONAL_ITEMS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^LV4-(25|26|27|28|29)-\d{2}$/.test(id)));
});

test("every published operational evidence path resolves to a repository file", () => {
  const repositoryRoot = path.resolve(process.cwd(), "..");
  const missing = V4_OPERATIONAL_ITEMS.flatMap((item) =>
    item.evidence
      .filter((relativePath) => {
        const evidencePath = path.resolve(repositoryRoot, relativePath);
        return !fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile();
      })
      .map((relativePath) => `${item.id}: ${relativePath}`),
  );
  assert.deepEqual(missing, []);
});

test("V4-25 through V4-29 expose read-only readiness and support surfaces", () => {
  const routes: string[] = [];
  const app = {
    get(path: string) { routes.push(`GET ${path}`); return this; },
  };
  registerOperationalReadinessRoutes(app as never);
  for (const expected of [
    "GET /api/operations/readiness",
    "GET /api/operations/acceptance",
    "GET /api/operations/provider-acceptance",
    "GET /api/operations/desktop-acceptance",
    "GET /api/operations/production-acceptance",
    "GET /api/operations/security-acceptance",
    "GET /api/operations/p7-release-readiness",
    "GET /api/operations/release",
    "GET /api/operations/items/:itemId",
    "GET /api/operations/support-summary",
  ]) assert.ok(routes.includes(expected), `missing ${expected}`);
});
