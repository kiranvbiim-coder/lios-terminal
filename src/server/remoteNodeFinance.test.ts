import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { test, type TestContext } from "node:test";
import { calculatePersonalFinanceSnapshot } from "./p6PersonalFinance";
import { executeNodeLocalFinanceSnapshot, loadNodeLocalFinanceSource } from "./remoteNodeFinance";

async function source(t: TestContext) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "lios-node-finance-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profilePath = path.join(directory, "profile.json");
  const profile = { schemaVersion: "1" as const, asOf: "2020-01-01", accounts: [{ id: "private-account-id", kind: "bank" as const, balance: 1000, currency: "INR" }], transactions: [], debts: [], goals: [], retirement: null };
  const content = JSON.stringify(profile);
  await writeFile(profilePath, content, { mode: 0o600 });
  return { directory, profile, content, configuration: { sourceId: "owned-profile", profilePath, ownerApproved: true as const, dataRights: "user-owned-profile" as const } };
}

test("node finance reuses canonical P6 math and exact file bytes without exporting raw identities", { skip: process.platform === "win32" }, async (t) => {
  const fixture = await source(t);
  const loaded = await loadNodeLocalFinanceSource(fixture.configuration);
  assert.equal(loaded.source.inputHash, createHash("sha256").update(fixture.content).digest("hex"));
  const report = await executeNodeLocalFinanceSnapshot(fixture.configuration, loaded.source);
  assert.equal(report.netWorth, calculatePersonalFinanceSnapshot(fixture.profile).netWorth);
  assert.equal(report.engineInputHash, calculatePersonalFinanceSnapshot(fixture.profile).inputHash);
  assert.doesNotMatch(JSON.stringify(report), /private-account-id|profilePath|profile\.json/);
  await writeFile(fixture.configuration.profilePath, fixture.content + "\n", { mode: 0o600 });
  await assert.rejects(executeNodeLocalFinanceSnapshot(fixture.configuration, loaded.source), /hash/);
  await assert.rejects(executeNodeLocalFinanceSnapshot(fixture.configuration, { ...loaded.source, sourceId: "another-source" }), /hash/);
});

test("node finance refuses unapproved, world-readable, missing and oversized sources", { skip: process.platform === "win32" }, async (t) => {
  const fixture = await source(t);
  await assert.rejects(loadNodeLocalFinanceSource({ ...fixture.configuration, ownerApproved: false as unknown as true }), /approval/);
  await assert.rejects(loadNodeLocalFinanceSource({ ...fixture.configuration, dataRights: undefined as unknown as "user-owned-profile" }), /rights/);
  await chmod(fixture.configuration.profilePath, 0o644);
  await assert.rejects(loadNodeLocalFinanceSource(fixture.configuration), /owner-only/);
  await chmod(fixture.configuration.profilePath, 0o600);
  await assert.rejects(loadNodeLocalFinanceSource({ ...fixture.configuration, profilePath: path.join(fixture.directory, "missing.json") }));
  await writeFile(fixture.configuration.profilePath, " ".repeat(256 * 1024 + 1));
  await assert.rejects(loadNodeLocalFinanceSource(fixture.configuration), /bounded/);
});

test("node finance refuses final and ancestor symlinks, directories and arbitrary relative paths", { skip: process.platform === "win32" }, async (t) => {
  const fixture = await source(t);
  const link = path.join(fixture.directory, "linked-profile.json");
  await symlink(fixture.configuration.profilePath, link);
  await assert.rejects(loadNodeLocalFinanceSource({ ...fixture.configuration, profilePath: link }), /symbolic/);
  const nested = path.join(fixture.directory, "nested");
  await mkdir(nested);
  await writeFile(path.join(nested, "profile.json"), fixture.content, { mode: 0o600 });
  const ancestor = path.join(fixture.directory, "ancestor");
  await symlink(nested, ancestor);
  await assert.rejects(loadNodeLocalFinanceSource({ ...fixture.configuration, profilePath: path.join(ancestor, "profile.json") }), /symbolic/);
  await assert.rejects(loadNodeLocalFinanceSource({ ...fixture.configuration, profilePath: nested }), /regular file/);
  await assert.rejects(loadNodeLocalFinanceSource({ ...fixture.configuration, profilePath: "profile.json" }), /absolute/);
});

test("node finance refuses future/invalid dates, nonfinite values, provider FX and simulation requests", { skip: process.platform === "win32" }, async (t) => {
  const fixture = await source(t);
  for (const invalid of [
    { ...fixture.profile, asOf: "2999-01-01" },
    { ...fixture.profile, asOf: "2020-02-31" },
    { ...fixture.profile, accounts: [{ ...fixture.profile.accounts[0], balance: null }] },
    { ...fixture.profile, fxNormalization: { reportingCurrency: "INR" } },
    { ...fixture.profile, retirementStress: { annualReturnVolatility: 0.2, paths: 100, yearsInRetirement: 30, seed: 1 } },
    { ...fixture.profile, accounts: Array.from({ length: 257 }, () => fixture.profile.accounts[0]) },
    { ...fixture.profile, accounts: [fixture.profile.accounts[0], { ...fixture.profile.accounts[0], id: "second", currency: "USD" }] },
    { ...fixture.profile, accounts: [fixture.profile.accounts[0], fixture.profile.accounts[0]] },
    { ...fixture.profile, transactions: [{ id: "orphan", at: "2019-12-01", amount: 1, category: "income", accountId: "missing" }] },
  ]) {
    await writeFile(fixture.configuration.profilePath, JSON.stringify(invalid));
    await assert.rejects(loadNodeLocalFinanceSource(fixture.configuration));
  }
  await writeFile(fixture.configuration.profilePath, fixture.content.replace('"balance":1000', '"balance":1e999'));
  await assert.rejects(loadNodeLocalFinanceSource(fixture.configuration));
});
