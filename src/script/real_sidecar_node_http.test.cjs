// Source-runtime integration, not a packaged PyInstaller or Electron release test.
// Exercise actual Node desktop probe functions against a real per-launch Python
// sidecar process. All HTTP calls stay on 127.0.0.1 with synthetic inputs.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { createServer } = require("node:net");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  buildBundledPythonSidecarEnvironment,
  verifySidecarAuthentication,
  validateHealth,
  runRepresentativeCalculation,
  runRepresentativeValuation,
  PACKAGED_VALUATION_ROUTE,
} = require("../desktopPythonSidecar.cjs");

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child, port) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error("Real Python service exited before loopback health.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const data = await response.json();
        if (data.ok === true && Object.keys(data).length === 1) return data;
      }
    } catch { /* Python may still be importing the deterministic numerical service. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Real Python sidecar did not become healthy over loopback within 30s.");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, "exit").catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, 2500)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("real Node desktop validation probes authenticated Python HTTP and reverse DCF", { timeout: 45_000 }, async () => {
  const port = await freeLoopbackPort();
  const token = crypto.randomBytes(32).toString("base64url");
  const python = process.env.PYTHON_EXECUTABLE || (process.platform === "win32" ? "python" : "python3");
  const service = path.resolve(__dirname, "../python-service/sidecar_entry.py");
  let child;
  try {
    child = spawn(python, [service], {
      cwd: path.dirname(service),
      env: buildBundledPythonSidecarEnvironment({
        PYTHON_SERVICE_PORT: String(port),
        LIOS_SIDECAR_TOKEN: token,
        LIOS_PARENT_PID: String(process.pid),
        LIOS_PYTHON_LOG_LEVEL: "warning",
      }),
      stdio: ["ignore", "ignore", "ignore"],
    });
    // Don't expose child stderr/tracebacks; report only a public-stage failure.
    const error = new Promise((_, reject) => child.once("error", () => reject(new Error("Python launch failed."))));
    const health = await Promise.race([waitForReady(child, port), error]);
    assert.deepEqual(await verifySidecarAuthentication(port, token, health), {
      unauthenticatedRejected: true, wrongTokenRejected: true, healthMinimal: true,
    });
    const inventory = await fetch(`http://127.0.0.1:${port}/runtime-info`, {
      headers: { "X-LiOS-Sidecar-Token": token }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(inventory.status, 200);
    const packages = validateHealth(await inventory.json()).packages;
    assert.ok(packages.numpy);
    assert.ok(packages.scipy);
    assert.deepEqual(await runRepresentativeCalculation(port, token), {
      verified: true, route: "/stats/descriptive-diagnostics", mean: 3,
    });
    const valuation = await runRepresentativeValuation(port, token);
    assert.equal(valuation.verified, true);
    assert.equal(valuation.route, PACKAGED_VALUATION_ROUTE);
    assert.ok(Math.abs(valuation.impliedRevenueGrowthPct) <= 1e-7);
    assert.ok(Math.abs(valuation.repricedEquityValue - 100) <= 1e-7);
  } finally {
    await stopChild(child);
  }
});
