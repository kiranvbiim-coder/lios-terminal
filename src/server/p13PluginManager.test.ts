import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import { liosPluginManifestV1Schema, type LiosPluginManifestV1 } from "@shared/pluginSdk";
import type { RuntimeComponentDescriptor, RuntimeExecutionContext, ToolAdapter } from "@shared/runtimeContracts";
import type { ArtifactRendererAdapter } from "@shared/runtimeAdapters";
import { P13NodeProcessBroker, type P13PluginInvocationBroker, type P13PluginInvocationRequest } from "./p13PluginBroker";
import { P13PluginManager, negotiatePluginCompatibility } from "./p13PluginManager";
import { computePluginPackageDigest, PluginTrustStore, signPluginManifest } from "./p13PluginTrust";

class FakeBroker implements P13PluginInvocationBroker {
  async invoke(_request: P13PluginInvocationRequest): Promise<unknown> { return null; }
  dispose(): void {}
}

const context: RuntimeExecutionContext = {
  requestId: "11111111-1111-4111-8111-111111111111",
  userId: 1,
  organizationId: 1,
  projectId: 1,
  sessionId: null,
  conversationId: null,
  activeObjectId: null,
  dataClassification: "private",
  approvedActions: [],
};

function externalDescriptor(id: string): RuntimeComponentDescriptor {
  return {
    contractVersion: "1",
    id,
    kind: "tool",
    name: id,
    version: "1.0.0",
    lifecycle: "external",
    executionScopes: ["external_process"],
    capabilities: ["plugin.echo"],
    permissions: [],
    runtimePackId: null,
    replaceable: true,
    source: { origin: "external", importedPaths: [], modified: false },
  };
}

function executableManifest(input: {
  id?: string;
  version?: string;
  dependencies?: Array<{ pluginId: string; versionRange: string }>;
  allFamilies?: boolean;
} = {}): LiosPluginManifestV1 {
  const id = input.id ?? "com.example.p13";
  const all = input.allFamilies ?? false;
  return liosPluginManifestV1Schema.parse({
    apiVersion: "1",
    id,
    name: id,
    version: input.version ?? "1.0.0",
    publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: "1.9.9" },
    runtime: { kind: "node_process", entrypoint: "index.mjs" },
    dependencies: input.dependencies ?? [],
    permissions: [],
    connectors: all ? [{ id: "connector", componentId: id + ".connector", name: "Connector", capabilities: ["plugin.connector"] }] : [],
    tools: [{ id: "echo", componentId: id + ".tool", name: "Echo", capabilities: ["plugin.echo"] }],
    artifacts: all ? [{
      id: "artifact",
      componentId: id + ".artifact",
      name: "Artifact",
      capabilities: ["plugin.artifact"],
      artifactKinds: ["chart"],
    }] : [],
    agents: all ? [{ id: "agent", componentId: id + ".agent", name: "Agent", capabilities: ["plugin.agent"] }] : [],
    integrity: null,
    signer: null,
  });
}

function declarativeArtifactManifest(
  id: string,
  version = "1.0.0",
  dependencies: Array<{ pluginId: string; versionRange: string }> = [],
): LiosPluginManifestV1 {
  return liosPluginManifestV1Schema.parse({
    apiVersion: "1",
    id,
    name: id,
    version,
    publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "declarative", entrypoint: null },
    dependencies,
    permissions: [],
    connectors: [],
    tools: [],
    artifacts: [{
      id: "artifact",
      componentId: id + ".artifact",
      name: "Artifact",
      capabilities: ["plugin.artifact"],
      artifactKinds: ["chart"],
    }],
    agents: [],
    integrity: null,
    signer: null,
  });
}

function signer() {
  const pair = crypto.generateKeyPairSync("ed25519");
  const trust = new PluginTrustStore();
  trust.trustKey("publisher.main", pair.publicKey);
  return { trust, privateKey: pair.privateKey };
}

function signed(manifest: LiosPluginManifestV1, privateKey: crypto.KeyObject) {
  const observedPackageDigest = computePluginPackageDigest(Buffer.from(manifest.id + "@" + manifest.version));
  return {
    manifest: signPluginManifest(manifest, "publisher.main", privateKey, observedPackageDigest),
    observedPackageDigest,
  };
}

function governedBroker(t: TestContext, manifest: LiosPluginManifestV1): P13NodeProcessBroker {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p13-manager-"));
  const entrypoint = path.join(root, "index.mjs");
  fs.copyFileSync(path.resolve("server/fixtures/p13PluginFixture.mjs"), entrypoint);
  const broker = new P13NodeProcessBroker({
    manifest,
    installDirectory: root,
    trustState: "trusted",
    grant: {
      projectRoot: null,
      userSelectedReadRoots: [],
      userSelectedWriteRoots: [],
      networkHosts: [],
      allowProcessSpawn: false,
    },
    requestTimeoutMs: 5_000,
  });
  t.after(async () => {
    broker.dispose();
    // Windows reports EBUSY while the just-stopped child is still releasing its working directory.
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  });
  return broker;
}

test("P13 manager registers LiOS-owned proxy adapters and supervised broker executes tool calls", async (t) => {
  const { trust, privateKey } = signer();
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, trust, "1.0.0");
  const pkg = signed(executableManifest(), privateKey);
  const broker = governedBroker(t, pkg.manifest);

  const installed = manager.install({ ...pkg, broker });
  assert.equal(installed.id, "com.example.p13");
  const tool = registry.require("com.example.p13.tool") as ToolAdapter;
  const output = await tool.invoke({ value: 7 }, context) as { operation: string; echoed: { value: number } };
  assert.equal(output.operation, "tool.invoke");
  assert.deepEqual(output.echoed, { value: 7 });

  assert.equal(manager.remove("com.example.p13"), true);
  assert.equal(broker.isDisposed(), true);
  assert.equal(registry.has("com.example.p13.tool"), false);
  await assert.rejects(() => broker.invoke({
    pluginId: "com.example.p13",
    componentId: "com.example.p13.tool",
    operation: "tool.invoke",
    payload: {},
    context,
  }), /disposed/);
});

test("P13 gate installs and removes connector, tool, artifact and agent proxies together", (t) => {
  const { trust, privateKey } = signer();
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, trust, "1.0.0");
  const pkg = signed(executableManifest({ id: "com.example.all", allFamilies: true }), privateKey);
  const broker = governedBroker(t, pkg.manifest);

  manager.install({ ...pkg, broker });
  for (const id of ["com.example.all.connector", "com.example.all.tool", "com.example.all.artifact", "com.example.all.agent"]) {
    assert.ok(registry.has(id));
  }
  const artifact = registry.require("com.example.all.artifact") as ArtifactRendererAdapter;
  assert.equal(artifact.supports({ artifactType: "chart" } as never), true);
  assert.equal(artifact.supports({ artifactType: "table" } as never), false);

  manager.remove("com.example.all");
  assert.equal(broker.isDisposed(), true);
  for (const id of ["com.example.all.connector", "com.example.all.tool", "com.example.all.artifact", "com.example.all.agent"]) {
    assert.equal(registry.has(id), false);
  }
});

test("P13 executable plugins require trusted signature, observed digest and exact governed broker", (t) => {
  const manifest = executableManifest();
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, new PluginTrustStore(), "1.0.0");
  assert.throws(() => manager.install({ manifest, broker: new FakeBroker(manifest) }), /trusted publisher/);

  const { trust, privateKey } = signer();
  const trustedManager = new P13PluginManager(new RuntimeRegistry(), trust, "1.0.0");
  const pkg = signed(manifest, privateKey);
  assert.throws(() => trustedManager.install(pkg), /isolated invocation broker/);
  assert.throws(
    () => trustedManager.install({ ...pkg, broker: new FakeBroker(manifest) }),
    /LiOS-governed broker/,
  );

  const wrongManifest = signed(executableManifest({ id: "com.example.other" }), privateKey);
  const wrongBroker = governedBroker(t, wrongManifest.manifest);
  assert.throws(
    () => trustedManager.install({ ...pkg, broker: wrongBroker }),
    /exact manifest/,
  );
});

test("P13 declarative artifact contribution is useful without executing plugin code", () => {
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, new PluginTrustStore(), "1.0.0");
  manager.install({ manifest: declarativeArtifactManifest("com.example.artifact") });
  const artifact = registry.require("com.example.artifact.artifact") as ArtifactRendererAdapter;
  assert.equal(artifact.supports({ artifactType: "chart" } as never), true);
  assert.equal(artifact.supports({ artifactType: "table" } as never), false);
});

test("P13 compatibility negotiation fails closed on missing dependencies and version ranges", () => {
  const value = declarativeArtifactManifest("com.example.consumer");
  value.dependencies = [{ pluginId: "com.example.base", versionRange: "^2.0.0" }];
  const missing = negotiatePluginCompatibility(value, "1.0.0", new Map());
  assert.equal(missing.compatible, false);
  assert.ok(missing.reasons.includes("missing_dependency:com.example.base"));
  const wrong = negotiatePluginCompatibility(value, "1.0.0", new Map([["com.example.base", "1.9.0"]]));
  assert.equal(wrong.compatible, false);
  assert.ok(wrong.reasons.includes("dependency_version_mismatch:com.example.base"));
});

test("P13 registration collision is transactional and disposes the rejected governed broker", (t) => {
  const { trust, privateKey } = signer();
  const registry = new RuntimeRegistry();
  registry.register({ descriptor: externalDescriptor("com.example.p13.tool") });
  const manager = new P13PluginManager(registry, trust, "1.0.0");
  const pkg = signed(executableManifest(), privateKey);
  const broker = governedBroker(t, pkg.manifest);

  assert.throws(() => manager.install({ ...pkg, broker }), /without partial activation/);
  assert.equal(registry.has("plugin:com.example.p13"), false);
  assert.equal(broker.isDisposed(), true);
});

test("P13 live publisher-key revocation blocks already captured executable adapters", async (t) => {
  const { trust, privateKey } = signer();
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, trust, "1.0.0");
  const pkg = signed(executableManifest({ id: "com.example.key-revocation" }), privateKey);
  const broker = governedBroker(t, pkg.manifest);
  manager.install({ ...pkg, broker });
  const tool = registry.require("com.example.key-revocation.tool") as ToolAdapter;

  await tool.invoke({ value: 1 }, context);
  trust.revokeKey("publisher.main");
  await assert.rejects(
    () => tool.invoke({ value: 2 }, context),
    /package trust is revoked/i,
  );
  assert.equal(registry.has("com.example.key-revocation.tool"), true,
    "revocation must deny a cached adapter even before removal from registry");
  assert.equal(manager.remove("com.example.key-revocation"), true);
  await assert.rejects(() => tool.invoke({ value: 3 }, context), /no longer active/i);
});

test("P13 live package-digest revocation denies execution without a new install", async (t) => {
  const { trust, privateKey } = signer();
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, trust, "1.0.0");
  const pkg = signed(executableManifest({ id: "com.example.digest-revocation" }), privateKey);
  const broker = governedBroker(t, pkg.manifest);
  manager.install({ ...pkg, broker });
  const tool = registry.require("com.example.digest-revocation.tool") as ToolAdapter;

  await tool.invoke({ value: 1 }, context);
  trust.revokeDigest(pkg.observedPackageDigest);
  await assert.rejects(() => tool.invoke({ value: 2 }, context), /package trust is revoked/i);
});

test("P13 update swaps exact governed brokers transactionally and retires the previous runtime", async (t) => {
  const { trust, privateKey } = signer();
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, trust, "1.0.0");

  const firstPkg = signed(executableManifest({ version: "1.0.0" }), privateKey);
  const first = governedBroker(t, firstPkg.manifest);
  manager.install({ ...firstPkg, broker: first });

  const secondPkg = signed(executableManifest({ version: "1.1.0" }), privateKey);
  const second = governedBroker(t, secondPkg.manifest);
  const updated = manager.update({ ...secondPkg, broker: second });
  assert.equal(updated.version, "1.1.0");
  assert.equal(first.isDisposed(), true);

  const tool = registry.require("com.example.p13.tool") as ToolAdapter;
  const result = await tool.invoke({ value: 2 }, context) as { echoed: { value: number } };
  assert.equal(result.echoed.value, 2);
});

test("P13 update refuses to break dependents or introduce dependency cycles", () => {
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, new PluginTrustStore(), "1.0.0");

  manager.install({ manifest: declarativeArtifactManifest("com.example.base") });
  manager.install({
    manifest: declarativeArtifactManifest(
      "com.example.dependent",
      "1.0.0",
      [{ pluginId: "com.example.base", versionRange: "^1.0.0" }],
    ),
  });

  assert.throws(
    () => manager.update({ manifest: declarativeArtifactManifest("com.example.base", "2.0.0") }),
    /would break installed dependent/,
  );

  assert.throws(
    () => manager.update({
      manifest: declarativeArtifactManifest(
        "com.example.base",
        "1.1.0",
        [{ pluginId: "com.example.dependent", versionRange: "^1.0.0" }],
      ),
    }),
    /dependency cycle detected/,
  );
});
