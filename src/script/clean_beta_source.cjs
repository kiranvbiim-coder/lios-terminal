"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

/**
 * The exact commit stamped into beta metadata must represent every tracked
 * and non-ignored source file in the full checkout. A status launched from
 * src/ alone misses dirty root-level files; --untracked-files=no also misses
 * new source imports. Ignored generated sidecars remain allowed.
 */
function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Unable to inspect the exact beta source checkout.");
  }
  return String(result.stdout || "").trim();
}

function requireCleanBetaSourceCommit(cwd) {
  const root = fs.realpathSync(runGit(["rev-parse", "--show-toplevel"], cwd));
  const commit = runGit(["rev-parse", "--verify", "HEAD"], root);
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("Beta packaging requires an exact 40-hex Git source commit.");
  }
  const dirty = runGit(["status", "--porcelain=v1", "--untracked-files=normal"], root);
  if (dirty) {
    throw new Error("Beta packaging requires the complete Git checkout to be clean, including untracked source.");
  }
  return commit;
}

module.exports = { requireCleanBetaSourceCommit };
