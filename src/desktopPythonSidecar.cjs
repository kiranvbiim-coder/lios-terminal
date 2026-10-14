const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");

const SAFE_PYTHON_SIDECAR_ENV_KEYS = Object.freeze([
  "PATH",
  "HOME",
  "USERPROFILE",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
]);
const SECRET_ENV_NAME = /(?:api[_-]?key|token|secret|password|credential|authorization|cookie|private[_-]?key)/i;
const SIDECAR_TOKEN_ENV = "LIOS_SIDECAR_TOKEN";
const SIDECAR_TOKEN_HEADER = "X-LiOS-Sidecar-Token";

function buildBundledPythonSidecarEnvironment(overrides = {}) {
  const env = { PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1", PYTHONUTF8: "1" };
  for (const name of SAFE_PYTHON_SIDECAR_ENV_KEYS) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (name !== SIDECAR_TOKEN_ENV && SECRET_ENV_NAME.test(name)) throw new Error(`Bundled Python sidecar secrets must not be passed through environment variable ${name}.`);
    env[name] = String(value);
  }
  env.PYTHONDONTWRITEBYTECODE = "1";
  env.PYTHONNOUSERSITE = "1";
  env.PYTHONUTF8 = "1";
  return env;
}

const REQUIRED_SIDECAR_PACKAGES = Object.freeze([
  "fastapi",
  "uvicorn",
  "numpy",
  "scipy",
  "statsmodels",
  "pandas",
  "QuantLib",
]);

function bundledPythonSidecarPath(resourcesPath, platform = process.platform) {
  if (!resourcesPath) return null;
  const executable = platform === "win32" ? "lios-python-sidecar.exe" : "lios-python-sidecar";
  const candidate = path.join(resourcesPath, "python-sidecar-dist", "lios-python-sidecar", executable);
  return fs.existsSync(candidate) ? candidate : null;
}

async function reserveLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a loopback port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForSidecarHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Bundled Python sidecar failed health probe: ${lastError}`);
}

function validateRepresentativeCalculation(payload) {
  if (!payload || typeof payload !== "object" || !payload.result || typeof payload.result !== "object") {
    throw new Error("Bundled Python sidecar returned an invalid representative calculation result.");
  }
  const mean = Number(payload.result.mean);
  if (!Number.isFinite(mean) || Math.abs(mean - 3) > 1e-12) {
    throw new Error("Bundled Python sidecar representative calculation returned an unexpected mean.");
  }
  return {
    verified: true,
    route: "/stats/descriptive-diagnostics",
    mean,
  };
}

async function runRepresentativeCalculation(port, token) {
  const response = await fetch(`http://127.0.0.1:${port}/stats/descriptive-diagnostics`, {
    method: "POST",
    headers: { "content-type": "application/json", [SIDECAR_TOKEN_HEADER]: token },
    body: JSON.stringify({ data: [1, 2, 3, 4, 5] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Bundled Python sidecar representative calculation failed with HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}.`);
  }
  return validateRepresentativeCalculation(await response.json());
}

// The sidecar must enforce its per-launch token: an unauthenticated or wrongly
// authenticated request to a real route is rejected with 401, /health alone is
// open and minimal (no package versions), and the correct token is accepted.
async function verifySidecarAuthentication(port, token, health) {
  const base = `http://127.0.0.1:${port}`;
  const route = `${base}/runtime-info`;
  const anonymous = await fetch(route, { signal: AbortSignal.timeout(5_000) });
  if (anonymous.status !== 401) throw new Error(`Bundled Python sidecar accepted an unauthenticated request (HTTP ${anonymous.status}); expected 401.`);
  const wrong = await fetch(route, { headers: { [SIDECAR_TOKEN_HEADER]: `${token}x` }, signal: AbortSignal.timeout(5_000) });
  if (wrong.status !== 401) throw new Error(`Bundled Python sidecar accepted a wrong token (HTTP ${wrong.status}); expected 401.`);
  if (health.packages !== undefined || health.python !== undefined) throw new Error("Bundled Python sidecar /health leaked environment details.");
  return { unauthenticatedRejected: true, wrongTokenRejected: true, healthMinimal: true };
}

function validateHealth(health) {
  if (!health || typeof health !== "object" || health.ok !== true) throw new Error("Bundled Python sidecar returned an invalid health response.");
  const packages = health.packages && typeof health.packages === "object" ? health.packages : {};
  for (const name of REQUIRED_SIDECAR_PACKAGES) {
    if (!packages[name] || packages[name] === "unavailable") {
      throw new Error(`Bundled Python sidecar is missing required package ${name}.`);
    }
  }
  return {
    python: typeof health.python === "string" ? health.python : "unknown",
    packages: Object.fromEntries(REQUIRED_SIDECAR_PACKAGES.map((name) => [name, packages[name]])),
  };
}

async function probeBundledPythonSidecar(options) {
  const executable = options.executable;
  if (!executable || !fs.existsSync(executable)) throw new Error("Bundled Python sidecar executable is missing.");
  if (process.platform !== "win32" && (fs.statSync(executable).mode & 0o111) === 0) throw new Error("Bundled Python sidecar is not executable.");

  const port = await reserveLoopbackPort();
  const token = crypto.randomBytes(32).toString("base64url");
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: buildBundledPythonSidecarEnvironment({
      PYTHON_SERVICE_PORT: String(port),
      LIOS_PYTHON_LOG_LEVEL: "warning",
      ...(options.env || {}),
      [SIDECAR_TOKEN_ENV]: token,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    const openHealth = await waitForSidecarHealth(port, options.timeoutMs || 45_000);
    if (!openHealth || openHealth.ok !== true) throw new Error("Bundled Python sidecar returned an invalid health response.");
    const authentication = await verifySidecarAuthentication(port, token, openHealth);
    const runtimeInfo = await fetch(`http://127.0.0.1:${port}/runtime-info`, {
      headers: { [SIDECAR_TOKEN_HEADER]: token },
      signal: AbortSignal.timeout(5_000),
    });
    if (!runtimeInfo.ok) throw new Error(`Bundled Python sidecar authenticated runtime-info request failed with HTTP ${runtimeInfo.status}.`);
    const health = validateHealth(await runtimeInfo.json());
    const representativeRoute = await runRepresentativeCalculation(port, token);
    return { ...health, authentication, representativeRoute, executable };
  } catch (error) {
    if (stderr.trim()) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} Sidecar stderr: ${stderr.trim().slice(0, 2_000)}`);
    }
    throw error;
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

module.exports = {
  SAFE_PYTHON_SIDECAR_ENV_KEYS,
  buildBundledPythonSidecarEnvironment,
  REQUIRED_SIDECAR_PACKAGES,
  bundledPythonSidecarPath,
  probeBundledPythonSidecar,
  validateHealth,
  validateRepresentativeCalculation,
};
module.exports.SIDECAR_TOKEN_HEADER = SIDECAR_TOKEN_HEADER;
module.exports.verifySidecarAuthentication = verifySidecarAuthentication;
