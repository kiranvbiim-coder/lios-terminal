const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const {
  bundledPythonSidecarPath,
  validateHealth,
  validateRepresentativeCalculation,
  REQUIRED_SIDECAR_PACKAGES,
  buildBundledPythonSidecarEnvironment,
  SIDECAR_TOKEN_HEADER,
  verifySidecarAuthentication,
  PACKAGED_VALUATION_ROUTE,
  PACKAGED_VALUATION_INPUT,
  validateRepresentativeValuation,
  runRepresentativeValuation,
  runRepresentativeCalculation,
  publicSidecarProbeFailure,
} = require("./desktopPythonSidecar.cjs");

test("bundled sidecar path is platform-specific and fail-closed when absent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-sidecar-path-"));
  try {
    assert.equal(bundledPythonSidecarPath(root, "darwin"), null);
    const dir = path.join(root, "python-sidecar-dist", "lios-python-sidecar");
    fs.mkdirSync(dir, { recursive: true });
    const executable = path.join(dir, "lios-python-sidecar");
    fs.writeFileSync(executable, "stub", { mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(executable, 0o700);
    assert.equal(bundledPythonSidecarPath(root, "darwin"), executable);
    assert.equal(bundledPythonSidecarPath(root, "win32"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged desktop probe rejects symlinked parent directories and untrusted images", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-sidecar-parent-"));
  try {
    const distribution = path.join(root, "python-sidecar-dist");
    const bundle = path.join(distribution, "lios-python-sidecar");
    const external = path.join(root, "unrelated-runtime");
    fs.mkdirSync(external);
    const fake = path.join(external, "lios-python-sidecar");
    fs.writeFileSync(fake, "synthetic external binary", { mode: 0o700 });
    if (process.platform !== "win32") {
      fs.symlinkSync(external, distribution, "dir");
      assert.equal(bundledPythonSidecarPath(root, "darwin"), null,
        "a symlinked distribution cannot redirect the packaged self-test to host Python");
      fs.unlinkSync(distribution);
    }
    fs.mkdirSync(distribution);
    if (process.platform !== "win32") {
      fs.symlinkSync(external, bundle, "dir");
      assert.equal(bundledPythonSidecarPath(root, "darwin"), null,
        "the nested bundle folder cannot redirect an executable outside Resources");
      fs.unlinkSync(bundle);
    }
    fs.mkdirSync(bundle);
    const owned = path.join(bundle, "lios-python-sidecar");
    fs.writeFileSync(owned, "synthetic packaged image", { mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(owned, 0o700);
    assert.equal(bundledPythonSidecarPath(root, "darwin"), owned);
    fs.writeFileSync(owned, "");
    assert.equal(bundledPythonSidecarPath(root, "darwin"), null);
    assert.equal(bundledPythonSidecarPath("relative-Resources", "darwin"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bundled sidecar health requires every deterministic core package", () => {
  const packages = Object.fromEntries(REQUIRED_SIDECAR_PACKAGES.map((name) => [name, "1.0.0"]));
  const valid = validateHealth({ ok: true, python: "3.12.10", packages });
  assert.equal(valid.python, "3.12.10");
  assert.deepEqual(Object.keys(valid.packages), [...REQUIRED_SIDECAR_PACKAGES]);
  assert.throws(() => validateHealth({ ok: true, python: "3.12.10", packages: { ...packages, QuantLib: "unavailable" } }), /QuantLib/);
  assert.throws(() => validateHealth({ ok: false, packages }), /invalid health/);
});


test("packaged sidecar environment never inherits unrelated secrets", () => {
  const previous = process.env.LIOS_TEST_SECRET_TOKEN;
  process.env.LIOS_TEST_SECRET_TOKEN = "must-not-leak";
  try {
    const env = buildBundledPythonSidecarEnvironment({
      PYTHON_SERVICE_PORT: "49152",
      LIOS_SIDECAR_TOKEN: "per-launch-token",
      LIOS_PYTHON_LOG_LEVEL: "warning",
      PYTHONDONTWRITEBYTECODE: "0",
    });
    assert.equal(env.LIOS_TEST_SECRET_TOKEN, undefined);
    assert.equal(env.PYTHON_SERVICE_PORT, "49152");
    assert.equal(env.LIOS_SIDECAR_TOKEN, "per-launch-token");
    assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
    assert.equal(env.PYTHONNOUSERSITE, "1");
    assert.throws(
      () => buildBundledPythonSidecarEnvironment({ PROVIDER_API_KEY: "secret" }),
      /secrets must not be passed/,
    );
  } finally {
    if (previous === undefined) delete process.env.LIOS_TEST_SECRET_TOKEN;
    else process.env.LIOS_TEST_SECRET_TOKEN = previous;
  }
});


test("packaged sidecar representative deterministic calculation is validated", () => {
  assert.deepEqual(
    validateRepresentativeCalculation({ result: { mean: 3 }, diagnostics: {}, warnings: [] }),
    { verified: true, route: "/stats/descriptive-diagnostics", mean: 3 },
  );
  assert.throws(
    () => validateRepresentativeCalculation({ result: { mean: 99 } }),
    /unexpected mean/,
  );
  assert.throws(
    () => validateRepresentativeCalculation({ diagnostics: {} }),
    /invalid representative calculation result/,
  );
});

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

test("sidecar self-test requires 401 for missing/wrong tokens and a minimal /health", async () => {
  const token = "per-launch-token";
  const enforcing = await listen((req, res) => {
    const ok = req.headers[SIDECAR_TOKEN_HEADER.toLowerCase()] === token;
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { ok: true } : { detail: "Unauthorized" }));
  });
  const open = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    assert.deepEqual(await verifySidecarAuthentication(enforcing.port, token, { ok: true }), {
      unauthenticatedRejected: true,
      wrongTokenRejected: true,
      healthMinimal: true,
    });
    await assert.rejects(() => verifySidecarAuthentication(enforcing.port, token, { ok: true, packages: {} }), /leaked/);
    await assert.rejects(() => verifySidecarAuthentication(open.port, token, { ok: true }), /unauthenticated request/);
  } finally {
    enforcing.server.close();
    open.server.close();
  }
});

test("packaged numerical probe agrees exactly with original independently checked SP-01 valuation contract", async () => {
  const expected = await import("./script/sp01_strict_python_valuation_contract.mjs");
  assert.equal(PACKAGED_VALUATION_ROUTE, expected.REVERSE_ROUTE);
  assert.deepEqual(PACKAGED_VALUATION_INPUT, expected.REVERSE_BODY);
  assert.deepEqual(validateRepresentativeValuation({
    impliedRevenueGrowthPct: 0, repricedEquityValue: 100, absoluteError: 0,
  }), {
    verified: true, route: PACKAGED_VALUATION_ROUTE, impliedRevenueGrowthPct: 0, repricedEquityValue: 100,
  });
  for (const invalid of [
    null, {}, { impliedRevenueGrowthPct: "0", repricedEquityValue: 100 },
    { impliedRevenueGrowthPct: 0, repricedEquityValue: "100" },
    { impliedRevenueGrowthPct: NaN, repricedEquityValue: 100 },
    { impliedRevenueGrowthPct: 1.1, repricedEquityValue: 100 },
    { impliedRevenueGrowthPct: 0, repricedEquityValue: 90 },
  ]) assert.throws(() => validateRepresentativeValuation(invalid));
});

test("packaged probe performs real loopback authenticated POST to exact valuation route", async () => {
  const token = "known-value-only-token";
  let requestCount = 0;
  const service = await listen(async (req, res) => {
    requestCount++;
    const raw = [];
    for await (const chunk of req) raw.push(chunk);
    assert.equal(req.method, "POST");
    assert.equal(req.url, PACKAGED_VALUATION_ROUTE);
    assert.equal(req.headers[SIDECAR_TOKEN_HEADER.toLowerCase()], token);
    assert.deepEqual(JSON.parse(Buffer.concat(raw).toString("utf8")), PACKAGED_VALUATION_INPUT);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ impliedRevenueGrowthPct: 0, repricedEquityValue: 100, absoluteError: 0 }));
  });
  try {
    const result = await runRepresentativeValuation(service.port, token);
    assert.equal(result.verified, true);
    assert.equal(requestCount, 1);
  } finally {
    service.server.close();
  }
});

test("missing packaged valuation route fails closed without exposing server response body", async () => {
  const service = await listen(async (req, res) => {
    for await (const _chunk of req) { /* consume */ }
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("PRIVATE_PATH_OR_TRACEBACK_NEVER_RETURNED");
  });
  try {
    await assert.rejects(() => runRepresentativeValuation(service.port, "token"), error => {
      assert.match(error.message, /HTTP 503/);
      assert.doesNotMatch(error.message, /PRIVATE_PATH_OR_TRACEBACK/);
      return true;
    });
  } finally {
    service.server.close();
  }
});

test("packaged sidecar public qualification failures preserve HTTP status but never private diagnostics", () => {
  const secret = "PRIVATE_CUSTOMER_PATH__DO_NOT_LOG";
  const traced = publicSidecarProbeFailure(
    new Error(`Packaged valuation route failed with HTTP 502. ${secret}`), true);
  assert.match(traced.message, /valuation route failed with HTTP 502/);
  assert.match(traced.message, /diagnostics withheld/);
  assert.doesNotMatch(traced.message, /PRIVATE_CUSTOMER_PATH|Sidecar stderr:/);
  assert.equal(publicSidecarProbeFailure(new Error(`Traceback: ${secret}`), true).message,
    "Bundled Python sidecar qualification failed. Worker diagnostics withheld from public logs.");
  assert.equal(publicSidecarProbeFailure(new Error(`Bundled Python sidecar failed health probe: ${secret}`)).message,
    "Bundled Python sidecar health probe failed.");
  assert.equal(publicSidecarProbeFailure(new Error("Bundled Python sidecar is missing required package QuantLib.")).message,
    "Bundled Python sidecar is missing a required package.");
});

test("packaged representative calculation errors never reveal HTTP response body", async () => {
  const service = await listen(async (req, res) => {
    for await (const _chunk of req) { /* consume request */ }
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("PRIVATE_TRACEBACK_DO_NOT_LOG");
  });
  try {
    await assert.rejects(() => runRepresentativeCalculation(service.port, "test-token"), err => {
      assert.match(err.message, /HTTP 502/);
      assert.doesNotMatch(err.message, /PRIVATE_TRACEBACK_DO_NOT_LOG/);
      return true;
    });
  } finally {
    service.server.close();
  }
});
