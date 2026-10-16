import type { ProviderEntitlementDecision } from "@shared/universalDataFabric";
import type { ProviderStreamSubscription } from "./providerSdk";

/**
 * Managed subscription for the existing P5 streaming authority. A periodic
 * check is not a substitute for adapter-side continuous rights enforcement;
 * recheckEntitlement permits immediate revocation handling on known changes.
 */
export interface ManagedProviderStreamSubscription extends ProviderStreamSubscription {
  recheckEntitlement(): Promise<boolean>;
}

const DEFAULT_RECHECK_INTERVAL_MS = 60_000;

function sameStreamingGrant(initial: ProviderEntitlementDecision, current: ProviderEntitlementDecision): boolean {
  return current.decision === "allowed"
    && current.permittedUses.includes("internal_research")
    && current.policyId === initial.policyId
    && JSON.stringify([...current.permittedUses].sort()) === JSON.stringify([...initial.permittedUses].sort());
}

/**
 * A single guarded owner of the stream timer, stop lifecycle and rechecks.
 * Never propagate entitlement-provider exception contents into user-facing
 * errors, logs, lifecycle reasons or the stream's source data.
 */
export function guardProviderStreamEntitlement(
  source: ProviderStreamSubscription,
  check: () => Promise<ProviderEntitlementDecision>,
  initial: ProviderEntitlementDecision,
  intervalMs = DEFAULT_RECHECK_INTERVAL_MS,
): ManagedProviderStreamSubscription {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new RangeError("Stream entitlement recheck interval must be at least one second.");
  }

  let closed = false;
  let reason = "Stream stopped by request.";
  let stopPromise: Promise<void> | null = null;
  let checkPromise: Promise<boolean> | null = null;

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    closed = true;
    clearInterval(timer);
    stopPromise = (async () => {
      try {
        await source.stop();
        source.lifecycle.state = "stopped";
        source.lifecycle.reason = reason;
      } catch {
        // A failed adapter shutdown is not proof that the external stream
        // ended. Preserve the degraded status for an operator to investigate.
        source.lifecycle.state = "degraded";
        source.lifecycle.reason = "Stream shutdown failed; manual recovery required.";
        throw new Error("Provider stream shutdown could not be confirmed.");
      }
    })();
    return stopPromise;
  };

  const recheckEntitlement = async (): Promise<boolean> => {
    if (closed) return false;
    if (checkPromise) return checkPromise;
    const pending = (async () => {
      let current: ProviderEntitlementDecision | null = null;
      try {
        current = await check();
      } catch {
        // Verification errors fail closed, without exposing provider secrets.
      }
      if (closed) return false;
      if (!current || !sameStreamingGrant(initial, current)) {
        reason = "Streaming entitlement was revoked, changed or could not be verified.";
        await stop();
        return false;
      }
      return true;
    })();
    checkPromise = pending;
    try {
      return await pending;
    } finally {
      if (checkPromise === pending) checkPromise = null;
    }
  };

  const timer = setInterval(() => {
    // Timer rejection must not turn a failed adapter stop into an unhandled
    // rejection. The lifecycle is marked degraded if shutdown fails.
    void recheckEntitlement().catch(() => {});
  }, intervalMs);
  timer.unref?.();

  return {
    lifecycle: source.lifecycle,
    stop,
    recheckEntitlement,
  };
}
