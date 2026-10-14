import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseSecretRef } from "@shared/secretRef";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-secretref-"));
process.env.LIOS_DATA_ROOT = path.join(root, "home");
process.env.HOME = path.join(root, "userhome");
fs.mkdirSync(process.env.HOME, { recursive: true });
delete process.env.SESSION_SECRET;
delete process.env.LIOS_SECRET_FILE_DIRS;

const { resolveCredential } = await import("./credentialVault");
const { getSessionSecret } = await import("./sessionSecret");
const { dataPath, stateDir } = await import("./dataRoot");

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("grammar accepts the three sources, the legacy bare vault name, and nothing that could name an arbitrary variable or path", () => {
  assert.deepEqual(parseSecretRef("env:LIOS_SECRET_FRED"), { source: "env", provider: "default", id: "LIOS_SECRET_FRED" });
  assert.deepEqual(parseSecretRef("file:/run/secrets/fred"), { source: "file", provider: "default", id: "/run/secrets/fred" });
  assert.deepEqual(parseSecretRef("vault:fred_api_key"), { source: "vault", provider: "default", id: "fred_api_key" });
  assert.deepEqual(parseSecretRef("fred_api_key"), { source: "vault", provider: "default", id: "fred_api_key" });
  for (const bad of ["env:DATABASE_URL", "env:SESSION_SECRET", "env:lios_secret_x", "file:relative/path", "file:", "vault:", "", "env:LIOS_SECRET_X\nY", "a b"]) {
    assert.equal(parseSecretRef(bad), null, JSON.stringify(bad));
  }
});

test("env references resolve only operator-staged LIOS_SECRET_ variables", () => {
  process.env.LIOS_SECRET_TEST_KEY = " staged-value ";
  process.env.SESSION_SECRET = "must-not-leak";
  try {
    assert.equal(resolveCredential("", "env:LIOS_SECRET_TEST_KEY"), "staged-value");
    assert.equal(resolveCredential("", "env:SESSION_SECRET"), null, "a reference cannot name an arbitrary variable");
    assert.equal(resolveCredential("", "env:LIOS_SECRET_MISSING"), null);
  } finally {
    delete process.env.LIOS_SECRET_TEST_KEY;
    delete process.env.SESSION_SECRET;
  }
});

test("file references read only private files inside approved secret directories", () => {
  const secrets = dataPath("secrets");
  fs.mkdirSync(secrets, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(secrets, "good"), "file-secret\n", { mode: 0o600 });
  assert.equal(resolveCredential("", `file:${path.join(secrets, "good")}`), "file-secret");

  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "key"), "outside-secret", { mode: 0o600 });
  assert.equal(resolveCredential("", `file:${path.join(outside, "key")}`), null, "not an approved directory");
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(outside, "key"), path.join(secrets, "link"));
    assert.equal(resolveCredential("", `file:${path.join(secrets, "link")}`), null, "a link out of the directory is refused");
    fs.writeFileSync(path.join(secrets, "open"), "world-readable", { mode: 0o644 });
    assert.equal(resolveCredential("", `file:${path.join(secrets, "open")}`), null, "permissive files are refused");
  }
  process.env.LIOS_SECRET_FILE_DIRS = outside;
  try {
    assert.equal(resolveCredential("", `file:${path.join(outside, "key")}`), "outside-secret", "operator-approved directory");
  } finally {
    delete process.env.LIOS_SECRET_FILE_DIRS;
  }
  assert.equal(resolveCredential("", `file:${path.join(secrets, "does-not-exist")}`), null);
});

test("the session and device-binding secret is random per Home, private, stable, and never a built-in default", () => {
  const first = getSessionSecret();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, "limuria-local-device-binding-v1");
  assert.equal(getSessionSecret(), first);
  const file = path.join(stateDir(), "session-secret");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  process.env.SESSION_SECRET = "operator-supplied";
  try {
    assert.equal(getSessionSecret(), "operator-supplied");
  } finally {
    delete process.env.SESSION_SECRET;
  }
});
