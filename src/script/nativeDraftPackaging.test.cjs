"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

test("desktop distribution includes every native recovery runtime module, not just source tests", () => {
  const root = path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const files = manifest.build?.files;
  assert.ok(Array.isArray(files), "electron-builder file allowlist must be explicit");
  for (const name of ["main.cjs", "preload.cjs", "desktopArtifactDraftRecovery.cjs", "nativeDraftGrant.cjs"]) {
    assert.ok(files.includes(name), `electron-builder must package ${name} alongside main.cjs`);
    assert.equal(fs.existsSync(path.join(root, name)), true, `missing source for ${name}`);
  }
  const main = fs.readFileSync(path.join(root, "main.cjs"), "utf8");
  assert.match(main, /require\("\.\/nativeDraftGrant\.cjs"\)/);
  assert.match(main, /require\("\.\/desktopArtifactDraftRecovery\.cjs"\)/);
  for (const action of ["read", "write", "clear"]) {
    const channel = action === "read" ? "recovery-read" : action === "write" ? "recovery-write" : "recovery-clear";
    const pos = main.indexOf(`ipcMain.handle("limuria:artifact-draft-${channel}"`);
    assert.ok(pos > -1, `native ${action} IPC must exist`);
    assert.match(main.slice(pos, pos + 280), /verifyNativeDraftGrant\(localTrustToken/);
  }
  assert.match(manifest.scripts["test:desktop"], /node --check nativeDraftGrant\.cjs/);
  assert.match(manifest.scripts["test:desktop"], /node --check desktopArtifactDraftRecovery\.cjs/);
});
