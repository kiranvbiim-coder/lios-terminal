import { TelegramPollingController } from "./telegramPollingController";
import {
  isTerminalTelegramFailure, listEnabledTelegramPollingTargets, purgeExpiredTelegramMessages, runTelegramPollCycle,
} from "./telegramConnectionService";

import { startTelegramAutoRunsAfterAdoption } from "./telegramAutoRunRuntime";
const RECONCILE_MS = 60_000;
const RETENTION_MS = 60 * 60_000;
let activeController: TelegramPollingController | null = null;

/** Redacted live polling state for one source, or null when Home is not currently running a loop for it. */
export function telegramPollingStatus(connectionId: number) {
  return activeController?.status().find(status => status.connectionId === connectionId) ?? null;
}

/**
 * Starts Home-owned polling only for explicitly enabled Telegram source connections. A clean install has none, so this
 * is inert and leaves every other Home capability untouched. Reconcile only starts newly enabled sources; revoked or
 * changed authority is discovered by each cycle's current-state checks, never by this controller's cached grant.
 * Retention enforcement also covers disconnected sources, because a stored policy does not lapse on disconnect.
 */
export function startTelegramPollingRuntime(): () => Promise<void> {
  const controller = new TelegramPollingController({
    cycle: async (target, signal) => {
      const adopted = await runTelegramPollCycle(target, signal);
      // Adoption has committed and released its source/Chat locks before canonical run admission.
      // Discovery failure must not turn an already-durable import into a provider polling failure.
      await startTelegramAutoRunsAfterAdoption(target.connectionId, signal).catch(() => undefined);
      return adopted;
    },
    isTerminalFailure: isTerminalTelegramFailure,
  });
  activeController = controller;
  let stopped = false;
  let reconciling = false;
  let purging: Promise<unknown> = Promise.resolve();
  const reconcile = async () => {
    if (stopped || reconciling) return;
    reconciling = true;
    try {
      for (const target of await listEnabledTelegramPollingTargets()) {
        if (stopped) return;
        controller.start(target);
      }
    } catch {
      // Discovery failure is retried on the next interval; it never reveals database or provider detail.
    } finally {
      reconciling = false;
    }
  };
  const purge = () => {
    if (stopped) return;
    purging = purging.then(() => purgeExpiredTelegramMessages()).catch(() => undefined);
  };
  void reconcile();
  purge();
  const timer = setInterval(() => { void reconcile(); }, RECONCILE_MS);
  const retentionTimer = setInterval(purge, RETENTION_MS);
  timer.unref();
  retentionTimer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(retentionTimer);
    if (activeController === controller) activeController = null;
    await controller.stop();
    await purging;
  };
}
