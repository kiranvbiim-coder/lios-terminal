import type { CapabilitySurface } from "@shared/capability";
import { liosContextSchema, type LiOSContext } from "@shared/context";
import { ADVANCED_QUANT_REGISTRY } from "./advancedQuantRegistry";
import { ADVANCED_QUANT_DEPTH2_REGISTRY } from "./advancedQuantRegistryDepth2";
import {
  executeAdvancedQuant,
  isAdvancedQuantPath,
  type AdvancedQuantExecution,
  type AdvancedQuantPath,
} from "./advancedQuantExecution";
import { capabilityRegistry, type CapabilityRegistry } from "./capabilityRegistry";

export type CapabilityExecutionContext = {
  surface: CapabilitySurface;
  userId?: number;
  signal?: AbortSignal;
  context?: LiOSContext;
};

export type CapabilityHandler = (
  input: unknown,
  context: CapabilityExecutionContext,
) => Promise<unknown>;

export type AdvancedQuantRunner = (
  path: AdvancedQuantPath,
  input: unknown,
  options?: { signal?: AbortSignal; userId?: number },
) => Promise<AdvancedQuantExecution>;

export class CapabilityExecutionError extends Error {
  constructor(
    public readonly code:
      | "unknown_capability"
      | "capability_unavailable"
      | "unsupported_surface"
      | "handler_missing"
      | "duplicate_handler"
      | "invalid_context",
    message: string,
    public readonly capabilityId?: string,
  ) {
    super(message);
    this.name = "CapabilityExecutionError";
  }
}

/**
 * Provider-neutral execution dispatcher.
 *
 * It owns only invocation routing. Domain services still own validation,
 * calculation, provider access, receipts and domain-specific audit details.
 * Authorization/entitlement enforcement remains at the caller boundary until
 * a shared policy evaluator is introduced; this class never weakens an
 * existing route's guards.
 */
export class CapabilityExecutor {
  private readonly handlers = new Map<string, CapabilityHandler>();

  constructor(private readonly registry: CapabilityRegistry) {}

  register(capabilityId: string, handler: CapabilityHandler): void {
    if (!this.registry.has(capabilityId)) {
      throw new CapabilityExecutionError(
        "unknown_capability",
        `Cannot register a handler for unknown capability: ${capabilityId}`,
        capabilityId,
      );
    }
    if (this.handlers.has(capabilityId)) {
      throw new CapabilityExecutionError(
        "duplicate_handler",
        `Duplicate capability handler: ${capabilityId}`,
        capabilityId,
      );
    }
    this.handlers.set(capabilityId, handler);
  }

  hasHandler(capabilityId: string): boolean {
    return this.handlers.has(capabilityId);
  }

  executableIds(): string[] {
    return [...this.handlers.keys()].sort((left, right) => left.localeCompare(right));
  }

  async execute(
    capabilityId: string,
    input: unknown,
    context: CapabilityExecutionContext,
  ): Promise<unknown> {
    const capability = this.registry.get(capabilityId);
    if (!capability) {
      throw new CapabilityExecutionError(
        "unknown_capability",
        `Unknown LiOS capability: ${capabilityId}`,
        capabilityId,
      );
    }
    if (capability.availability.state !== "available") {
      throw new CapabilityExecutionError(
        "capability_unavailable",
        capability.availability.reason ?? `Capability is ${capability.availability.state}.`,
        capabilityId,
      );
    }
    if (!capability.surfaces.includes(context.surface)) {
      throw new CapabilityExecutionError(
        "unsupported_surface",
        `Capability ${capabilityId} is not exposed on ${context.surface}.`,
        capabilityId,
      );
    }
    const handler = this.handlers.get(capabilityId);
    if (!handler) {
      throw new CapabilityExecutionError(
        "handler_missing",
        `Capability ${capabilityId} is discoverable but does not have a common execution handler yet.`,
        capabilityId,
      );
    }

    let normalizedContext = context;
    if (context.context) {
      const parsed = liosContextSchema.safeParse(context.context);
      if (!parsed.success) {
        throw new CapabilityExecutionError(
          "invalid_context",
          `Capability ${capabilityId} received an invalid LiOS context.`,
          capabilityId,
        );
      }
      normalizedContext = { ...context, context: parsed.data };
    }

    return handler(input, normalizedContext);
  }
}

const ALL_ADVANCED_QUANT = [
  ...ADVANCED_QUANT_REGISTRY,
  ...ADVANCED_QUANT_DEPTH2_REGISTRY,
];

export function advancedQuantPathForCapability(capabilityId: string): AdvancedQuantPath | null {
  const entry = ALL_ADVANCED_QUANT.find((candidate) => candidate.id === capabilityId);
  if (!entry?.engineEndpoint?.startsWith("/advanced/")) return null;
  const path = entry.engineEndpoint.slice("/advanced/".length);
  return isAdvancedQuantPath(path) ? path : null;
}

export function createDefaultCapabilityExecutor(options: {
  registry?: CapabilityRegistry;
  runAdvancedQuant?: AdvancedQuantRunner;
} = {}): CapabilityExecutor {
  const registry = options.registry ?? capabilityRegistry;
  const runAdvancedQuant = options.runAdvancedQuant ?? executeAdvancedQuant;
  const executor = new CapabilityExecutor(registry);

  for (const entry of ALL_ADVANCED_QUANT) {
    const path = advancedQuantPathForCapability(entry.id);
    if (!path || !registry.has(entry.id)) continue;
    executor.register(entry.id, (input, context) => runAdvancedQuant(path, input, { signal: context.signal, userId: context.userId }));
  }

  return executor;
}

export const capabilityExecutor = createDefaultCapabilityExecutor();
