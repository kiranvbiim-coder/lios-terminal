import {
  capabilityRouteSchema,
  type CapabilityRoute,
  type EngineCapabilityRole,
} from "./engineFabricContracts";
import {
  runtimeComponentDescriptorSchema,
  runtimeHealthReportSchema,
  type RuntimeAdapter,
  type RuntimeComponentDescriptor,
  type RuntimeComponentKind,
  type RuntimeHealthReport,
} from "./runtimeContracts";

export class RuntimeRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeRegistryError";
  }
}

function canonicalDescriptor(descriptor: RuntimeComponentDescriptor): RuntimeComponentDescriptor {
  return runtimeComponentDescriptorSchema.parse(descriptor);
}

function cloneDescriptor(descriptor: RuntimeComponentDescriptor): RuntimeComponentDescriptor {
  return runtimeComponentDescriptorSchema.parse(JSON.parse(JSON.stringify(descriptor)));
}

function cloneCapabilityRoute(route: CapabilityRoute): CapabilityRoute {
  return capabilityRouteSchema.parse(JSON.parse(JSON.stringify(route)));
}

/**
 * LiOS-owned registry for runtime adapters.
 *
 * Specialist registries (connectors, finance engines, AI providers, etc.)
 * remain authoritative for domain-specific configuration. They project
 * stable descriptors/adapters into this registry so downstream code can
 * discover capabilities without coupling Project state to a donor library.
 */
export class RuntimeRegistry {
  private readonly adapters = new Map<string, { adapter: RuntimeAdapter; descriptor: RuntimeComponentDescriptor }>();
  private readonly capabilityRoutes = new Map<string, CapabilityRoute>();

  register(adapter: RuntimeAdapter, options: { replace?: boolean } = {}): RuntimeComponentDescriptor {
    const descriptor = canonicalDescriptor(adapter.descriptor);
    const existing = this.adapters.get(descriptor.id);

    if (existing && !options.replace) {
      throw new RuntimeRegistryError(`Runtime component "${descriptor.id}" is already registered.`);
    }

    if (existing && options.replace) {
      const current = canonicalDescriptor(existing.descriptor);
      if (current.kind !== descriptor.kind) {
        throw new RuntimeRegistryError(
          `Runtime component "${descriptor.id}" cannot change kind from ${current.kind} to ${descriptor.kind}.`,
        );
      }
      if (!current.replaceable) {
        throw new RuntimeRegistryError(`Runtime component "${descriptor.id}" is not replaceable.`);
      }
    }

    this.adapters.set(descriptor.id, { adapter, descriptor });
    return cloneDescriptor(descriptor);
  }

  registerMany(adapters: RuntimeAdapter[], options: { replace?: boolean } = {}): RuntimeComponentDescriptor[] {
    const parsed = adapters.map((adapter) => ({
      adapter,
      descriptor: canonicalDescriptor(adapter.descriptor),
    }));

    const incoming = new Set<string>();
    for (const { descriptor } of parsed) {
      if (incoming.has(descriptor.id)) {
        throw new RuntimeRegistryError(`Runtime component "${descriptor.id}" is duplicated in the registration batch.`);
      }
      incoming.add(descriptor.id);

      const existing = this.adapters.get(descriptor.id);
      if (!existing) continue;
      if (!options.replace) {
        throw new RuntimeRegistryError(`Runtime component "${descriptor.id}" is already registered.`);
      }
      const current = canonicalDescriptor(existing.descriptor);
      if (current.kind !== descriptor.kind) {
        throw new RuntimeRegistryError(
          `Runtime component "${descriptor.id}" cannot change kind from ${current.kind} to ${descriptor.kind}.`,
        );
      }
      if (!current.replaceable) {
        throw new RuntimeRegistryError(`Runtime component "${descriptor.id}" is not replaceable.`);
      }
    }

    for (const { adapter, descriptor } of parsed) {
      this.adapters.set(descriptor.id, { adapter, descriptor });
    }

    return parsed.map(({ descriptor }) => cloneDescriptor(descriptor));
  }

  private materialize(entry: { adapter: RuntimeAdapter; descriptor: RuntimeComponentDescriptor }): RuntimeAdapter {
    const adapter = entry.adapter;
    const prototype = Object.getPrototypeOf(adapter);
    const materialized = Object.assign(Object.create(prototype), adapter) as RuntimeAdapter;
    Object.defineProperty(materialized, "descriptor", {
      value: cloneDescriptor(entry.descriptor),
      enumerable: true,
      configurable: false,
      writable: false,
    });
    return materialized;
  }

  get(id: string): RuntimeAdapter | null {
    const entry = this.adapters.get(id);
    return entry ? this.materialize(entry) : null;
  }

  require(id: string): RuntimeAdapter {
    const entry = this.adapters.get(id);
    if (!entry) throw new RuntimeRegistryError(`Runtime component "${id}" is not registered.`);
    return this.materialize(entry);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  unregister(id: string): boolean {
    const removed = this.adapters.delete(id);
    if (!removed) return false;
    for (const [capability, route] of this.capabilityRoutes.entries()) {
      const targets = [route.primary, route.validator, route.fallback].filter(Boolean);
      if (targets.some((target) => target?.componentId === id)) this.capabilityRoutes.delete(capability);
    }
    return true;
  }

  registerCapabilityRoute(routeInput: CapabilityRoute, options: { replace?: boolean } = {}): CapabilityRoute {
    const route = capabilityRouteSchema.parse(routeInput);
    const existing = this.capabilityRoutes.get(route.capability);
    if (existing && !options.replace) {
      throw new RuntimeRegistryError(`Capability route "${route.capability}" is already registered.`);
    }

    for (const [role, target] of [
      ["primary", route.primary],
      ["validator", route.validator],
      ["fallback", route.fallback],
    ] as const) {
      if (!target) continue;
      if (!this.adapters.has(target.componentId)) {
        throw new RuntimeRegistryError(
          `Capability "${route.capability}" ${role} component "${target.componentId}" is not registered.`,
        );
      }
    }

    this.capabilityRoutes.set(route.capability, route);
    return cloneCapabilityRoute(route);
  }

  unregisterCapabilityRoute(capability: string): boolean {
    return this.capabilityRoutes.delete(capability);
  }

  listCapabilityRoutes(): CapabilityRoute[] {
    return [...this.capabilityRoutes.values()]
      .sort((a, b) => a.capability.localeCompare(b.capability))
      .map(cloneCapabilityRoute);
  }

  resolveCapability(capability: string): {
    route: CapabilityRoute;
    primary: RuntimeAdapter;
    validator: RuntimeAdapter | null;
    fallback: RuntimeAdapter | null;
  } {
    const route = this.capabilityRoutes.get(capability);
    if (!route) throw new RuntimeRegistryError(`Capability "${capability}" is not registered.`);
    return {
      route: cloneCapabilityRoute(route),
      primary: this.require(route.primary.componentId),
      validator: route.validator ? this.require(route.validator.componentId) : null,
      fallback: route.fallback ? this.require(route.fallback.componentId) : null,
    };
  }

  resolveCapabilityRole(capability: string, role: EngineCapabilityRole): RuntimeAdapter | null {
    const route = this.capabilityRoutes.get(capability);
    if (!route) throw new RuntimeRegistryError(`Capability "${capability}" is not registered.`);
    const target = role === "primary" ? route.primary : role === "validator" ? route.validator : route.fallback;
    return target ? this.require(target.componentId) : null;
  }

  list(kind?: RuntimeComponentKind): RuntimeComponentDescriptor[] {
    const descriptors = [...this.adapters.values()]
      .map((entry) => canonicalDescriptor(entry.descriptor))
      .filter((descriptor) => !kind || descriptor.kind === kind)
      .sort((a, b) => a.id.localeCompare(b.id));

    return descriptors.map(cloneDescriptor);
  }

  snapshot(): ReadonlyArray<RuntimeComponentDescriptor> {
    return this.list();
  }

  async healthSnapshot(): Promise<RuntimeHealthReport[]> {
    const reports: RuntimeHealthReport[] = [];

    for (const entry of [...this.adapters.values()].sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id))) {
      const adapter = entry.adapter;
      const descriptor = entry.descriptor;
      if (!adapter.health) {
        reports.push(runtimeHealthReportSchema.parse({
          componentId: descriptor.id,
          state: "configurable",
          detail: "Registered capability only; no active health probe has verified runtime availability.",
          checkedAt: new Date().toISOString(),
        }));
        continue;
      }

      try {
        const report = await adapter.health();
        if (report.componentId !== descriptor.id) {
          throw new RuntimeRegistryError(
            `Health probe for "${descriptor.id}" returned report for "${report.componentId}".`,
          );
        }
        reports.push(runtimeHealthReportSchema.parse(report));
      } catch (error) {
        reports.push(runtimeHealthReportSchema.parse({
          componentId: descriptor.id,
          state: "degraded",
          detail: error instanceof Error ? error.message.slice(0, 2_000) : "Runtime health probe failed.",
          checkedAt: new Date().toISOString(),
        }));
      }
    }

    return reports;
  }
}

export function createRuntimeRegistry(adapters: RuntimeAdapter[] = []): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registry.registerMany(adapters);
  return registry;
}
