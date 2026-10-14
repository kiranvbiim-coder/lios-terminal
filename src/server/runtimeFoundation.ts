import { AI_PROVIDERS } from "./byoaiRouter";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";
import { registerP11ProofPacks } from "./p11ProofPacks";
import { createP12RuntimeAdapters } from "./p12RuntimeComponents";
import { ACP_RUNTIME_DESCRIPTOR, createCodingRuntimeAdapter } from "./acp/runtime-capabilities";
import { GOVERNED_CODING_WORKSPACE_DESCRIPTOR, createGovernedCodingWorkspaceAdapter } from "./acp/coding-runtime";
import { BUILT_IN_CONNECTORS, type ConnectorDefinition } from "@shared/connectorRegistry";
import {
  LIOS_RUNTIME_CONTRACT_VERSION,
  runtimeComponentDescriptorSchema,
  type RuntimeComponentDescriptor,
  type RuntimeExecutionScope,
} from "@shared/runtimeContracts";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import { createHomeProviderAdapters, createHomeRuntimeSnapshot, homeProviderDescriptors, type HomeRuntimeSnapshot } from "./runtimeProviders";

function connectorExecutionScopes(connector: ConnectorDefinition): RuntimeExecutionScope[] {
  switch (connector.sourceType) {
    case "file":
    case "database":
      return ["node_worker"];
    case "private_api":
    case "cloud_storage":
      return ["node_worker", "remote_api"];
    case "sidecar":
      return ["external_process", "local_api"];
    case "local_model":
      return ["local_api"];
    case "public_api":
    case "keyed_api":
    default:
      return ["remote_api"];
  }
}

function connectorDescriptor(connector: ConnectorDefinition): RuntimeComponentDescriptor {
  return runtimeComponentDescriptorSchema.parse({
    contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
    id: `connector:${connector.id}`,
    kind: "connector",
    name: connector.name,
    version: "1.0.0",
    lifecycle: connector.builtIn ? "builtin" : "external",
    executionScopes: connectorExecutionScopes(connector),
    capabilities: [...new Set(connector.capabilities.map((capability) => capability.contractFamily))],
    permissions: [],
    runtimePackId: null,
    replaceable: true,
    source: {
      origin: connector.builtIn ? "lios" : "user",
      importedPaths: [],
      modified: false,
    },
  });
}

function aiProviderDescriptors(): RuntimeComponentDescriptor[] {
  return AI_PROVIDERS.map((provider) => runtimeComponentDescriptorSchema.parse({
    contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
    id: `ai:${provider.id}`,
    kind: "ai_provider",
    name: provider.name,
    version: "1.0.0",
    lifecycle: "optional",
    executionScopes: [provider.isLocal ? "local_api" : "remote_api"],
    capabilities: [
      "ai:chat",
      ...(provider.supportsStreaming ? ["ai:stream"] : []),
    ],
    permissions: provider.isLocal ? [] : ["ai:external-data"],
    runtimePackId: provider.isLocal ? "local-ai" : null,
    replaceable: true,
    source: {
      origin: "lios",
      importedPaths: [],
      modified: false,
    },
  }));
}

function runtimePackDescriptors(): RuntimeComponentDescriptor[] {
  return MANAGED_RUNTIME_MANIFEST.packs.map((pack) => runtimeComponentDescriptorSchema.parse({
    contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
    id: `runtime-pack:${pack.id}`,
    kind: "runtime_pack",
    name: pack.name,
    version: MANAGED_RUNTIME_MANIFEST.manifestVersion,
    lifecycle: pack.id === "core" ? "managed" : "optional",
    executionScopes: ["python_sidecar"],
    capabilities: [...new Set(pack.engines.map((engine) => `engine:${engine}`))],
    permissions: [],
    runtimePackId: pack.id,
    replaceable: true,
    source: {
      origin: "lios",
      importedPaths: [],
      modified: false,
    },
  }));
}

export interface RuntimeFoundationSnapshot {
  contractVersion: typeof LIOS_RUNTIME_CONTRACT_VERSION;
  generatedFrom: {
    aiProviders: number;
    connectors: number;
    runtimePacks: number;
    infrastructureProviders: number;
  };
  components: RuntimeComponentDescriptor[];
  /** Which provider fills each infrastructure slot in this process, and zero-LiOS-server conformance (GM-02). */
  home: HomeRuntimeSnapshot;
}

/**
 * Projects the current specialist registries into the P0 runtime contract.
 *
 * This deliberately does not replace any specialist registry or execution
 * path. It gives later phases one discoverable, secret-free inventory and a
 * stable adapter seam for donor engines/providers.
 */
export function createRuntimeFoundationSnapshot(): RuntimeFoundationSnapshot {
  const components = [
    ...aiProviderDescriptors(),
    ...BUILT_IN_CONNECTORS.map(connectorDescriptor),
    ...runtimePackDescriptors(),
    ...homeProviderDescriptors(),
    ACP_RUNTIME_DESCRIPTOR,
    GOVERNED_CODING_WORKSPACE_DESCRIPTOR,
  ].sort((a, b) => a.id.localeCompare(b.id));

  const ids = new Set<string>();
  for (const descriptor of components) {
    if (ids.has(descriptor.id)) {
      throw new Error(`Duplicate runtime component id: ${descriptor.id}`);
    }
    ids.add(descriptor.id);
  }

  return {
    contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
    generatedFrom: {
      aiProviders: AI_PROVIDERS.length,
      connectors: BUILT_IN_CONNECTORS.length,
      runtimePacks: MANAGED_RUNTIME_MANIFEST.packs.length,
      infrastructureProviders: homeProviderDescriptors().length,
    },
    components,
    home: createHomeRuntimeSnapshot(),
  };
}

export function createRuntimeFoundationRegistry(): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  const providerAdapters = createHomeProviderAdapters();
  const providerIds = new Set(providerAdapters.map((adapter) => adapter.descriptor.id));
  registry.registerMany(
    createRuntimeFoundationSnapshot().components
      .filter((descriptor) => !providerIds.has(descriptor.id))
      .map((descriptor) => ({ descriptor })),
  );
  // Infrastructure providers carry real health derived from the running process.
  registry.registerMany(providerAdapters);
  registerP11ProofPacks(registry);
  registry.registerMany(createP12RuntimeAdapters());
  registry.register(createCodingRuntimeAdapter(), { replace: true });
  registry.register(createGovernedCodingWorkspaceAdapter(), { replace: true });
  return registry;
}
