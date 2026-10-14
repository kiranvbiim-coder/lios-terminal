import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("CI disk recovery preserves the 6 GiB floor and only reclaims regenerable state", () => {
  const scriptPath = path.resolve(process.cwd(), "script/ci_runner_disk_preflight.sh");
  const source = fs.readFileSync(scriptPath, "utf8");

  execFileSync("bash", ["-n", scriptPath], { stdio: "pipe" });

  assert.match(source, /LIOS_CI_REQUIRED_FREE_KB:-6291456/, "CI must keep the 6 GiB minimum free-space floor");
  assert.match(source, /docker builder prune -af/, "build cache may be pruned as a final regenerable fallback");
  assert.match(source, /docker buildx prune -af/, "BuildKit cache may be pruned as a final regenerable fallback");
  assert.match(source, /find "\$temp_root".*name 'lios-\*'.*mmin \+120/, "only stale LiOS-prefixed temp entries may be removed");
  assert.match(source, /xcrun simctl delete unavailable/, "only unavailable simulator devices may be removed");
  assert.match(source, /brew cleanup --prune=all/, "superseded Homebrew artifacts may be reclaimed");

  for (const forbidden of [
    /docker\s+system\s+prune/i,
    /docker\s+image\s+prune/i,
    /docker\s+volume\s+prune/i,
    /docker\s+container\s+prune/i,
    /rm\s+-rf[^\n]*(?:\.ollama\/models|\.ollama["'/ ]|Models\/|Documents\/|Desktop\/)/i,
    /rm\s+-rf[^\n]*(?:\.ssh|\.gnupg|keychains|mobileprovision|provisioning profiles)/i,
    /rm\s+-rf[^\n]*RUNNER_TOOL_CACHE/i,
  ]) {
    assert.doesNotMatch(source, forbidden, `unsafe CI disk-recovery pattern detected: ${forbidden}`);
  }

  assert.match(
    source,
    /Docker disk usage \(diagnostic only; images\/volumes are never pruned\)/,
    "Docker diagnostics must document that persistent Docker assets are preserved",
  );
});
