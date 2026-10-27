"use strict";
/**
 * Native PyInstaller build acceptance on the LOCAL, just-built executable.
 * The installed/packaged application still requires independent verification.
 * No live credentials, raw worker output, response bodies or local paths are
 * written to shared release logs.
 */
const { probeBundledPythonSidecar } = require("../desktopPythonSidecar.cjs");

function hasCompleteSidecarBuildProof(result) {
  return result?.authentication?.unauthenticatedRejected === true
    && result.authentication.wrongTokenRejected === true
    && result.authentication.healthMinimal === true
    && result.representativeRoute?.verified === true
    && result.representativeRoute.route === "/stats/descriptive-diagnostics"
    && result.representativeRoute.mean === 3
    && result.valuationRoute?.verified === true
    && result.valuationRoute.route === "/advanced/valuation/reverse-dcf"
    && result.valuationRoute.impliedRevenueGrowthPct === 0
    && result.valuationRoute.repricedEquityValue === 100;
}

async function qualifyBuiltPythonSidecar(executable, probe = probeBundledPythonSidecar) {
  // No skipped acceptance mode: an executable's mere presence is never enough.
  if (typeof executable !== "string" || !executable) {
    throw new Error("Bundled sidecar build missing an executable.");
  }
  let result;
  try {
    result = await probe({ executable });
  } catch {
    // The original probe already sanitizes expected 502s; avoid ever exposing
    // arbitrary worker output, local build paths or native loader diagnostics.
    throw new Error("Bundled sidecar build qualification failed; review private native diagnostics.");
  }
  if (!hasCompleteSidecarBuildProof(result)) {
    throw new Error("Bundled sidecar build did not pass authenticated calculations and reverse-DCF.");
  }
  return {
    qualified: true,
    authenticated: true,
    valuationKnownAnswer: true,
    packaged: false,
  };
}

module.exports = { hasCompleteSidecarBuildProof, qualifyBuiltPythonSidecar };
