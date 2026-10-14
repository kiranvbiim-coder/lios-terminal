import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import {
  createP13PluginAuxiliaryHandler,
  requestPinned,
} from "./p13PluginNetworkBroker";

const context: RuntimeExecutionContext = {
  requestId: "44444444-4444-4444-8444-444444444444",
  userId: 1,
  organizationId: 1,
  projectId: 1,
  sessionId: null,
  conversationId: null,
  activeObjectId: null,
  dataClassification: "private",
  approvedActions: [],
};

test("P13 pinned HTTP transport uses the supplied address and enforces response bounds", async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/large") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.alloc(4_096, 7));
      return;
    }
    res.writeHead(200, { "content-type": "text/plain", "x-test": "ok" });
    res.end("pinned-ok");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");

  const response = await requestPinned({
    url: new URL("http://example.test:" + address.port + "/ok"),
    address: "127.0.0.1",
    family: 4,
    method: "GET",
    headers: { accept: "text/plain" },
    body: null,
    timeoutMs: 2_000,
    maxResponseBytes: 1_024,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.toString("utf8"), "pinned-ok");
  assert.equal(response.headers["x-test"], "ok");

  await assert.rejects(
    requestPinned({
      url: new URL("http://example.test:" + address.port + "/large"),
      address: "127.0.0.1",
      family: 4,
      method: "GET",
      headers: {},
      body: null,
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
    }),
    /network_response_too_large/,
  );
});

test("P13 auxiliary broker ties network access to active execution, strips plugin secrets and denies private destinations", async () => {
  const manifest = liosPluginManifestV1Schema.parse({
    apiVersion: "1",
    id: "com.example.network",
    name: "Network Broker Test",
    version: "1.0.0",
    publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "node_process", entrypoint: "plugin.mjs" },
    dependencies: [],
    permissions: ["network.http", "connector.credentials"],
    connectors: [{
      id: "connector",
      componentId: "plugin.network.connector",
      name: "Connector",
      capabilities: ["plugin.network"],
    }],
    tools: [],
    artifacts: [],
    agents: [],
    integrity: null,
    signer: null,
  });

  let credentialCalls = 0;
  const handler = createP13PluginAuxiliaryHandler({
    manifest,
    grant: {
      projectRoot: null,
      userSelectedReadRoots: [],
      userSelectedWriteRoots: [],
      networkHosts: ["127.0.0.1"],
      allowProcessSpawn: false,
    },
    lookupExecution: (id) => id === "55555555-5555-4555-8555-555555555555"
      ? { componentId: "plugin.network.connector", context }
      : null,
    credentialResolver: async ({ credentialHandle, componentId }) => {
      credentialCalls += 1;
      assert.equal(credentialHandle, "secret-handle-1");
      assert.equal(componentId, "plugin.network.connector");
      return { Authorization: "Bearer host-side-secret" };
    },
  });

  const base = {
    protocol: "lios-plugin-broker/1",
    kind: "network.request",
    requestId: "66666666-6666-4666-8666-666666666666",
    executionRequestId: "55555555-5555-4555-8555-555555555555",
    componentId: "plugin.network.connector",
    url: "http://127.0.0.1/",
    method: "GET",
    headers: {},
    bodyBase64: null,
    credentialHandle: "secret-handle-1",
    timeoutMs: 1_000,
    maxResponseBytes: 1_024,
  } as const;

  const privateDenied = await handler(base) as { kind: string; code: string };
  assert.equal(privateDenied.kind, "network.error");
  assert.equal(privateDenied.code, "network_private_address_denied");
  assert.equal(credentialCalls, 0);

  const sensitiveHeader = await handler({
    ...base,
    requestId: "77777777-7777-4777-8777-777777777777",
    credentialHandle: null,
    headers: { Authorization: "Bearer plugin-secret" },
  }) as { kind: string; code: string };
  assert.equal(sensitiveHeader.code, "network_sensitive_header_denied");

  const protectedHeader = await handler({
    ...base,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    credentialHandle: null,
    headers: { Host: "attacker.invalid" },
  }) as { kind: string; code: string };
  assert.equal(protectedHeader.code, "network_protected_header_denied");

  const wrongExecution = await handler({
    ...base,
    requestId: "88888888-8888-4888-8888-888888888888",
    executionRequestId: "99999999-9999-4999-8999-999999999999",
    credentialHandle: null,
  }) as { kind: string; code: string };
  assert.equal(wrongExecution.code, "network_execution_scope_invalid");
});


test("P13 auxiliary broker injects opaque credentials only after a public destination is validated", async () => {
  const manifest = liosPluginManifestV1Schema.parse({
    apiVersion: "1",
    id: "com.example.credential",
    name: "Credential Broker Test",
    version: "1.0.0",
    publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "node_process", entrypoint: "plugin.mjs" },
    dependencies: [],
    permissions: ["network.http", "connector.credentials"],
    connectors: [{
      id: "connector",
      componentId: "plugin.credential.connector",
      name: "Connector",
      capabilities: ["plugin.credential"],
    }],
    tools: [],
    artifacts: [],
    agents: [],
    integrity: null,
    signer: null,
  });

  let resolverCalls = 0;
  let observedAuthorization: string | undefined;
  const handler = createP13PluginAuxiliaryHandler({
    manifest,
    grant: {
      projectRoot: null,
      userSelectedReadRoots: [],
      userSelectedWriteRoots: [],
      networkHosts: ["api.example.com"],
      allowProcessSpawn: false,
    },
    lookupExecution: (id) => id === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      ? { componentId: "plugin.credential.connector", context }
      : null,
    resolveAddress: async () => ({ address: "93.184.216.34", family: 4 }),
    credentialResolver: async ({ credentialHandle, url }) => {
      resolverCalls += 1;
      assert.equal(credentialHandle, "oauth-handle");
      assert.equal(url.hostname, "api.example.com");
      return { Authorization: "Bearer host-only-secret" };
    },
    requester: async (input) => {
      observedAuthorization = input.headers.Authorization;
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"ok":true}'),
      };
    },
  });

  const response = await handler({
    protocol: "lios-plugin-broker/1",
    kind: "network.request",
    requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    executionRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    componentId: "plugin.credential.connector",
    url: "https://api.example.com/v1/data",
    method: "GET",
    headers: { Accept: "application/json" },
    bodyBase64: null,
    credentialHandle: "oauth-handle",
    timeoutMs: 1_000,
    maxResponseBytes: 1_024,
  }) as { kind: string; status: number; bodyBase64: string };

  assert.equal(response.kind, "network.response");
  assert.equal(response.status, 200);
  assert.equal(resolverCalls, 1);
  assert.equal(observedAuthorization, "Bearer host-only-secret");
  assert.deepEqual(JSON.parse(Buffer.from(response.bodyBase64, "base64").toString("utf8")), { ok: true });
});
