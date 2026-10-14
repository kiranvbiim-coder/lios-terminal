import { buildDesktopAcceptanceSnapshot } from "../server/desktopAcceptance";

const snapshot = buildDesktopAcceptanceSnapshot();
const ids = snapshot.rows.map((row) => row.id);

if (new Set(ids).size !== ids.length) throw new Error("Desktop acceptance ledger contains duplicate row IDs.");
if (snapshot.rows.length === 0) throw new Error("Desktop acceptance ledger is empty.");

for (const row of snapshot.rows) {
  if (!row.nextAction.trim()) throw new Error(`${row.id}: next action is required.`);
  if (row.state === "verified") {
    if (row.blockers.length > 0) throw new Error(`${row.id}: verified rows cannot retain blockers.`);
  } else if (row.blockers.length === 0) {
    throw new Error(`${row.id}: non-verified rows must name a blocker.`);
  }
}

for (const required of [
  "desktop:native-secret-custody",
  "desktop:bundled-python-sidecar",
  "desktop:workspace-recovery-contract",
  "desktop:signed-release-workflows",
  "desktop:macos-signed-notarized",
  "desktop:windows-authenticode",
  "desktop:macos-clean-install",
  "desktop:windows-clean-install",
  "desktop:macos-update-rollback",
  "desktop:windows-update-rollback",
  "desktop:macos-accessibility",
  "desktop:windows-accessibility",
]) {
  if (!snapshot.rows.some((row) => row.id === required)) throw new Error(`Missing required P2 row ${required}.`);
}

for (const category of ["custody", "runtime", "recovery", "macos", "windows", "update", "accessibility"] as const) {
  if (!snapshot.rows.some((row) => row.category === category)) throw new Error(`Missing P2 category ${category}.`);
}

console.log(JSON.stringify({
  contractVersion: snapshot.contractVersion,
  generatedAt: snapshot.generatedAt,
  status: snapshot.status,
  counts: snapshot.counts,
  blockedIds: snapshot.rows.filter((row) => row.state !== "verified").map((row) => row.id),
}, null, 2));
