import crypto from "node:crypto";
import { streamingLifecycleSchema, type CanonicalDataCapability, type ProviderQuota, type StreamingLifecycle } from "@shared/universalDataFabric";

export function quotaAwarePollInterval(input: {
  suggestedMs?: number | null;
  quota?: ProviderQuota | null;
  minimumMs?: number;
  maximumMs?: number;
}): number {
  const minimum = Math.max(1_000, input.minimumMs ?? 1_000);
  const maximum = Math.max(minimum, input.maximumMs ?? 86_400_000);
  let interval = Math.max(minimum, Math.min(maximum, input.suggestedMs ?? 60_000));
  if (input.quota?.retryAfterMs != null) interval = Math.max(interval, input.quota.retryAfterMs);
  if (input.quota?.remaining === 0 && input.quota.resetAt) {
    const resetMs = Math.max(0, Date.parse(input.quota.resetAt) - Date.now());
    interval = Math.max(interval, resetMs);
  }
  return Math.max(minimum, Math.min(maximum, interval));
}

export function buildStreamingLifecycle(input: {
  providerId: string;
  capability: CanonicalDataCapability;
  supportsStream: boolean;
  streamHealthy: boolean;
  quota?: ProviderQuota | null;
  suggestedPollMs?: number | null;
  lastEventAt?: string | null;
  reason?: string | null;
}): StreamingLifecycle {
  const streaming = input.supportsStream && input.streamHealthy;
  return streamingLifecycleSchema.parse({
    id: crypto.randomUUID(),
    providerId: input.providerId,
    capability: input.capability,
    state: streaming ? "streaming" : "polling",
    transport: streaming ? "websocket" : "polling",
    pollIntervalMs: streaming ? null : quotaAwarePollInterval({ suggestedMs: input.suggestedPollMs, quota: input.quota }),
    quota: input.quota ?? null,
    lastEventAt: input.lastEventAt ?? null,
    reason: input.reason ?? (streaming ? "Provider stream is healthy." : "Streaming unavailable/degraded; using quota-aware polling."),
  });
}
