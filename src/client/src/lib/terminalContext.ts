import { useEffect, useMemo, useRef, useState } from "react";
import { createLiOSContext, patchLiOSContext, type LiOSContext } from "@shared/context";
import { getTerminalCapability } from "./terminalCatalog";
import {
  loadTerminalTimeContext,
  normalizeTimeContext,
  subscribeTerminalTimeContext,
  type TerminalTimeContext,
} from "./terminalTimeTravel";
import { getWorkspacePane } from "./terminalWorkspace";
import type { ViewMode, WorkspaceState } from "./terminalTypes";

export interface TerminalContextProjectionInput {
  view: ViewMode;
  symbol?: string | null;
  workspaceId?: string | null;
  portfolioId?: string | null;
  region?: string | null;
  scenarioId?: string | null;
  benchmarkId?: string | null;
  timeContext?: TerminalTimeContext;
}

export type TerminalWorkspaceContextExtras = Pick<
  TerminalContextProjectionInput,
  "workspaceId" | "portfolioId" | "region" | "scenarioId" | "benchmarkId"
>;

function projectionPatch(input: TerminalContextProjectionInput) {
  const capability = getTerminalCapability(input.view);
  const symbol = input.symbol?.trim().toUpperCase() ?? "";
  const time = normalizeTimeContext(input.timeContext ?? loadTerminalTimeContext());

  return {
    entity: capability.symbolAware && symbol
      ? { entityId: null, symbol, name: null, exchange: null, region: null, assetClass: null }
      : null,
    portfolioId: input.portfolioId ?? null,
    region: input.region ?? null,
    time: time.enabled && time.asOfDate
      ? { mode: "as-known-on" as const, asOfDate: time.asOfDate }
      : { mode: "latest" as const, asOfDate: null },
    scenarioId: input.scenarioId ?? null,
    benchmarkId: input.benchmarkId ?? null,
    workspaceId: input.workspaceId ?? capability.workspace,
    viewId: input.view,
  };
}

/**
 * Project existing terminal state into the product-wide context contract.
 * Existing workspace/time owners remain authoritative; this function does not
 * create a second source of truth.
 */
export function projectTerminalContext(
  input: TerminalContextProjectionInput,
  previous?: LiOSContext,
): LiOSContext {
  const patch = projectionPatch(input);
  return previous ? patchLiOSContext(previous, patch) : createLiOSContext(patch);
}

/**
 * Resolve context directly from the workspace's focused pane. Multi-pane
 * layouts therefore keep their local views, while the focused pane defines
 * the context that search, AI and context-aware actions should inherit.
 */
export function projectWorkspaceContext(
  workspace: WorkspaceState,
  timeContext: TerminalTimeContext,
  previous?: LiOSContext,
  extras: TerminalWorkspaceContextExtras = {},
): LiOSContext {
  const pane = getWorkspacePane(workspace, workspace.focusedPane) ?? workspace.primary;
  return projectTerminalContext({
    view: pane.view,
    symbol: pane.symbol,
    timeContext,
    ...extras,
  }, previous);
}

/**
 * Read-only React projection over the current terminal context. The hook
 * follows the existing time-context event when a caller does not provide an
 * explicit time context; view/symbol continue to come from the existing pane
 * owner. This is intentionally not a new global state store.
 */
export function useTerminalContextProjection(input: TerminalContextProjectionInput): LiOSContext {
  const [observedTime, setObservedTime] = useState<TerminalTimeContext>(() => input.timeContext ?? loadTerminalTimeContext());
  const previous = useRef<LiOSContext | undefined>(undefined);

  useEffect(() => {
    if (input.timeContext) {
      setObservedTime(normalizeTimeContext(input.timeContext));
      return;
    }
    setObservedTime(loadTerminalTimeContext());
    return subscribeTerminalTimeContext(setObservedTime);
  }, [input.timeContext]);

  const context = useMemo(() => projectTerminalContext({ ...input, timeContext: input.timeContext ?? observedTime }, previous.current), [
    input.view,
    input.symbol,
    input.workspaceId,
    input.portfolioId,
    input.region,
    input.scenarioId,
    input.benchmarkId,
    input.timeContext,
    observedTime,
  ]);
  previous.current = context;
  return context;
}
