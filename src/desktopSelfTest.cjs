const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadOrCreateProtectedSecret } = require("./desktopSecretCustody.cjs");
const { ensureLocalWorkspace } = require("./desktopWorkspace.cjs");
const { bundledPythonSidecarPath, probeBundledPythonSidecar } = require("./desktopPythonSidecar.cjs");

function performWorkspaceRecoveryProbe(root) {
  const workspace = ensureLocalWorkspace(path.join(root, "workspace"));
  const markerPath = path.join(workspace.paths.datasets, "p2-self-test.txt");
  const original = `p2-recovery-${crypto.randomUUID()}`;
  fs.writeFileSync(markerPath, original, { encoding: "utf8", mode: 0o600 });

  const reopened = ensureLocalWorkspace(path.join(root, "workspace"));
  const persisted = fs.readFileSync(markerPath, "utf8");

  if (reopened.workspaceId !== workspace.workspaceId) throw new Error("Workspace self-test reopened a different workspace.");
  if (persisted !== original) throw new Error("Workspace self-test did not preserve the written data across reopen.");

  return {
    workspaceId: workspace.workspaceId,
    persistedFileCount: 1,
  };
}

function listForbiddenPackagedPythonBytecode(resourcesPath) {
  const results = [];
  const visit = (absolutePath) => {
    if (!fs.existsSync(absolutePath)) return;
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(absolutePath, entry.name);
      if (entry.name === "__pycache__") {
        results.push(path.relative(resourcesPath, child));
        continue;
      }
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      if (entry.isFile() && /\.(?:pyc|pyo)$/i.test(entry.name)) {
        results.push(path.relative(resourcesPath, child));
      }
    }
  };
  for (const root of ["python-service", "python-sidecar-dist", "script"]) visit(path.join(resourcesPath, root));
  return results.sort();
}

function assertPackagedPythonResourcesImmutable(resourcesPath, phase) {
  const forbidden = listForbiddenPackagedPythonBytecode(resourcesPath);
  if (forbidden.length) {
    throw new Error(
      `Packaged Python resources were mutated ${phase}: ${forbidden.slice(0, 20).join(", ")}`,
    );
  }
  return forbidden;
}

function locatePackagedServer(appPath) {
  const base = path.dirname(appPath);
  const candidates = [
    path.join(base, "app.asar.unpacked", "dist", "index.cjs"),
    path.join(appPath, "dist", "index.cjs"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function runPackagedDesktopSelfTest(options) {
  const {
    app,
    safeStorage,
    resourcesPath,
    appPath,
    electronAppReadyElapsedMs,
  } = options;

  const selfTestStartedAtNs = process.hrtime.bigint();

  if (!app?.isPackaged) throw new Error("Desktop self-test must run from a packaged application.");
  // The beta acceptance gate must not reuse a self-test from an earlier
  // installer. Electron's packaged getVersion() reads the actual app metadata.
  const packageVersion = app.getVersion?.();
  if (typeof packageVersion !== "string" ||
      !/^[0-9]+[.][0-9]+[.][0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(packageVersion)) {
    throw new Error("Packaged application version is missing or malformed.");
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p2-self-test-"));
  try {
    const custody = loadOrCreateProtectedSecret({
      safeStorage,
      userDataPath: path.join(root, "user-data"),
      configuredSecret: "",
      isPackaged: true,
    });
    if (custody.mode !== "native_protected" || !custody.protectedAtRest || !custody.secret) {
      throw new Error(`Native desktop secret custody is not available: ${custody.detail}`);
    }

    const workspace = performWorkspaceRecoveryProbe(root);
    const serverPath = locatePackagedServer(appPath);
    if (!serverPath) throw new Error("Packaged Node backend is missing.");

    const bytecodeBefore = assertPackagedPythonResourcesImmutable(resourcesPath, "before Python startup");
    const sidecarPath = bundledPythonSidecarPath(resourcesPath);
    if (!sidecarPath) throw new Error("Bundled Python sidecar is missing from packaged resources.");
    const sidecar = await probeBundledPythonSidecar({ executable: sidecarPath });
    const bytecodeAfter = assertPackagedPythonResourcesImmutable(resourcesPath, "after Python startup and representative calculation");

    const updaterMetadata = path.join(resourcesPath, "app-update.yml");
    if (!fs.existsSync(updaterMetadata)) throw new Error("Packaged updater metadata app-update.yml is missing.");

    return {
      version: 1,
      packageVersion,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      status: "verified",
      nativeSecretCustody: {
        mode: custody.mode,
        protectedAtRest: custody.protectedAtRest,
        roundTripVerified: true,
      },
      workspaceRecovery: workspace,
      packagedBackend: path.basename(serverPath),
      pythonSidecar: {
        python: sidecar.python,
        requiredPackages: sidecar.packages,
        representativeRoute: sidecar.representativeRoute,
        valuationRoute: sidecar.valuationRoute,
      },
      packagedResourceImmutability: {
        checkedRoots: ["python-service", "python-sidecar-dist", "script"],
        forbiddenPythonBytecodeBefore: bytecodeBefore.length,
        forbiddenPythonBytecodeAfter: bytecodeAfter.length,
      },
      updaterMetadataPresent: true,
      performance: {
        electronAppReadyElapsedMs: Number(electronAppReadyElapsedMs),
        desktopSelfTestElapsedMs: Number(process.hrtime.bigint() - selfTestStartedAtNs) / 1_000_000,
        mainProcessMemoryAtCompletion: (() => {
          const memory = process.memoryUsage();
          return {
            rssBytes: memory.rss,
            heapUsedBytes: memory.heapUsed,
            heapTotalBytes: memory.heapTotal,
            externalBytes: memory.external,
          };
        })(),
      },
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = {
  assertPackagedPythonResourcesImmutable,
  listForbiddenPackagedPythonBytecode,
  locatePackagedServer,
  performWorkspaceRecoveryProbe,
  runPackagedDesktopSelfTest,
};
