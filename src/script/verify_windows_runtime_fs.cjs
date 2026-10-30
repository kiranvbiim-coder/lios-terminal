const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildNativeRuntimeFs } = require("./build_native_runtime_fs.cjs");

function verifyCustody(loader, root) {
  process.env.ELECTRON_RESOURCES_PATH = path.join(root, "resources");
  const native = require(loader).windowsRuntimeFs();
  const directory = path.join(root, "private");
  native.makeDirectory(directory);
  const filename = path.join(directory, "runtime.bin");
  const fd = native.openFile(filename, true);
  try { fs.writeSync(fd, "owned native runtime bytes"); }
  finally { fs.closeSync(fd); }

  assert.throws(() => { const duplicate = native.openFile(filename, true); fs.closeSync(duplicate); });
  const reader = native.openFile(filename, false);
  try {
    assert.equal(fs.readFileSync(reader, "utf8"), "owned native runtime bytes");
    assert.throws(() => fs.writeSync(reader, "must not mutate"));
  } finally { fs.closeSync(reader); }
  assert.equal(fs.readFileSync(filename, "utf8"), "owned native runtime bytes");

  const aclResult = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $facts = foreach ($p in @($env:LIOS_CUSTODY_TEST_DIRECTORY, $env:LIOS_CUSTODY_TEST_FILE)) {
      $acl = Get-Acl -LiteralPath $p
      $entries = @($acl.Access | ForEach-Object {
        @{ sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
           inherited = $_.IsInherited; allow = ($_.AccessControlType -eq 'Allow') }
      })
      @{ protected = $acl.AreAccessRulesProtected; entries = $entries; owner = $owner }
    }
    ConvertTo-Json -InputObject @($facts) -Depth 5 -Compress
  `], { encoding: "utf8", timeout: 15_000, env: { ...process.env,
    LIOS_CUSTODY_TEST_DIRECTORY: directory, LIOS_CUSTODY_TEST_FILE: filename } });
  assert.equal(aclResult.status, 0, aclResult.stderr);
  const acls = JSON.parse(aclResult.stdout);
  assert.equal(acls.length, 2);
  for (const facts of acls) {
    assert.equal(facts.protected, true);
    assert.deepEqual(new Set(facts.entries.map(entry => entry.sid)),
      new Set([facts.owner, "S-1-5-18", "S-1-5-32-544"]));
    assert.ok(facts.entries.every(entry => !entry.inherited && entry.allow));
  }

  const alias = path.join(directory, "alias.bin");
  fs.linkSync(filename, alias);
  try { assert.throws(() => { const linked = native.openFile(filename, false); fs.closeSync(linked); }); }
  finally { fs.unlinkSync(alias); }

  const moved = path.join(root, "moved");
  const pin = native.pinDirectories(directory);
  try { assert.throws(() => fs.renameSync(directory, moved)); }
  finally { native.releasePin(pin); }
  fs.renameSync(directory, moved);
  assert.equal(fs.readFileSync(path.join(moved, "runtime.bin"), "utf8"), "owned native runtime bytes");
  fs.renameSync(moved, directory);

  const junction = path.join(root, "junction");
  fs.symlinkSync(directory, junction, "junction");
  try { assert.throws(() => native.pinDirectories(junction)); }
  finally { fs.unlinkSync(junction); }
  for (const target of [filename + ":payload", path.join(directory, "unsafe."), path.join(directory, "unsafe ")]) {
    assert.throws(() => { const unsafe = native.openFile(target, true); fs.closeSync(unsafe); });
  }
  assert.deepEqual(fs.readdirSync(directory), ["runtime.bin"]);
  console.log(JSON.stringify({ scope: "WINDOWS_X64_CUSTODY_NOT_INSTALLED_QUALIFICATION",
    exclusiveCreate: true, readOnlyReopen: true, privateAcls: true,
    hardlinkRefused: true, pinLifetime: true, junctionRefused: true, alternateNamesRefused: true }));
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("This verification requires actual Windows x64; no emulated pass is available.");
  }
  if (process.argv[2] === "--child") return verifyCustody(process.argv[3], process.argv[4]);
  const builtAddon = buildNativeRuntimeFs();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-windows-custody-native-"));
  try {
    const addon = path.join(root, "resources", "native-runtime-fs", "lios_native_runtime_fs.node");
    fs.mkdirSync(path.dirname(addon), { recursive: true });
    fs.copyFileSync(builtAddon, addon);
    const loader = path.join(root, "custody.cjs");
    await require("esbuild").build({ entryPoints: [path.resolve(__dirname, "../server/nativeRuntimeWindowsFs.ts")],
      bundle: true, platform: "node", format: "cjs", outfile: loader, logLevel: "silent" });
    // Windows locks loaded DLLs. Child exit releases the addon before owned scratch cleanup.
    const result = spawnSync(process.execPath, [__filename, "--child", loader, root], {
      stdio: "inherit", timeout: 30_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Windows runtime custody verification failed (${result.status ?? result.signal}).`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
