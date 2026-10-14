import { spawnSync } from "node:child_process";

// P4 canonical behavior is proven by real persistence/ownership/revision tests,
// not source spelling, component names or stale copy-assignment expressions.
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=2",
  "server/artifactStore.projectRetention.test.ts",
  "server/artifactRestoreRevision.test.ts",
  "server/artifactRevisionMerge.test.ts",
  "server/artifactMaintenance.test.ts",
  "client/src/lib/artifactProposalReview.test.ts",
], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("P4 active Artifact workspace persistence/review/restore behavior: PASS (not packaged acceptance)");
