const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pythonService = path.join(root, "python-service");
const distPath = path.join(root, "python-sidecar-dist");
const workPath = path.join(root, ".pyinstaller-work");
const specPath = path.join(root, ".pyinstaller-spec");
const python = process.env.PYTHON_EXECUTABLE || (process.platform === "win32" ? "python" : "python3");

for (const target of [distPath, workPath, specPath]) fs.rmSync(target, { recursive: true, force: true });

const collectAll = [
  "fastapi",
  "uvicorn",
  "numpy",
  "scipy",
  "statsmodels",
  "pandas",
  "linearmodels",
  "QuantLib",
  "arch",
  "ruptures",
  "yfinance",
  "sklearn",
  "networkx",
  "moocore",
  "pymoo",
  "SALib",
  "asteval",
  "edgar",
];

const copyMetadata = [
  "fastapi",
  "uvicorn",
  "numpy",
  "scipy",
  "statsmodels",
  "pandas",
  "linearmodels",
  "QuantLib",
  "arch",
  "ruptures",
  "yfinance",
  "scikit-learn",
  "networkx",
  "moocore",
  "pymoo",
  "SALib",
  "asteval",
  "edgartools",
];

const args = [
  "-m", "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onedir",
  "--name", "lios-python-sidecar",
  "--distpath", distPath,
  "--workpath", workPath,
  "--specpath", specPath,
  "--paths", pythonService,
];

for (const moduleName of collectAll) args.push("--collect-all", moduleName);
for (const distribution of copyMetadata) args.push("--copy-metadata", distribution);
// Engine modules are resolved lazily at runtime; freeze every shipped local module,
// without importing their optional numerical libraries during HTTP startup.
for (const entry of fs.readdirSync(pythonService, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".py") && !entry.name.startsWith("test_") && entry.name !== "conftest.py") {
    args.push("--hidden-import", entry.name.slice(0, -3));
  }
}
args.push(path.join(pythonService, "sidecar_entry.py"));

const result = spawnSync(python, args, {
  cwd: root,
  env: { ...process.env, PYTHONHASHSEED: "0" },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

const executable = path.join(
  distPath,
  "lios-python-sidecar",
  process.platform === "win32" ? "lios-python-sidecar.exe" : "lios-python-sidecar",
);
if (!fs.existsSync(executable)) {
  console.error(`PyInstaller completed but no sidecar executable exists at ${executable}`);
  process.exit(1);
}
try {
  if (process.platform !== "win32") fs.chmodSync(executable, 0o755);
} catch {
  // release verification will catch an unusable executable.
}
// Do not ship an executable that merely exists: the known-answer reverse-DCF
// and authentication probe must pass in the REAL frozen Python executable.
// Installed app qualification remains a separate release gate.
const { qualifyBuiltPythonSidecar } = require("./sidecar_build_acceptance.cjs");
qualifyBuiltPythonSidecar(executable)
  .then(() => {
    console.log("Built Python sidecar passed authenticated calculation and reverse-DCF qualification.");
  })
  .catch(() => {
    console.error("Bundled sidecar build qualification failed. No distributable app is accepted.");
    process.exitCode = 1;
  });
