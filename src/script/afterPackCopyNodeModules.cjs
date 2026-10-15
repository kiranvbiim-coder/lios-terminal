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
// Fix: after electron-builder finishes packaging, throw away its app.asar
// and app.asar.unpacked entirely and rebuild BOTH from a staging directory
// that (a) extracts everything electron-builder DID get right out of the
// original app.asar (dist/**, main.cjs, build-resources/**, etc.) and (b)
// overlays a full, dereferenced copy of the real node_modules on top. This
// sidesteps electron-builder's dependency-tree resolution entirely for
// both the archive and its unpacked mirror.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const plist = require("plist");

const EXCLUDE_DIR_NAMES = new Set([".bin", "test", "tests", "__tests__", "example", "examples", ".github"]);
const EXCLUDE_EXTENSIONS = new Set([".md", ".map", ".ts", ".flow"]);
// Legal files and the complete contents of legal directories take precedence
// over size pruning. Some dependencies put their only terms in LICENSE.md or
// licenses/<component>/README.md, including case variants.
const LEGAL_PATH_NAME = /^(?:third[-_]?party[-_])?(?:licen[cs]es?|copying|notices?)(?:[._-].*)?$/i;

/** Enumerate every bundled root-rights source so verification cannot miss nested donor grants. */
function rootRightsFiles(repoRoot) {
  const paths = ["LICENSE", "THIRD_PARTY_NOTICES.md"];
  function collect(relative) {
    const source = path.join(repoRoot, relative);
    const entry = fs.statSync(source);
    if (entry.isDirectory()) {
      for (const child of fs.readdirSync(source)) collect(path.join(relative, child));
    } else if (entry.isFile()) {
      paths.push(relative);
    } else {
      throw new Error(`[afterPackCopyNodeModules] Unsupported root legal source: ${relative}`);
    }
  }
  collect("third_party/licenses");
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

function shouldCopy(srcPath, sourceRoot) {
  const relativePath = sourceRoot ? path.relative(sourceRoot, srcPath) : path.basename(srcPath);
  if (relativePath.split(path.sep).some((part) => LEGAL_PATH_NAME.test(part))) return true;
  const base = path.basename(srcPath);
  if (EXCLUDE_DIR_NAMES.has(base)) return false;
  const ext = path.extname(srcPath);
  if (ext && EXCLUDE_EXTENSIONS.has(ext)) return false;
  return true;
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

  const sourceCount = fs.readdirSync(srcNodeModules).length;
  console.log(
    `[afterPackCopyNodeModules] Rebuilding app.asar with a full node_modules copy ` +
      `(electron-builder's dependency walker is known to drop transitive deps on this project). ` +
      `src=${srcNodeModules} (${sourceCount} top-level packages)`,
  );

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-asar-rebuild-"));
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

    // 2. Blow away whatever partial/broken node_modules ended up in the
    //    staging tree and replace with a full dereferenced copy of the
    //    real thing.
    const stagingNodeModules = path.join(stagingDir, "node_modules");
    fs.rmSync(stagingNodeModules, { recursive: true, force: true });
    fs.mkdirSync(stagingNodeModules, { recursive: true });
    fs.cpSync(srcNodeModules, stagingNodeModules, {
      recursive: true,
      dereference: true,
      mode: fs.constants.COPYFILE_FICLONE,
      filter: (source) => shouldCopy(source, srcNodeModules),
    });

    const destCount = fs.readdirSync(stagingNodeModules).length;
    console.log(`[afterPackCopyNodeModules] Staged ${destCount} top-level packages.`);
    if (destCount < sourceCount - 1) {
      // -1 tolerates the excluded ".bin" entry.
      console.warn(
        `[afterPackCopyNodeModules] WARNING: staged count (${destCount}) is notably lower than source count ` +
          `(${sourceCount}); verify exclude filters did not drop a required top-level package.`,
      );
    }

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

    // 3. Rebuild app.asar from the corrected staging tree, unpacking the
    //    same paths the original build config unpacked (dist/**, node_modules/**).
    fs.rmSync(asarPath, { force: true });
    fs.rmSync(unpackedDir, { recursive: true, force: true });
    await asar.createPackageWithOptions(stagingDir, asarPath, {
      unpack: "{dist/**,node_modules/**}",
      unpackDir: "{dist,node_modules}",
    });
    // extractAll cached the old index under this same archive path.
    // Consumers in this process must inspect the newly rebuilt notice files.
    asar.uncache(asarPath);

    // Signing must never bless an archive with silently zero-filled or
    // otherwise modified proprietary/donor terms, even when the header and
    // integrity hash themselves are internally consistent.
    verifyRootRightsBytes(repoRoot, asarPath, requiredRights);

    if (electronPlatformName === "darwin") {
      const hash = updateMacEmbeddedAsarIntegrity(path.dirname(resourcesDir), asarPath);
      console.log(`[afterPackCopyNodeModules] Updated embedded app.asar integrity hash: ${hash}`);
    }

    console.log(`[afterPackCopyNodeModules] app.asar rebuilt: ${asarPath}`);
    console.log(
      `[afterPackCopyNodeModules] app.asar.unpacked present after rebuild: ${fs.existsSync(unpackedDir)}`,
    );
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
};

module.exports.updateMacEmbeddedAsarIntegrity = updateMacEmbeddedAsarIntegrity;
module.exports.shouldCopy = shouldCopy;
