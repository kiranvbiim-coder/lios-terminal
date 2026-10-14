const assert = require("node:assert/strict");
const test = require("node:test");
const { configureAutoUpdater, resolveUpdateUrl, DEFAULT_UPDATE_URL } = require("./desktopUpdater.cjs");

function makeUpdater() {
  const events = new Map();
  const calls = [];
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: true,
    setFeedURL(value) { calls.push(["feed", value]); },
    on(event, handler) { events.set(event, handler); },
    checkForUpdates() { calls.push(["check"]); return Promise.resolve(); },
  };
  return { updater, events, calls };
}

test("desktop updater accepts an explicit HTTPS override and has no source-code default feed", () => {
  assert.equal(DEFAULT_UPDATE_URL, null);
  assert.equal(resolveUpdateUrl({}), null);
  assert.equal(resolveUpdateUrl({ LIOS_UPDATE_URL: "https://updates.example.test/lios" }), "https://updates.example.test/lios/");
});

test("desktop updater rejects insecure or malformed runtime overrides", () => {
  assert.equal(resolveUpdateUrl({ LIOS_UPDATE_URL: "http://updates.example.test" }), null);
  assert.equal(resolveUpdateUrl({ LIOS_UPDATE_URL: "http://localhost:4312" }), null);
  assert.equal(resolveUpdateUrl({ LIOS_UPDATE_URL: "not-a-url" }), null);

  const { updater, calls } = makeUpdater();
  assert.deepEqual(configureAutoUpdater({
    updater,
    isPackaged: true,
    env: { LIOS_UPDATE_URL: "http://updates.example.test" },
  }), {
    enabled: false,
    reason: "LIOS_UPDATE_URL is present but is not a valid HTTPS update feed.",
  });
  assert.deepEqual(calls, []);
});

test("development is disabled while packaged builds use embedded app-update.yml by default", () => {
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
  assert.equal(packaged.updater.autoInstallOnAppQuit, true);
  assert.equal(packaged.updater.allowDowngrade, false);
  assert.deepEqual(packaged.calls, [["check"]]);
  assert.equal(packaged.events.has("update-downloaded"), true);
});

test("packaged builds may override the embedded feed with an explicit HTTPS runtime URL", () => {
  const { updater, calls } = makeUpdater();
  const configured = configureAutoUpdater({
    updater,
    isPackaged: true,
    env: { LIOS_UPDATE_URL: "https://updates.example.test" },
    log() {},
  });
  assert.deepEqual(configured, {
    enabled: true,
    url: "https://updates.example.test/",
    source: "runtime_override",
  });
  assert.deepEqual(calls[0], ["feed", { provider: "generic", url: "https://updates.example.test/" }]);
  assert.deepEqual(calls[1], ["check"]);
});
