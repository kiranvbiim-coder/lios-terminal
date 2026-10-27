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
    // Never expose internal server error bodies (which can include local paths
    // or tracebacks) in release and qualification logs.
    throw new Error(`Bundled Python sidecar representative calculation failed with HTTP ${response.status}.`);
  }
  return validateRepresentativeCalculation(await response.json());
}

// The installed sidecar's existing statistics probe cannot prove that
// the advanced valuation route is registered, importable or numerically sound.
// This known-answer input matches SP-01's independently checked reverse-DCF.
const PACKAGED_VALUATION_ROUTE = "/advanced/valuation/reverse-dcf";
const PACKAGED_VALUATION_INPUT = Object.freeze({
  currentRevenue: 100,
  marketEquityValue: 100,
  years: 1,
  waccPct: 10,
  terminalGrowthPct: 0,
  ebitMarginPct: 20,
  taxRatePct: 0,
  reinvestmentPctOfRevenue: 10,
  solveFor: "revenue_growth",
});

function validateRepresentativeValuation(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Packaged valuation route returned no typed numerical result.");
  }
  const values = [["impliedRevenueGrowthPct", 0], ["repricedEquityValue", 100]];
  for (const [name, expected] of values) {
    if (typeof result[name] !== "number" || !Number.isFinite(result[name]) || Math.abs(result[name] - expected) > 1e-7) {
      throw new Error("Packaged valuation failed independently verified " + name + " result.");
    }
  }
  return { verified: true, route: PACKAGED_VALUATION_ROUTE,
    impliedRevenueGrowthPct: result.impliedRevenueGrowthPct, repricedEquityValue: result.repricedEquityValue };
}

async function runRepresentativeValuation(port, token) {
  const response = await fetch(`http://127.0.0.1:${port}${PACKAGED_VALUATION_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json", [SIDECAR_TOKEN_HEADER]: token },
    body: JSON.stringify(PACKAGED_VALUATION_INPUT),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // No private Python tracebacks or local system paths in a public release log.
    throw new Error(`Packaged valuation route failed with HTTP ${response.status}.`);
  }
  return validateRepresentativeValuation(await response.json());
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

/**
 * A packaged worker may emit private paths/tracebacks on stderr. Keep public
 * qualification diagnostics actionable without returning untrusted process text.
 */
function publicSidecarProbeFailure(error, observedStderr = false) {
  const message = error instanceof Error ? error.message : "";
  const http = /^(Packaged valuation route failed|Bundled Python sidecar representative calculation failed|Bundled Python sidecar authenticated runtime-info request failed) with HTTP ([1-5][0-9]{2})\./.exec(message);
  const reason = http
    ? `${http[1]} with HTTP ${http[2]}.`
    : message.startsWith("Bundled Python sidecar failed health probe:")
      ? "Bundled Python sidecar health probe failed."
      : REQUIRED_SIDECAR_PACKAGES.some(name => message === `Bundled Python sidecar is missing required package ${name}.`)
        ? "Bundled Python sidecar is missing a required package."
        : "Bundled Python sidecar qualification failed.";
  const detail = observedStderr ? " Worker diagnostics withheld from public logs." : "";
  return new Error(reason + detail);
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
  // Neither stdout nor stderr may backpressure the worker into hanging.
  // Sidecar output is not retained as it may contain private tracebacks/paths.
  child.stdout.on("data", () => {});
  let observedStderr = false;
  child.stderr.on("data", () => { observedStderr = true; });

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
    const valuationRoute = await runRepresentativeValuation(port, token);
    return { ...health, authentication, representativeRoute, valuationRoute, executable };
  } catch (error) {
    throw publicSidecarProbeFailure(error, observedStderr);
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
module.exports.PACKAGED_VALUATION_ROUTE = PACKAGED_VALUATION_ROUTE;
module.exports.PACKAGED_VALUATION_INPUT = PACKAGED_VALUATION_INPUT;
module.exports.validateRepresentativeValuation = validateRepresentativeValuation;
module.exports.runRepresentativeValuation = runRepresentativeValuation;
module.exports.publicSidecarProbeFailure = publicSidecarProbeFailure;
module.exports.runRepresentativeCalculation = runRepresentativeCalculation;
