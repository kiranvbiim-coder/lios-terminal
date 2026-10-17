import { onConversationScopeCancel } from "./exec/execution-scope";
import {
  definePluginPackageManifest,
  hasPrivilegedPluginPermissions,
  type LiosPluginManifestV1,
  type PluginArtifactContribution,
  type PluginContribution,
  type PluginManifestPackage,
  type PluginManifestPackageInput,
} from "@shared/pluginSdk";
import type { ArtifactRendererAdapter, ConnectorAdapter, ConnectorResource } from "@shared/runtimeAdapters";
import {
  LIOS_RUNTIME_CONTRACT_VERSION,
  type AgentAdapter,
  type RuntimeAdapter,
  type RuntimeComponentDescriptor,
  type RuntimeExecutionContext,
  type SkillAdapter,
  type ToolAdapter,
} from "@shared/runtimeContracts";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import { isGovernedP13PluginBroker, type P13PluginInvocationBroker } from "./p13PluginBroker";
import { PluginTrustStore, type PluginTrustDecision } from "./p13PluginTrust";

export interface PluginCompatibilityResult {
  compatible: boolean;
  reasons: string[];
}

export interface InstalledPluginSnapshot {
  id: string;
  version: string;
  trust: PluginTrustDecision;
  componentIds: string[];
  manifest: LiosPluginManifestV1;
}

export interface PluginActivationPreview {
  manifest: LiosPluginManifestV1;
  trust: PluginTrustDecision;
  compatible: boolean;
  reasons: string[];
}

export interface P13PluginInstallInput extends PluginManifestPackageInput {
  broker?: P13PluginInvocationBroker | null;
}

export class PluginInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginInstallError";
  }
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error("Invalid semantic version: " + version);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function satisfiesPluginVersion(version: string, range: string): boolean {
  const operator = range.startsWith(">=") || range.startsWith("<=")
    ? range.slice(0, 2)
    : ["^", "~", ">", "<"].includes(range[0] ?? "")
      ? range[0]
      : "=";
  const base = operator === "=" ? range : range.slice(operator.length);
  const comparison = compareVersions(version, base);

  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  if (operator === "=") return comparison === 0;

  const [major, minor, patch] = parseVersion(base);
  if (comparison < 0) return false;

  if (operator === "~") {
    return compareVersions(version, String(major) + "." + String(minor + 1) + ".0") < 0;
  }

  if (major > 0) return compareVersions(version, String(major + 1) + ".0.0") < 0;
  if (minor > 0) return compareVersions(version, "0." + String(minor + 1) + ".0") < 0;
  return compareVersions(version, "0.0." + String(patch + 1)) < 0;
}

export function negotiatePluginCompatibility(
  manifest: LiosPluginManifestV1,
  liosVersion: string,
  installedVersions: ReadonlyMap<string, string>,
): PluginCompatibilityResult {
  const reasons: string[] = [];
  if (compareVersions(liosVersion, manifest.lios.minVersion) < 0) reasons.push("lios_version_below_minimum");
  if (manifest.lios.maxVersion && compareVersions(liosVersion, manifest.lios.maxVersion) > 0) {
    reasons.push("lios_version_above_maximum");
  }

  for (const dependency of manifest.dependencies) {
    const installed = installedVersions.get(dependency.pluginId);
    if (!installed) {
      reasons.push("missing_dependency:" + dependency.pluginId);
      continue;
    }
    if (!satisfiesPluginVersion(installed, dependency.versionRange)) {
      reasons.push("dependency_version_mismatch:" + dependency.pluginId);
    }
  }

  return { compatible: reasons.length === 0, reasons };
}

function pluginExecutionScope(
  manifest: LiosPluginManifestV1,
): RuntimeComponentDescriptor["executionScopes"][number] {
  if (manifest.runtime.kind === "declarative") return "declarative";
  if (manifest.runtime.kind === "python_sidecar") return "python_sidecar";
  return "external_process";
}

function pluginDescriptor(manifest: LiosPluginManifestV1): RuntimeComponentDescriptor {
  const capabilities = [
    ...manifest.connectors.flatMap((item) => item.capabilities),
    ...manifest.tools.flatMap((item) => item.capabilities),
    ...manifest.artifacts.flatMap((item) => item.capabilities),
    ...manifest.agents.flatMap((item) => item.capabilities),
    ...manifest.skills.flatMap((item) => item.capabilities),
  ];
  return {
    contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
    id: "plugin:" + manifest.id,
    kind: "plugin",
    name: manifest.name,
    version: manifest.version,
    lifecycle: "external",
    executionScopes: [pluginExecutionScope(manifest)],
    capabilities: [...new Set(capabilities)],
    permissions: [...manifest.permissions],
    runtimePackId: null,
    replaceable: true,
    source: { origin: "external", importedPaths: [], modified: false },
  };
}

function contributionDescriptor(
  manifest: LiosPluginManifestV1,
  contribution: PluginContribution | PluginArtifactContribution,
  kind: RuntimeComponentDescriptor["kind"],
  executionScope: RuntimeComponentDescriptor["executionScopes"][number],
): RuntimeComponentDescriptor {
  return {
    contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
    id: contribution.componentId,
    kind,
    name: contribution.name,
    version: manifest.version,
    lifecycle: "external",
    executionScopes: [executionScope],
    capabilities: [...contribution.capabilities],
    permissions: [...manifest.permissions],
    runtimePackId: null,
    replaceable: true,
    source: { origin: "external", importedPaths: [], modified: false },
  };
}

function requireBroker(
  broker: P13PluginInvocationBroker | null,
  manifest: LiosPluginManifestV1,
): P13PluginInvocationBroker {
  if (!broker) {
    throw new PluginInstallError("Executable plugin " + manifest.id + " has no isolated invocation broker.");
  }
  if (!isGovernedP13PluginBroker(broker, manifest)) {
    throw new PluginInstallError(
      "Executable plugin " + manifest.id + " must use a LiOS-governed broker bound to the exact manifest.",
    );
  }
  return broker;
}

function brokerInvoke(
  broker: P13PluginInvocationBroker | null,
  manifest: LiosPluginManifestV1,
  componentId: string,
  operation: string,
  payload: unknown,
  context: RuntimeExecutionContext,
): Promise<unknown> {
  const active = requireBroker(broker, manifest);
  // A plugin call made under a conversation run is a child of that run's cancellation scope (SI-02.07).
  const unregister = onConversationScopeCancel(async () => { await active.cancel?.(context.requestId); });
  return active.invoke({
    pluginId: manifest.id,
    componentId,
    operation,
    payload,
    context,
  }).finally(unregister);
}

function createManagedAdapters(
  manifest: LiosPluginManifestV1,
  broker: P13PluginInvocationBroker | null,
): RuntimeAdapter[] {
  const executionScope = pluginExecutionScope(manifest);

  const connectors: ConnectorAdapter[] = manifest.connectors.map((contribution) => ({
    descriptor: contributionDescriptor(manifest, contribution, "connector", executionScope),
    connect: async (context) => {
      await brokerInvoke(broker, manifest, contribution.componentId, "connector.connect", {}, context);
    },
    disconnect: async (context) => {
      await brokerInvoke(broker, manifest, contribution.componentId, "connector.disconnect", {}, context);
    },
    discover: async (context) => {
      const value = await brokerInvoke(broker, manifest, contribution.componentId, "connector.discover", {}, context);
      if (!Array.isArray(value)) throw new Error("Plugin connector discover result must be an array.");
      return value as ConnectorResource[];
    },
    query: async (request, context) => brokerInvoke(
      broker,
      manifest,
      contribution.componentId,
      "connector.query",
      request,
      context,
    ),
  }));

  const tools: ToolAdapter[] = manifest.tools.map((contribution) => ({
    descriptor: contributionDescriptor(manifest, contribution, "tool", executionScope),
    invoke: async (input, context) => brokerInvoke(
      broker,
      manifest,
      contribution.componentId,
      "tool.invoke",
      input,
      context,
    ),
  }));

  const artifacts: ArtifactRendererAdapter[] = manifest.artifacts.map((contribution) => ({
    descriptor: contributionDescriptor(manifest, contribution, "artifact_renderer", "declarative"),
    supports: (artifact) => contribution.artifactKinds.includes(artifact.artifactType),
  }));

  const agents: AgentAdapter[] = manifest.agents.map((contribution) => ({
    descriptor: contributionDescriptor(manifest, contribution, "agent", executionScope),
    run: async (input, context) => brokerInvoke(
      broker,
      manifest,
      contribution.componentId,
      "agent.run",
      input,
      context,
    ),
    cancel: async (requestId) => {
      if (broker?.cancel) await broker.cancel(requestId);
    },
  }));

  const skills: SkillAdapter[] = manifest.skills.map((contribution) => ({
    descriptor: contributionDescriptor(manifest, contribution, "skill", "declarative"),
    definition: {
      skillId: contribution.id,
      description: contribution.description,
      requiredInputs: [...contribution.requiredInputs],
      supportedObjectKinds: [...contribution.supportedObjectKinds],
      toolIds: [...contribution.toolIds],
    },
  }));

  return [{ descriptor: pluginDescriptor(manifest) }, ...connectors, ...tools, ...artifacts, ...agents, ...skills];
}

function cloneSnapshot(snapshot: InstalledPluginSnapshot): InstalledPluginSnapshot {
  return {
    ...snapshot,
    trust: { ...snapshot.trust },
    componentIds: [...snapshot.componentIds],
    manifest: JSON.parse(JSON.stringify(snapshot.manifest)) as LiosPluginManifestV1,
  };
}

function needsExecutableBroker(manifest: LiosPluginManifestV1): boolean {
  return manifest.connectors.length > 0 || manifest.tools.length > 0 || manifest.agents.length > 0;
}

export class P13PluginManager {
  private readonly installed = new Map<string, InstalledPluginSnapshot>();
  private readonly installedPackages = new Map<string, PluginManifestPackage>();
  private readonly installedBrokers = new Map<string, P13PluginInvocationBroker | null>();

  constructor(
    private readonly registry: RuntimeRegistry,
    private readonly trustStore: PluginTrustStore,
    private readonly liosVersion = "1.0.0",
  ) {}

  private installedVersions(excludePluginId: string | null = null): Map<string, string> {
    return new Map(
      [...this.installed.values()]
        .filter((item) => item.id !== excludePluginId)
        .map((item) => [item.id, item.version] as const),
    );
  }

  private assertDependencyGraph(candidate: LiosPluginManifestV1): void {
    const manifests = new Map([...this.installed.values()].map((item) => [item.id, item.manifest] as const));
    manifests.set(candidate.id, candidate);
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (pluginId: string): void => {
      if (visited.has(pluginId)) return;
      if (visiting.has(pluginId)) throw new PluginInstallError("Plugin dependency cycle detected at: " + pluginId);
      const manifest = manifests.get(pluginId);
      if (!manifest) return;
      visiting.add(pluginId);
      for (const dependency of manifest.dependencies) {
        if (manifests.has(dependency.pluginId)) visit(dependency.pluginId);
      }
      visiting.delete(pluginId);
      visited.add(pluginId);
    };

    for (const pluginId of manifests.keys()) visit(pluginId);
  }

  private assertReverseDependencyCompatibility(pluginId: string, nextVersion: string): void {
    for (const dependent of this.installed.values()) {
      if (dependent.id === pluginId) continue;
      const requirement = dependent.manifest.dependencies.find((dependency) => dependency.pluginId === pluginId);
      if (requirement && !satisfiesPluginVersion(nextVersion, requirement.versionRange)) {
        throw new PluginInstallError(
          "Plugin update would break installed dependent " + dependent.id + " requiring " + requirement.versionRange,
        );
      }
    }
  }

  private validateForActivation(
    plugin: PluginManifestPackage,
    installedVersions: ReadonlyMap<string, string>,
    broker: P13PluginInvocationBroker | null,
  ): PluginTrustDecision {
    const manifest = plugin.manifest;
    const compatibility = negotiatePluginCompatibility(manifest, this.liosVersion, installedVersions);
    if (!compatibility.compatible) {
      throw new PluginInstallError("Plugin compatibility failed: " + compatibility.reasons.join(","));
    }

    const trust = this.trustStore.verify(manifest, plugin.observedPackageDigest);
    if (trust.state === "invalid" || trust.state === "revoked" || trust.state === "unknown_signer") {
      throw new PluginInstallError("Plugin trust verification failed: " + trust.reason);
    }
    if ((hasPrivilegedPluginPermissions(manifest) || manifest.runtime.kind !== "declarative") && trust.state !== "trusted") {
      throw new PluginInstallError("Executable or privileged plugins must be signed by a trusted publisher.");
    }

    if (needsExecutableBroker(manifest)) {
      if (manifest.runtime.kind === "declarative") {
        throw new PluginInstallError("Declarative plugins cannot contribute executable connectors, tools or agents.");
      }
      if (manifest.runtime.kind !== "node_process") {
        throw new PluginInstallError(
          "P13 executable activation currently permits only the supervised node_process runtime.",
        );
      }
      requireBroker(broker, manifest);
    }

    if (manifest.runtime.kind === "declarative" && hasPrivilegedPluginPermissions(manifest)) {
      throw new PluginInstallError("Declarative plugins cannot request privileged execution permissions.");
    }

    // Skills steer what the agent does, so they follow the curated-approval rule the Wave E skill routes enforced.
    if (manifest.skills.length > 0 && trust.state !== "trusted") {
      throw new PluginInstallError("Skills require a trusted publisher; third-party skills need curated approval.");
    }

    return trust;
  }

  private snapshotFor(
    plugin: PluginManifestPackage,
    trust: PluginTrustDecision,
    adapters: RuntimeAdapter[],
  ): InstalledPluginSnapshot {
    return {
      id: plugin.manifest.id,
      version: plugin.manifest.version,
      trust,
      componentIds: adapters.map((adapter) => adapter.descriptor.id),
      manifest: plugin.manifest,
    };
  }

  /** Pure activation assessment; it never registers adapters or creates a broker. */
  preview(input: P13PluginInstallInput): PluginActivationPreview {
    const plugin = definePluginPackageManifest(input);
    const reasons = negotiatePluginCompatibility(plugin.manifest, this.liosVersion, this.installedVersions()).reasons;
    const trust = this.trustStore.verify(plugin.manifest, plugin.observedPackageDigest);
    try {
      if (this.installed.has(plugin.manifest.id)) throw new PluginInstallError("Plugin is already installed.");
      this.assertDependencyGraph(plugin.manifest);
      this.validateForActivation(plugin, this.installedVersions(), input.broker ?? null);
      for (const id of [pluginDescriptor(plugin.manifest).id, ...plugin.manifest.connectors.map(item => item.componentId), ...plugin.manifest.tools.map(item => item.componentId), ...plugin.manifest.artifacts.map(item => item.componentId), ...plugin.manifest.agents.map(item => item.componentId), ...plugin.manifest.skills.map(item => item.componentId)]) {
        if (this.registry.has(id)) throw new PluginInstallError("Runtime component is already registered: " + id);
      }
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : "Plugin activation refused.");
    }
    return { manifest: plugin.manifest, trust, compatible: reasons.length === 0, reasons: [...new Set(reasons)] };
  }

  install(input: P13PluginInstallInput): InstalledPluginSnapshot {
    const broker = input.broker ?? null;
    let plugin: PluginManifestPackage;
    try {
      plugin = definePluginPackageManifest(input);
      if (this.installed.has(plugin.manifest.id)) {
        throw new PluginInstallError("Plugin is already installed: " + plugin.manifest.id);
      }
      this.assertDependencyGraph(plugin.manifest);
      const trust = this.validateForActivation(plugin, this.installedVersions(), broker);
      const adapters = createManagedAdapters(plugin.manifest, broker);
      const registered: string[] = [];
      try {
        for (const adapter of adapters) {
          this.registry.register(adapter);
          registered.push(adapter.descriptor.id);
        }
      } catch (error) {
        for (const componentId of registered.reverse()) this.registry.unregister(componentId);
        throw new PluginInstallError(
          "Plugin registration failed without partial activation: "
          + (error instanceof Error ? error.message : "unknown error"),
        );
      }

      const snapshot = this.snapshotFor(plugin, trust, adapters);
      this.installed.set(plugin.manifest.id, snapshot);
      this.installedPackages.set(plugin.manifest.id, plugin);
      this.installedBrokers.set(plugin.manifest.id, broker);
      return cloneSnapshot(snapshot);
    } catch (error) {
      broker?.dispose();
      throw error;
    }
  }

  update(input: P13PluginInstallInput): InstalledPluginSnapshot {
    const nextBroker = input.broker ?? null;
    const nextPlugin = definePluginPackageManifest(input);
    const pluginId = nextPlugin.manifest.id;
    const currentSnapshot = this.installed.get(pluginId);
    const currentPlugin = this.installedPackages.get(pluginId);
    const currentBroker = this.installedBrokers.get(pluginId) ?? null;
    if (!currentSnapshot || !currentPlugin) {
      nextBroker?.dispose();
      throw new PluginInstallError("Plugin is not installed: " + pluginId);
    }
    if (compareVersions(nextPlugin.manifest.version, currentSnapshot.version) <= 0) {
      nextBroker?.dispose();
      throw new PluginInstallError("Plugin update version must be greater than the installed version.");
    }

    try {
      this.assertReverseDependencyCompatibility(pluginId, nextPlugin.manifest.version);
      this.assertDependencyGraph(nextPlugin.manifest);
      const trust = this.validateForActivation(nextPlugin, this.installedVersions(pluginId), nextBroker);
      const currentAdapters = createManagedAdapters(currentPlugin.manifest, currentBroker);
      const nextAdapters = createManagedAdapters(nextPlugin.manifest, nextBroker);
      const currentIds = new Set(currentSnapshot.componentIds);

      for (const adapter of nextAdapters) {
        if (this.registry.has(adapter.descriptor.id) && !currentIds.has(adapter.descriptor.id)) {
          throw new PluginInstallError("Plugin update collides with runtime component: " + adapter.descriptor.id);
        }
      }

      for (const componentId of [...currentSnapshot.componentIds].reverse()) this.registry.unregister(componentId);

      const registered: string[] = [];
      try {
        for (const adapter of nextAdapters) {
          this.registry.register(adapter);
          registered.push(adapter.descriptor.id);
        }
      } catch (error) {
        for (const componentId of registered.reverse()) this.registry.unregister(componentId);
        for (const adapter of currentAdapters) this.registry.register(adapter);
        throw new PluginInstallError(
          "Plugin update failed and previous version was restored: "
          + (error instanceof Error ? error.message : "unknown error"),
        );
      }

      const snapshot = this.snapshotFor(nextPlugin, trust, nextAdapters);
      this.installed.set(pluginId, snapshot);
      this.installedPackages.set(pluginId, nextPlugin);
      this.installedBrokers.set(pluginId, nextBroker);
      if (currentBroker && currentBroker !== nextBroker) currentBroker.dispose();
      return cloneSnapshot(snapshot);
    } catch (error) {
      if (nextBroker && nextBroker !== currentBroker) nextBroker.dispose();
      throw error;
    }
  }

  remove(pluginId: string): boolean {
    const current = this.installed.get(pluginId);
    if (!current) return false;

    const dependent = [...this.installed.values()].find((item) =>
      item.id !== pluginId && item.manifest.dependencies.some((dependency) => dependency.pluginId === pluginId)
    );
    if (dependent) throw new PluginInstallError("Plugin is required by installed plugin: " + dependent.id);

    for (const componentId of [...current.componentIds].reverse()) this.registry.unregister(componentId);
    this.installedBrokers.get(pluginId)?.dispose();
    this.installed.delete(pluginId);
    this.installedPackages.delete(pluginId);
    this.installedBrokers.delete(pluginId);
    return true;
  }
  /** Revoke the exact package and dependent adapters, leaf-first, through the canonical manager. */
  revoke(pluginId: string): string[] {
    const current = this.installed.get(pluginId);
    if (!current) return [];
    const revoked = new Set([pluginId]);
    if (current.trust.packageDigest) {
      for (const item of this.installed.values()) {
        if (item.trust.packageDigest === current.trust.packageDigest) revoked.add(item.id);
      }
    }
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const item of this.installed.values()) {
        if (!revoked.has(item.id) && item.manifest.dependencies.some(dep => revoked.has(dep.pluginId))) {
          revoked.add(item.id);
          expanded = true;
        }
      }
    }
    const removed: string[] = [];
    while (revoked.size > 0) {
      const leaf = [...revoked].find(id => ![...this.installed.values()].some(item => item.id !== id && item.manifest.dependencies.some(dep => dep.pluginId === id)));
      if (!leaf) throw new PluginInstallError("Cannot revoke cyclic plugin dependencies.");
      this.remove(leaf);
      removed.push(leaf);
      revoked.delete(leaf);
    }
    if (current.trust.packageDigest) this.trustStore.revokeDigest(current.trust.packageDigest);
    return removed;
  }


  get(pluginId: string): InstalledPluginSnapshot | null {
    const snapshot = this.installed.get(pluginId);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  list(): InstalledPluginSnapshot[] {
    return [...this.installed.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(cloneSnapshot);
  }
}
