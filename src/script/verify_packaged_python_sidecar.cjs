const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { bundledPythonSidecarPath, probeBundledPythonSidecar } = require("../desktopPythonSidecar.cjs");

function walkDirectories(root, found = []) {
  if (!fs.existsSync(root)) return found;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(full);
      walkDirectories(full, found);
    }
  }
  return found;
}

function findPackagedResources(root) {
  const candidates = [root, ...walkDirectories(root)].filter((directory) => {
    const sidecar = bundledPythonSidecarPath(directory);
    return Boolean(sidecar);
  });
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one packaged Resources directory containing the LiOS Python sidecar; found ${candidates.length}.`);
  }
  return candidates[0];
}

function evidenceOutputPath(root, configured) {
  let bundle = path.resolve(root);
  while (!bundle.endsWith(".app") && path.dirname(bundle) !== bundle) bundle = path.dirname(bundle);
  const appBundle = bundle.endsWith(".app") ? bundle : null;
  const report = path.resolve(configured || path.join(appBundle ? path.dirname(appBundle) : path.dirname(root), "python-sidecar-evidence.json"));
  if (appBundle && (report === appBundle || report.startsWith(appBundle + path.sep))) {
    throw new Error("Sidecar evidence must be written outside the signed application bundle.");
  }
  return report;
}

// Bind qualification to the exact frozen executable bytes rather than a
// matching filename; the path alone cannot prove which artifact was tested.
function sidecarExecutableIdentity(executable) {
  const before = fs.lstatSync(executable);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 ||
      before.size > 4 * 1024 * 1024 * 1024) {
    throw new Error("Packaged sidecar identity requires a bounded regular executable.");
  }
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(executable, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.size !== before.size ||
        opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error("Packaged sidecar executable changed during fingerprint acquisition.");
    }
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      hash.update(chunk.subarray(0, count));
    }
    const finished = fs.fstatSync(fd);
    if (finished.size !== before.size || finished.mtimeMs !== before.mtimeMs) {
      throw new Error("Packaged sidecar executable changed during fingerprint acquisition.");
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: hash.digest("hex"), bytes: before.size };
}

function writeSidecarEvidenceReport(resourcesPath, reportPath, evidence) {
  const root = path.resolve(resourcesPath);
  const report = path.resolve(reportPath);
  if (report === root || report.startsWith(root + path.sep)) {
    throw new Error("Sidecar evidence must be written outside packaged resources.");
  }
  // Do not overwrite an earlier native qualification report for another binary.
  fs.writeFileSync(report, JSON.stringify(evidence, null, 2) + "\n", {
    encoding: "utf8", flag: "wx", mode: 0o600,
  });
}

async function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist-app"));
  const resourcesPath = findPackagedResources(root);
  const reportPath = evidenceOutputPath(resourcesPath, process.env.LIOS_PYTHON_SIDECAR_EVIDENCE);
  const executable = bundledPythonSidecarPath(resourcesPath);
  const executableBefore = sidecarExecutableIdentity(executable);
  const health = await probeBundledPythonSidecar({ executable });
  const executableAfter = sidecarExecutableIdentity(executable);
  if (executableBefore.sha256 !== executableAfter.sha256 ||
      executableBefore.bytes !== executableAfter.bytes) {
    throw new Error("Packaged Python sidecar changed during native qualification.");
  }

  const evidence = {
    version: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    sidecarPath: path.relative(root, executable),
    sidecarExecutable: executableAfter,
    python: health.python,
    requiredPackages: health.packages,
    representativeRoute: health.representativeRoute,
    valuationRoute: health.valuationRoute,
    status: "verified",
  };
  // Never add evidence to sealed app resources after signature verification.
  writeSidecarEvidenceReport(resourcesPath, reportPath, evidence);
  console.log(JSON.stringify(evidence, null, 2));
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

module.exports = { evidenceOutputPath, sidecarExecutableIdentity, writeSidecarEvidenceReport };
