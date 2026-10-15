const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { configureAutoUpdater, resolveUpdateUrl, DEFAULT_UPDATE_URL } = require("./desktopUpdater.cjs");

function makeUpdater({ checkError = null } = {}) {
  const events = new Map();
  const calls = [];
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    allowPrerelease: true,
    setFeedURL(value) { calls.push(["feed", value]); },
    on(event, handler) { events.set(event, handler); },
    checkForUpdates() {
      calls.push(["check"]);
      return checkError ? Promise.reject(checkError) : Promise.resolve();
    },
    quitAndInstall(isSilent, isForceRunAfter) {
      calls.push(["quitAndInstall", isSilent, isForceRunAfter]);
    },
  };
  return { updater, events, calls };
}

function packagedOptions(updater, overrides = {}) {
  return {
    updater,
    isPackaged: true,
    env: {},
    confirmInstall: async () => false,
    log() {},
    ...overrides,
  };
}

test("desktop updater accepts HTTPS syntax for build-time feed validation and has no source-code default feed", () => {
  assert.equal(DEFAULT_UPDATE_URL, null);
  assert.equal(resolveUpdateUrl({}), null);
  assert.equal(resolveUpdateUrl({ LIOS_UPDATE_URL: "https://updates.example.test/lios" }), "https://updates.example.test/lios/");
});

test("desktop updater rejects insecure or malformed feed syntax", () => {
  assert.equal(resolveUpdateUrl({ LIOS_UPDATE_URL: "http://updates.example.test" }), null);
  assert.equal(resolveUpdateUrl({ LIOS_UPDATE_URL: "http://localhost:4312" }), null);
  assert.equal(resolveUpdateUrl({ LIOS_UPDATE_URL: "not-a-url" }), null);
});

test("development is disabled while packaged builds use only embedded app-update.yml authority", () => {
  const dev = makeUpdater();
  assert.deepEqual(configureAutoUpdater({ updater: dev.updater, isPackaged: false, env: {} }), {
    enabled: false,
    reason: "Desktop updates are disabled for unpackaged development launches.",
  });
  assert.deepEqual(dev.calls, []);

  const packaged = makeUpdater();
  assert.deepEqual(configureAutoUpdater(packagedOptions(packaged.updater)), {
    enabled: true,
    url: null,
    source: "packaged_config",
  });
  assert.equal(packaged.updater.autoDownload, true);
  assert.equal(packaged.updater.autoInstallOnAppQuit, false);
  assert.equal(packaged.updater.allowDowngrade, false);
  assert.equal(packaged.updater.allowPrerelease, false);
  assert.deepEqual(packaged.calls, [["check"]]);
  assert.equal(packaged.events.has("update-downloaded"), true);
});

test("packaged runtime environment cannot replace the embedded release feed", () => {
  const { updater, calls } = makeUpdater();
  const logs = [];
  const configured = configureAutoUpdater(packagedOptions(updater, {
    env: { LIOS_UPDATE_URL: "https://attacker-controlled.example/lios" },
    log(message) { logs.push(String(message)); },
  }));
  assert.deepEqual(configured, {
    enabled: true,
    url: null,
    source: "packaged_config",
  });
  assert.deepEqual(calls, [["check"]]);
  assert.equal(logs.some((line) => line.includes("attacker-controlled.example")), false);
});

test("downloaded desktop update installs only after explicit confirmation", async () => {
  const { updater, events, calls } = makeUpdater();
  const confirmations = [];
  configureAutoUpdater(packagedOptions(updater, {
    confirmInstall: async ({ version }) => {
      confirmations.push(version);
      return true;
    },
  }));

  await events.get("update-downloaded")({ version: "1.2.3" });

  assert.deepEqual(confirmations, ["1.2.3"]);
  assert.deepEqual(calls, [["check"], ["quitAndInstall", false, true]]);
});

test("declining desktop update confirmation never installs on quit or restart", async () => {
  const { updater, events, calls } = makeUpdater();
  const logs = [];
  configureAutoUpdater(packagedOptions(updater, {
    confirmInstall: async () => false,
    log(message) { logs.push(String(message)); },
  }));

  await events.get("update-downloaded")({ version: "1.2.3" });

  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.deepEqual(calls, [["check"]]);
  assert.equal(logs.some((line) => line.includes("deferred by user")), true);
});

test("desktop update confirmation failure fails closed without raw external text", async () => {
  const secret = "prompt-secret-token";
  const { updater, events, calls } = makeUpdater();
  const logs = [];
  configureAutoUpdater(packagedOptions(updater, {
    confirmInstall: async () => {
      throw new Error(`native prompt failed ${secret}`);
    },
    log(message) { logs.push(String(message)); },
  }));

  await events.get("update-downloaded")({ version: "1.2.3" });

  assert.deepEqual(calls, [["check"]]);
  assert.equal(logs.some((line) => line.includes(secret)), false);
  assert.equal(logs.some((line) => line.includes("confirmation failed safely")), true);
});

test("duplicate downloaded events cannot open concurrent install confirmations", async () => {
  const { updater, events, calls } = makeUpdater();
  let resolveConfirmation;
  let confirmationCount = 0;
  const pendingConfirmation = new Promise((resolve) => { resolveConfirmation = resolve; });
  configureAutoUpdater(packagedOptions(updater, {
    confirmInstall: async () => {
      confirmationCount += 1;
      return pendingConfirmation;
    },
  }));

  const first = events.get("update-downloaded")({ version: "1.2.3" });
  const second = events.get("update-downloaded")({ version: "1.2.3" });
  assert.equal(confirmationCount, 1);
  resolveConfirmation(true);
  await Promise.all([first, second]);

  assert.equal(confirmationCount, 1);
  assert.deepEqual(calls, [["check"], ["quitAndInstall", false, true]]);
});

test("desktop updater never logs raw external error text", async () => {
  const secret = "super-secret-token";
  const { updater, events } = makeUpdater({
    checkError: new Error(`request failed https://updates.example.test/?token=${secret}`),
  });
  const logs = [];
  configureAutoUpdater(packagedOptions(updater, {
    log(message) { logs.push(String(message)); },
  }));
  events.get("error")(new Error(`provider rejected credential ${secret}`));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(logs.some((line) => line.includes(secret)), false);
  assert.equal(logs.some((line) => line.includes("token=")), false);
  assert.equal(logs.filter((line) => line.includes("Desktop update failed safely.")).length >= 1, true);
});

test("desktop main process supplies a native safe-default install confirmation", () => {
  const mainSource = fs.readFileSync(require.resolve("./main.cjs"), "utf8");
  assert.match(mainSource, /confirmInstall:\s*async\s*\(\{\s*version\s*\}\)\s*=>/);
  assert.match(mainSource, /dialog\.showMessageBox\(mainWindow,\s*\{/);
  assert.match(mainSource, /buttons:\s*\[\s*"Later"\s*,\s*"Restart and install"\s*\]/);
  assert.match(mainSource, /defaultId:\s*0/);
  assert.match(mainSource, /cancelId:\s*0/);
  assert.match(mainSource, /return\s+confirmation\.response\s*===\s*1/);
});
