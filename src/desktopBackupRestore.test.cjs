const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createRestoreWorkerLaunchPlan,
  normalizeRestorePassphrase,
  resolveRestoreWorkerPath,
  validateRestoreArchive,
} = require("./desktopBackupRestore.cjs");

test("restore launch keeps archive/passphrase off argv and passphrase off environment", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-desktop-restore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, "lios-backup-20261004T120000Z.liosbak");
  fs.writeFileSync(archive, "fixture");
  const worker = path.join(root, "desktop-restore.cjs");
  fs.writeFileSync(worker, "fixture");
  const secret = "correct horse battery staple";
  const destinationVaultSecret = "destination-os-protected-vault-secret-123456";

  const plan = createRestoreWorkerLaunchPlan({
    executable: "/Applications/LiOS.app/Contents/MacOS/LiOS",
    workerPath: worker,
    archivePath: archive,
    passphrase: secret,
    destinationVaultSecret,
    dataRoot: path.join(root, "home"),
    resourcesPath: path.join(root, "Resources"),
    isPackaged: true,
    env: { PATH: "/usr/bin" },
  });

  assert.deepEqual(plan.args, [worker]);
  assert.equal(plan.args.join(" ").includes(secret), false);
  assert.equal(plan.args.join(" ").includes(archive), false);
  assert.equal(JSON.stringify(plan.env).includes(secret), false);
  assert.equal(plan.args.join(" ").includes(destinationVaultSecret), false);
  assert.equal(JSON.stringify(plan.env).includes(destinationVaultSecret), false);
  const payload = JSON.parse(plan.stdin);
  assert.equal(payload.archivePath, archive);
  assert.equal(payload.passphrase, secret);
  assert.equal(payload.destinationVaultSecret, destinationVaultSecret);
  assert.equal(plan.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(plan.env.LIOS_DATA_ROOT, path.join(root, "home"));
});

test("restore archive validation refuses relative, empty and unsupported files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-desktop-restore-validation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validateRestoreArchive("relative.liosbak"), /absolute/);

  const empty = path.join(root, "empty.liosbak");
  fs.writeFileSync(empty, "");
  assert.throws(() => validateRestoreArchive(empty), /readable file/);

  const wrong = path.join(root, "backup.zip");
  fs.writeFileSync(wrong, "x");
  assert.throws(() => validateRestoreArchive(wrong), /\.liosbak or \.tar\.gz/);

  const ok = path.join(root, "backup.tar.gz");
  fs.writeFileSync(ok, "x");
  assert.equal(validateRestoreArchive(ok), ok);
});

test("restore passphrase is bounded but otherwise treated as opaque secret text", () => {
  assert.equal(normalizeRestorePassphrase(""), null);
  assert.equal(normalizeRestorePassphrase(undefined), null);
  assert.equal(normalizeRestorePassphrase("line one\nline two"), "line one\nline two");
  assert.throws(() => normalizeRestorePassphrase("x".repeat(513)), /invalid/);
  assert.throws(() => normalizeRestorePassphrase("bad\0secret"), /invalid/);
});


test("desktop package includes the restore helper and bundled worker output", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  assert.ok(pkg.build.files.includes("desktopBackupRestore.cjs"));
  assert.ok(pkg.build.files.includes("dist/**/*"), "bundled desktop-restore.cjs is included through dist/**/*");
  assert.ok(pkg.build.asarUnpack.includes("dist/**/*"), "restore worker stays directly spawnable outside app.asar");
});

test("SI-07.12 desktop restore refuses a symlinked backup archive", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-restore-archive-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = path.join(root, "user-private-notes.txt");
  const linked = path.join(root, "looks-valid.liosbak");
  fs.writeFileSync(original, "unrelated private bytes");
  try {
    fs.symlinkSync(original, linked, "file");
  } catch (error) {
    t.skip("Host cannot create file symlinks: " + String(error));
    return;
  }
  assert.throws(() => validateRestoreArchive(linked), /must not be a symbolic link/);
  assert.equal(fs.readFileSync(original, "utf8"), "unrelated private bytes");
});

test("SI-07.12 restore worker resolver skips symlinked candidates and selects a real unpacked worker", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-restore-worker-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appPath = path.join(root, "LiOS.app", "Contents", "Resources", "app.asar");
  const preferred = path.join(root, "LiOS.app", "Contents", "Resources", "app.asar.unpacked", "dist", "desktop-restore.cjs");
  const fallback = path.join(appPath, "dist", "desktop-restore.cjs");
  const untrusted = path.join(root, "outside-worker.cjs");
  fs.mkdirSync(path.dirname(preferred), { recursive: true });
  fs.mkdirSync(path.dirname(fallback), { recursive: true });
  fs.writeFileSync(untrusted, "do-not-run");
  fs.writeFileSync(fallback, "trusted-fallback");
  try {
    fs.symlinkSync(untrusted, preferred, "file");
  } catch (error) {
    t.skip("Host cannot create file symlinks: " + String(error));
    return;
  }
  assert.equal(resolveRestoreWorkerPath({ appPath, isPackaged: true }), fallback);
  fs.rmSync(fallback);
  assert.throws(
    () => resolveRestoreWorkerPath({ appPath, isPackaged: true }),
    /worker is missing or unsafe/,
  );
});

test("SI-07.12 restore launch rechecks that the selected worker is a real file", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-restore-worker-launch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "valid.liosbak");
  const worker = path.join(root, "desktop-restore.cjs");
  const external = path.join(root, "external.cjs");
  fs.writeFileSync(file, "backup fixture");
  fs.writeFileSync(external, "outside worker");
  try {
    fs.symlinkSync(external, worker, "file");
  } catch (error) {
    t.skip("Host cannot create file symlinks: " + String(error));
    return;
  }
  assert.throws(() => createRestoreWorkerLaunchPlan({
    executable: "/fake/desktop-app",
    workerPath: worker,
    archivePath: file,
    dataRoot: path.join(root, "home"),
    isPackaged: true,
  }), /worker is missing or unsafe/);
  assert.equal(fs.readFileSync(external, "utf8"), "outside worker");
});
