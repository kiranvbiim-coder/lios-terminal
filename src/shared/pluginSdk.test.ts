import test from "node:test";
import assert from "node:assert/strict";
import {
  definePlugin,
  liosPluginManifestV1Schema,
  type PluginSdkPackageInput,
} from "./pluginSdk";
import type { RuntimeComponentDescriptor, ToolAdapter } from "./runtimeContracts";

function descriptor(id: string, kind: RuntimeComponentDescriptor["kind"]): RuntimeComponentDescriptor {
  return {
    contractVersion: "1",
    id,
    kind,
    name: id,
    version: "1.0.0",
    lifecycle: "external",
    executionScopes: ["external_process"],
    capabilities: ["plugin.test.echo"],
    permissions: [],
    runtimePackId: null,
    replaceable: true,
    source: {
      origin: "external",
      importedPaths: [],
      modified: false,
    },
  };
}

function input(): PluginSdkPackageInput {
  const tool: ToolAdapter = {
    descriptor: descriptor("plugin.demo.echo", "tool"),
    invoke: async (value) => value,
  };
  return {
    manifest: {
      apiVersion: "1",
      id: "com.example.demo",
      name: "Demo",
      version: "1.0.0",
      publisher: "Example",
      lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
      runtime: { kind: "declarative", entrypoint: null },
      permissions: [],
      dependencies: [],
      connectors: [],
      tools: [{
        id: "echo",
        componentId: "plugin.demo.echo",
        name: "Echo",
        capabilities: ["plugin.test.echo"],
      }],
      artifacts: [],
      agents: [],
      integrity: null,
      signer: null,
    },
    tools: [tool],
  };
}

test("P13 manifest freezes identity, compatibility, permissions and four contribution families", () => {
  const manifest = liosPluginManifestV1Schema.parse(input().manifest);
  assert.equal(manifest.apiVersion, "1");
  assert.equal(manifest.id, "com.example.demo");
  assert.equal(manifest.tools[0]?.componentId, "plugin.demo.echo");
  assert.deepEqual(manifest.connectors, []);
  assert.deepEqual(manifest.artifacts, []);
  assert.deepEqual(manifest.agents, []);
});

test("P13 SDK package validates manifest contributions against canonical runtime adapters", () => {
  const plugin = definePlugin(input());
  assert.equal(plugin.tools.length, 1);
  assert.equal(plugin.tools[0]?.descriptor.kind, "tool");
});

test("P13 SDK fails closed when a contribution is not backed by the declared component", () => {
  const value = input();
  value.tools = [];
  assert.throws(() => definePlugin(value), /do not match the manifest componentIds/);
});


test("P13 SDK rejects capability and permission smuggling outside the manifest", () => {
  const capabilityMismatch = input();
  capabilityMismatch.tools![0]!.descriptor.capabilities = ["plugin.undeclared"];
  assert.throws(
    () => definePlugin(capabilityMismatch),
    /capabilities differ from its manifest contribution/,
  );

  const permissionMismatch = input();
  permissionMismatch.tools![0]!.descriptor.permissions = ["network.http"];
  assert.throws(
    () => definePlugin(permissionMismatch),
    /requests undeclared permissions/,
  );
});
