import { hashLedgerValue } from "./ledgerStore";
import { providerCredentialRevision } from "./providerCredentialRevision";
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
// Incremented whenever cache state is explicitly invalidated (e.g. changed
// provider configuration/entitlement). Old requests may finish for their
// existing callers, but must not reintroduce stale observations.
let cacheGeneration = 0;

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
    // No secret values enter this key. Revocation/rotation changes only the
    // process-local epoch so previous observations cannot be reused.
    credentialRevision: providerCredentialRevision(),
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    role: ctx.role,
    projectId: request.projectId,
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
/**
 * A fresh entitlement decision is required before an old provider observation
 * can be reused whenever the adapter offers a live entitlement callback.
 * Changed policy identity/use rights and unknown/denied status all force a
 * normal SDK execution (which preserves provider fallback and gap semantics).
 * Providers without that callback still rely on their existing SDK checks,
 * context-isolated cache keys, TTL and explicit invalidation.
 */
async function canReuseProviderObservation(
  request: CanonicalDataRequest,
  context: TenantContext,
  registry: ProviderSdkRegistry,
  response: CanonicalDataResponse,
): Promise<boolean> {
  const observation = response.observation;
  if (!observation) return false;
  const adapter = registry.get(observation.providerId);
  if (!adapter) return false;
  if (!adapter.entitlement) return true;
  try {
    const live = await adapter.entitlement(request, context);
    const prior = observation.entitlement;
    return live.decision === "allowed"
      && prior.decision === "allowed"
      && live.policyId === prior.policyId
      && JSON.stringify([...live.permittedUses].sort()) === JSON.stringify([...prior.permittedUses].sort());
  } catch {
    // Entitlement backend errors must never authorize a cached response.
    return false;
  }
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
  const generation = cacheGeneration;
  const now = Date.now();
  const hit = cache.get(k);
  if (hit && hit.expiresAt > now) {
    const allowed = await canReuseProviderObservation(request, context, registry, hit.response);
    // A clear or a replacement may happen while entitlement is being checked.
    if (allowed && generation === cacheGeneration && cache.get(k) === hit) {
      touch(k, hit);
      return { response: hit.response, cache: "hit" };
    }
  }
  if (hit && cache.get(k) === hit) cache.delete(k);
  const pending = inflight.get(k);
  if (pending) {
    const response = await pending;
    if (generation === cacheGeneration && await canReuseProviderObservation(request, context, registry, response)) {
      return { response, cache: "deduped" };
    }
    // Permission changed during execution: rerun through the canonical SDK
    // rather than handing a newly unauthorized observation to this caller.
    return { response: await executeCanonicalDataRequest(request, context, registry), cache: "miss" };
  }

  const promise = executeCanonicalDataRequest(request, context, registry);
  inflight.set(k, promise);
  try {
    const response = await promise;
    // Gaps/errors are intentionally not cached: a just-connected provider or renewed
    // entitlement must take effect immediately.
    if (response.observation && generation === cacheGeneration) {
      const entry = { response, createdAt: now, expiresAt: now + ttlMs(request) };
      touch(k, entry);
    }
    return { response, cache: "miss" };
  } finally {
    // An invalidation may have started a newer request for this same key.
    // Old cleanup may remove only its own promise, never the replacement.
    if (inflight.get(k) === promise) inflight.delete(k);
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
  cacheGeneration += 1;
  cache.clear();
  inflight.clear();
}

export function providerExecutionCacheStats() {
  return { entries: cache.size, inflight: inflight.size, limit: CACHE_LIMIT };
}
