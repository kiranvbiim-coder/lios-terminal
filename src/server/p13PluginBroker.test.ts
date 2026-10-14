import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import { P13NodeProcessBroker } from "./p13PluginBroker";

const context: RuntimeExecutionContext = {
  requestId: "22222222-2222-4222-8222-222222222222",
  userId: 1,
  organizationId: 1,
  projectId: 1,
  sessionId: null,
  conversationId: null,
  activeObjectId: null,
  dataClassification: "private",
  approvedActions: [],
};

test("P13 Node broker executes through supervised LEP process without inheriting secrets or raw network", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p13-broker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entrypoint = path.join(root, "plugin.mjs");
  fs.copyFileSync(path.resolve("server/fixtures/p13PluginFixture.mjs"), entrypoint);

  const manifest = liosPluginManifestV1Schema.parse({
    apiVersion: "1",
    id: "com.example.broker",
    name: "Broker Fixture",
    version: "1.0.0",
    publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "node_process", entrypoint: "plugin.mjs" },
    dependencies: [],
    permissions: ["network.http"],
    connectors: [],
    tools: [{
      id: "echo",
      componentId: "plugin.broker.echo",
      name: "Echo",
      capabilities: ["plugin.echo"],
    }],
    artifacts: [],
    agents: [],
    integrity: null,
    signer: null,
  });

  const previous = process.env.LIOS_P13_TEST_SECRET;
  process.env.LIOS_P13_TEST_SECRET = "parent-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.LIOS_P13_TEST_SECRET;
    else process.env.LIOS_P13_TEST_SECRET = previous;
  });

  const broker = new P13NodeProcessBroker({
    manifest,
    installDirectory: root,
    trustState: "trusted",
    grant: {
      projectRoot: null,
      userSelectedReadRoots: [],
      userSelectedWriteRoots: [],
      networkHosts: ["127.0.0.1"],
      allowProcessSpawn: false,
    },
    requestTimeoutMs: 5_000,
  });
  t.after(() => broker.dispose());

  const result = await broker.invoke({
    pluginId: manifest.id,
    componentId: "plugin.broker.echo",
    operation: "tool.invoke",
    payload: {
      value: 9,
      checkEnv: "LIOS_P13_TEST_SECRET",
      probeRawNetwork: true,
      probeBrokeredPrivateNetwork: true,
    },
    context,
  }) as {
    operation: string;
    echoed: { value: number };
    inheritedEnvironmentValue: string | null;
    rawNetworkDenied: boolean;
    brokeredNetworkError: string | null;
  };

  assert.equal(result.operation, "tool.invoke");
  assert.equal(result.echoed.value, 9);
  assert.equal(result.inheritedEnvironmentValue, null);
  assert.equal(result.rawNetworkDenied, true);
  assert.equal(result.brokeredNetworkError, "network_private_address_denied");
});


test("P13 supervised read-only plugin receives only owner-authorized bytes and cannot open Project paths directly", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p13-brokered-read-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installDirectory = path.join(root, "plugin");
  const projectRoot = path.join(root, "project");
  const outsideRoot = path.join(root, "outside");
  fs.mkdirSync(installDirectory);
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(outsideRoot);
  fs.copyFileSync(path.resolve("server/fixtures/p13PluginFixture.mjs"), path.join(installDirectory, "plugin.mjs"));
  fs.writeFileSync(path.join(projectRoot, "input.txt"), "only Project A can read");
  fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "outside-secret");
  fs.symlinkSync(path.join(outsideRoot, "secret.txt"), path.join(projectRoot, "escape.txt"));

  const manifest = liosPluginManifestV1Schema.parse({
    apiVersion: "1", id: "com.example.readonly", name: "Read-only Plugin", version: "1.0.0", publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "node_process", entrypoint: "plugin.mjs" },
    dependencies: [], permissions: ["filesystem.project.read"],
    connectors: [], tools: [{ id: "echo", componentId: "plugin.readonly.echo", name: "Read", capabilities: ["plugin.readonly.echo"] }],
    artifacts: [], agents: [], integrity: null, signer: null,
  });
  let allowedProject = 1;
  const broker = new P13NodeProcessBroker({
    manifest, installDirectory, trustState: "trusted",
    grant: { projectRoot, userSelectedReadRoots: [], userSelectedWriteRoots: [], networkHosts: [], allowProcessSpawn: false },
    authorizeFileRead: ({ context: caller, root: chosen, scope }) =>
      caller.userId === 1 && caller.organizationId === 1
      && caller.projectId === allowedProject && chosen === projectRoot && scope === "project",
    requestTimeoutMs: 5_000,
  });
  t.after(() => broker.dispose());
  const invoke = (projectId: number, relativePath: string) => broker.invoke({
    pluginId: manifest.id, componentId: "plugin.readonly.echo", operation: "tool.invoke",
    payload: { probeRawFileRead: true, rawFilePath: path.join(projectRoot, "input.txt"),
      probeBrokeredFileRead: true, relativePath },
    context: { ...context, requestId: crypto.randomUUID(), projectId },
  }) as Promise<{ rawFileReadDenied: boolean; fileBrokerEnvironment: string;
    brokeredFileText: string | null; brokeredFileError: string | null }>;

  const allowed = await invoke(1, "input.txt");
  assert.equal(allowed.rawFileReadDenied, true, "Untrusted child must not bypass the host broker");
  assert.equal(allowed.fileBrokerEnvironment, "read-only");
  assert.equal(allowed.brokeredFileText, "only Project A can read");
  assert.equal(allowed.brokeredFileError, null);
  const crossing = await invoke(2, "input.txt");
  assert.equal(crossing.brokeredFileText, null);
  assert.equal(crossing.brokeredFileError, "filesystem_execution_scope_invalid");
  const symlink = await invoke(1, "escape.txt");
  assert.equal(symlink.brokeredFileText, null);
  assert.equal(symlink.brokeredFileError, "filesystem_read_denied");
  allowedProject = 2;
  const revoked = await invoke(1, "input.txt");
  assert.equal(revoked.brokeredFileError, "filesystem_execution_scope_invalid");
});
