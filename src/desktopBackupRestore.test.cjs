const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createRestoreWorkerLaunchPlan,
  normalizeRestorePassphrase,
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
