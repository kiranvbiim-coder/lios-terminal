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

test("published evidence files resolve, while privately withheld workflows remain explicitly NOT_RUN", () => {
  const repositoryRoot = path.resolve(process.cwd(), "..");
  // This public snapshot intentionally excludes private signing, release and
  // hardware qualification workflows. A missing, *unlisted* evidence file is
  // still a regression, never a success or an unconditional test skip.
  const distribution = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, "third_party/source-distribution.json"), "utf8",
  )) as {
    distribution: string;
    sourceWorkflow: string;
    withheldWorkflows: string[];
    qualification: Record<string, string>;
  };
  assert.equal(distribution.distribution, "sanitized_proprietary_source_only");
  assert.deepEqual(new Set(Object.values(distribution.qualification)), new Set(["NOT_RUN"]));
  assert.equal(distribution.sourceWorkflow, ".github/workflows/source-cross-platform.yml");
  assert.ok(fs.statSync(path.join(repositoryRoot, distribution.sourceWorkflow)).isFile());

  const withheld = new Set(distribution.withheldWorkflows);
  assert.equal(withheld.size, distribution.withheldWorkflows.length, "duplicate withheld workflow paths");
  for (const relativePath of withheld) {
    assert.match(relativePath, /^\.github\/workflows\/[a-z0-9._-]+\.ya?ml$/i);
    assert.equal(fs.existsSync(path.join(repositoryRoot, relativePath)), false,
      `Withheld workflow was accidentally published: ${relativePath}`);
  }

  const missing = V4_OPERATIONAL_ITEMS.flatMap((item) =>
    item.evidence
      .filter((relativePath) => {
        const evidencePath = path.resolve(repositoryRoot, relativePath);
        return !fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile();
      })
      .map((relativePath) => ({ item: item.id, relativePath })),
  );

  assert.deepEqual(
    missing.filter(({ relativePath }) => !withheld.has(relativePath)),
    [],
    "All non-withheld operational evidence must exist as a repository file",
  );
  // Lock the inventory's reference to private-only evidence regardless of
  // whether a given test fixture makes the relative files appear present.
  // Every missing non-withheld file is already a hard failure above.
  const citedWithheld = new Set(
    V4_OPERATIONAL_ITEMS.flatMap((item) => item.evidence)
      .filter((relativePath) => withheld.has(relativePath)),
  );
  assert.deepEqual([...citedWithheld].sort(), [
    ".github/workflows/lios-hardening.yml",
    ".github/workflows/production-release-readiness.yml",
    ".github/workflows/windows-release.yml",
  ]);
  for (const relativePath of citedWithheld) {
    assert.equal(fs.existsSync(path.join(repositoryRoot, relativePath)), false,
      `Private evidence must not be published: ${relativePath}`);
  }
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
