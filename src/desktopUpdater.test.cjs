const assert = require("node:assert/strict");
const Module = require("node:module");
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
  assert.equal(configureAutoUpdater({ updater: dev.updater, isPackaged: false, env: {} }).enabled, false);
  assert.deepEqual(dev.calls, []);

  const packaged = makeUpdater();
  assert.deepEqual(configureAutoUpdater({ updater: packaged.updater, isPackaged: true, env: {}, confirmInstall: async () => false }), {
    enabled: true,
    url: null,
    source: "packaged_config",
  });
  assert.equal(packaged.updater.autoDownload, true);
  assert.equal(packaged.updater.autoInstallOnAppQuit, false);
  assert.equal(packaged.updater.allowDowngrade, false);
  assert.equal(packaged.updater.allowPrerelease, false);
  assert.deepEqual(packaged.calls, [["check"]]);
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

test("canonical desktop update controller allows only one in-flight prompt and one install", async () => {
  const { updater, calls } = makeUpdater();
  let release;
  let confirms = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const controller = createDesktopUpdateInstallController({
    updater,
    confirmInstall: async () => {
      confirms += 1;
      return pending;
    },
    log() {},
  });
  const first = controller.handleDownloaded({ version: "1.2.3" });
  const duplicate = await controller.handleDownloaded({ version: "1.2.3" });
  assert.deepEqual(duplicate, { accepted: false, reason: "busy", version: "1.2.3" });
  assert.equal(confirms, 1);
  release(true);
  assert.deepEqual(await first, { accepted: true, version: "1.2.3" });
  const repeated = await controller.handleDownloaded({ version: "1.2.3" });
  assert.equal(repeated.reason, "busy", "a second event cannot invoke quitAndInstall twice");
  assert.equal(confirms, 1);
  assert.deepEqual(calls.filter(([action]) => action === "install"), [["install", false, true]]);
});

test("canonical desktop update controller fails closed when quitAndInstall throws", async () => {
  const { updater } = makeUpdater();
  let attempts = 0;
  updater.quitAndInstall = () => { attempts += 1; throw new Error("sensitive native error"); };
  const logs = [];
  const controller = createDesktopUpdateInstallController({
    updater,
    confirmInstall: async () => true,
    log(message) { logs.push(String(message)); },
  });
  assert.deepEqual(await controller.handleDownloaded({ version: "1.2.3" }), {
    accepted: false, reason: "install_failed", version: "1.2.3",
  });
  assert.equal(attempts, 1);
  assert.equal(logs.some((message) => message.includes("sensitive native error")), false);
});

test("canonical production confirmation uses a safe-default native dialog and live window", async () => {
  const initialLoad = Module._load;
  const prompts = [];
  const staleWindow = { isDestroyed: () => true };
  const healthyWindow = { isDestroyed: () => false };
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "electron") return {
      BrowserWindow: {
        getFocusedWindow: () => staleWindow,
        getAllWindows: () => [staleWindow, healthyWindow],
      },
      dialog: {
        async showMessageBox(parentWindow, options) {
          prompts.push({ parentWindow, options });
          return { response: 1 };
        },
      },
    };
    return initialLoad.call(this, request, parent, isMain);
  };
  const { updater, events, calls } = makeUpdater();
  try {
    configureAutoUpdater({ updater, isPackaged: true, env: {}, log() {} });
    await events.get("update-downloaded")({ version: "1.2.3" });
  } finally {
    Module._load = initialLoad;
  }
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].parentWindow, healthyWindow);
  assert.deepEqual(prompts[0].options.buttons, ["Later", "Install and restart"]);
  assert.equal(prompts[0].options.defaultId, 0);
  assert.equal(prompts[0].options.cancelId, 0);
  assert.equal(prompts[0].options.noLink, true);
  assert.match(prompts[0].options.message, /1[.]2[.]3/);
  assert.deepEqual(calls.filter(([name]) => name === "install"), [["install", false, true]]);
});
