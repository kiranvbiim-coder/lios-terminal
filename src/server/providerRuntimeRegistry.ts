import type { User } from "@shared/schema";
import type { TenantContext } from "./tenantContext";
import { ProviderSdkRegistry, createNativeProviderAdapters } from "./providerSdk";
import { listSourceConnections } from "./sourceConnectionService";
import { registerSourceConnectionProviders } from "./sourceConnectionProviderAdapter";

export async function createProviderRegistryForUser(
  ctx: TenantContext,
  actor: Pick<User, "id" | "email">,
): Promise<ProviderSdkRegistry> {
  const registry = new ProviderSdkRegistry();
  for (const adapter of createNativeProviderAdapters()) registry.register(adapter);
  const connections = (await listSourceConnections(ctx.userId))
    .filter((connection) => connection.status !== "invalid");
  registerSourceConnectionProviders(registry, connections, actor);
  return registry;
}

export function describeProviderRegistry(registry: ProviderSdkRegistry) {
  return registry.list().map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    priority: adapter.priority,
    capabilities: [...adapter.capabilities],
    pointInTimeModes: [...adapter.pointInTimeModes],
    operations: {
      capability: true,
      search: Boolean(adapter.search),
      fetch: true,
      stream: Boolean(adapter.stream),
      health: Boolean(adapter.health),
      quota: Boolean(adapter.quota),
      entitlement: Boolean(adapter.entitlement),
      normalize: Boolean(adapter.normalize),
    },
  }));
}
