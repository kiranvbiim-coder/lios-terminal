import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProviderStatuses } from "./providerStatus";
import { getVaultCredential, migrateLegacyConfigCredentials, setVaultCredential } from "./credentialVault";
import { getCredential, invalidateConfigCache, terminalConfigPath } from "./terminalConfig";

function withTempHome(config: Record<string, unknown>, fn: () => Promise<void> | void) {
  const previousRoot = process.env.LIOS_DATA_ROOT;
  const previousKey = process.env.FRED_API_KEY;
  const previousDataDir = process.env.LIMURIA_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-config-test-"));
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config), "utf8");
  process.env.LIOS_DATA_ROOT = dir;
  delete process.env.FRED_API_KEY;
  delete process.env.LIMURIA_DATA_DIR;
  invalidateConfigCache();
  return Promise.resolve(fn()).finally(() => {
    if (previousRoot === undefined) delete process.env.LIOS_DATA_ROOT; else process.env.LIOS_DATA_ROOT = previousRoot;
    if (previousKey === undefined) delete process.env.FRED_API_KEY; else process.env.FRED_API_KEY = previousKey;
    if (previousDataDir === undefined) delete process.env.LIMURIA_DATA_DIR; else process.env.LIMURIA_DATA_DIR = previousDataDir;
    invalidateConfigCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test("plaintext config.json credentials are moved into the vault once, the file keeps only settings, and a backup is kept", async () => {
  await withTempHome({ fredApiKey: "fred-secret", finnhubApiKey: "finnhub-secret", theme: "dark", region: "uk" }, () => {
    assert.match(terminalConfigPath() ?? "", /[\\/]config\.json$/);
    assert.equal(getCredential("FRED_API_KEY", "fredApiKey"), null, "plaintext is no longer read");
    setVaultCredential("finnhubApiKey", "already-in-vault", "existing");
    assert.equal(migrateLegacyConfigCredentials(), 2);
    assert.equal(getCredential("FRED_API_KEY", "fredApiKey"), "fred-secret");
    assert.equal(getVaultCredential("finnhubApiKey"), "already-in-vault", "an existing vault entry is never overwritten");
    const file = terminalConfigPath();
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(after, { theme: "dark", region: "uk" });
    assert.equal(fs.readFileSync(file, "utf8").includes("fred-secret"), false);
    const backup = `${file}.pre-gm07.bak`;
    assert.equal(JSON.parse(fs.readFileSync(backup, "utf8")).fredApiKey, "fred-secret");
    if (process.platform !== "win32") assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
    assert.equal(migrateLegacyConfigCredentials(), 0, "idempotent");
  });
});

test("provider status treats credentials migrated from a legacy config as configured", async () => {
  await withTempHome({ fredApiKey: "fred-secret", lseApiKey: "lse-secret", finnhubApiKey: "finnhub-secret", simfinApiKey: "simfin-secret", fmpApiKey: "fmp-secret" }, async () => {
    assert.equal(migrateLegacyConfigCredentials(), 5);
    const statuses = await getProviderStatuses();
    const byId = new Map(statuses.map((status) => [status.id, status]));
    assert.equal(byId.get("fred")?.state, "configured");
    assert.equal(byId.get("lse")?.state, "configured");
    assert.equal(byId.get("finnhub")?.state, "configured");
    assert.equal(byId.get("simfin")?.state, "configured");
    assert.equal(byId.get("fmp")?.state, "configured");
    assert.ok(!JSON.stringify(statuses).includes("secret"));
  });
});
