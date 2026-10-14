import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OwnerBootstrapCredentialError,
  prepareOwnerSetupToken,
  removeOwnerSetupToken,
  verifyOwnerSetupToken,
} from "./ownerBootstrapCredential";
import { PrivateSecretFileError, readPrivateSecretFile } from "./privateSecretFile";

function fixture(t: test.TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-owner-setup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("token is unguessable, 0600 and stable across restarts; it is destroyed after use", (t) => {
  const root = fixture(t);
  const first = prepareOwnerSetupToken(root, new Date("2026-10-02T09:00:00Z"));
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.created, true);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(root, "owner-setup.token")).mode & 0o777, 0o600);
  const second = prepareOwnerSetupToken(root, new Date("2026-10-02T09:05:00Z"));
  assert.equal(second.created, false);
  assert.equal(second.token, first.token);
  assert.equal(verifyOwnerSetupToken(first.token, root, new Date("2026-10-02T09:05:00Z")), true);
  for (const candidate of ["", "X".repeat(43), `${first.token}x`, null, undefined]) {
    assert.equal(verifyOwnerSetupToken(candidate, root, new Date("2026-10-02T09:05:00Z")), false);
  }
  removeOwnerSetupToken(root);
  assert.equal(fs.existsSync(path.join(root, "owner-setup.token")), false);
  assert.equal(verifyOwnerSetupToken(first.token, root), false);
});

test("an expired token fails and rotates only at next startup", (t) => {
  const root = fixture(t);
  const first = prepareOwnerSetupToken(root, new Date("2026-10-02T09:00:00Z"));
  assert.equal(verifyOwnerSetupToken(first.token, root, new Date("2026-10-03T09:00:00Z")), false);
  const next = prepareOwnerSetupToken(root, new Date("2026-10-03T09:00:01Z"));
  assert.equal(next.created, true);
  assert.notEqual(next.token, first.token);
  assert.equal(verifyOwnerSetupToken(first.token, root, new Date("2026-10-03T09:00:02Z")), false);
  assert.equal(verifyOwnerSetupToken(next.token, root, new Date("2026-10-03T09:00:02Z")), true);
});

test("token reader refuses symlinks and permissive files rather than regenerating over them", (t) => {
  const root = fixture(t);
  const tokenFile = path.join(root, "owner-setup.token");
  fs.symlinkSync(path.join(root, "missing"), tokenFile);
  assert.throws(() => prepareOwnerSetupToken(root), OwnerBootstrapCredentialError);
  fs.unlinkSync(tokenFile);
  prepareOwnerSetupToken(root);
  if (process.platform !== "win32") {
    fs.chmodSync(tokenFile, 0o644);
    assert.throws(() => verifyOwnerSetupToken("X".repeat(43), root), /private|regular/);
  }
});

test("password file must be absolute, regular, privately owned and no longer than one line", (t) => {
  const root = fixture(t);
  const file = path.join(root, "owner-password");
  fs.writeFileSync(file, "CorrectHorseBatteryStaple#2026\n", { mode: 0o600 });
  assert.equal(readPrivateSecretFile(file, "owner password file"), "CorrectHorseBatteryStaple#2026");
  assert.throws(() => readPrivateSecretFile("./owner-password", "owner password file"), /absolute/);
  fs.writeFileSync(file, "line 1\nline 2\n");
  assert.throws(() => readPrivateSecretFile(file, "owner password file"), /exactly one line/);
  if (process.platform !== "win32") {
    fs.writeFileSync(file, "private-but-visible-to-group");
    fs.chmodSync(file, 0o640);
    assert.throws(() => readPrivateSecretFile(file, "owner password file"), /private/);
  }
  const link = path.join(root, "owner-link");
  fs.symlinkSync(file, link);
  assert.throws(() => readPrivateSecretFile(link, "owner password file"), PrivateSecretFileError);
  fs.writeFileSync(path.join(root, "too-long"), crypto.randomBytes(1100));
  assert.throws(() => readPrivateSecretFile(path.join(root, "too-long"), "owner password file"), PrivateSecretFileError);
});
