import {
  runtimeExecutionContextSchema,
  type RuntimeExecutionContext,
} from "@shared/runtimeContracts";
import {
  canonicalPluginPayload,
  liosPluginManifestV1Schema,
  type LiosPluginManifestV1,
} from "@shared/pluginSdk";
import { LepSidecarSupervisor } from "./p11SidecarSupervisor";
import {
  buildNodePluginLaunchPlan,
  pluginExecutionGrantSchema,
  type PluginExecutionGrant,
  type P13PluginFileReadAuthorizer,
} from "./p13PluginHost";
import type { PluginTrustState } from "./p13PluginTrust";
import { createP13PluginFileAuxiliaryHandler } from "./p13PluginFileBroker";
import { createP13PluginWriteReturnHandler, type P13DeclaredFileReturn, type P13StagedFileReturn } from "./p13PluginWriteReturn";
import { P13ExecutionFileReturnLedger } from "./p13ExecutionFileReturnLedger";
import {
  createP13PluginAuxiliaryHandler,
  type P13PluginCredentialResolver,
  type P13PluginExecutionBinding,
} from "./p13PluginNetworkBroker";

export interface P13PluginInvocationRequest {
  pluginId: string;
  componentId: string;
  operation: string;
  payload: unknown;
  context: RuntimeExecutionContext;
}

export interface P13PluginInvocationBroker {
  invoke(request: P13PluginInvocationRequest): Promise<unknown>;
  cancel?(requestId: string): boolean | Promise<boolean>;
  dispose(): void;
}

const GOVERNED_P13_BROKERS = new WeakSet<object>();

// P11's LEP handshake requires "capability" values to be dot-qualified
// identifiers under the frozen P11 business-domain namespace (see
// engineCapabilitySchema in shared/engineFabricContracts.ts). Plugin
// component IDs (e.g. "plugin.broker.echo") are author-defined and are not
// part of that frozen namespace, so the wire-protocol "capability" field
// declares this single governed-broker capability instead; the real
// component identity travels in the execute payload's componentId field.
const P13_GOVERNED_PLUGIN_BROKER_CAPABILITY = "broker.plugin-execution";

export function isGovernedP13PluginBroker(
  broker: P13PluginInvocationBroker | null | undefined,
  manifest: LiosPluginManifestV1,
): broker is P13NodeProcessBroker {
  return Boolean(
    broker
    && GOVERNED_P13_BROKERS.has(broker as object)
    && broker instanceof P13NodeProcessBroker
    && broker.matchesManifest(manifest),
  );
}

export interface P13NodeProcessBrokerOptions {
  manifest: LiosPluginManifestV1;
  installDirectory: string;
  trustState: PluginTrustState;
  grant: PluginExecutionGrant;
  requestTimeoutMs?: number;
  credentialResolver?: P13PluginCredentialResolver;
  /** Required for filesystem reads. Must bind current tenant/Project/root and support revocation. */
  authorizeFileRead?: P13PluginFileReadAuthorizer;
  /** Owner-only declarations. Write returns remain gated by the canonical host. */
  allowedFileReturnPaths?: (executionRequestId: string) => readonly P13DeclaredFileReturn[];
  /** Receives copies after a successful sidecar result, never during execution. */
  onCompletedFileReturns?: (context: RuntimeExecutionContext, files: readonly P13StagedFileReturn[]) => void;
}

export class P13NodeProcessBroker implements P13PluginInvocationBroker {
  private readonly manifest: LiosPluginManifestV1;
  private readonly supervisor: LepSidecarSupervisor;
  private readonly executableComponentIds: Set<string>;
  private readonly requestMap = new Map<string, Set<string>>();
  private readonly sidecarBindings = new Map<string, P13PluginExecutionBinding>();
  private readonly fileReturns = new P13ExecutionFileReturnLedger();
  private readonly acceptReturns: boolean;
  private readonly deliverFileReturns: P13NodeProcessBrokerOptions["onCompletedFileReturns"];
  private startPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(options: P13NodeProcessBrokerOptions) {
    this.manifest = liosPluginManifestV1Schema.parse(options.manifest);
    GOVERNED_P13_BROKERS.add(this);
    if (this.manifest.runtime.kind !== "node_process") {
      throw new Error("P13 Node broker only accepts node_process plugins.");
    }

    const grant = pluginExecutionGrantSchema.parse(options.grant);
    this.acceptReturns = Boolean(options.allowedFileReturnPaths && options.onCompletedFileReturns);
    this.deliverFileReturns = options.onCompletedFileReturns;
    const plan = buildNodePluginLaunchPlan({
      manifest: this.manifest,
      installDirectory: options.installDirectory,
      trustState: options.trustState,
      grant,
      authorizeFileRead: options.authorizeFileRead,
    });

    this.executableComponentIds = new Set([
      ...this.manifest.connectors.map((item) => item.componentId),
      ...this.manifest.tools.map((item) => item.componentId),
      ...this.manifest.agents.map((item) => item.componentId),
    ]);

    this.supervisor = new LepSidecarSupervisor({
      command: plan.command,
      args: plan.args,
      cwd: plan.cwd,
      env: plan.env,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      maxRestarts: 3,
      auxiliaryRequestHandler: (() => {
        const lookupExecution = (id: string) => this.sidecarBindings.get(id) ?? null;
        const file = createP13PluginFileAuxiliaryHandler({
          manifest: this.manifest, grant, lookupExecution,
          authorizeFileRead: options.authorizeFileRead,
        });
        const returned = createP13PluginWriteReturnHandler({
          manifest: this.manifest, grant, lookupExecution,
          allowedPaths: this.acceptReturns ? options.allowedFileReturnPaths : undefined,
          stageReturn: this.acceptReturns ? file => this.fileReturns.stage(file) : undefined,
        });
        const network = createP13PluginAuxiliaryHandler({
          manifest: this.manifest, grant, lookupExecution,
          credentialResolver: options.credentialResolver,
        });
        return async (raw: unknown) => (await file(raw)) ?? (await returned(raw)) ?? await network(raw);
      })(),
    });
  }

  matchesManifest(manifest: LiosPluginManifestV1): boolean {
    return canonicalPluginPayload(this.manifest) === canonicalPluginPayload(manifest);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  private async ensureStarted(): Promise<void> {
    if (this.disposed) throw new Error("Plugin broker has been disposed.");
    if (!this.startPromise) {
      this.startPromise = this.supervisor.start({
        packId: "plugin:" + this.manifest.id,
        packVersion: this.manifest.version,
        componentId: "plugin:" + this.manifest.id,
        componentVersion: this.manifest.version,
        capabilities: [P13_GOVERNED_PLUGIN_BROKER_CAPABILITY],
        inputSchemaVersion: "1",
        outputSchemaVersion: "1",
      }).then(() => undefined).catch((error) => {
        this.startPromise = null;
        throw error;
      });
    }
    await this.startPromise;
  }

  async invoke(request: P13PluginInvocationRequest): Promise<unknown> {
    if (request.pluginId !== this.manifest.id) {
      throw new Error("Plugin broker request does not match the bound plugin.");
    }
    if (!this.executableComponentIds.has(request.componentId)) {
      throw new Error("Plugin broker component is not declared executable by the manifest.");
    }

    if (this.disposed) throw new Error("Plugin broker has been disposed.");
    const context = runtimeExecutionContextSchema.parse(request.context);
    await this.ensureStarted();

    let activeSidecarRequestId: string | null = null;
    const response = await this.supervisor.execute({
      capability: P13_GOVERNED_PLUGIN_BROKER_CAPABILITY,
      payload: {
        componentId: request.componentId,
        operation: request.operation,
        input: request.payload,
        context,
      },
      executionContextRef: context.requestId,
      inputSchemaVersion: "1",
      outputSchemaVersion: "1",
      onRequestId: (sidecarRequestId) => {
        activeSidecarRequestId = sidecarRequestId;
        const active = this.requestMap.get(context.requestId) ?? new Set<string>();
        if (this.acceptReturns) this.fileReturns.begin(sidecarRequestId, request.componentId);
        active.add(sidecarRequestId);
        this.requestMap.set(context.requestId, active);
        this.sidecarBindings.set(sidecarRequestId, {
          componentId: request.componentId,
          context,
        });
      },
    }).then((reply) => {
      if (reply.kind === "result" && this.acceptReturns && activeSidecarRequestId &&
          this.sidecarBindings.has(activeSidecarRequestId)) {
        const files = this.fileReturns.complete(activeSidecarRequestId);
        if (files.length > 0) this.deliverFileReturns?.(context, files);
      }
      return reply;
    }).finally(() => {
      if (!activeSidecarRequestId) return;
      this.fileReturns.revoke(activeSidecarRequestId);
      this.sidecarBindings.delete(activeSidecarRequestId);
      const active = this.requestMap.get(context.requestId);
      active?.delete(activeSidecarRequestId);
      if (active && active.size === 0) this.requestMap.delete(context.requestId);
    });

    if (response.kind !== "result") {
      throw new Error("Plugin sidecar returned a non-result response.");
    }
    return response.result;
  }

  cancel(requestId: string): boolean {
    const active = this.requestMap.get(requestId);
    if (!active || active.size === 0) return false;
    let cancelled = false;
    for (const sidecarRequestId of [...active]) {
      // Synchronously deny late auxiliary requests before signalling the sidecar.
      this.sidecarBindings.delete(sidecarRequestId);
      this.fileReturns.revoke(sidecarRequestId);
      cancelled = this.supervisor.cancel(sidecarRequestId) || cancelled;
    }
    return cancelled;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestMap.clear();
    this.sidecarBindings.clear();
    this.fileReturns.dispose();
    this.supervisor.stop("plugin-disposed");
  }
}
