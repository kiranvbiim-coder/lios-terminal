const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertPackagedPythonResourcesImmutable,
  listForbiddenPackagedPythonBytecode,
  locatePackagedServer,
  performWorkspaceRecoveryProbe,
} = require("./desktopSelfTest.cjs");
const { P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS, evaluateP14PackagedPerformance } = require("./p14PerformanceBudget.cjs");

test("desktop self-test keeps workspace data across reopen", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-self-test-workspace-"));
  try {
    const result = performWorkspaceRecoveryProbe(root);
    assert.ok(result.workspaceId.startsWith("ws_"));
    assert.equal(result.persistedFileCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("desktop self-test locates unpacked packaged backend", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-self-test-server-"));
  try {
    const appPath = path.join(root, "app.asar");
    fs.writeFileSync(appPath, "asar-placeholder");
    const server = path.join(root, "app.asar.unpacked", "dist", "index.cjs");
    fs.mkdirSync(path.dirname(server), { recursive: true });
    fs.writeFileSync(server, "server");
    assert.equal(locatePackagedServer(appPath), server);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("packaged Python source trees reject runtime bytecode mutations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-self-test-python-resources-"));
  try {
    const resources = path.join(root, "Resources");
    const pythonService = path.join(resources, "python-service");
    const scripts = path.join(resources, "script");
    fs.mkdirSync(pythonService, { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(pythonService, "main.py"), "print('ok')\n");
    assert.deepEqual(listForbiddenPackagedPythonBytecode(resources), []);
    assert.deepEqual(assertPackagedPythonResourcesImmutable(resources, "before startup"), []);

    const cache = path.join(pythonService, "__pycache__");
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, "main.cpython-312.pyc"), "bytecode");
    const forbidden = listForbiddenPackagedPythonBytecode(resources);
    assert.ok(forbidden.some((item) => item.includes("__pycache__")));
    assert.throws(
      () => assertPackagedPythonResourcesImmutable(resources, "after startup"),
      /Packaged Python resources were mutated after startup/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged Python bytecode guard also covers python-sidecar-dist, where the bundled interpreter actually runs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-self-test-python-sidecar-dist-"));
  try {
    const resources = path.join(root, "Resources");
    const sidecarDist = path.join(resources, "python-sidecar-dist", "lios-python-sidecar");
    fs.mkdirSync(sidecarDist, { recursive: true });
    fs.writeFileSync(path.join(sidecarDist, "lios-python-sidecar"), "binary-placeholder");
    assert.deepEqual(listForbiddenPackagedPythonBytecode(resources), []);

    const cache = path.join(sidecarDist, "__pycache__");
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, "bootstrap.cpython-312.pyc"), "bytecode");
    const forbidden = listForbiddenPackagedPythonBytecode(resources);
    assert.ok(forbidden.some((item) => item.startsWith("python-sidecar-dist") && item.includes("__pycache__")));
    assert.throws(
      () => assertPackagedPythonResourcesImmutable(resources, "after startup"),
      /Packaged Python resources were mutated after startup/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P14 packaged performance safety ceilings accept measured values and fail closed on regressions", () => {
  const passing = {
    electronAppReadyElapsedMs: 1_500,
    desktopSelfTestElapsedMs: 4_000,
    mainProcessMemoryAtCompletion: {
      rssBytes: 250 * 1024 * 1024,
      heapUsedBytes: 90 * 1024 * 1024,
    },
  };
  assert.deepEqual(evaluateP14PackagedPerformance(passing), { ok: true, errors: [] });

  const failing = {
    ...passing,
    electronAppReadyElapsedMs: P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS.electronAppReadyElapsedMsMax + 1,
    mainProcessMemoryAtCompletion: {
      ...passing.mainProcessMemoryAtCompletion,
      rssBytes: P14_PACKAGED_PERFORMANCE_SAFETY_CEILINGS.mainProcessRssBytesMax + 1,
    },
  };
  const evaluation = evaluateP14PackagedPerformance(failing);
  assert.equal(evaluation.ok, false);
  assert.ok(evaluation.errors.some((error) => /electronAppReadyElapsedMs exceeded/.test(error)));
  assert.ok(evaluation.errors.some((error) => /rssBytes exceeded/.test(error)));
});

test("P14 packaged performance safety ceilings reject missing or non-finite measurements", () => {
  assert.equal(evaluateP14PackagedPerformance(null).ok, false);
  const evaluation = evaluateP14PackagedPerformance({
    electronAppReadyElapsedMs: Number.NaN,
    desktopSelfTestElapsedMs: 100,
    mainProcessMemoryAtCompletion: { rssBytes: 100, heapUsedBytes: -1 },
  });
  assert.equal(evaluation.ok, false);
  assert.ok(evaluation.errors.length >= 2);
});
