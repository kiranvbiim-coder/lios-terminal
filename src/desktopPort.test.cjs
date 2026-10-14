const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LEGACY_PORT, choosePersistentPort, readSavedPort } = require("./desktopPort.cjs");

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lios-port-")), "server-port.json");
const allFree = async () => true;

test("a new install gets a random high port and keeps it across launches", async () => {
  const file = tmp();
  const first = await choosePersistentPort({ file, existingInstall: false, isFree: allFree, random: () => 0.5 });
  assert.ok(first >= 20000 && first < 60000 && first !== LEGACY_PORT);
  assert.equal(readSavedPort(file), first);
  const second = await choosePersistentPort({ file, existingInstall: false, isFree: allFree, random: () => 0.9 });
  assert.equal(second, first, "the origin must stay stable so renderer storage survives");
});

test("an existing install keeps the historical port so upgrades lose no renderer state", async () => {
  const file = tmp();
  assert.equal(await choosePersistentPort({ file, existingInstall: true, isFree: allFree }), LEGACY_PORT);
  assert.equal(readSavedPort(file), LEGACY_PORT);
});

test("when the saved port is busy a new free port is chosen and saved", async () => {
  const file = tmp();
  await choosePersistentPort({ file, existingInstall: true, isFree: allFree });
  const busy = async (port) => port !== LEGACY_PORT;
  const next = await choosePersistentPort({ file, existingInstall: true, isFree: busy });
  assert.equal(next, LEGACY_PORT + 1);
  assert.equal(readSavedPort(file), LEGACY_PORT + 1);
});

test("an existing install scans a bounded window and fails clearly when nothing is free", async () => {
  await assert.rejects(choosePersistentPort({ file: tmp(), existingInstall: true, isFree: async () => false }), /No available local port/);
  await assert.rejects(choosePersistentPort({ file: tmp(), existingInstall: false, isFree: async () => false }), /No available local port/);
});

test("an operator-supplied PORT is honoured and never persisted", async () => {
  const file = tmp();
  assert.equal(await choosePersistentPort({ file, existingInstall: false, isFree: allFree, preferredFromEnv: 6100 }), 6100);
  assert.equal(fs.existsSync(file), false);
});

test("corrupt or out-of-range saved values are ignored", async () => {
  const file = tmp();
  fs.writeFileSync(file, '{"port": 80}');
  assert.equal(readSavedPort(file), null);
  fs.writeFileSync(file, "not json");
  assert.equal(readSavedPort(file), null);
});
