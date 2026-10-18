// electron-builder's built-in node_modules dependency walker fails to
// resolve a large fraction of this project's transitive dependencies (logs
// "cannot find path for dependency" for dozens of packages -- e.g.
// sql-escaper, graceful-fs, fs-extra) and silently drops them, both from
// app.asar's own header/index AND from app.asar.unpacked. Symptom in the
// shipped app: the Electron main process (which requires electron-updater
// straight out of app.asar) or the bundled Express server crashes at
// startup with `Cannot find module 'X'`. The Electron main process cannot
// recover from that: the window never shows and the process exits with
// code 0/1, no dialog, no crash report.
//
// Root cause of the resolver failure: this project's node_modules is a
// symlink to a sibling worktree's real node_modules (a deliberate
// disk-saving setup for git worktrees). electron-builder's dependency
// walker does not handle that redirection correctly for every package.
//
// Rebuild the archive from its original application payload and an explicit
// lockfile-path runtime closure. Physical node_modules may remain symlinked;
// package identity and original nested/hoisted placements remain authoritative.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { finished } = require("node:stream/promises");
const asar = require("@electron/asar");
const plist = require("plist");
const { selectRuntimeClosure, copyRuntimeClosure, closureEvidence } = require("./runtimeDependencyClosure.cjs");

/** Enumerate every bundled root-rights source so verification cannot miss nested donor grants. */
function rootRightsFiles(repoRoot) {
  const paths = [];
  function collect(relative) {
    const source = path.join(repoRoot, relative);
    // Root legal files are code-signing evidence, not an arbitrary file-copy
    // capability. Dereferencing a linked grant can bundle outside-user files
    // and conceal the real license source under a plausible archive path.
    const entry = fs.lstatSync(source);
    if (entry.isSymbolicLink()) {
      throw new Error(`[afterPackCopyNodeModules] Symlinked root legal source is refused: ${relative}`);
    }
    if (entry.isDirectory()) {
      for (const child of fs.readdirSync(source).sort()) collect(path.join(relative, child));
    } else if (entry.isFile()) {
      paths.push(relative);
    } else {
      throw new Error(`[afterPackCopyNodeModules] Unsupported root legal source: ${relative}`);
    }
  }
  for (const relative of ["LICENSE", "THIRD_PARTY_NOTICES.md", "third_party/licenses"]) collect(relative);
  return paths;
}

function verifyRootRightsBytes(repoRoot, asarPath, files) {
  for (const relative of files) {
    const expected = fs.readFileSync(path.join(repoRoot, relative));
    const archived = asar.extractFile(asarPath, path.normalize(relative));
    if (!archived.equals(expected)) {
      throw new Error(`[afterPackCopyNodeModules] Root legal bytes changed in rebuilt ASAR: ${relative}; package signing refused.`);
    }
  }
}

function updateMacEmbeddedAsarIntegrity(contentsDir, asarPath) {
  const infoPlistPath = path.join(contentsDir, "Info.plist");
  const infoPlist = plist.parse(fs.readFileSync(infoPlistPath, "utf8"));
  const asarIntegrity = infoPlist.ElectronAsarIntegrity;
  const asarRecord = asarIntegrity && asarIntegrity["Resources/app.asar"];
  if (!asarRecord) {
    throw new Error(`Missing ElectronAsarIntegrity.Resources/app.asar in ${infoPlistPath}`);
  }

  // electron-builder calculates this metadata before the afterPack hook. Since
  // this hook replaces app.asar, refresh the embedded hash before code signing;
  // otherwise Electron's enabled integrity fuse rejects the app at startup.
  const { headerString } = asar.getRawHeader(asarPath);
  const hash = crypto.createHash("sha256").update(headerString).digest("hex");
  asarIntegrity["Resources/app.asar"] = { ...asarRecord, algorithm: "SHA256", hash };
  fs.writeFileSync(infoPlistPath, plist.build(infoPlist), "utf8");
  return hash;
}

function verifyDependencyLegalBytes(asarPath, files) {
  for (const file of files) {
    const archived = asar.extractFile(asarPath, path.normalize(file.path));
    if (crypto.createHash("sha256").update(archived).digest("hex") !== file.sha256) {
      throw new Error(`[afterPackCopyNodeModules] Dependency legal bytes changed in rebuilt ASAR: ${file.path}; package signing refused.`);
    }
  }
}

module.exports = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const projectDir = packager.projectDir;
  const srcNodeModules = path.join(projectDir, "node_modules");

  if (!fs.existsSync(srcNodeModules)) {
    throw new Error(`[afterPackCopyNodeModules] source node_modules not found at ${srcNodeModules}.`);
  }

  const resourcesDir =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");

  // Reflink large immutable runtime assets on APFS; other filesystems retain ordinary-copy behavior.
  // This changes no packaged bytes or release verification and avoids a second multi-GiB physical archive copy.
  const sandboxArchive = path.join(projectDir, "sandbox-image-dist", "sandbox-image.tar.gz");
  const packagedArchive = path.join(resourcesDir, "sandbox-image-dist", "sandbox-image.tar.gz");
  if (fs.existsSync(sandboxArchive) && fs.existsSync(packagedArchive)) {
    fs.copyFileSync(sandboxArchive, packagedArchive, fs.constants.COPYFILE_FICLONE);
  }
  const asarPath = path.join(resourcesDir, "app.asar");
  const unpackedDir = path.join(resourcesDir, "app.asar.unpacked");

  if (!fs.existsSync(asarPath)) {
    throw new Error(`[afterPackCopyNodeModules] app.asar not found at ${asarPath}.`);
  }

  const closure = selectRuntimeClosure({
    projectDir,
    platform: electronPlatformName,
    arch: context.arch,
    libc: electronPlatformName === "linux" && process.platform === "linux"
      ? (process.report.getReport().header.glibcVersionRuntime ? "glibc" : "musl")
      : undefined,
  });
  console.log(`[afterPackCopyNodeModules] Runtime dependency closure: ${JSON.stringify(closureEvidence(closure))}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-asar-rebuild-"));
  const stagingDir = path.join(workDir, "payload");
  const candidatePath = path.join(workDir, "rebuilt", "app.asar");
  fs.mkdirSync(stagingDir);
  fs.mkdirSync(path.dirname(candidatePath));
  try {
    // 1. Extract everything electron-builder got right (dist/**, main.cjs,
    //    build-resources/**, package.json, ...) out of the original asar.
    asar.extractAll(asarPath, stagingDir);

    // Root rights/notice sources are outside electron-builder's src projectDir.
    // Put their actual bytes in the rebuilt archive, not only in a source tree.
    const repoRoot = path.resolve(projectDir, "..");
    const requiredRights = rootRightsFiles(repoRoot);
    for (const relativePath of ["LICENSE", "THIRD_PARTY_NOTICES.md", "third_party/licenses"]) {
      // Legal grants are small and must be byte-for-byte stable across APFS,
      // case variants and Electron ASAR rebuilds. Do not use the optional
      // reflink optimisation intended for large immutable runtime archives.
      fs.cpSync(path.join(repoRoot, relativePath), path.join(stagingDir, relativePath), {
        recursive: true,
        dereference: true,
      });
    }

    // Replace the partial builder tree with package payloads selected by their
    // exact lock locations, without recursively copying unselected children.
    const stagingNodeModules = path.join(stagingDir, "node_modules");
    fs.rmSync(stagingNodeModules, { recursive: true, force: true });
    fs.mkdirSync(stagingNodeModules, { recursive: true });
    const dependencyLegalFiles = copyRuntimeClosure(closure, stagingDir);

    // Audit the graph actually copied, including dev-only and unlocked packages,
    // before replacing the archive or handing the bundle to code signing.
    const audit = spawnSync(process.execPath, [
      require.resolve("tsx/cli"),
      path.join(__dirname, "audit_supply_chain.ts"),
      "--project-dir", projectDir,
      "--packaged-node-modules", stagingNodeModules,
    ], { cwd: projectDir, stdio: "inherit" });
    if (audit.error) throw audit.error;
    if (audit.status !== 0) {
      throw new Error(`[afterPackCopyNodeModules] Copied dependency license audit failed (exit ${audit.status}); binary release blocked.`);
    }

    // Build and validate a candidate without destroying the healthy archive.
    // The existing plist must already support embedded integrity before any
    // replacement; its hash is refreshed only after all byte checks succeed.
    if (electronPlatformName === "darwin") {
      const info = plist.parse(fs.readFileSync(path.join(path.dirname(resourcesDir), "Info.plist"), "utf8"));
      if (!info.ElectronAsarIntegrity?.["Resources/app.asar"]) {
        throw new Error("Missing ElectronAsarIntegrity.Resources/app.asar before archive replacement");
      }
    }
    // @electron/asar resolves with out.end(), not the stream's finish/close.
    // Wait for flushed bytes before inspecting, copying or deleting its source.
    const archiveStream = await asar.createPackageWithOptions(stagingDir, candidatePath, {
      unpack: "{dist/**,node_modules/**}",
      unpackDir: "{dist,node_modules}",
    });
    await finished(archiveStream);

    // Signing must never bless an archive with silently zero-filled or
    // otherwise modified proprietary/donor terms, even when the header and
    // integrity hash themselves are internally consistent.
    verifyRootRightsBytes(repoRoot, candidatePath, requiredRights);
    verifyDependencyLegalBytes(candidatePath, dependencyLegalFiles);
    fs.rmSync(unpackedDir, { recursive: true, force: true });
    if (fs.existsSync(candidatePath + ".unpacked")) {
      fs.cpSync(candidatePath + ".unpacked", unpackedDir, {
        recursive: true,
        mode: fs.constants.COPYFILE_FICLONE,
      });
    }
    fs.copyFileSync(candidatePath, asarPath, fs.constants.COPYFILE_FICLONE);
    asar.uncache(asarPath);

    if (electronPlatformName === "darwin") {
      const hash = updateMacEmbeddedAsarIntegrity(path.dirname(resourcesDir), asarPath);
      console.log(`[afterPackCopyNodeModules] Updated embedded app.asar integrity hash: ${hash}`);
    }

    console.log(`[afterPackCopyNodeModules] app.asar rebuilt: ${asarPath}`);
    console.log(
      `[afterPackCopyNodeModules] app.asar.unpacked present after rebuild: ${fs.existsSync(unpackedDir)}`,
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};

module.exports.updateMacEmbeddedAsarIntegrity = updateMacEmbeddedAsarIntegrity;
