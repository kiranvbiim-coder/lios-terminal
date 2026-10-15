const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const asar = require("@electron/asar");
const plist = require("plist");
const afterPack = require("./afterPackCopyNodeModules.cjs");
const { updateMacEmbeddedAsarIntegrity } = afterPack;

test("refreshes macOS embedded ASAR integrity after replacing app.asar", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lios-asar-integrity-test-"));
  const contentsDir = path.join(tempRoot, "Contents");
  const resourcesDir = path.join(contentsDir, "Resources");
  const sourceDir = path.join(tempRoot, "source");
  const asarPath = path.join(resourcesDir, "app.asar");
  const infoPlistPath = path.join(contentsDir, "Info.plist");

  try {
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "main.js"), "module.exports = 'LiOS';\n");
    await asar.createPackage(sourceDir, asarPath);
    fs.writeFileSync(
      infoPlistPath,
      plist.build({
        CFBundleName: "LiOS Intelligence Terminal",
        ElectronAsarIntegrity: {
          "Resources/app.asar": { algorithm: "SHA256", hash: "stale-hash" },
        },
      }),
    );

    const { headerString } = asar.getRawHeader(asarPath);
    const expectedHash = crypto.createHash("sha256").update(headerString).digest("hex");
    const returnedHash = updateMacEmbeddedAsarIntegrity(contentsDir, asarPath);
    const updatedPlist = plist.parse(fs.readFileSync(infoPlistPath, "utf8"));

    assert.equal(returnedHash, expectedHash);
    assert.equal(updatedPlist.ElectronAsarIntegrity["Resources/app.asar"].hash, expectedHash);
    assert.equal(updatedPlist.ElectronAsarIntegrity["Resources/app.asar"].algorithm, "SHA256");
    assert.equal(updatedPlist.CFBundleName, "LiOS Intelligence Terminal");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("fails closed when macOS app metadata has no embedded ASAR integrity entry", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lios-asar-integrity-missing-test-"));
  const contentsDir = path.join(tempRoot, "Contents");
  const infoPlistPath = path.join(contentsDir, "Info.plist");

  try {
    fs.mkdirSync(contentsDir, { recursive: true });
    fs.writeFileSync(infoPlistPath, plist.build({ CFBundleName: "LiOS Intelligence Terminal" }));
    assert.throws(
      () => updateMacEmbeddedAsarIntegrity(contentsDir, path.join(contentsDir, "Resources", "app.asar")),
      /Missing ElectronAsarIntegrity\.Resources\/app\.asar/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

async function createPackFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-packaged-notices-test-"));
  const projectDir = path.join(root, "src");
  const contentsDir = path.join(root, "out", "LiOS.app", "Contents");
  const resourcesDir = path.join(contentsDir, "Resources");
  const originalSource = path.join(root, "original");
  const installedModules = path.join(root, "installed-modules");
  for (const directory of [projectDir, resourcesDir, originalSource, installedModules]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.symlinkSync(installedModules, path.join(projectDir, "node_modules"), "dir");
  const lockedPackages = {
    "node_modules/@fixture/runtime": { version: "1.0.0" },
    "node_modules/@fixture/runtime/node_modules/nested": { version: "2.0.0" },
    "node_modules/dev-tool": { version: "3.0.0", dev: true },
  };
  for (const [relativePath, entry] of Object.entries(lockedPackages)) {
    const directory = path.join(projectDir, relativePath);
    fs.mkdirSync(directory, { recursive: true });
    const name = relativePath.slice(relativePath.lastIndexOf("node_modules/") + "node_modules/".length);
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: entry.version, license: "MIT" }));
    fs.writeFileSync(path.join(directory, "index.js"), `module.exports = ${JSON.stringify(name)};\n`);
  }
  fs.writeFileSync(path.join(projectDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: lockedPackages }));
  const legalBytes = {
    LICENSE: "LiOS fixture proprietary rights. All rights reserved.\n",
    "THIRD_PARTY_NOTICES.md": "# Fixture notices\nCopyright fixture contributors.\n",
    "third_party/licenses/donor/README.md": "# Donor terms\nExact required fixture grant.\n",
    "third_party/licenses/donor/NOTICE.txt": "Exact donor attribution bytes.\n",
  };
  for (const [relativePath, bytes] of Object.entries(legalBytes)) {
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(root, relativePath), bytes);
  }
  fs.writeFileSync(path.join(originalSource, "main.cjs"), "module.exports = 'original app';\n");
  fs.mkdirSync(path.join(originalSource, "dist"), { recursive: true });
  fs.writeFileSync(path.join(originalSource, "dist", "server.cjs"), "module.exports = 'bundled server';\n");
  const asarPath = path.join(resourcesDir, "app.asar");
  await asar.createPackage(originalSource, asarPath);
  fs.writeFileSync(path.join(contentsDir, "Info.plist"), plist.build({
    CFBundleName: "LiOS",
    ElectronAsarIntegrity: { "Resources/app.asar": { algorithm: "SHA256", hash: "original-hash", fixture: "retained" } },
  }));
  return {
    root, projectDir, contentsDir, resourcesDir, asarPath, legalBytes,
    context: {
      appOutDir: path.join(root, "out"),
      electronPlatformName: "darwin",
      packager: { projectDir, appInfo: { productFilename: "LiOS" } },
    },
  };
}

test("rebuilds a real ASAR with root rights, case-variant dependency notices and native unpacked bytes", async () => {
  const fixture = await createPackFixture();
  const packageDir = path.join(fixture.projectDir, "node_modules", "@fixture", "runtime");
  const dependencyBytes = {
    "LICENSE.md": "MIT terms and copyright, not disposable documentation.\n",
    "licence.MD": "Case-variant licence bytes.\n",
    "CoPyInG.md": "Copying terms.\n",
    "nOtIcE.md": "Required notice.\n",
    "LiCeNsEs/vendor/README.md": "Vendor terms in an otherwise pruned README.\n",
    "third-party-licenses/vendor/tests/notice.ts": "Complete legal directory contents.\n",
    "binding.node": Buffer.from([0, 1, 2, 255]),
  };
  try {
    for (const [relativePath, bytes] of Object.entries(dependencyBytes)) {
      fs.mkdirSync(path.dirname(path.join(packageDir, relativePath)), { recursive: true });
      fs.writeFileSync(path.join(packageDir, relativePath), bytes);
    }
    fs.writeFileSync(path.join(packageDir, "README.md"), "Ordinary dependency documentation remains pruned.\n");
    await afterPack(fixture.context);

    for (const [relativePath, bytes] of Object.entries(fixture.legalBytes)) {
      assert.deepEqual(asar.extractFile(fixture.asarPath, path.normalize(relativePath)), Buffer.from(bytes));
    }
    for (const [relativePath, bytes] of Object.entries(dependencyBytes)) {
      const archivePath = `node_modules/@fixture/runtime/${relativePath}`;
      assert.deepEqual(asar.extractFile(fixture.asarPath, path.normalize(archivePath)), Buffer.from(bytes));
      assert.deepEqual(fs.readFileSync(path.join(fixture.resourcesDir, "app.asar.unpacked", archivePath)), Buffer.from(bytes));
    }
    assert.throws(() => asar.statFile(fixture.asarPath, path.normalize("node_modules/@fixture/runtime/README.md")));
    assert.match(asar.extractFile(fixture.asarPath, "main.cjs").toString(), /original app/);
    assert.match(asar.extractFile(fixture.asarPath, path.normalize("dist/server.cjs")).toString(), /bundled server/);
    assert.match(asar.extractFile(fixture.asarPath, path.normalize("node_modules/dev-tool/index.js")).toString(), /dev-tool/);
    assert.match(asar.extractFile(fixture.asarPath, path.normalize("node_modules/@fixture/runtime/node_modules/nested/index.js")).toString(), /nested/);
    const expectedHash = crypto.createHash("sha256").update(asar.getRawHeader(fixture.asarPath).headerString).digest("hex");
    const info = plist.parse(fs.readFileSync(path.join(fixture.contentsDir, "Info.plist"), "utf8"));
    assert.equal(info.ElectronAsarIntegrity["Resources/app.asar"].hash, expectedHash);
    assert.equal(info.ElectronAsarIntegrity["Resources/app.asar"].fixture, "retained");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("blocks missing root rights sources before replacing the real archive", async () => {
  const fixture = await createPackFixture();
  try {
    const originalArchive = fs.readFileSync(fixture.asarPath);
    fs.rmSync(path.join(fixture.root, "THIRD_PARTY_NOTICES.md"));
    await assert.rejects(afterPack(fixture.context), /THIRD_PARTY_NOTICES\.md/);
    assert.deepEqual(fs.readFileSync(fixture.asarPath), originalArchive);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("blocks an unresolved dev-only license before replacing the archive or its embedded integrity", async () => {
  const fixture = await createPackFixture();
  try {
    const originalArchive = fs.readFileSync(fixture.asarPath);
    const manifestPath = path.join(fixture.projectDir, "node_modules", "dev-tool", "package.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ name: "dev-tool", version: "3.0.0" }));
    await assert.rejects(afterPack(fixture.context), /Copied dependency license audit failed.*binary release blocked/);
    assert.deepEqual(fs.readFileSync(fixture.asarPath), originalArchive);
    const info = plist.parse(fs.readFileSync(path.join(fixture.contentsDir, "Info.plist"), "utf8"));
    assert.equal(info.ElectronAsarIntegrity["Resources/app.asar"].hash, "original-hash");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails closed before signing when rebuilt ASAR mutates a nested donor grant", async (t) => {
  const fixture = await createPackFixture();
  const donorSource = path.join(fixture.root, "third_party", "licenses");
  const targetRelative = "third_party/licenses/donor/README.md";
  const donorExpected = fs.readFileSync(path.join(fixture.root, targetRelative));
  const cpSync = fs.cpSync.bind(fs);
  let legalCopySeen = false;

  try {
    const mock = t.mock.method(fs, "cpSync", (source, destination, options) => {
      cpSync(source, destination, options);
      if (String(source) === donorSource) {
        legalCopySeen = true;
        assert.equal(options.mode, undefined, "legal sources must not use APFS clone mode");
        const stagedNotice = path.join(String(destination), "donor", "README.md");
        fs.writeFileSync(stagedNotice, Buffer.alloc(donorExpected.length));
      }
    });

    await assert.rejects(
      afterPack(fixture.context),
      /Root legal bytes changed in rebuilt ASAR: third_party[/\\]licenses[/\\]donor[/\\]README.md; package signing refused/,
    );
    mock.mock.restore();
    assert.equal(legalCopySeen, true);
    assert.deepEqual(fs.readFileSync(path.join(fixture.root, targetRelative)), donorExpected);
    const info = plist.parse(fs.readFileSync(path.join(fixture.contentsDir, "Info.plist"), "utf8"));
    assert.equal(info.ElectronAsarIntegrity["Resources/app.asar"].hash, "original-hash",
      "a broken archive must never receive a new embedded integrity signature");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
