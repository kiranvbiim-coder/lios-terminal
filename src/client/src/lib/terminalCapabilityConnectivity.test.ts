import test from "node:test";
import assert from "node:assert/strict";
import { TERMINAL_CAPABILITIES } from "./terminalCatalog";
import { ANALYSIS_JOURNEYS, getRelatedToolActions, getIncomingToolActions } from "./terminalToolGraph";
import { TERMINAL_USE_CASES } from "./terminalUseCaseRegistry";
import type { ViewMode } from "./terminalTypes";

// This is a ratchet, not a target. It exists to stop the terminal from
// re-accumulating undiscoverable capabilities. The 16 listed below are
// deliberate: `environment` is a modal trigger, not a pane, and can never
// participate in the pane-discovery mechanisms below. The remaining
// specialty, legacy, media/tourism and internal-administration surfaces stay
// explicitly searchable without being forced into a finance workflow. This
// is a bounded exception list, not a target for adding more disconnected
// capabilities.
//
// A capability counts as "connected" if it is reachable through at least
// one of the terminal's three cross-capability discovery mechanisms:
//   - the tool graph (getRelatedToolActions/getIncomingToolActions in
//     terminalToolGraph.ts) -- surfaced as "related actions" in ContextRail
//   - an ANALYSIS_JOURNEYS stage -- surfaced as the guided-mode storyline
//   - a TERMINAL_USE_CASES entry -- surfaced in Cognitive Core / search
// or is a HERO_VIEW (definitionally connected -- it's a default CommandBar
// result). Anything satisfying none of these is reachable only by knowing
// its exact name in advance (direct sidebar click or exact-match search)
// -- it has no path INTO it from anywhere else in the product.
//
// Adding a new ViewMode to terminalCatalog.ts without wiring it into one
// of the three mechanisms above will fail the first test below. That is
// the point: it forces a decision (wire it in, or justify the isolation
// here) instead of letting the catalog grow unnoticed.
const KNOWN_DISCONNECTED_VIEWS = new Set<ViewMode>([
  "heatmap", "cryptochain",
  "developer", "adminconsole", "consultinginbox", "publishdesk", "globalindicators", "marketbreadth",
  "mediaindicators", "mediadashboard", "tourismindicators", "uide", "advisory", "activity", "environment",
]);

function journeyViews(): Set<ViewMode> {
  const views = new Set<ViewMode>();
  for (const journey of ANALYSIS_JOURNEYS) for (const stage of journey.stages) for (const view of stage.views) views.add(view);
  return views;
}

function useCaseViews(): Set<ViewMode> {
  const views = new Set<ViewMode>();
  for (const useCase of TERMINAL_USE_CASES) for (const view of useCase.views) views.add(view);
  return views;
}

function isConnected(view: ViewMode, journeys: Set<ViewMode>, useCases: Set<ViewMode>): boolean {
  const hasEdge = ["internal", "client"].some((audience) => {
    const isInternal = audience === "internal";
    return getRelatedToolActions(view, isInternal).length > 0 || getIncomingToolActions(view, isInternal).length > 0;
  });
  return hasEdge || journeys.has(view) || useCases.has(view);
}

test("no new capability is added without a tool-graph edge, a journey stage, or a use case", () => {
  const journeys = journeyViews();
  const useCases = useCaseViews();
  const newlyDisconnected = TERMINAL_CAPABILITIES
    .filter((capability) => !capability.hero)
    .filter((capability) => !isConnected(capability.view, journeys, useCases))
    .map((capability) => capability.view)
    .filter((view) => !KNOWN_DISCONNECTED_VIEWS.has(view));

  assert.deepEqual(
    newlyDisconnected,
    [],
    `These capabilities have no tool-graph edge, journey stage, or use case, and are not hero views: ` +
      `${newlyDisconnected.join(", ")}. Wire them into an existing journey/use case/tool-graph edge in ` +
      `terminalToolGraph.ts or terminalUseCaseRegistry.ts before merging, or add them to ` +
      `KNOWN_DISCONNECTED_VIEWS above with a one-line reason if the isolation is genuinely deliberate ` +
      `(e.g. rarely-used admin tooling) -- that should be the exception, not the default.`,
  );
});

test("KNOWN_DISCONNECTED_VIEWS shrinks as capabilities get wired in, and never lists a removed view", () => {
  const journeys = journeyViews();
  const useCases = useCaseViews();
  const stale = Array.from(KNOWN_DISCONNECTED_VIEWS).filter((view) => {
    const capability = TERMINAL_CAPABILITIES.find((entry) => entry.view === view);
    if (!capability) return true; // view no longer exists in the catalog at all
    return capability.hero || isConnected(view, journeys, useCases);
  });

  assert.deepEqual(
    stale,
    [],
    `These entries in KNOWN_DISCONNECTED_VIEWS are no longer disconnected (someone wired them into a ` +
      `journey/use case/tool-graph edge, or made them hero) or no longer exist in the catalog -- remove ` +
      `them from the allowlist so it reflects real remaining debt: ${stale.join(", ")}`,
  );
});
