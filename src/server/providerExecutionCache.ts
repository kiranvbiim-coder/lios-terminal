import { hashLedgerValue } from "./ledgerStore";
import type { TenantContext } from "./tenantContext";
import type { CanonicalDataRequest, CanonicalDataResponse } from "@shared/universalDataFabric";
import { executeCanonicalDataRequest, type ProviderSdkRegistry } from "./providerSdk";

interface Entry {
  response: CanonicalDataResponse;
  expiresAt: number;
  createdAt: number;
}
const CACHE_LIMIT = 500;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<CanonicalDataResponse>>();

function ttlMs(request: CanonicalDataRequest): number {
  if (request.pointInTime.mode !== "latest") return 5 * 60_000;
  switch (request.capability) {
    case "prices":
    case "fx": return 15_000;
    case "options": return 30_000;
    case "filings":
    case "statements":
    case "estimates": return 5 * 60_000;
    case "security_resolution": return 30 * 60_000;
    default: return 60_000;
  }
}
function key(request: CanonicalDataRequest, ctx: TenantContext, registry: ProviderSdkRegistry): string {
  const providerSet = registry.list(request.capability).map((adapter) => ({
    id: adapter.id,
    priority: adapter.priority,
    capabilities: [...adapter.capabilities],
    pointInTimeModes: [...adapter.pointInTimeModes],
  }));
  return hashLedgerValue({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    capability: request.capability,
    entity: request.entity,
    fields: request.fields,
    parameters: request.parameters,
    pointInTime: request.pointInTime,
    providerAllow: request.providerAllow,
    providerDeny: request.providerDeny,
    providerSet,
  });
}
function touch(k: string, entry: Entry) {
  cache.delete(k);
  cache.set(k, entry);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export async function executeCanonicalDataRequestCached(
  request: CanonicalDataRequest,
  context: TenantContext,
  registry: ProviderSdkRegistry,
): Promise<{ response: CanonicalDataResponse; cache: "hit" | "miss" | "deduped" }> {
  const k = key(request, context, registry);
  const now = Date.now();
  const hit = cache.get(k);
  if (hit && hit.expiresAt > now) {
    touch(k, hit);
    return { response: hit.response, cache: "hit" };
  }
  if (hit) cache.delete(k);
  const pending = inflight.get(k);
  if (pending) return { response: await pending, cache: "deduped" };

  const promise = executeCanonicalDataRequest(request, context, registry);
  inflight.set(k, promise);
  try {
    const response = await promise;
    // Gaps/errors are intentionally not cached: a just-connected provider or renewed
    // entitlement must take effect immediately.
    if (response.observation) {
      const entry = { response, createdAt: now, expiresAt: now + ttlMs(request) };
      touch(k, entry);
    }
    return { response, cache: "miss" };
  } finally {
    inflight.delete(k);
  }
}

export async function prefetchCanonicalDataRequests(
  requests: CanonicalDataRequest[],
  context: TenantContext,
  registry: ProviderSdkRegistry,
  concurrency = 4,
): Promise<Array<{ requestId: string; ok: boolean; cache: string; gapReason: string | null }>> {
  const queue = [...requests].slice(0, 100);
  const out: Array<{ requestId: string; ok: boolean; cache: string; gapReason: string | null }> = [];
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), 8) }, async () => {
    while (queue.length) {
      const request = queue.shift();
      if (!request) return;
      try {
        const result = await executeCanonicalDataRequestCached(request, context, registry);
        out.push({ requestId: request.requestId, ok: Boolean(result.response.observation), cache: result.cache, gapReason: result.response.gap?.reason ?? null });
      } catch {
        out.push({ requestId: request.requestId, ok: false, cache: "miss", gapReason: "provider_error" });
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export function clearProviderExecutionCache(): void {
  cache.clear();
  inflight.clear();
}

export function providerExecutionCacheStats() {
  return { entries: cache.size, inflight: inflight.size, limit: CACHE_LIMIT };
}
