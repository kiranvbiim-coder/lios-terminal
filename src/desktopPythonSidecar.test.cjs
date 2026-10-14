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
} = require("./desktopPythonSidecar.cjs");

test("bundled sidecar path is platform-specific and fail-closed when absent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-sidecar-path-"));
  try {
    assert.equal(bundledPythonSidecarPath(root, "darwin"), null);
    const dir = path.join(root, "python-sidecar-dist", "lios-python-sidecar");
    fs.mkdirSync(dir, { recursive: true });
    const executable = path.join(dir, "lios-python-sidecar");
    fs.writeFileSync(executable, "stub");
    assert.equal(bundledPythonSidecarPath(root, "darwin"), executable);
    assert.equal(bundledPythonSidecarPath(root, "win32"), null);
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
