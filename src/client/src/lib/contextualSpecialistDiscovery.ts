import type { ViewMode } from "./terminalTypes";
import {
  isRegisteredView, isViewVisibleToAudience,
  type WorkspaceAudience, type WorkspaceKey,
} from "./featureRegistry";
import {
  searchTerminalCapabilities, TERMINAL_CAPABILITIES,
  type TerminalCapability,
} from "./terminalCatalog";
import { getRelatedToolActions } from "./terminalToolGraph";

/** Navigation suggestions only. Tool execution, source rights and runtime readiness
 * remain with the original LiOS authorities, not the Command Bar. */
export interface DiscoverableSpecialist {
  capability: TerminalCapability;
  /** A relationship from the existing professional tool graph, not AI advice. */
  relatedReason?: string;
}

export interface SpecialistBrowseRequest {
  query: string;
  audience: WorkspaceAudience;
  activeView?: ViewMode | null;
  workspace?: WorkspaceKey | "all";
  limit?: number;
}

/** The explicit Tools filter browses the *registered* audience-visible catalog.
 * The default all-results Chat/Command experience deliberately stays quiet. */
export function browseRegisteredSpecialists(request: SpecialistBrowseRequest): DiscoverableSpecialist[] {
  const query = request.query.trim();
  const related = request.activeView
    ? getRelatedToolActions(request.activeView, request.audience === "internal")
    : [];
  const rank = new Map(related.map((action, index) => [action.view, index]));
  const reason = new Map(related.map((action) => [action.view, action.reason]));
  const candidates = query
    ? searchTerminalCapabilities(query, request.audience === "internal", TERMINAL_CAPABILITIES.length)
    : TERMINAL_CAPABILITIES;

  const filtered = candidates
    .filter((capability) => isRegisteredView(capability.view))
    .filter((capability) => isViewVisibleToAudience(capability.view, request.audience))
    .filter((capability) => !request.workspace || request.workspace === "all" || capability.workspace === request.workspace);

  if (!query) {
    filtered.sort((left, right) => {
      const leftRank = rank.get(left.view) ?? Infinity;
      const rightRank = rank.get(right.view) ?? Infinity;
      return leftRank - rightRank
        || Number(right.hero) - Number(left.hero)
        || left.label.localeCompare(right.label);
    });
  }

  const limit = request.limit === undefined ? filtered.length
    : Math.max(0, Math.min(filtered.length, Math.floor(request.limit)));
  return filtered.slice(0, limit).map((capability) => ({
    capability,
    ...(reason.has(capability.view) ? { relatedReason: reason.get(capability.view) } : {}),
  }));
}
