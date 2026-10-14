import type { LiOSContext } from "@shared/context";
import { applyLinkedContextToLiOSContext, normalizeLinkedContext, type TerminalLinkedContext } from "./terminalLinkedContext";
import type { TerminalTimeContext } from "./terminalTimeTravel";

function terminalTimeFromLiOS(context: LiOSContext["time"]): TerminalTimeContext {
  return context.mode === "as-known-on" && context.asOfDate
    ? { enabled: true, asOfDate: context.asOfDate, mode: "as-known-on" }
    : { enabled: false, asOfDate: null, mode: "latest" };
}

/**
 * Convert the linkable dimensions of the Universal LiOS Context into the tab
 * propagation payload. Instrument is included only when the universal context
 * actually has an entity; non-symbol views therefore never invent a ticker.
 */
export function linkedContextFromLiOSContext(context: LiOSContext): TerminalLinkedContext {
  return normalizeLinkedContext({
    ...(context.entity?.symbol ? { instrument: context.entity.symbol } : {}),
    time: terminalTimeFromLiOS(context.time),
    scenarioId: context.scenarioId,
    portfolioId: context.portfolioId,
    benchmarkId: context.benchmarkId,
  });
}

/** Round-trip helper used by context-aware surfaces and future Master AI wiring. */
export function mergeLinkedLiOSContext(context: LiOSContext, linked: TerminalLinkedContext): LiOSContext {
  return applyLinkedContextToLiOSContext(context, linked);
}
