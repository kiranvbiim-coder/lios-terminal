const fs = require("node:fs");
const path = require("node:path");
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

async function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist-app"));
  const resourcesPath = findPackagedResources(root);
  const reportPath = evidenceOutputPath(resourcesPath, process.env.LIOS_PYTHON_SIDECAR_EVIDENCE);
  const executable = bundledPythonSidecarPath(resourcesPath);
  const health = await probeBundledPythonSidecar({ executable });

  const evidence = {
    version: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    sidecarPath: path.relative(root, executable),
    python: health.python,
    requiredPackages: health.packages,
    status: "verified",
  };
  // Never add evidence to sealed app resources after signature verification.
  fs.writeFileSync(reportPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(evidence, null, 2));
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

module.exports = { evidenceOutputPath };
