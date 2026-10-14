import {
  definePluginPackageManifest,
  type PluginManifestPackageInput,
} from "@shared/pluginSdk";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import { createRuntimeFoundationRegistry } from "./runtimeFoundation";
import { P13McpServer, type P13McpServerPolicy } from "./p13McpServer";
import {
  P13NodeProcessBroker,
  type P13PluginInvocationBroker,
} from "./p13PluginBroker";
import type { P13PluginCredentialResolver } from "./p13PluginNetworkBroker";
import type { PluginExecutionGrant, P13PluginFileReadAuthorizer } from "./p13PluginHost";
import {
  P13PluginManager,
  PluginInstallError,
  type InstalledPluginSnapshot,
} from "./p13PluginManager";
import { PluginTrustStore } from "./p13PluginTrust";

export interface P13PluginRuntimeHostOptions {
  registry?: RuntimeRegistry;
  trustStore?: PluginTrustStore;
  liosVersion?: string;
}

export interface P13NodePluginActivationInput extends PluginManifestPackageInput {
  installDirectory: string;
  grant: PluginExecutionGrant;
  credentialResolver?: P13PluginCredentialResolver;
  /** A server-owned current principal/root authorizer is mandatory for brokered filesystem reads. */
  authorizeFileRead?: P13PluginFileReadAuthorizer;
  requestTimeoutMs?: number;
}

/**
 * One P13 host over the canonical RuntimeRegistry.
 *
 * The host deliberately owns no Project/Conversation/Artifact persistence.
 * Plugin installation mutates only runtime registration state, and governed
 * MCP exposure reads from the exact same registry instance.
 */
export class P13PluginRuntimeHost {
  readonly registry: RuntimeRegistry;
  readonly trustStore: PluginTrustStore;
  readonly plugins: P13PluginManager;

  constructor(options: P13PluginRuntimeHostOptions = {}) {
    this.registry = options.registry ?? createRuntimeFoundationRegistry();
    this.trustStore = options.trustStore ?? new PluginTrustStore();
    this.plugins = new P13PluginManager(
      this.registry,
      this.trustStore,
      options.liosVersion ?? "1.0.0",
    );
  }

  installDeclarativePlugin(input: PluginManifestPackageInput): InstalledPluginSnapshot {
    const plugin = definePluginPackageManifest(input);
    if (plugin.manifest.runtime.kind !== "declarative") {
      throw new PluginInstallError("Executable plugins must use installNodePlugin.");
    }
    return this.plugins.install(input);
  }

  installNodePlugin(input: P13NodePluginActivationInput): InstalledPluginSnapshot {
    const { installDirectory, grant, credentialResolver, authorizeFileRead, requestTimeoutMs, ...packageInput } = input;
    const plugin = definePluginPackageManifest(packageInput);
    if (plugin.manifest.runtime.kind !== "node_process") {
      throw new PluginInstallError("installNodePlugin only accepts node_process plugins.");
    }
    const trust = this.trustStore.verify(plugin.manifest, plugin.observedPackageDigest);
    if (trust.state !== "trusted") {
      throw new PluginInstallError("Executable plugin trust verification failed: " + trust.reason);
    }

    let broker: P13PluginInvocationBroker | null = null;
    try {
      broker = new P13NodeProcessBroker({
        manifest: plugin.manifest,
        installDirectory,
        trustState: trust.state,
        grant,
        credentialResolver,
        authorizeFileRead,
        requestTimeoutMs,
      });
      return this.plugins.install({ ...packageInput, broker });
    } catch (error) {
      broker?.dispose();
      throw error;
    }
  }

  updateNodePlugin(input: P13NodePluginActivationInput): InstalledPluginSnapshot {
    const { installDirectory, grant, credentialResolver, authorizeFileRead, requestTimeoutMs, ...packageInput } = input;
    const plugin = definePluginPackageManifest(packageInput);
    if (plugin.manifest.runtime.kind !== "node_process") {
      throw new PluginInstallError("updateNodePlugin only accepts node_process plugins.");
    }
    const trust = this.trustStore.verify(plugin.manifest, plugin.observedPackageDigest);
    if (trust.state !== "trusted") {
      throw new PluginInstallError("Executable plugin trust verification failed: " + trust.reason);
    }

    let broker: P13PluginInvocationBroker | null = null;
    try {
      broker = new P13NodeProcessBroker({
        manifest: plugin.manifest,
        installDirectory,
        trustState: trust.state,
        grant,
        credentialResolver,
        authorizeFileRead,
        requestTimeoutMs,
      });
      return this.plugins.update({ ...packageInput, broker });
    } catch (error) {
      broker?.dispose();
      throw error;
    }
  }

  createMcpServer(policy: P13McpServerPolicy): P13McpServer {
    return new P13McpServer(this.registry, policy);
  }
}

export function createP13PluginRuntimeHost(
  options: P13PluginRuntimeHostOptions = {},
): P13PluginRuntimeHost {
  return new P13PluginRuntimeHost(options);
}


let processRuntimeHost: P13PluginRuntimeHost | null = null;

/** Process-wide P13 host used by production plugin and skill consumers. */
export function getP13PluginRuntimeHost(): P13PluginRuntimeHost {
  processRuntimeHost ??= createP13PluginRuntimeHost();
  return processRuntimeHost;
}

/** Test seam only: production callers use getP13PluginRuntimeHost(). */
export function replaceP13PluginRuntimeHostForTest(host: P13PluginRuntimeHost | null): void {
  processRuntimeHost = host;
}
