import { buildProviderAcceptanceSnapshot } from "../server/providerAcceptance";

const snapshot = await buildProviderAcceptanceSnapshot();

const ids = snapshot.rows.map((row) => row.id);
if (new Set(ids).size !== ids.length) {
  throw new Error("Provider acceptance ledger contains duplicate row IDs.");
}
if (snapshot.rows.length === 0) {
  throw new Error("Provider acceptance ledger is empty.");
}

for (const row of snapshot.rows) {
  if (row.state === "verified") {
    if (!row.liveVerified || !row.evidenceAt || row.blockers.length > 0) {
      throw new Error(`${row.id}: verified rows require dated live evidence and zero blockers.`);
    }
  } else if (row.blockers.length === 0) {
    throw new Error(`${row.id}: non-verified rows must name at least one blocker.`);
  }
  if (!row.nextAction.trim()) {
    throw new Error(`${row.id}: every row must name a next action.`);
  }
}

for (const category of ["ai", "data", "news", "communications"] as const) {
  if (!snapshot.rows.some((row) => row.category === category)) {
    throw new Error(`Provider acceptance ledger is missing category ${category}.`);
  }
}

for (const requiredId of [
  "communications:gmail",
  "communications:microsoft365",
  "communications:imap",
  "communications:smtp",
  "communications:slack",
  "communications:teams",
  "communications:webhook",
  "news:google_rss",
]) {
  if (!snapshot.rows.some((row) => row.id === requiredId)) {
    throw new Error(`Provider acceptance ledger is missing required P1 row ${requiredId}.`);
  }
}

const serialized = JSON.stringify(snapshot);
for (const forbidden of [
  /api[_-]?key\s*[:=]\s*["'][^"']+/i,
  /password\s*[:=]\s*["'][^"']+/i,
  /bearer\s+[a-z0-9._-]{8,}/i,
  /pdl_[a-z0-9_-]{8,}/i,
]) {
  if (forbidden.test(serialized)) {
    throw new Error("Provider acceptance ledger appears to contain credential material.");
  }
}

console.log(JSON.stringify({
  contractVersion: snapshot.contractVersion,
  generatedAt: snapshot.generatedAt,
  status: snapshot.status,
  counts: snapshot.counts,
  blockedIds: snapshot.rows.filter((row) => row.state !== "verified").map((row) => row.id),
}, null, 2));
