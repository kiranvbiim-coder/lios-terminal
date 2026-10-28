import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import {
  SIDECAR_TOKEN_HEADER,
  buildPythonSidecarEnvironment,
  buildSidecarRequestHeaders,
  createSidecarToken,
  isOwnedSidecar,
  reserveLoopbackPort,
  resolvePackagedPythonSidecar,
} from "./pythonService";

test("Python sidecar environment inherits only safe runtime values and never parent secrets", (t) => {
  const previousSecret = process.env.LIOS_TEST_API_KEY;
  const previousPath = process.env.PATH;
  process.env.LIOS_TEST_API_KEY = "must-not-leak";
  process.env.PATH = previousPath ?? "/usr/bin";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.LIOS_TEST_API_KEY;
    else process.env.LIOS_TEST_API_KEY = previousSecret;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });

  const env = buildPythonSidecarEnvironment({
    PYTHON_SERVICE_PORT: "49152",
    LIOS_SIDECAR_TOKEN: "per-launch-token",
    LIOS_PYTHON_LOG_LEVEL: "warning",
    PYTHONDONTWRITEBYTECODE: "0",
  });
  assert.equal(env.LIOS_TEST_API_KEY, undefined);
  assert.equal(env.PATH, process.env.PATH);
  assert.equal(env.PYTHON_SERVICE_PORT, "49152");
  assert.equal(env.LIOS_SIDECAR_TOKEN, "per-launch-token");
  assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(env.PYTHONNOUSERSITE, "1");
  assert.throws(
    () => buildPythonSidecarEnvironment({ SOME_ACCESS_TOKEN: "secret" }),
    /secrets must not be passed/,
  );
});

test("per-launch tokens are random base64url and unique", () => {
  const first = createSidecarToken();
  const second = createSidecarToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("the local token header is sent to the local sidecar and never to a remote service", () => {
  assert.deepEqual(buildSidecarRequestHeaders({ remote: false }, { localToken: "t", remoteToken: "r" }), { [SIDECAR_TOKEN_HEADER]: "t" });
  const remote = buildSidecarRequestHeaders({ remote: true }, { localToken: "local-secret", remoteToken: "r" });
  assert.deepEqual(remote, { Authorization: "Bearer r" });
  assert.deepEqual(buildSidecarRequestHeaders({ remote: true }, { localToken: "local-secret" }), {});
});

test("reserveLoopbackPort returns a free ephemeral loopback port", async () => {
  const port = await reserveLoopbackPort();
  assert.ok(Number.isInteger(port) && port > 0 && port !== 5077);
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  server.close();
});

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address: AddressInfo = server.address() as AddressInfo; // listening on a TCP port, never a pipe
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test("a sidecar that does not enforce our token is never trusted", async () => {
  const token = "per-launch-token";
  const enforcing = await listen((req, res) => {
    const ok = req.headers[SIDECAR_TOKEN_HEADER.toLowerCase()] === token;
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { ok: true } : { detail: "Unauthorized" }));
  });
  const foreign = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, python: "3.12", packages: {} }));
  });
  try {
    assert.equal(await isOwnedSidecar(enforcing.url, token), true);
    assert.equal(await isOwnedSidecar(enforcing.url, "other-token"), false);
    assert.equal(await isOwnedSidecar(foreign.url, token), false);
    assert.equal(await isOwnedSidecar("http://127.0.0.1:1", token), false);
  } finally {
    enforcing.server.close();
    foreign.server.close();
  }
});

test("canonical packaged Python resolver rejects symlinked distribution and bundle parents", () => {
  if (process.platform === "win32") return; // directory symlink permission requires Windows Developer Mode
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-symlinked-sidecar-"));
  const dist = path.join(root, "python-sidecar-dist");
  const fakeDir = path.join(root, "user-local-python");
  try {
    fs.mkdirSync(fakeDir);
    fs.writeFileSync(path.join(fakeDir, "lios-python-sidecar"), "synthetic external binary", { mode: 0o700 });
    fs.symlinkSync(fakeDir, dist, "dir");
    assert.throws(() => resolvePackagedPythonSidecar(root, "darwin"),
      /host-interpreter fallback refused/,
      "a real-looking executable under a symlinked distribution cannot pass as bundled");
    fs.unlinkSync(dist);
    fs.mkdirSync(dist);
    fs.symlinkSync(fakeDir, path.join(dist, "lios-python-sidecar"), "dir");
    assert.throws(() => resolvePackagedPythonSidecar(root, "darwin"),
      /host-interpreter fallback refused/,
      "a symlinked nested parent cannot redirect to a user-local executable");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged desktop never falls back to an unverified host Python interpreter", () => {
  assert.equal(resolvePackagedPythonSidecar(undefined), null, "source checkout still uses its configured interpreter");
  assert.throws(() => resolvePackagedPythonSidecar("./relative-resources", "darwin"),
    /host-interpreter fallback refused/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-frozen-sidecar-"));
  const binDir = path.join(root, "python-sidecar-dist", "lios-python-sidecar");
  try {
    fs.mkdirSync(binDir, { recursive: true });
    assert.throws(() => resolvePackagedPythonSidecar(root, "darwin"),
      /host-interpreter fallback refused/, "packaged macOS must not use the system python3");
    assert.throws(() => resolvePackagedPythonSidecar(root, "win32"),
      /host-interpreter fallback refused/, "packaged Windows must not use the system python");

    // POSIX execute permission bits have no equivalent in Node's Win32 stat.
    // Exercise those assertions on actual POSIX runners, not simulated chmod.
    if (process.platform !== "win32") {
      const macBinary = path.join(binDir, "lios-python-sidecar");
      fs.writeFileSync(macBinary, "synthetic frozen executable", { mode: 0o700 });
      fs.chmodSync(macBinary, 0o700);
      assert.equal(resolvePackagedPythonSidecar(root, "darwin"), macBinary);
      assert.equal(resolvePackagedPythonSidecar(root, "linux"), macBinary);
      fs.chmodSync(macBinary, 0o600);
      assert.throws(() => resolvePackagedPythonSidecar(root, "darwin"),
        /host-interpreter fallback refused/, "non-executable packaged binary must be refused");

      // A symlink cannot turn a mutable user-local python into an accepted package.
      fs.unlinkSync(macBinary);
      fs.symlinkSync(path.join(root, "outside-not-bundled"), macBinary);
      assert.throws(() => resolvePackagedPythonSidecar(root, "darwin"),
        /host-interpreter fallback refused/);
    }

    const winBinary = path.join(binDir, "lios-python-sidecar.exe");
    fs.writeFileSync(winBinary, "synthetic frozen Windows executable");
    assert.equal(resolvePackagedPythonSidecar(root, "win32"), winBinary);
    fs.writeFileSync(winBinary, "");
    assert.throws(() => resolvePackagedPythonSidecar(root, "win32"),
      /host-interpreter fallback refused/, "empty packaged executable must be refused");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
