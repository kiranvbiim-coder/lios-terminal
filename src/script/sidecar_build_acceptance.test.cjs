"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { qualifyBuiltPythonSidecar, hasCompleteSidecarBuildProof } = require("./sidecar_build_acceptance.cjs");

const result = {
  authentication: {
    unauthenticatedRejected: true,
    wrongTokenRejected: true,
    healthMinimal: true,
  },
  representativeRoute: { verified: true, route: "/stats/descriptive-diagnostics", mean: 3 },
  valuationRoute: {
    verified: true, route: "/advanced/valuation/reverse-dcf",
    impliedRevenueGrowthPct: 0, repricedEquityValue: 100,
  },
};

test("native frozen sidecar requires authenticated known-answer valuation, not health alone", async () => {
  assert.equal(hasCompleteSidecarBuildProof(result), true);
  const accepted = await qualifyBuiltPythonSidecar("/fake/build-sidecar", async ({ executable }) => {
    assert.equal(executable, "/fake/build-sidecar");
    return result;
  });
  assert.deepEqual(accepted, {
    qualified: true, authenticated: true, valuationKnownAnswer: true, packaged: false,
  });
});

test("missing authentication, missing valuation, bogus reverse-DCF and missing source are rejected", async () => {
  for (const unsafe of [
    null, {},
    { ...result, authentication: { ...result.authentication, wrongTokenRejected: false } },
    { ...result, representativeRoute: { ...result.representativeRoute, mean: 0 } },
    { ...result, valuationRoute: { ...result.valuationRoute, verified: false } },
    { ...result, valuationRoute: { ...result.valuationRoute, impliedRevenueGrowthPct: 5 } },
    { ...result, valuationRoute: { ...result.valuationRoute, repricedEquityValue: 95 } },
  ]) {
    assert.equal(hasCompleteSidecarBuildProof(unsafe), false);
    await assert.rejects(
      () => qualifyBuiltPythonSidecar("/fake/build-sidecar", async () => unsafe),
      /did not pass authenticated calculations and reverse-DCF/,
    );
  }
  await assert.rejects(() => qualifyBuiltPythonSidecar("", async () => result), /missing an executable/);
});

test("unexpected Python stderr and private path from probe cannot escape release diagnostics", async () => {
  const secret = "PRIVATE_PYTHON_TRACEBACK /Users/operator/private/cert";
  await assert.rejects(
    () => qualifyBuiltPythonSidecar("/private/working-path", async () => {
      throw new Error(secret);
    }),
    error => {
      assert.match(error.message, /qualification failed/);
      assert.doesNotMatch(error.message, /PRIVATE_PYTHON_TRACEBACK|operator|cert/);
      return true;
    },
  );
});

test("PyInstaller builder invokes proof after checking actual frozen executable", () => {
  const source = fs.readFileSync(path.join(__dirname, "build_python_sidecar.cjs"), "utf8");
  assert.match(source, /qualifyBuiltPythonSidecar\(executable\)/);
  assert.match(source, /process\.exitCode = 1/);
  assert.ok(source.indexOf("fs.existsSync(executable)") < source.indexOf("qualifyBuiltPythonSidecar(executable)"));
  assert.doesNotMatch(source, /LIOS_SKIP_BUNDLED_SIDECAR_PROBE|QUALIFICATION_BYPASS/);
});
