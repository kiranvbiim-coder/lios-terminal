import { TelegramPollingController } from "./telegramPollingController";
import { isTerminalTelegramFailure, listEnabledTelegramPollingTargets, runTelegramPollCycle } from "./telegramConnectionService";

const RECONCILE_MS = 60_000;

/**
 * Starts Home-owned polling only for explicitly enabled Telegram source connections. A clean install has none, so this
 * is inert and leaves every other Home capability untouched. Reconcile only starts newly enabled sources; revoked or
 * changed authority is discovered by each cycle's current-state checks, never by this controller's cached grant.
 */
export function startTelegramPollingRuntime(): () => Promise<void> {
  const controller = new TelegramPollingController({
    cycle: (target, signal) => runTelegramPollCycle(target, signal),
    isTerminalFailure: isTerminalTelegramFailure,
  });
  let stopped = false;
  let reconciling = false;
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
  void reconcile();
  const timer = setInterval(() => { void reconcile(); }, RECONCILE_MS);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await controller.stop();
  };
}
