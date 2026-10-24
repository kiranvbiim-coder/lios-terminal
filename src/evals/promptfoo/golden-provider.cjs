/**
 * Optional Promptfoo custom JS provider. Executes only reviewed local golden routing
 * fixtures through the REAL LiOS planner. No arbitrary prompts or shell commands.
 */
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");

function runGoldenProbe(caseId, spawn = spawnSync) {
  if (typeof caseId !== "string" || !/^[A-Z][A-Z0-9]{1,15}$/.test(caseId)) {
    return { error: "Invalid golden case ID; only existing reviewed fixture IDs are permitted." };
  }
  const child = spawn(process.execPath, ["--import", "tsx", "evals/promptfoo/golden_probe.ts", caseId], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
    shell: false,
  });
  if (child.error || child.status !== 0 || child.signal) {
    return { error: `Golden planner probe unavailable or rejected ${caseId}.` };
  }
  try {
    const result = JSON.parse(child.stdout);
    if (result.caseId !== caseId || typeof result.passed !== "boolean" ||
        !Array.isArray(result.failures) || !Array.isArray(result.capabilities) ||
        !Array.isArray(result.entities)) {
      return { error: `Invalid golden planner output for ${caseId}.` };
    }
    const output = JSON.stringify(result);
    if (!result.passed) return { error: `Golden routing assertion failed for ${caseId}.`, output };
    return { output };
  } catch {
    return { error: `Invalid JSON from golden planner for ${caseId}.` };
  }
}

class LiOSGoldenProvider {
  id() { return "lios:offline-golden-routing"; }
  async callApi(_prompt, context) {
    return runGoldenProbe(context?.vars?.caseId);
  }
}

LiOSGoldenProvider.runGoldenProbe = runGoldenProbe;
module.exports = LiOSGoldenProvider;
