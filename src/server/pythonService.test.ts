import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  SIDECAR_TOKEN_HEADER,
  buildPythonSidecarEnvironment,
  buildSidecarRequestHeaders,
  createSidecarToken,
  isOwnedSidecar,
  reserveLoopbackPort,
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
