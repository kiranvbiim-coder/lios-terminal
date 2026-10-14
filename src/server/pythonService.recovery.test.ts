import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { getPythonServiceEnvironment, stopPythonService } from "./pythonService";

test("failed Python readiness and metadata are retryable after explicit configuration correction", async (t) => {
  const keys = ["PYTHON_REMOTE_SERVICE_URL", "PYTHON_REMOTE_SERVICE_TOKEN", "PYTHON_LOCAL_SERVICE_DISABLED", "LIOS_EXECUTION_ISOLATION"] as const;
  const previous = keys.map(key => [key, process.env[key]] as const);
  let healthCalls = 0;
  let metadataCalls = 0;
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer recovery") { res.writeHead(401).end(); return; }
    if (req.url?.replace(/^\/+/, "/") === "/health") { healthCalls++; res.end("ok"); return; }
    metadataCalls++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ python: "3.12", packages: { numpy: "2.2.6" } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    stopPythonService();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  stopPythonService();
  delete process.env.PYTHON_REMOTE_SERVICE_URL;
  delete process.env.PYTHON_REMOTE_SERVICE_TOKEN;
  process.env.LIOS_EXECUTION_ISOLATION = "legacy-host";
  process.env.PYTHON_LOCAL_SERVICE_DISABLED = "true";
  await assert.rejects(getPythonServiceEnvironment(), /not available/);
  process.env.PYTHON_REMOTE_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.PYTHON_REMOTE_SERVICE_TOKEN = "recovery";
  const results = await Promise.all([getPythonServiceEnvironment(), getPythonServiceEnvironment()]);
  assert.deepEqual(results, [
    { python: "3.12", packages: { numpy: "2.2.6" } },
    { python: "3.12", packages: { numpy: "2.2.6" } },
  ]);
  assert.equal(healthCalls, 1, "concurrent explicit retries share one readiness check");
  assert.equal(metadataCalls, 1, "successful metadata remains single-flight cached");
});
