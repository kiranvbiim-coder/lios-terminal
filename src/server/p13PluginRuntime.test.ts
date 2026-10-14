import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import { computePluginPackageDigest, signPluginManifest } from "./p13PluginTrust";
import { createP13PluginRuntimeHost } from "./p13PluginRuntime";

test("P13 runtime host installs, exposes, invokes and removes through one canonical registry and supervised broker", async (t) => {
  const registry = new RuntimeRegistry();
  const host = createP13PluginRuntimeHost({ registry, liosVersion: "1.0.0" });
  const pair = crypto.generateKeyPairSync("ed25519");
  host.trustStore.trustKey("publisher.main", pair.publicKey);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p13-runtime-"));
  fs.copyFileSync(path.resolve("server/fixtures/p13PluginFixture.mjs"), path.join(root, "index.mjs"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const base = liosPluginManifestV1Schema.parse({
    apiVersion: "1",
    id: "com.example.runtime",
    name: "Runtime Host Test",
    version: "1.0.0",
    publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "node_process", entrypoint: "index.mjs" },
    dependencies: [],
    permissions: [],
    connectors: [],
    tools: [{
      id: "echo",
      componentId: "plugin.runtime.echo",
      name: "Runtime Echo",
      capabilities: ["plugin.runtime.echo"],
    }],
    artifacts: [],
    agents: [],
    integrity: null,
    signer: null,
  });
  const observedPackageDigest = computePluginPackageDigest(Buffer.from("com.example.runtime@1.0.0"));
  const manifest = signPluginManifest(base, "publisher.main", pair.privateKey, observedPackageDigest);

  host.installNodePlugin({
    manifest,
    observedPackageDigest,
    installDirectory: root,
    grant: {
      projectRoot: null,
      userSelectedReadRoots: [],
      userSelectedWriteRoots: [],
      networkHosts: [],
      allowProcessSpawn: false,
    },
    requestTimeoutMs: 5_000,
  });
  assert.ok(host.registry.has("plugin.runtime.echo"));

  const mcp = host.createMcpServer({
    exposure: {
      version: "1",
      exposedTools: ["plugin.runtime.echo"],
      exposedResources: [],
      filesystemExposure: false,
      secretExposure: false,
      internalStateExposure: false,
      tenantScoped: true,
    },
    organizationId: 3,
    allowedProjectIds: [41],
    rightsApprovedToolIds: ["plugin.runtime.echo"],
    requireExplicitApproval: true,
  });

  const listed = await mcp.handle(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { userId: 7, organizationId: 3, projectId: 41 },
  );
  assert.deepEqual(
    (listed.result as { tools: Array<{ name: string }> }).tools.map((item) => item.name),
    ["plugin.runtime.echo"],
  );

  const called = await mcp.handle(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "plugin.runtime.echo", arguments: { value: 9 } },
    },
    { userId: 7, organizationId: 3, projectId: 41 },
  );
  assert.equal(called.error?.code, -32004);

  assert.equal(host.plugins.remove("com.example.runtime"), true);
  assert.equal(host.registry.has("plugin.runtime.echo"), false);

  const afterRemoval = await mcp.handle(
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    { userId: 7, organizationId: 3, projectId: 41 },
  );
  assert.deepEqual((afterRemoval.result as { tools: Array<{ name: string }> }).tools, []);
});

test("P13 runtime host refuses executable activation before trusted package verification", (t) => {
  const host = createP13PluginRuntimeHost({ registry: new RuntimeRegistry(), liosVersion: "1.0.0" });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p13-untrusted-"));
  fs.writeFileSync(path.join(root, "index.mjs"), "process.stdin.resume();\n");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const manifest = liosPluginManifestV1Schema.parse({
    apiVersion: "1",
    id: "com.example.untrusted",
    name: "Untrusted",
    version: "1.0.0",
    publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "node_process", entrypoint: "index.mjs" },
    dependencies: [],
    permissions: [],
    connectors: [],
    tools: [{ id: "echo", componentId: "plugin.untrusted.echo", name: "Echo", capabilities: ["plugin.echo"] }],
    artifacts: [],
    agents: [],
    integrity: null,
    signer: null,
  });

  assert.throws(
    () => host.installNodePlugin({
      manifest,
      installDirectory: root,
      grant: {
        projectRoot: null,
        userSelectedReadRoots: [],
        userSelectedWriteRoots: [],
        networkHosts: [],
        allowProcessSpawn: false,
      },
    }),
    /trust verification failed/,
  );
});
