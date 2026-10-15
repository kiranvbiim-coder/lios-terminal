const assert = require("node:assert/strict");
const test = require("node:test");
const { configureAutoUpdater, createDesktopUpdateInstallController, resolveUpdateUrl, DEFAULT_UPDATE_URL } = require("./desktopUpdater.cjs");

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
    quitAndInstall(...args) { calls.push(["install", ...args]); },
  };
  return { updater, events, calls };
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
  assert.deepEqual(configureAutoUpdater({ updater: packaged.updater, isPackaged: true, env: {}, log() {} }), {
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
  const configured = configureAutoUpdater({
    updater,
    isPackaged: true,
    env: { LIOS_UPDATE_URL: "https://attacker-controlled.example/lios" },
    log(message) { logs.push(String(message)); },
  });
  assert.deepEqual(configured, {
    enabled: true,
    url: null,
    source: "packaged_config",
  });
  assert.deepEqual(calls, [["check"]]);
  assert.equal(logs.some((line) => line.includes("attacker-controlled.example")), false);
});

test("desktop updater never logs raw external error text", async () => {
  const secret = "super-secret-token";
  const { updater, events } = makeUpdater({
    checkError: new Error(`request failed https://updates.example.test/?token=${secret}`),
  });
  const logs = [];
  configureAutoUpdater({
    updater,
    isPackaged: true,
    env: {},
    log(message) { logs.push(String(message)); },
  });
  events.get("error")(new Error(`provider rejected credential ${secret}`));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(logs.some((line) => line.includes(secret)), false);
  assert.equal(logs.some((line) => line.includes("token=")), false);
  assert.equal(logs.filter((line) => line.includes("Desktop update failed safely.")).length >= 1, true);
});

test("desktop update install requires explicit approval and never installs on decline", async () => {
  const { updater, calls } = makeUpdater();
  let approved = false;
  const controller = createDesktopUpdateInstallController({
    updater,
    confirmInstall: async ({ version }) => {
      assert.equal(version, "1.2.3");
      return approved;
    },
    log() {},
  });

  assert.deepEqual(await controller.handleDownloaded({ version: "1.2.3" }), {
    accepted: false,
    reason: "cancelled",
    version: "1.2.3",
  });
  assert.equal(calls.some(([name]) => name === "install"), false);

  approved = true;
  assert.deepEqual(await controller.handleDownloaded({ version: "1.2.3" }), {
    accepted: true,
    version: "1.2.3",
  });
  assert.deepEqual(calls.filter(([name]) => name === "install"), [["install", false, true]]);
});

test("desktop update confirmation receives only a bounded version and failures never log raw external text", async () => {
  const secret = "credential-secret";
  const { updater } = makeUpdater();
  const logs = [];
  const controller = createDesktopUpdateInstallController({
    updater,
    confirmInstall: async ({ version }) => {
      assert.equal(version, "unknown");
      throw new Error(`dialog failed with ${secret}`);
    },
    log(message) { logs.push(String(message)); },
  });

  assert.deepEqual(await controller.handleDownloaded({ version: `1.2.3?token=${secret}` }), {
    accepted: false,
    reason: "confirmation_failed",
    version: "unknown",
  });
  assert.equal(logs.some((line) => line.includes(secret)), false);
});

test("downloaded packaged updates are routed through explicit confirmation before install", async () => {
  const { updater, events, calls } = makeUpdater();
  let approved = false;
  configureAutoUpdater({
    updater,
    isPackaged: true,
    env: {},
    log() {},
    confirmInstall: async ({ version }) => {
      assert.equal(version, "2.0.0");
      return approved;
    },
  });

  await events.get("update-downloaded")({ version: "2.0.0" });
  assert.equal(calls.some(([name]) => name === "install"), false);

  approved = true;
  await events.get("update-downloaded")({ version: "2.0.0" });
  assert.deepEqual(calls.filter(([name]) => name === "install"), [["install", false, true]]);
});
