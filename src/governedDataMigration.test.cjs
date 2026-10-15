const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GovernedDataMigrationError,
  migrateDataRootSafely,
} = require("./governedDataMigration.cjs");
const {
  moveDataRoot,
  prepareDataRoot,
  readMarker,
  resolveDataRoot,
} = require("./dataRootCore.cjs");

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-migration-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { NODE_ENV: "production" };
  const current = prepareDataRoot({ env, homedir: home });
  fs.mkdirSync(path.join(current.root, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(current.root, "workspace", "project.json"), "{\"project\":\"alpha\"}\n", "utf8");
  fs.mkdirSync(path.join(current.root, "data"), { recursive: true });
  fs.writeFileSync(path.join(current.root, "data", "memory.json"), "{\"memory\":true}\n", "utf8");
  return { home, env, current };
}

test("governed migration delegates the copy to canonical data-root authority and preserves the original", async (t) => {
  const { home, env, current } = fixture(t);
  const targetRoot = path.join(home, "moved-home");

  const result = await migrateDataRootSafely({ targetRoot, env, homedir: home });

  assert.equal(result.status, "migrated");
  assert.equal(result.from, current.root);
  assert.equal(result.to, targetRoot);
  assert.equal(resolveDataRoot({ env, homedir: home }).root, targetRoot);
  assert.equal(fs.readFileSync(path.join(current.root, "workspace", "project.json"), "utf8"), "{\"project\":\"alpha\"}\n");
  assert.equal(fs.readFileSync(path.join(targetRoot, "workspace", "project.json"), "utf8"), "{\"project\":\"alpha\"}\n");
  assert.equal(readMarker(targetRoot).rootId, readMarker(current.root).rootId);
});

test("governed migration is a truthful no-op when the requested root is already active", async (t) => {
  const { home, env, current } = fixture(t);

  const result = await migrateDataRootSafely({ targetRoot: current.root, env, homedir: home });

  assert.deepEqual(result, {
    status: "already_current",
    from: current.root,
    to: current.root,
    files: 0,
    bytes: 0,
  });
});

test("governed migration refuses roots controlled by environment overrides because pointer activation cannot win", async (t) => {
  const { home, current } = fixture(t);
  const env = { NODE_ENV: "production", LIOS_DATA_ROOT: current.root };
  const targetRoot = path.join(home, "should-not-activate");

  await assert.rejects(
    migrateDataRootSafely({ targetRoot, env, homedir: home }),
    (error) => error instanceof GovernedDataMigrationError && error.code === "external_root_override",
  );
  assert.equal(fs.existsSync(targetRoot), false);
});

test("failed post-switch validation restores the previously selected pointer root", async (t) => {
  const { home, env, current } = fixture(t);
  const intermediate = path.join(home, "intermediate-home");
  moveDataRoot({ from: current.root, to: intermediate, env, homedir: home });
  assert.equal(resolveDataRoot({ env, homedir: home }).root, intermediate);
  const targetRoot = path.join(home, "rejected-home");

  const result = await migrateDataRootSafely({
    targetRoot,
    env,
    homedir: home,
    validateActivatedRoot: async ({ resolution, previous }) => {
      assert.equal(resolution.root, targetRoot);
      assert.equal(previous.root, intermediate);
      return false;
    },
  });

  assert.equal(result.status, "rollback_restored");
  assert.equal(result.from, intermediate);
  assert.equal(result.to, targetRoot);
  assert.equal(resolveDataRoot({ env, homedir: home }).root, intermediate);
  assert.equal(fs.readFileSync(path.join(intermediate, "data", "memory.json"), "utf8"), "{\"memory\":true}\n");
});

test("overlapping governed migrations are refused while activation validation is pending", async (t) => {
  const { home, env } = fixture(t);
  const firstTarget = path.join(home, "first-target");
  const secondTarget = path.join(home, "second-target");
  let releaseValidation;
  const validationGate = new Promise((resolve) => { releaseValidation = resolve; });

  const first = migrateDataRootSafely({
    targetRoot: firstTarget,
    env,
    homedir: home,
    validateActivatedRoot: async () => {
      await validationGate;
      return true;
    },
  });

  await assert.rejects(
    migrateDataRootSafely({ targetRoot: secondTarget, env, homedir: home }),
    (error) => error instanceof GovernedDataMigrationError && error.code === "migration_in_progress",
  );
  assert.equal(fs.existsSync(secondTarget), false);

  releaseValidation();
  assert.equal((await first).status, "migrated");
});

test("rollback failure is explicit when the previous verified root becomes unavailable", async (t) => {
  const { home, env, current } = fixture(t);
  const intermediate = path.join(home, "intermediate-home");
  moveDataRoot({ from: current.root, to: intermediate, env, homedir: home });
  const targetRoot = path.join(home, "target-home");

  await assert.rejects(
    migrateDataRootSafely({
      targetRoot,
      env,
      homedir: home,
      validateActivatedRoot: async ({ previous }) => {
        fs.rmSync(previous.root, { recursive: true, force: true });
        return false;
      },
    }),
    (error) => error instanceof GovernedDataMigrationError && error.code === "rollback_failed",
  );

  assert.equal(resolveDataRoot({ env, homedir: home }).root, targetRoot);
  assert.equal(fs.readFileSync(path.join(targetRoot, "workspace", "project.json"), "utf8"), "{\"project\":\"alpha\"}\n");
});

test("desktop move-data-folder IPC delegates to the governed migration authority", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(mainSource, /const \{ migrateDataRootSafely \} = require\("\.\/governedDataMigration\.cjs"\);/);
  const start = mainSource.indexOf('ipcMain.handle("limuria:move-data-folder"');
  const end = mainSource.indexOf('ipcMain.handle("limuria:restore-backup"', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = mainSource.slice(start, end);
  assert.match(handler, /await migrateDataRootSafely\(\{/);
  assert.doesNotMatch(handler, /\bmoveDataRoot\(/);
});
