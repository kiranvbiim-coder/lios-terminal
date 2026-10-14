import test from "node:test";
import assert from "node:assert/strict";
import { packageNameFromLockPath, productionVersionsFromLock, summarizeBulkAdvisories } from "./audit_production_dependencies.mjs";

test("production audit extracts exact non-dev locked versions including nested/scoped packages", () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: "root", version: "1.0.0" },
      "node_modules/prod": { version: "2.0.0" },
      "node_modules/@scope/pkg": { version: "3.0.0" },
      "node_modules/dev-only": { version: "4.0.0", dev: true },
      "node_modules/prod/node_modules/nested": { version: "5.0.0" },
    },
  };
  assert.deepEqual(productionVersionsFromLock(lock), {
    "@scope/pkg": ["3.0.0"],
    "nested": ["5.0.0"],
    "prod": ["2.0.0"],
  });
  assert.equal(packageNameFromLockPath("node_modules/@scope/pkg", {}), "@scope/pkg");
});

test("production audit fails closed on unversioned production lock entries", () => {
  assert.throws(
    () => productionVersionsFromLock({ lockfileVersion: 3, packages: { "": {}, "node_modules/bad": {} } }),
    /missing a concrete version/i,
  );
});

test("bulk advisory parser preserves severity and rejects malformed/unknown results", () => {
  assert.deepEqual(summarizeBulkAdvisories({
    alpha: [{ severity: "high", title: "Example", url: "https://example.test/a", vulnerable_versions: "<2" }],
  }), [{
    packageName: "alpha",
    severity: "high",
    title: "Example",
    url: "https://example.test/a",
    vulnerableVersions: "<2",
  }]);
  assert.throws(() => summarizeBulkAdvisories({ alpha: [{ severity: "mystery" }] }), /unknown severity/i);
  assert.throws(() => summarizeBulkAdvisories({ alpha: {} }), /not an array/i);
});
