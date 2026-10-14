"use strict";

const MiB = 1024 * 1024;

const P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS = Object.freeze({
  schemaVersion: "1",
  electronAppReadyElapsedMsMax: 20_000,
  desktopSelfTestElapsedMsMax: 60_000,
  mainProcessRssBytesMax: 1024 * MiB,
  mainProcessHeapUsedBytesMax: 512 * MiB,
});

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function evaluateP14PackagedPerformance(performance) {
  const errors = [];
  if (!performance || typeof performance !== "object") {
    return { ok: false, errors: ["Packaged performance measurements are missing."] };
  }

  const memory = performance.mainProcessMemoryAtCompletion;
  const values = [
    ["electronAppReadyElapsedMs", performance.electronAppReadyElapsedMs, P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS.electronAppReadyElapsedMsMax],
    ["desktopSelfTestElapsedMs", performance.desktopSelfTestElapsedMs, P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS.desktopSelfTestElapsedMsMax],
    ["mainProcessMemoryAtCompletion.rssBytes", memory?.rssBytes, P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS.mainProcessRssBytesMax],
    ["mainProcessMemoryAtCompletion.heapUsedBytes", memory?.heapUsedBytes, P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS.mainProcessHeapUsedBytesMax],
  ];

  for (const [name, value, max] of values) {
    if (!finiteNonNegative(value)) errors.push(name + " must be a finite non-negative measurement.");
    else if (value > max) errors.push(name + " exceeded the release safety ceiling: " + value + " > " + max + ".");
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS,
  evaluateP14PackagedPerformance,
};
